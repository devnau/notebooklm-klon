import { RETRIEVAL_CANDIDATES, RETRIEVAL_TOP_K, type ContextChunk } from '@nlm/shared';
import type { SupabaseClient } from '@supabase/supabase-js';

import { embedQuery } from '@/lib/rag/embeddings';
import type { Database } from '@/lib/supabase/types';

/**
 * Retrieval: von der Frage zu den Auszügen, die das Modell zu sehen bekommt.
 *
 * Der Aufruf von `match_chunks` läuft über den Client des **Nutzers**, nicht
 * über service_role. Die Funktion ist bewusst `security invoker`, damit RLS
 * greift: eine erratene fremde `notebook_id` liefert dann eine leere Liste
 * statt fremder Dokumente. Die Zugriffsprüfung liegt damit in der Datenbank
 * und nicht in dieser Datei — hier könnte man sie vergessen.
 */

type MatchRow = {
  readonly chunk_id: number;
  readonly source_id: string;
  readonly idx: number;
  readonly content: string;
  readonly heading_path: string | null;
  readonly page: number | null;
  readonly char_start: number;
  readonly char_end: number;
  readonly score: number;
  readonly vector_rank: number | null;
  readonly fulltext_rank: number | null;
};

export type RetrievalResult = {
  readonly context: ContextChunk[];
  /** Nur die Quellen, aus denen tatsächlich etwas im Kontext steht. */
  readonly usedSourceIds: string[];
  readonly stats: {
    readonly candidates: number;
    readonly viaVector: number;
    readonly viaFulltext: number;
    readonly viaBoth: number;
  };
};

export async function retrieve(
  supabase: SupabaseClient<Database>,
  {
    notebookId,
    question,
    sourceIds,
    limit = RETRIEVAL_TOP_K,
  }: {
    readonly notebookId: string;
    readonly question: string;
    readonly sourceIds?: readonly string[] | undefined;
    readonly limit?: number;
  },
): Promise<RetrievalResult> {
  const embedding = await embedQuery(question);

  /*
   * `p_source_ids` wird nur gesetzt, wenn wirklich gefiltert werden soll.
   * `exactOptionalPropertyTypes` unterscheidet zwischen „Feld fehlt" und „Feld
   * ist undefined" — und der generierte Typ lässt für einen Parameter mit
   * Vorgabewert nur Ersteres zu.
   */
  const filter = sourceIds && sourceIds.length > 0 ? { p_source_ids: [...sourceIds] } : {};

  const { data, error } = await supabase.rpc('match_chunks', {
    p_notebook: notebookId,
    p_query: question,
    // Als JSON-Zeichenkette: PostgREST reicht Arrays nicht als vector durch.
    p_embedding: JSON.stringify(embedding),
    p_limit: limit,
    p_candidates: RETRIEVAL_CANDIDATES,
    ...filter,
  });

  if (error) {
    throw new Error(`Suche fehlgeschlagen: ${error.message}`);
  }

  const rows = (data ?? []) as MatchRow[];
  if (rows.length === 0) {
    return {
      context: [],
      usedSourceIds: [],
      stats: { candidates: 0, viaVector: 0, viaFulltext: 0, viaBoth: 0 },
    };
  }

  // Titel nachladen: `match_chunks` liefert sie nicht mit, weil sie pro Quelle
  // gleich sind und die Antwort sonst dutzendfach dieselbe Zeichenkette trüge.
  const sourceIdList = [...new Set(rows.map((row) => row.source_id))];
  const { data: sources } = await supabase
    .from('sources')
    .select('id, title')
    .in('id', sourceIdList);

  const titleById = new Map((sources ?? []).map((source) => [source.id, source.title]));

  /*
   * Die Nummerierung im Prompt folgt der Reihenfolge, in der Quellen im
   * Ergebnis zuerst auftauchen — nicht ihrer Anlage im Notebook. Dadurch ist
   * S1 immer die Quelle mit dem besten Treffer, und der Nutzer sieht in der
   * Antwort auf einen Blick, worauf sie sich hauptsächlich stützt.
   */
  const sourceNumbers = new Map<string, number>();
  const context: ContextChunk[] = rows.map((row) => {
    let sourceNumber = sourceNumbers.get(row.source_id);
    if (sourceNumber === undefined) {
      sourceNumber = sourceNumbers.size + 1;
      sourceNumbers.set(row.source_id, sourceNumber);
    }

    return {
      sourceNumber,
      // Der Index des Abschnitts innerhalb seiner Quelle, nicht seine
      // Datenbank-ID: die wäre fünfstellig und kostet im Prompt unnötig Token.
      chunkNumber: row.idx,
      sourceId: row.source_id,
      sourceTitle: titleById.get(row.source_id) ?? 'Unbenannte Quelle',
      chunkId: row.chunk_id,
      content: row.content,
      headingPath: row.heading_path,
      page: row.page,
      charStart: row.char_start,
      charEnd: row.char_end,
    };
  });

  return {
    context,
    usedSourceIds: [...sourceNumbers.keys()],
    stats: {
      candidates: rows.length,
      viaVector: rows.filter((row) => row.vector_rank !== null).length,
      viaFulltext: rows.filter((row) => row.fulltext_rank !== null).length,
      viaBoth: rows.filter((row) => row.vector_rank !== null && row.fulltext_rank !== null)
        .length,
    },
  };
}
