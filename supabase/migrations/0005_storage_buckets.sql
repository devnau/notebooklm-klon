-- Storage-Buckets für hochgeladene Quellen und gerenderte Audio-Dateien.
--
-- Beide Buckets sind privat. Öffentliche Buckets wären hier ein Datenleck mit
-- Ansage: der Pfad ist ratbar, sobald jemand eine Notebook-ID kennt, und
-- Dokumente, die jemand hochlädt, sind per Annahme vertraulich. Die Anwendung
-- liefert Dateien ausschließlich über kurzlebige Signed URLs aus.
--
-- Der Pfadaufbau ist Teil des Sicherheitsmodells:
--
--     {notebook_id}/{source_id}.{ext}
--
-- Das erste Pfadsegment ist die Notebook-ID, und genau darauf greifen die
-- Policies zu. Ohne diese Konvention müsste jede Policy einen Join auf
-- `sources` machen — teurer und leichter zu umgehen, weil die Zeile in
-- `sources` beim Upload noch gar nicht existieren muss.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'sources',
    'sources',
    false,
    52428800, -- 50 MB, identisch mit MAX_UPLOAD_BYTES in packages/shared
    array[
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/markdown'
    ]
  ),
  -- Audio wird ausschließlich vom Worker geschrieben, deshalb kein MIME-Filter
  -- für Clients — sie dürfen hier ohnehin nicht schreiben.
  ('audio', 'audio', false, 104857600, array['audio/mpeg'])
on conflict (id) do nothing;

/*
 * Die MIME-Liste im Bucket ist eine Vorprüfung, kein Schutz: der Client
 * bestimmt den Content-Type selbst. Die verbindliche Prüfung passiert über
 * Magic Bytes in checkUpload() (packages/shared/src/upload-guard.ts), bevor
 * überhaupt hochgeladen wird. Beides zusammen, weil die Bucket-Regel auch
 * greift, wenn jemand die Anwendung umgeht und direkt gegen die Storage-API
 * spricht.
 */

-- ---------------------------------------------------------------------------
-- Policies auf storage.objects
-- ---------------------------------------------------------------------------

/**
 * Notebook-ID aus dem Objektpfad.
 *
 * Eigene Funktion statt inline, damit die Policies lesbar bleiben und die
 * Konvention an genau einer Stelle steht. `strict` liefert null bei null-Pfad,
 * und ein ungültiges UUID-Segment fängt der Cast-Guard ab — sonst würde ein
 * Objekt mit krummem Pfad die Policy mit einem Fehler statt mit `false`
 * beantworten, und das wäre ein Denial-of-Service über einen Dateinamen.
 */
create or replace function public.storage_notebook_id(object_name text)
returns uuid
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $$
declare
  first_segment text := split_part(object_name, '/', 1);
begin
  return first_segment::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

comment on function public.storage_notebook_id(text) is
  'Erstes Pfadsegment eines Storage-Objekts als Notebook-ID; null bei ungültigem Pfad.';

-- Lesen: jedes Mitglied des Notebooks, für beide Buckets.
create policy storage_read_member on storage.objects
  for select to authenticated
  using (
    bucket_id in ('sources', 'audio')
    and public.is_notebook_member(public.storage_notebook_id(name), 'viewer')
  );

/*
 * Schreiben nur in `sources` und nur als editor. Audio schreibt allein der
 * Worker über service_role — ein Client, der beliebige MP3s in den Bucket legen
 * könnte, wäre ein hübscher Hoster für fremde Inhalte auf unsere Rechnung.
 */
create policy storage_insert_editor on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'sources'
    and public.is_notebook_member(public.storage_notebook_id(name), 'editor')
  );

/*
 * Kein UPDATE: eine Quelle wird ersetzt, indem sie gelöscht und neu angelegt
 * wird. Überschreiben würde bedeuten, dass der Index in `chunks` still zu einer
 * Datei gehört, die es so nicht mehr gibt — Zitate zeigten dann auf Text, der
 * nirgends steht.
 */

create policy storage_delete_editor on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'sources'
    and public.is_notebook_member(public.storage_notebook_id(name), 'editor')
  );
