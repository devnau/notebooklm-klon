-- ═══════════════════════════════════════════════════════════════════════════
-- 0012 · Rate-Limits und Kostenerfassung
--
-- Zwei Dinge, die zusammengehören: was Geld kostet, muss begrenzt und gezählt
-- werden.
--
-- **Warum in der Datenbank und nicht im Anwendungsprozess.** Ein Zähler im
-- Speicher gilt pro Prozess. Sobald die Anwendung zweimal läuft — und genau
-- dafür ist sie gebaut —, hat jeder sein eigenes Limit, und das
-- vermeintliche „120 pro Stunde" sind in Wirklichkeit 240. Redis wäre die
-- übliche Antwort; hier steht bereits eine Datenbank, die Transaktionen kann,
-- und ein weiterer Dienst für einen Zähler wäre nicht zu rechtfertigen.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.rate_limit_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- 'chat', 'upload', 'artifact', 'audio' — bewusst kein CHECK: eine neue
  -- Aktion soll keine Migration brauchen, und ein Tippfehler führt hier zu
  -- einem eigenen Kontingent, nicht zu einem Datenleck.
  action      text not null,
  created_at  timestamptz not null default now()
);

comment on table public.rate_limit_events is
  'Ein Eintrag je kostenrelevanter Aktion. Grundlage der Kontingente.';

-- Der Index, auf dem die Zählung läuft: je Nutzer und Aktion, nach Zeit.
create index rate_limit_lookup_idx
  on public.rate_limit_events (user_id, action, created_at desc);

alter table public.rate_limit_events enable row level security;
alter table public.rate_limit_events force row level security;

/*
 * Keine Policy für `authenticated` — weder lesend noch schreibend. Geschrieben
 * wird ausschliesslich über die Funktion unten, die als `security definer`
 * läuft. Ein Nutzer, der seine eigenen Einträge löschen könnte, hätte kein
 * Limit.
 */

-- ── Kostenerfassung ────────────────────────────────────────────────────────
create table public.llm_usage (
  id            bigint generated always as identity primary key,
  notebook_id   uuid references public.notebooks (id) on delete set null,
  user_id       uuid references auth.users (id) on delete set null,
  -- 'chat', 'artifact', 'audio_script', 'embedding'
  kind          text not null,
  model         text not null,
  input_tokens          int not null default 0,
  output_tokens         int not null default 0,
  cache_read_tokens     int not null default 0,
  cache_write_tokens    int not null default 0,
  created_at    timestamptz not null default now()
);

comment on table public.llm_usage is
  'Verbrauch je Aufruf. Grundlage für Kostenauswertung und Missbrauchserkennung.';

/*
 * `on delete set null` statt `cascade`: wird ein Notizbuch gelöscht, sind die
 * Kosten trotzdem angefallen. Eine Abrechnung, die beim Aufräumen schrumpft,
 * wäre keine.
 */
create index llm_usage_time_idx on public.llm_usage (created_at desc);
create index llm_usage_notebook_idx on public.llm_usage (notebook_id, created_at desc);

alter table public.llm_usage enable row level security;
alter table public.llm_usage force row level security;

-- Lesen darf jeder für seine eigenen Notizbücher — wer zahlt, soll sehen
-- wofür. Geschrieben wird nur über service_role.
create policy llm_usage_select_own on public.llm_usage
  for select to authenticated
  using (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════════════
-- Kontingent prüfen und verbrauchen
-- ═══════════════════════════════════════════════════════════════════════════

/**
 * Prüft das Kontingent und verbucht die Aktion — in einem Schritt.
 *
 * Zwei getrennte Aufrufe („darf ich?" und dann „ich mache") hätten ein
 * Zeitfenster dazwischen: zwei gleichzeitige Anfragen fragen beide, bekommen
 * beide „ja" und überziehen gemeinsam. Hier zählt und schreibt dieselbe
 * Anweisung.
 *
 * Gleitendes Fenster statt fester Stunde: bei einem Stundenraster wären um
 * 10:59 und 11:01 zusammen das Doppelte möglich, ohne dass ein Limit greift.
 *
 * @return verbleibendes Kontingent nach dieser Aktion, oder -1 bei Ablehnung
 */
create or replace function public.consume_rate_limit(
  p_action text,
  p_limit  int,
  p_window_seconds int default 3600
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  used int;
begin
  if current_user_id is null then
    raise exception 'Nicht angemeldet' using errcode = 'insufficient_privilege';
  end if;

  select count(*) into used
  from public.rate_limit_events e
  where e.user_id = current_user_id
    and e.action = p_action
    and e.created_at > now() - make_interval(secs => p_window_seconds);

  if used >= p_limit then
    return -1;
  end if;

  insert into public.rate_limit_events (user_id, action)
  values (current_user_id, p_action);

  return p_limit - used - 1;
end;
$$;

comment on function public.consume_rate_limit(text, int, int) is
  'Prüft und verbucht ein Kontingent in einem Schritt. -1 bedeutet abgelehnt.';

revoke all on function public.consume_rate_limit(text, int, int) from public;
grant execute on function public.consume_rate_limit(text, int, int) to authenticated;

/**
 * Räumt alte Einträge weg.
 *
 * Ohne das wächst die Tabelle unbegrenzt — bei einem Limit von 120 Anfragen
 * pro Stunde und Nutzer sind das im Jahr sechsstellige Zeilenzahlen, für die
 * sich nach einer Stunde niemand mehr interessiert. Der Worker ruft die
 * Funktion beim Aufräumen mit auf.
 *
 * 48 Stunden Vorlauf statt genau einer: das längste Fenster ist eine Stunde,
 * aber ein grosszügiger Rand kostet nichts und erspart die Frage, ob beim
 * Löschen gerade jemand mitten in einer Zählung steckt.
 */
create or replace function public.prune_rate_limit_events()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed int;
begin
  delete from public.rate_limit_events
  where created_at < now() - interval '48 hours';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.prune_rate_limit_events() from public;
