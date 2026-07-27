import Anthropic from '@anthropic-ai/sdk';
import {
  buildContextBlock,
  buildSourceOverview,
  deriveChatTitle,
  resolveCitations,
  systemPrompt,
  type Citation,
} from '@nlm/shared';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireKey } from '@/lib/env';
import { QueryEmbeddingError } from '@/lib/rag/embeddings';
import { retrieve } from '@/lib/rag/retrieve';
import { createClient } from '@/lib/supabase/server';

/**
 * Der Chat.
 *
 * Ablauf: Frage entgegennehmen → passende Auszüge suchen → Claude fragen →
 * Antwort tokenweise durchreichen → Zitate auflösen und alles speichern.
 *
 * **Streaming ist hier keine Spielerei.** Eine belegte Antwort über mehreren
 * Dokumenten braucht ihre Zeit; ohne Streaming sässe der Nutzer vor einem
 * Spinner und wüsste nicht, ob überhaupt etwas passiert. Mit Streaming liest
 * er bereits, während der Rest entsteht.
 *
 * Das Protokoll ist zeilenweises JSON (NDJSON), nicht Server-Sent Events. SSE
 * hätte hier keinen Vorteil — es gibt keine Wiederverbindung, keine
 * Ereignis-IDs — und `fetch` mit einem ReadableStream ist auf beiden Seiten
 * weniger Code als ein EventSource, das ohnehin kein POST kann.
 */

export const runtime = 'nodejs';
/** Antworten über mehreren Dokumenten dauern; die Voreinstellung ist zu knapp. */
export const maxDuration = 120;

const requestSchema = z.object({
  notebookId: z.string().uuid(),
  chatId: z.string().uuid().optional(),
  question: z
    .string()
    .trim()
    .min(1, 'Bitte eine Frage eingeben.')
    // Eine „Frage" von 50 000 Zeichen ist keine Frage, sondern ein Versuch,
    // den Kontext mit fremdem Text zu fluten.
    .max(4_000, 'Die Frage ist zu lang.'),
  sourceIds: z.array(z.string().uuid()).max(100).optional(),
});

type StreamEvent =
  | { type: 'start'; chatId: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; messageId: number; citations: Citation[] }
  | { type: 'error'; message: string };

function line(event: StreamEvent): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

