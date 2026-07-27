-- ═══════════════════════════════════════════════════════════════════════════
-- 0010 · Audio-Überblick anfordern
--
-- `request_artifact()` kannte bisher nur die Textarten. Audio bekommt eine
-- eigene Funktion statt eines weiteren Zweigs, weil sich zwei Dinge
-- unterscheiden: der Job heisst `render_audio` und nicht `generate_artifact`,
-- und beim Löschen muss zusätzlich die MP3 aus dem Storage verschwinden.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.request_audio_overview(p_notebook uuid)
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

  select array_agg(s.id) into ready_sources
  from public.sources s
  where s.notebook_id = p_notebook and s.status = 'ready';

  if ready_sources is null then
    raise exception 'Keine verarbeitete Quelle vorhanden'
      using errcode = 'invalid_parameter_value';
  end if;

  delete from public.artifacts
  where notebook_id = p_notebook and kind = 'audio' and status = 'failed';

  insert into public.artifacts (notebook_id, kind, status, source_ids, created_by)
  values (p_notebook, 'audio', 'pending', ready_sources, auth.uid())
  on conflict (notebook_id, kind) where status <> 'failed'
  do update set
    status = 'pending',
    payload = null,
    error = null,
    /*
     * `storage_path` wird bewusst **nicht** geleert. Solange die neue Datei
     * nicht steht, soll die alte weiter abspielbar bleiben — eine Neuerzeugung
     * dauert Minuten, und in dieser Zeit einen toten Player anzuzeigen wäre ein
     * Rückschritt gegenüber „etwas Älterem, das funktioniert".
     */
    source_ids = excluded.source_ids,
    updated_at = now()
  returning id into target_id;

  insert into public.jobs (kind, notebook_id, payload)
  values ('render_audio', p_notebook, jsonb_build_object('artifactId', target_id));

  return target_id;
end;
$$;

comment on function public.request_audio_overview(uuid) is
  'Legt den Audio-Überblick an oder frischt ihn auf und reiht das Rendern ein.';

revoke all on function public.request_audio_overview(uuid) from public;
grant execute on function public.request_audio_overview(uuid) to authenticated;

/**
 * Räumt die MP3 weg, wenn das Artefakt verschwindet.
 *
 * Storage kennt die Fremdschlüssel der Anwendung nicht; ohne diesen Trigger
 * bliebe zu jedem gelöschten Überblick eine verwaiste Datei im Bucket liegen,
 * die niemand mehr zuordnen kann. Das ist auch ein Datenschutzthema: ein
 * gelöschter Überblick soll gelöscht sein.
 *
 * Der Löschvorgang läuft über `storage.objects` und nicht über die Storage-API
 * — in einem Trigger gibt es keinen HTTP-Client. Die Datei auf der Platte
 * räumt der Storage-Dienst selbst nach.
 */
create or replace function public.delete_artifact_audio()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.storage_path is not null then
    delete from storage.objects
    where bucket_id = 'audio' and name = old.storage_path;
  end if;
  return old;
end;
$$;

create trigger artifacts_delete_audio
  before delete on public.artifacts
  for each row execute function public.delete_artifact_audio();

revoke all on function public.delete_artifact_audio() from public;
