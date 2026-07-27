-- ═══════════════════════════════════════════════════════════════════════════
-- 0011 · Der Aufräum-Trigger für Audiodateien muss weg
--
-- 0010 hat einen Trigger eingeführt, der beim Löschen eines Artefakts die MP3
-- aus `storage.objects` entfernt. Das geht nicht: der Storage-Dienst schützt
-- seine Tabellen mit einem eigenen Trigger
--
--     „Direct deletion from storage tables is not allowed.
--      Use the Storage API instead."
--
-- Damit war nicht nur das Aufräumen kaputt, sondern das **Löschen eines
-- Notizbuchs insgesamt**: die Kaskade räumt `artifacts` mit ab, der Trigger
-- feuerte dabei und brach die ganze Transaktion.
--
-- Das ist derselbe Fehler wie in 0003, wo der Trigger gegen das Entfernen des
-- letzten Owners während der Kaskade zuschlug. Beide Male sah die Prüfung des
-- Einzelfalls gut aus, und beide Male war eine ganz andere Operation kaputt.
-- Gefunden hat es wieder nur der Ende-zu-Ende-Lauf, beim Aufräumen.
--
-- Die Datei wird jetzt dort gelöscht, wo es einen HTTP-Client gibt: in der
-- Server Action `deleteArtifact`, über die Storage-API — genau wie bei den
-- Quellen.
-- ═══════════════════════════════════════════════════════════════════════════

drop trigger if exists artifacts_delete_audio on public.artifacts;
drop function if exists public.delete_artifact_audio();
