-- ═══════════════════════════════════════════════════════════════════════════
-- 0013 · Das Kontingent war überziehbar
--
-- `consume_rate_limit` aus 0012 zählt und fügt dann ein. Beides steht in
-- derselben Funktion, aber nicht in derselben Momentaufnahme: unter READ
-- COMMITTED sieht jede Anweisung den Stand bei ihrem eigenen Beginn. Zehn
-- gleichzeitige Aufrufe zählen deshalb alle denselben niedrigen Wert und
-- fügen alle ein.
--
-- Gemessen mit zehn parallelen Aufrufen bei einem Limit von fünf: **sieben
-- wurden gewährt**. Der Kommentar in 0012 behauptete, genau das sei
-- ausgeschlossen, weil „dieselbe Anweisung" zähle und schreibe — sie tut es
-- nicht, es sind zwei.
--
-- Die Sperre bindet sich an Nutzer und Aktion, nicht an die ganze Tabelle:
-- zwei verschiedene Nutzer behindern sich nicht, und derselbe Nutzer wartet
-- allenfalls Mikrosekunden auf sich selbst. Sie gilt bis zum Ende der
-- Transaktion und wird deshalb auch bei einem Fehler wieder freigegeben.
-- ═══════════════════════════════════════════════════════════════════════════

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

  /*
   * Ab hier ist der Abschnitt für diesen Nutzer und diese Aktion
   * serialisiert. `hashtextextended` liefert den bigint, den die
   * Ein-Argument-Form der Sperre erwartet; die Zwei-Argument-Form würde zwei
   * ints nehmen und wäre kollisionsanfälliger.
   */
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_action || ':' || current_user_id::text, 0)
  );

  select count(*) into used
  from public.rate_limit_events e
  where e.user_id = current_user_id
    and e.action = p_action
    and e.created_at > pg_catalog.now() - pg_catalog.make_interval(secs => p_window_seconds);

  if used >= p_limit then
    return -1;
  end if;

  insert into public.rate_limit_events (user_id, action)
  values (current_user_id, p_action);

  return p_limit - used - 1;
end;
$$;

comment on function public.consume_rate_limit(text, int, int) is
  'Prüft und verbucht ein Kontingent unter einer Sperre je Nutzer und Aktion. -1 bedeutet abgelehnt.';
