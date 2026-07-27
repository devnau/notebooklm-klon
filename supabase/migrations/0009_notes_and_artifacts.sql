-- ═══════════════════════════════════════════════════════════════════════════
-- 0009 · Notizen und Studio-Artefakte
--
-- Zwei Wege, aus einer Unterhaltung etwas Bleibendes zu machen:
--
--  * **Notizen** schreibt der Nutzer selbst, oder er übernimmt eine Antwort.
--  * **Artefakte** erzeugt das Modell auf Knopfdruck über alle Quellen hinweg:
--    Zusammenfassung, Lernleitfaden, FAQ, Zeitleiste, Briefing, Mindmap.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Notizen ────────────────────────────────────────────────────────────────
create table public.notes (
  id            uuid primary key default gen_random_uuid(),
  notebook_id   uuid not null references public.notebooks (id) on delete cascade,
  title         text not null default 'Neue Notiz'
                  check (length(btrim(title)) between 1 and 300),
  -- Markdown. Beim Anzeigen sanitisiert, nicht beim Speichern: was der Nutzer
  -- geschrieben hat, soll erhalten bleiben — auch wenn es zufällig wie Markup
  -- aussieht. Die Entscheidung, was gerendert wird, gehört an die Stelle, an
  -- der gerendert wird.
  content       text not null default '',
  kind          text not null default 'user' check (kind in ('user', 'generated')),
  /*
   * Übernommene Zitate, gleiche Form wie in `messages`. Damit bleibt ein
   * Beleg auch dann anklickbar, wenn die Unterhaltung längst gelöscht ist —
   * eine Notiz ohne nachprüfbare Herkunft wäre nur noch eine Behauptung.
   */
  citations     jsonb not null default '[]'::jsonb,
  /** Aus welcher Nachricht die Notiz entstanden ist, falls übernommen. */
  source_message_id bigint references public.messages (id) on delete set null,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.notes is
  'Notizen im Notizbuch — selbst geschrieben oder aus einer Antwort übernommen.';

create index notes_notebook_idx on public.notes (notebook_id, updated_at desc);

create trigger notes_set_updated_at
  before update on public.notes
  for each row execute function public.set_updated_at();

-- ── Artefakte ──────────────────────────────────────────────────────────────
create table public.artifacts (
  id            uuid primary key default gen_random_uuid(),
  notebook_id   uuid not null references public.notebooks (id) on delete cascade,
  kind          text not null check (kind in (
                  'summary', 'study_guide', 'faq', 'timeline', 'briefing', 'mindmap', 'audio'
                )),
  status        text not null default 'pending'
                  check (status in ('pending', 'running', 'ready', 'failed')),
  /*
   * Der Inhalt, strukturiert. Je `kind` ein eigenes Schema — validiert wird
   * gegen dieselben Zod-Schemas, mit denen das Modell zur Ausgabe gezwungen
   * wird (packages/shared/src/artifacts.ts). Freier Text hätte bedeutet, dass
   * die Oberfläche raten muss, wie sie ihn darstellt.
   */
  payload       jsonb,
  error         text,
  /** Für den Audio-Überblick ab Phase 5: die gerenderte Datei. */
  storage_path  text,
  /*
   * Welche Quellen eingeflossen sind. Kommt eine Quelle dazu, ist das Artefakt
   * veraltet — die Oberfläche kann das anzeigen, statt eine Zusammenfassung
   * auszugeben, die die Hälfte nicht kennt.
   */
  source_ids    uuid[],
  input_tokens      int,
  output_tokens     int,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.artifacts is
  'Vom Modell erzeugte Übersichten über alle Quellen eines Notizbuchs.';

create index artifacts_notebook_idx on public.artifacts (notebook_id, created_at desc);

/*
 * Ein Artefakt je Art und Notizbuch, solange es nicht fehlgeschlagen ist.
 *
 * Ohne diese Einschränkung entstünde bei jedem Klick auf „Zusammenfassung" eine
 * weitere, und die Studio-Spalte füllte sich mit Dubletten, zwischen denen
 * niemand unterscheiden kann. Fehlgeschlagene sind ausgenommen: sie bleiben mit
 * ihrer Fehlermeldung stehen, bis der Nutzer sie wegräumt, und dürfen einen
 * neuen Versuch nicht blockieren.
 */
create unique index artifacts_one_per_kind_idx
  on public.artifacts (notebook_id, kind)
  where status <> 'failed';

create trigger artifacts_set_updated_at
  before update on public.artifacts
  for each row execute function public.set_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.notes     enable row level security;
alter table public.notes     force row level security;
alter table public.artifacts enable row level security;
alter table public.artifacts force row level security;

create policy notes_select_member on public.notes
  for select to authenticated
  using (public.is_notebook_member(notebook_id, 'viewer'));

create policy notes_insert_editor on public.notes
  for insert to authenticated
  with check (public.is_notebook_member(notebook_id, 'editor'));

create policy notes_update_editor on public.notes
  for update to authenticated
  using (public.is_notebook_member(notebook_id, 'editor'))
  with check (public.is_notebook_member(notebook_id, 'editor'));

create policy notes_delete_editor on public.notes
  for delete to authenticated
  using (public.is_notebook_member(notebook_id, 'editor'));

create policy artifacts_select_member on public.artifacts
  for select to authenticated
  using (public.is_notebook_member(notebook_id, 'viewer'));

/*
 * Artefakte legt der Client **nicht** direkt an — das macht
 * `request_artifact()` weiter unten, zusammen mit dem Job. Eine INSERT-Policy
 * gibt es trotzdem nicht: sie wäre eine zweite Tür zu demselben Raum, und die
 * Prüfung „gibt es schon eines dieser Art?" liesse sich daran vorbei umgehen.
 */
create policy artifacts_update_editor on public.artifacts
  for update to authenticated
  using (public.is_notebook_member(notebook_id, 'editor'))
  with check (public.is_notebook_member(notebook_id, 'editor'));

create policy artifacts_delete_editor on public.artifacts
  for delete to authenticated
  using (public.is_notebook_member(notebook_id, 'editor'));

-- Statuswechsel live in die Studio-Spalte, wie bei den Quellen.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.artifacts;
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Erzeugung anstossen
-- ═══════════════════════════════════════════════════════════════════════════

/**
 * Fordert ein Artefakt an: legt die Zeile an und reiht den Job ein.
 *
 * Wie bei `retry_source` in einer Funktion statt in zwei Aufrufen vom Client,
 * und aus denselben Gründen: `jobs` darf der Client nicht beschreiben, und ein
 * halber Zustand — Artefakt auf `pending` ohne Job — sähe in der Oberfläche
 * ewig so aus, als würde gleich etwas passieren.
 *
 * Ist bereits eines dieser Art vorhanden, wird es zurückgesetzt und neu
 * erzeugt. Das ist der Fall „neue Quelle hinzugefügt, Zusammenfassung
 * auffrischen" — und er soll keine zweite Zeile erzeugen.
 */
create or replace function public.request_artifact(
  p_notebook uuid,
  p_kind     text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
  ready_sources uuid[];
begin
  if not public.is_notebook_member(p_notebook, 'editor') then
    raise exception 'Keine Berechtigung' using errcode = 'insufficient_privilege';
  end if;

  if p_kind not in ('summary', 'study_guide', 'faq', 'timeline', 'briefing', 'mindmap') then
    raise exception 'Unbekannte Artefaktart: %', p_kind
      using errcode = 'invalid_parameter_value';
  end if;

  select array_agg(s.id) into ready_sources
  from public.sources s
  where s.notebook_id = p_notebook and s.status = 'ready';

  if ready_sources is null then
    raise exception 'Keine verarbeitete Quelle vorhanden'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Fehlgeschlagene Versuche derselben Art wegräumen: der Teilindex lässt sie
  -- zu, und ohne dieses Aufräumen sammelten sie sich an.
  delete from public.artifacts
  where notebook_id = p_notebook and kind = p_kind and status = 'failed';

  insert into public.artifacts (notebook_id, kind, status, source_ids, created_by)
  values (p_notebook, p_kind, 'pending', ready_sources, auth.uid())
  on conflict (notebook_id, kind) where status <> 'failed'
  do update set
    status = 'pending',
    payload = null,
    error = null,
    source_ids = excluded.source_ids,
    updated_at = now()
  returning id into target_id;

  insert into public.jobs (kind, notebook_id, payload)
  values ('generate_artifact', p_notebook,
          jsonb_build_object('artifactId', target_id, 'kind', p_kind));

  return target_id;
end;
$$;

comment on function public.request_artifact(uuid, text) is
  'Legt ein Artefakt an oder frischt es auf und reiht die Erzeugung ein.';

revoke all on function public.request_artifact(uuid, text) from public;
grant execute on function public.request_artifact(uuid, text) to authenticated;
