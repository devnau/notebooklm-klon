-- ═══════════════════════════════════════════════════════════════════════════
-- 0004 · Quellen, Chunks und die Job-Warteschlange
--
-- Der Kern der Suche. Drei Entscheidungen, die hier festgelegt werden:
--
--  * notebook_id liegt auch auf chunks, obwohl es über source_id herleitbar
--    wäre. Die RLS-Policy kommt damit ohne Join aus — bei zehntausenden Chunks
--    ist das messbar — und der Vektorindex kann direkt darauf filtern.
--  * HNSW statt IVFFlat: kein Trainingsschritt, und bei laufend
--    hinzukommenden Quellen muss der Index nicht neu aufgebaut werden.
--  * Die Job-Warteschlange ist eine Tabelle, kein externer Broker. Status,
--    Versuchszähler und Fehlertext sind damit als Zeilen sichtbar und ohne
--    Zusatzarbeit in der UI darstellbar.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Quellen ────────────────────────────────────────────────────────────────
create table public.sources (
  id              uuid primary key default gen_random_uuid(),
  notebook_id     uuid not null references public.notebooks (id) on delete cascade,
  kind            text not null check (kind in ('pdf', 'docx', 'txt', 'md', 'url', 'paste')),
  title           text not null check (length(btrim(title)) between 1 and 500),
  -- Genau eines von beiden ist gesetzt: Datei im Storage oder abgerufene URL.
  storage_path    text,
  source_url      text,
  byte_size       bigint check (byte_size is null or byte_size >= 0),
  mime_type       text,
  status          text not null default 'pending'
                    check (status in ('pending', 'extracting', 'embedding', 'ready', 'failed')),
  -- Klartext für die UI, nicht der rohe Stacktrace.
  error           text,
  char_count      int check (char_count is null or char_count >= 0),
  page_count      int check (page_count is null or page_count >= 0),
  -- Kurzfassung und Schlagworte kommen vom Modell und gehen in die
  -- Quellenübersicht des Chat-Prompts ein.
  summary         text,
  key_topics      text[],
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint sources_location_present check (
    (storage_path is not null) or (source_url is not null) or (kind = 'paste')
  )
);

comment on table public.sources is
  'Eine hochgeladene, abgerufene oder eingefügte Quelle samt Verarbeitungsstatus.';

create index sources_notebook_idx on public.sources (notebook_id, created_at desc);
create index sources_status_idx on public.sources (status) where status <> 'ready';

create trigger sources_set_updated_at
  before update on public.sources
  for each row execute function public.set_updated_at();

-- ── Chunks ─────────────────────────────────────────────────────────────────
create table public.chunks (
  id            bigint generated always as identity primary key,
  source_id     uuid not null references public.sources (id) on delete cascade,
  notebook_id   uuid not null references public.notebooks (id) on delete cascade,
  -- Reihenfolge innerhalb der Quelle; Teil des Zitat-Labels [S<n>:<idx>].
  idx           int not null check (idx >= 0),
  content       text not null,
  -- "Kapitel 3 › Methodik" — gibt dem Modell Kontext und dem Nutzer Orientierung.
  heading_path  text,
  -- Für PDF-Sprungmarken.
  page          int check (page is null or page > 0),
  -- Zeichenoffsets in der extrahierten Fassung, für die Hervorhebung im Viewer.
  char_start    int check (char_start is null or char_start >= 0),
  char_end      int check (char_end is null or char_end >= char_start),
  token_count   int check (token_count is null or token_count > 0),
  embedding     extensions.vector(1024),
  -- Generierte Spalte statt Trigger: kann nicht vergessen werden.
  tsv           tsvector generated always as (to_tsvector('german', content)) stored,
  created_at    timestamptz not null default now(),

  unique (source_id, idx)
);

comment on table public.chunks is
  'Ein Textabschnitt einer Quelle mit Embedding und Volltextindex. Zieleinheit jedes Zitats.';
comment on column public.chunks.notebook_id is
  'Redundant zu sources.notebook_id, aber bewusst: erspart der RLS-Policy und dem Vektorfilter einen Join.';

-- Vektorsuche. m und ef_construction sind die Standardwerte; bei deutlich
-- größeren Beständen lohnt ein höheres ef_construction (langsamerer Aufbau,
-- bessere Trefferquote).
create index chunks_embedding_idx on public.chunks
  using hnsw (embedding extensions.vector_cosine_ops);

-- Volltextsuche.
create index chunks_tsv_idx on public.chunks using gin (tsv);

-- Lesen einer Quelle in Reihenfolge, und der Filter der Policy.
create index chunks_notebook_source_idx on public.chunks (notebook_id, source_id, idx);