export async function POST(request: Request): Promise<Response> {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Ungültige Anfrage.' },
      { status: 400 },
    );
  }

  const { notebookId, question, sourceIds } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 });
  }

  /*
   * Das Notebook wird gelesen, bevor irgendetwas Kostenpflichtiges passiert.
   * Der Zugriff wird dabei nicht hier geprüft, sondern von RLS: gibt die
   * Abfrage nichts zurück, darf dieser Nutzer das Notebook nicht sehen — ob es
   * existiert oder nicht, bleibt offen. Genau so soll es sein.
   */
  const { data: notebook } = await supabase
    .from('notebooks')
    .select('id, language')
    .eq('id', notebookId)
    .maybeSingle();

  if (!notebook) {
    return NextResponse.json({ error: 'Notebook nicht gefunden.' }, { status: 404 });
  }

  let apiKey: string;
  try {
    apiKey = requireKey('ANTHROPIC_API_KEY');
  } catch {
    return NextResponse.json(
      { error: 'Der Chat ist auf diesem Server nicht konfiguriert.' },
      { status: 503 },
    );
  }

  // Alle bereiten Quellen für die Übersicht — nicht nur die getroffenen. Sonst
  // antwortet das Modell auf „Was liegt hier alles?" mit dem, was die Suche
  // zufällig zurückgab.
  const { data: allSources } = await supabase
    .from('sources')
    .select('id, title, summary')
    .eq('notebook_id', notebookId)
    .eq('status', 'ready')
    .order('created_at');

  const readySources = allSources ?? [];
  if (readySources.length === 0) {
    return NextResponse.json(
      {
        error:
          'Dieses Notizbuch enthält noch keine fertig verarbeitete Quelle. Bitte zuerst eine hinzufügen.',
      },
      { status: 409 },
    );
  }

  let retrieval;
  try {
    retrieval = await retrieve(supabase, { notebookId, question, sourceIds });
  } catch (error) {
    const message =
      error instanceof QueryEmbeddingError
        ? error.userMessage
        : 'Die Suche ist fehlgeschlagen.';
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // Unterhaltung anlegen oder fortsetzen. Beides über den Client des Nutzers,
  // damit die RLS-Policy auf `chats` entscheidet, ob er schreiben darf.
  let chatId = parsed.data.chatId;
  if (!chatId) {
    const { data: chat, error } = await supabase
      .from('chats')
      .insert({
        notebook_id: notebookId,
        title: deriveChatTitle(question),
        created_by: user.id,
      })
      .select('id')
      .single();

    if (error || !chat) {
      return NextResponse.json(
        { error: 'Die Unterhaltung konnte nicht angelegt werden.' },
        { status: 403 },
      );
    }
    chatId = chat.id;
  }

  const { error: userMessageError } = await supabase.from('messages').insert({
    chat_id: chatId,
    notebook_id: notebookId,
    role: 'user',
    content: question,
    created_by: user.id,
  });

  if (userMessageError) {
    return NextResponse.json(
      { error: 'Die Frage konnte nicht gespeichert werden.' },
      { status: 403 },
    );
  }

  // Bisheriger Verlauf, ohne die gerade eingefügte Frage — die kommt als
  // letzte Nachricht separat, damit sie nicht Teil des zwischengespeicherten
  // Prefix wird.
  const { data: history } = await supabase
    .from('messages')
    .select('role, content')
    .eq('chat_id', chatId)
    .order('id')
    .limit(40);

  const previous = (history ?? []).slice(0, -1);

  const anthropic = new Anthropic({ apiKey });
  const conversationId = chatId;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(line({ type: 'start', chatId: conversationId }));

      let answer = '';

      try {
        /*
         * Prompt Caching. Der Aufbau ist kein Zufall:
         *
         *   [ Systemprompt ][ Quellenübersicht ]  ← stabil, zwischengespeichert
         *   [ Verlauf ][ Auszüge + Frage ]        ← ändert sich je Anfrage
         *
         * Die Marke sitzt am Ende der Quellenübersicht. Alles davor ist bei der
         * nächsten Frage im selben Notebook byteweise identisch und wird nicht
         * erneut berechnet. Stünde die Marke hinter den Auszügen, wäre der
         * Prefix bei jeder Frage anders — und der Cache nutzlos.
         *
         * Kontrollierbar an `usage.cache_read_input_tokens` der zweiten
         * Antwort: steht dort 0, invalidiert etwas den Prefix.
         */
        const messageStream = anthropic.messages.stream({
          model: 'claude-opus-5',
          max_tokens: 4096,
          thinking: { type: 'adaptive' },
          system: [
            { type: 'text', text: systemPrompt(notebook.language) },
            {
              type: 'text',
              text: buildSourceOverview(readySources),
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [
            ...previous.map((message) => ({
              role:
                message.role === 'assistant' ? ('assistant' as const) : ('user' as const),
              content: message.content,
            })),
            {
              role: 'user' as const,
              content: `${buildContextBlock(retrieval.context)}\n\nFrage: ${question}`,
            },
          ],
        });

        for await (const event of messageStream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            answer += event.delta.text;
            controller.enqueue(line({ type: 'delta', text: event.delta.text }));
          }
        }

        const finalMessage = await messageStream.finalMessage();

        /*
         * Zitate werden gegen den Kontext geprüft, nicht geglaubt. Ein
         * erfundener Marker wird protokolliert und **nicht** als Zitat
         * gespeichert — sonst entstünde in der Oberfläche eine Schaltfläche,
         * die nirgendwohin führt.
         */
        const { citations, unresolved } = resolveCitations(answer, retrieval.context);
        if (unresolved.length > 0) {
          console.warn('[chat] unauflösbare Zitatmarker', {
            chatId: conversationId,
            labels: unresolved.map((marker) => marker.label),
          });
        }

        const { data: saved } = await supabase
          .from('messages')
          .insert({
            chat_id: conversationId,
            notebook_id: notebookId,
            role: 'assistant',
            content: answer,
            citations,
            source_ids: retrieval.usedSourceIds,
            input_tokens: finalMessage.usage.input_tokens,
            output_tokens: finalMessage.usage.output_tokens,
            cache_read_tokens: finalMessage.usage.cache_read_input_tokens ?? 0,
            created_by: user.id,
          })
          .select('id')
          .single();

        controller.enqueue(line({ type: 'done', messageId: saved?.id ?? 0, citations }));
      } catch (error) {
        console.error('[chat] Antwort fehlgeschlagen', error);
        /*
         * Der Fehler geht in den Stream, nicht in einen HTTP-Status: die
         * Kopfzeilen sind längst raus. Ohne dieses Ereignis bliebe die
         * Oberfläche mit einer halben Antwort und blinkendem Cursor stehen und
         * der Nutzer wüsste nicht, ob noch etwas kommt.
         */
        controller.enqueue(
          line({
            type: 'error',
            message: 'Die Antwort konnte nicht vollständig erzeugt werden.',
          }),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      // Verhindert, dass ein Reverse Proxy die Antwort puffert und damit den
      // ganzen Zweck des Streamings aufhebt.
      'X-Accel-Buffering': 'no',
    },
  });
}
