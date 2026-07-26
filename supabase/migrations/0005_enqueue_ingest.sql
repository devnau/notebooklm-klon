-- ═══════════════════════════════════════════════════════════════════════════
-- 0006 · Quellen reihen sich selbst in die Warteschlange ein
--
-- `jobs` hat bewusst keine INSERT-Policy für `authenticated`: wer beliebige
-- Jobs anlegen könnte, könnte den Worker beschäftigen, bis nichts mehr geht,
-- und im Zweifel mit einer payload, die nie für ihn gedacht war.
--
-- Die Alternative — der Client legt Quelle und Job in zwei Schritten an —
-- hätte einen Zustand, den es nicht geben darf: eine Quelle auf 'pending',
-- zu der nie ein Job entsteht, weil der zweite Aufruf verlorenging. Sie sähe
-- in der UI ewig aus, als würde gleich etwas passieren.
--
-- Deshalb hängt der Job am Insert der Quelle: eine Transaktion, entweder beides
-- oder nichts.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.enqueue_ingest_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.jobs (kind, notebook_id, payload)
  values ('ingest_source', new.notebook_id, jsonb_build_object('sourceId', new.id));
  return new;
end;
$$;

comment on function public.enqueue_ingest_job() is
  'Legt zu jeder neuen Quelle den zugehörigen Import-Job an (AFTER INSERT auf sources).';

create trigger sources_enqueue_ingest
  after insert on public.sources
  for each row execute function public.enqueue_ingest_job();

-- ── Erneuter Versuch ───────────────────────────────────────────────────────
/**
 * Setzt eine fehlgeschlagene Quelle zurück und reiht sie neu ein.
 *
 * Als Funktion statt als zwei UPDATEs vom Client aus, weil der Client `jobs`
 * nicht beschreiben darf — und weil sonst zwei halbe Zustände möglich wären:
 * Quelle auf 'pending' ohne Job, oder ein Job zu einer Quelle, die schon läuft.
 *
 * `security definer` umgeht RLS, deshalb prüft die Funktion die Berechtigung
 * selbst — und zwar als Erstes. Der Rollenname 'editor' ist derselbe, den die
 * Policies auf `sources` verlangen.
 */
create or replace function public.retry_source(p_source_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_notebook uuid;
  current_status  text;
begin
  select notebook_id, status into target_notebook, current_status
  from public.sources
  where id = p_source_id;

  if target_notebook is null then
    raise exception 'Quelle nicht gefunden' using errcode = 'no_data_found';
  end if;

  if not public.is_notebook_member(target_notebook, 'editor') then
    raise exception 'Keine Berechtigung' using errcode = 'insufficient_privilege';
  end if;

  -- Nur fehlgeschlagene Quellen. Ein zweiter Job zu einer laufenden Quelle
  -- würde denselben Text doppelt einbetten — das kostet Geld und erzeugt
  -- einen Wettlauf beim Schreiben der Chunks.
  if current_status <> 'failed' then
    raise exception 'Nur fehlgeschlagene Quellen können wiederholt werden'
      using errcode = 'invalid_parameter_value';
  end if;

  update public.sources
  set status = 'pending', error = null
  where id = p_source_id;

  insert into public.jobs (kind, notebook_id, payload)
  values ('ingest_source', target_notebook, jsonb_build_object('sourceId', p_source_id));
end;
$$;

comment on function public.retry_source(uuid) is
  'Setzt eine fehlgeschlagene Quelle zurück und reiht den Import erneut ein.';

revoke all on function public.retry_source(uuid) from public;
grant execute on function public.retry_source(uuid) to authenticated;

-- Nur der Aufruf über die Anwendung ist vorgesehen; der Trigger läuft ohnehin
-- mit den Rechten seines Eigentümers.
revoke all on function public.enqueue_ingest_job() from public;