-- ── Job-Warteschlange ──────────────────────────────────────────────────────
create table public.jobs (
  id            bigint generated always as identity primary key,
  kind          text not null check (kind in ('ingest_source', 'generate_artifact', 'render_audio')),
  -- Notebook-Bezug für RLS und für die Statusanzeige in der UI.
  notebook_id   uuid not null references public.notebooks (id) on delete cascade,
  payload       jsonb not null default '{}'::jsonb,
  status        text not null default 'queued'
                  check (status in ('queued', 'running', 'done', 'failed')),
  attempts      int not null default 0 check (attempts >= 0),
  max_attempts  int not null default 3 check (max_attempts > 0),
  -- Steuert Backoff: vor diesem Zeitpunkt wird der Job nicht aufgegriffen.
  run_after     timestamptz not null default now(),
  -- Wer hält den Job und seit wann. Ohne das bliebe ein Job für immer
  -- 'running', wenn der Worker mitten in der Arbeit stirbt.
  locked_by     text,
  locked_at     timestamptz,
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.jobs is
  'Warteschlange für langlaufende Arbeit. Wird per SELECT ... FOR UPDATE SKIP LOCKED abgearbeitet.';

-- Der Index, auf dem das Aufgreifen läuft: nur offene Jobs, nach Fälligkeit.
create index jobs_pickup_idx on public.jobs (run_after, id)
  where status = 'queued';
create index jobs_notebook_idx on public.jobs (notebook_id, created_at desc);
-- Für das Wiedereinsammeln hängengebliebener Jobs.
create index jobs_stale_idx on public.jobs (locked_at) where status = 'running';

create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.sources enable row level security;
alter table public.chunks  enable row level security;
alter table public.jobs    enable row level security;

alter table public.sources force row level security;
alter table public.chunks  force row level security;
alter table public.jobs    force row level security;

-- ── sources ────────────────────────────────────────────────────────────────
create policy sources_select_member on public.sources
  for select to authenticated
  using (public.is_notebook_member(notebook_id, 'viewer'));

create policy sources_insert_editor on public.sources
  for insert to authenticated
  with check (public.is_notebook_member(notebook_id, 'editor'));

create policy sources_update_editor on public.sources
  for update to authenticated
  using (public.is_notebook_member(notebook_id, 'editor'))
  with check (public.is_notebook_member(notebook_id, 'editor'));

create policy sources_delete_editor on public.sources
  for delete to authenticated
  using (public.is_notebook_member(notebook_id, 'editor'));

-- ── chunks ─────────────────────────────────────────────────────────────────
-- Lesen genügt für Clients: Chunks entstehen ausschließlich im Worker, der mit
-- service_role arbeitet. Es gibt bewusst keine INSERT- oder UPDATE-Policy für
-- authenticated — der Inhalt eines Zitats darf nicht von außen manipulierbar
-- sein, sonst ist das Zitat nichts wert.
create policy chunks_select_member on public.chunks
  for select to authenticated
  using (public.is_notebook_member(notebook_id, 'viewer'));

-- ── jobs ───────────────────────────────────────────────────────────────────
-- Nur lesen, für die Fortschrittsanzeige. Angelegt und verändert werden Jobs
-- serverseitig.
create policy jobs_select_member on public.jobs
  for select to authenticated
  using (public.is_notebook_member(notebook_id, 'viewer'));

-- ═══════════════════════════════════════════════════════════════════════════
-- Grants
-- ═══════════════════════════════════════════════════════════════════════════
grant select, insert, update, delete on public.sources to authenticated;
grant select on public.chunks to authenticated;
grant select on public.jobs to authenticated;

grant all on public.sources, public.chunks, public.jobs to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- Job aufgreifen
--
-- SKIP LOCKED überspringt Zeilen, die ein anderer Worker gerade hält. Damit
-- können mehrere Worker parallel laufen, ohne Broker und ohne Advisory Locks.
-- Ohne SKIP LOCKED würden sie sich blockieren und einer nach dem anderen
-- arbeiten.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.claim_job(worker_id text)
returns table (
  job_id      bigint,
  kind        text,
  notebook_id uuid,
  payload     jsonb,
  attempts    int
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with picked as (
    select j.id
    from public.jobs j
    where j.status = 'queued'
      and j.run_after <= now()
    order by j.run_after, j.id
    for update skip locked
    limit 1
  )
  update public.jobs j
  set status = 'running',
      attempts = j.attempts + 1,
      locked_by = worker_id,
      locked_at = now(),
      updated_at = now()
  from picked
  where j.id = picked.id
  returning j.id, j.kind, j.notebook_id, j.payload, j.attempts;
end;
$$;

comment on function public.claim_job(text) is
  'Greift den nächsten fälligen Job atomar auf und markiert ihn als running.';

revoke all on function public.claim_job(text) from public;
grant execute on function public.claim_job(text) to service_role;

-- ── Hängengebliebene Jobs zurückholen ──────────────────────────────────────
-- Stirbt ein Worker mitten in der Arbeit, bleibt sein Job für immer 'running'.
-- Diese Funktion gibt Jobs frei, deren Lease abgelaufen ist.
create or replace function public.requeue_stale_jobs(lease_seconds int default 900)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected int;
begin
  with stale as (
    update public.jobs j
    set status = case when j.attempts >= j.max_attempts then 'failed' else 'queued' end,
        locked_by = null,
        locked_at = null,
        error = case
                  when j.attempts >= j.max_attempts
                  then 'Verarbeitung abgebrochen: der Worker hat den Job nicht abgeschlossen.'
                  else j.error
                end,
        -- Backoff, damit ein wiederkehrender Fehler nicht sofort erneut läuft.
        run_after = now() + (interval '1 minute' * j.attempts),
        updated_at = now()
    where j.status = 'running'
      and j.locked_at < now() - make_interval(secs => lease_seconds)
    returning 1
  )
  select count(*) into affected from stale;
  return affected;
end;
$$;

comment on function public.requeue_stale_jobs(int) is
  'Gibt Jobs frei, deren Worker sie nicht abgeschlossen hat. Nach max_attempts endgültig failed.';

revoke all on function public.requeue_stale_jobs(int) from public;
grant execute on function public.requeue_stale_jobs(int) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- Realtime
--
-- Die UI verfolgt den Verarbeitungsfortschritt live statt zu pollen. Dafür muss
-- die Tabelle in der Publikation liegen; RLS gilt dabei weiterhin, ein Nutzer
-- bekommt also nur Änderungen an seinen eigenen Quellen.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.sources;
  end if;
end $$;
