-- ═══════════════════════════════════════════════════════════════════════════
-- 0008 · Unterhaltungen und die Hybrid-Suche
--
-- Das Herzstück. Zwei Dinge entstehen hier:
--
--  1. `chats` und `messages` — die Unterhaltung, samt der Zitate, auf die sich
--     eine Antwort beruft.
--  2. `match_chunks()` — Vektor- und Volltextsuche, zusammengeführt per
--     Reciprocal Rank Fusion.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Unterhaltungen ─────────────────────────────────────────────────────────
create table public.chats (
  id            uuid primary key default gen_random_uuid(),
  notebook_id   uuid not null references public.notebooks (id) on delete cascade,
  title         text not null default 'Neue Unterhaltung'
                  check (length(btrim(title)) between 1 and 300),
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.chats is 'Eine Unterhaltung innerhalb eines Notebooks.';

create index chats_notebook_idx on public.chats (notebook_id, updated_at desc);

create trigger chats_set_updated_at
  before update on public.chats
  for each row execute function public.set_updated_at();

create table public.messages (
  id            bigint generated always as identity primary key,
  chat_id       uuid not null references public.chats (id) on delete cascade,
  -- Auch hier redundant, wie bei chunks: die RLS-Policy kommt ohne Join aus.
  notebook_id   uuid not null references public.notebooks (id) on delete cascade,
  role          text not null check (role in ('user', 'assistant')),
  content       text not null,
  /*
   * Die Zitate der Antwort, normalisiert:
   *   [{ "label": "S1:4", "sourceId": "…", "chunkId": 42,
   *      "page": 3, "headingPath": "Kapitel 2 › 2.1",
   *      "charStart": 1200, "charEnd": 1980 }]
   *
   * Als jsonb und nicht als eigene Tabelle: Zitate werden immer zusammen mit
   * ihrer Nachricht gelesen und nie einzeln abgefragt. Eine Join-Tabelle wäre
   * hier Aufwand ohne Nutzen — und Zitate sind unveränderlich, sobald die
   * Antwort steht.
   */
  citations     jsonb not null default '[]'::jsonb,
  -- Welche Quellen beim Erzeugen dieser Antwort überhaupt zur Auswahl standen.
  -- Ohne diese Angabe lässt sich später nicht nachvollziehen, warum das Modell
  -- etwas nicht wusste.
  source_ids    uuid[],
  -- Verbrauch je Antwort, Grundlage für die Kostenerfassung in Phase 7.
  input_tokens        int,
  output_tokens       int,
  cache_read_tokens   int,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);

comment on table public.messages is
  'Eine Nachricht in einer Unterhaltung, bei Antworten samt Zitaten.';

create index messages_chat_idx on public.messages (chat_id, id);

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.chats    enable row level security;
alter table public.chats    force row level security;
alter table public.messages enable row level security;
alter table public.messages force row level security;

create policy chats_select_member on public.chats
  for select to authenticated
  using (public.is_notebook_member(notebook_id, 'viewer'));

/*
 * Schreiben erst ab editor. Ein viewer darf mitlesen, aber nicht fragen — jede
 * Frage kostet Geld und erzeugt Inhalte im Notebook eines anderen.
 */
create policy chats_insert_editor on public.chats
  for insert to authenticated
  with check (public.is_notebook_member(notebook_id, 'editor'));

create policy chats_update_editor on public.chats
  for update to authenticated
  using (public.is_notebook_member(notebook_id, 'editor'))
  with check (public.is_notebook_member(notebook_id, 'editor'));

create policy chats_delete_editor on public.chats
  for delete to authenticated
  using (public.is_notebook_member(notebook_id, 'editor'));

create policy messages_select_member on public.messages
  for select to authenticated
  using (public.is_notebook_member(notebook_id, 'viewer'));

create policy messages_insert_editor on public.messages
  for insert to authenticated
  with check (public.is_notebook_member(notebook_id, 'editor'));

/*
 * Kein UPDATE auf Nachrichten. Eine Antwort samt ihrer Zitate ist ein
 * Protokoll: sie hält fest, was das Modell zu einem Zeitpunkt auf Basis
 * welcher Auszüge gesagt hat. Nachträglich änderbar wäre sie als Beleg
 * wertlos. Korrigieren heißt: neu fragen.
 */
create policy messages_delete_editor on public.messages
  for delete to authenticated
  using (public.is_notebook_member(notebook_id, 'editor'));

-- ═══════════════════════════════════════════════════════════════════════════
-- Hybrid-Suche
-- ═══════════════════════════════════════════════════════════════════════════

/**
 * Findet die Abschnitte, die zu einer Frage passen.
 *
 * Zwei Suchen, ein Ergebnis:
 *
 *  * **Vektorsuche** findet, was inhaltlich gemeint ist, auch bei anderer
 *    Wortwahl. Sie versagt bei Eigennamen, Aktenzeichen und Zahlen — die
 *    liegen im Einbettungsraum nah bei allem Ähnlichen und nirgends genau.
 *  * **Volltextsuche** findet genau diese exakten Zeichenketten, versteht aber
 *    keine Umschreibung.
 *
 * Zusammengeführt per Reciprocal Rank Fusion: jede Liste steuert `1/(k+rang)`
 * bei. Bewusst über den *Rang* statt über die Punktzahl — Kosinusdistanz und
 * ts_rank_cd haben keine gemeinsame Skala, jede Gewichtung von rohen Werten
 * wäre geraten. RRF braucht keine.
 *
 * `k = 60` ist der Wert aus der ursprünglichen Arbeit zu RRF. Er dämpft die
 * Dominanz der ersten Plätze: Rang 1 und 2 unterscheiden sich damit weniger
 * stark, als es ihre rohen Punktzahlen nahelegen würden — was gewollt ist,
 * weil keine der beiden Suchen für sich zuverlässig genug ist.
 *
 * `stable`, nicht `volatile`: der Planer darf die Funktion innerhalb einer
 * Anweisung wiederverwenden.
 *
 * Zur Schreibweise `operator(extensions.<=>)`: mit leerem `search_path` findet
 * Postgres den Operator sonst nicht, weil pgvector im Schema `extensions`
 * liegt. Den Suchpfad stattdessen zu erweitern wäre die bequemere, aber
 * schlechtere Lösung — ein fester, leerer Suchpfad ist die einzige Absicherung
 * dagegen, dass jemand mit einem gleichnamigen Objekt in einem anderen Schema
 * dazwischenfunkt.
 *
 * **Kein `security definer`.** Die Funktion läuft mit den Rechten des
 * Aufrufers, damit RLS auf `chunks` greift. Mit `security definer` würde sie
 * jedem Angemeldeten die Abschnitte jedes Notebooks liefern, sobald er eine
 * fremde ID errät — die Zugriffsprüfung läge dann allein im Anwendungscode.
 */
create or replace function public.match_chunks(
  p_notebook   uuid,
  p_query      text,
  p_embedding  extensions.vector(1024),
  p_source_ids uuid[] default null,
  p_limit      int default 20,
  p_candidates int default 60
)
returns table (
  chunk_id     bigint,
  source_id    uuid,
  idx          int,
  content      text,
  heading_path text,
  page         int,
  char_start   int,
  char_end     int,
  score        double precision,
  vector_rank  int,
  fulltext_rank int
)
language sql
stable
set search_path = ''
as $$
  with
  -- Der Filter wird in beiden Zweigen gebraucht; als eigene CTE steht die
  -- Bedingung nur einmal da und kann nicht auseinanderlaufen.
  eligible as (
    select c.id, c.source_id, c.content, c.heading_path, c.page,
           c.char_start, c.char_end, c.idx, c.embedding, c.tsv
    from public.chunks c
    where c.notebook_id = p_notebook
      and (p_source_ids is null or c.source_id = any (p_source_ids))
  ),
  vec as (
    select e.id,
           row_number() over (order by e.embedding operator(extensions.<=>) p_embedding) as rnk
    from eligible e
    where e.embedding is not null
    order by e.embedding operator(extensions.<=>) p_embedding
    limit p_candidates
  ),
  fts as (
    select e.id,
           row_number() over (
             order by ts_rank_cd(e.tsv, q.query) desc, e.id
           ) as rnk
    from eligible e,
         websearch_to_tsquery('german', p_query) as q(query)
    where e.tsv @@ q.query
    limit p_candidates
  )
  select e.id,
         e.source_id,
         e.idx,
         e.content,
         e.heading_path,
         e.page,
         e.char_start,
         e.char_end,
         coalesce(1.0 / (60 + v.rnk), 0) + coalesce(1.0 / (60 + f.rnk), 0) as score,
         v.rnk::int,
         f.rnk::int
  from vec v
  full outer join fts f on f.id = v.id
  join eligible e on e.id = coalesce(v.id, f.id)
  order by score desc, e.id
  limit p_limit;
$$;

comment on function public.match_chunks is
  'Hybride Suche über Vektoren und Volltext, zusammengeführt per Reciprocal Rank Fusion.';

revoke all on function public.match_chunks from public;
grant execute on function public.match_chunks to authenticated;
