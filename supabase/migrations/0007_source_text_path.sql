-- ═══════════════════════════════════════════════════════════════════════════
-- 0007 · Der extrahierte Text bleibt erhalten
--
-- Bisher überlebte nur, was in `chunks` landet. Für den Viewer reicht das
-- nicht: Abschnitte überlappen sich, und ein Zitat verweist über
-- `char_start`/`char_end` auf Positionen im *ganzen* Dokument. Aus den
-- Abschnitten ließe sich der Text nur ungefähr wieder zusammensetzen — und die
-- Stelle, die ein Zitat markiert, säße dann ein paar Zeichen daneben.
--
-- Der Text kommt in denselben Bucket wie die Datei, unter
-- `{notebook_id}/extrahiert/{source_id}.md`. Erstes Pfadsegment bleibt die
-- Notebook-ID, die Storage-Policies greifen also unverändert.
--
-- Nicht als Spalte in `sources`: ein 4-MB-Text in jeder Zeile bläht jede
-- Abfrage auf, die nur den Titel und den Status braucht — und das sind fast
-- alle.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.sources
  add column text_path text;

comment on column public.sources.text_path is
  'Storage-Pfad des extrahierten Volltexts. Grundlage für Viewer und Zitatanker.';
