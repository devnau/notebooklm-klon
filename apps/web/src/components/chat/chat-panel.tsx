'use client';

import { segmentAnswer, type Citation } from '@nlm/shared';
import { ArrowUp, MessageSquareQuote, Square } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { CitationChip } from '@/components/chat/citation-chip';
import { SourceViewer, type TextRange } from '@/components/sources/source-viewer';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Der Chat.
 *
 * Drei Dinge, die das Verhalten prägen:
 *
 *  * **Die Antwort erscheint beim Entstehen.** Der Strom kommt als NDJSON über
 *    `fetch`; jede Zeile ein Ereignis. Ohne das sässe der Nutzer bei einer
 *    Antwort über fünf Dokumenten zwanzig Sekunden vor einem Spinner.
 *  * **Zitate werden während des Streamings aufgelöst.** Ein halber Marker
 *    (`[S1:`) bleibt Text, bis die Klammer geschlossen ist — sonst flackerte
 *    die Antwort beim Tippen.
 *  * **Abbrechen ist möglich.** Eine lange Antwort, die in die falsche Richtung
 *    läuft, muss man stoppen können, ohne die Seite neu zu laden.
 */

export type ChatMessage = {
  readonly id: number | string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly citations: readonly Citation[];
};

type StreamEvent =
  | { type: 'start'; chatId: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; messageId: number; citations: Citation[] }
  | { type: 'error'; message: string };

export function ChatPanel({
  notebookId,
  initialMessages,
  initialChatId,
  canAsk,
  hasReadySources,
  selectedSourceIds,
}: {
  readonly notebookId: string;
  readonly initialMessages: readonly ChatMessage[];
  readonly initialChatId: string | null;
  readonly canAsk: boolean;
  readonly hasReadySources: boolean;
  readonly selectedSourceIds?: readonly string[] | undefined;
}) {
  const [messages, setMessages] = useState<readonly ChatMessage[]>(initialMessages);
  const [chatId, setChatId] = useState(initialChatId);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamed, setStreamed] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{
    sourceId: string;
    title: string;
    range: TextRange;
  } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Ans Ende scrollen, wenn etwas dazukommt. `instant` während des Streamings:
  // sanftes Scrollen bei jedem Token sieht aus wie ein Wackeln.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: streaming ? 'instant' : 'smooth' });
  }, [messages, streamed, streaming]);

  const openCitation = useCallback((citation: Citation) => {
    setViewer({
      sourceId: citation.sourceId,
      title: citation.sourceTitle,
      range: { charStart: citation.charStart, charEnd: citation.charEnd },
    });
  }, []);

  const send = useCallback(
    async (question: string) => {
      setError(null);
      setStreamed('');
      setStreaming(true);
      setMessages((current) => [
        ...current,
        {
          id: `local-${String(current.length)}`,
          role: 'user',
          content: question,
          citations: [],
        },
      ]);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            notebookId,
            ...(chatId ? { chatId } : {}),
            question,
            ...(selectedSourceIds && selectedSourceIds.length > 0
              ? { sourceIds: selectedSourceIds }
              : {}),
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          // Fehler vor dem ersten Token kommen als JSON mit Status, nicht im
          // Strom — die Kopfzeilen sind dann noch nicht raus.
          const body = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          setError(body?.error ?? 'Die Anfrage ist fehlgeschlagen.');
          setStreaming(false);
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('Keine Antwort erhalten.');

        const decoder = new TextDecoder();
        let buffer = '';
        let answer = '';

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          /*
           * Zeilenweise auswerten und den Rest im Puffer lassen: ein Chunk aus
           * dem Netz endet nicht zuverlässig an einer Zeilengrenze. Ohne diesen
           * Puffer scheitert JSON.parse an einer halben Zeile — sichtbar erst
           * unter Last, wenn die Pakete anders zerfallen.
           */
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const raw of lines) {
            if (!raw.trim()) continue;
            const event = JSON.parse(raw) as StreamEvent;

            switch (event.type) {
              case 'start':
                setChatId(event.chatId);
                break;
              case 'delta':
                answer += event.text;
                setStreamed(answer);
                break;
              case 'done':
                setMessages((current) => [
                  ...current,
                  {
                    id: event.messageId,
                    role: 'assistant',
                    content: answer,
                    citations: event.citations,
                  },
                ]);
                setStreamed('');
                break;
              case 'error':
                setError(event.message);
                break;
            }
          }
        }
      } catch (caught) {
        // Ein Abbruch durch den Nutzer ist kein Fehler.
        if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
          setError('Die Verbindung ist abgebrochen.');
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [notebookId, chatId, selectedSourceIds],
  );

  const submit = () => {
    const question = draft.trim();
    if (!question || streaming) return;
    setDraft('');
    void send(question);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
        {messages.length === 0 && !streaming ? (
          <EmptyChat hasReadySources={hasReadySources} onPick={setDraft} />
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-6">
            {messages.map((message) => (
              <MessageBubble
                key={String(message.id)}
                message={message}
                onOpenCitation={openCitation}
              />
            ))}

            {streaming && (
              /*
               * aria-live="polite" statt "assertive": die Antwort wird
               * vorgelesen, sobald der Nutzer eine Pause macht — nicht
               * mitten in seiner eigenen Eingabe.
               */
              <div aria-live="polite" aria-busy="true">
                <MessageBubble
                  message={{
                    id: 'streaming',
                    role: 'assistant',
                    content: streamed,
                    citations: [],
                  }}
                  onOpenCitation={openCitation}
                  showCaret={streamed.length === 0 || streaming}
                />
              </div>
            )}

            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}

            <div ref={endRef} />
          </div>
        )}
      </div>

      <div className="border-t p-4">
        <div className="mx-auto max-w-2xl">
          <form
            onSubmit={(submitEvent) => {
              submitEvent.preventDefault();
              submit();
            }}
            className="relative"
          >
            <label htmlFor="chat-frage" className="sr-only">
              Frage an die Quellen
            </label>
            <textarea
              id="chat-frage"
              value={draft}
              onChange={(changeEvent) => {
                setDraft(changeEvent.target.value);
              }}
              onKeyDown={(keyEvent) => {
                // Enter sendet, Shift+Enter macht einen Absatz. Andersherum
                // wäre es für ein Chat-Eingabefeld ungewohnt.
                if (keyEvent.key === 'Enter' && !keyEvent.shiftKey) {
                  keyEvent.preventDefault();
                  submit();
                }
              }}
              rows={2}
              disabled={!canAsk}
              placeholder={
                canAsk
                  ? 'Frage an die Quellen …'
                  : 'Nur Mitglieder mit Schreibrecht können fragen.'
              }
              className={cn(
                'bg-surface w-full resize-none rounded-lg border py-3 pr-12 pl-3.5 text-sm',
                'placeholder:text-muted-foreground',
                'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                'disabled:opacity-60',
              )}
            />
            <div className="absolute right-2 bottom-2.5">
              {streaming ? (
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  onClick={() => abortRef.current?.abort()}
                  aria-label="Antwort abbrechen"
                >
                  <Square aria-hidden />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon"
                  disabled={!canAsk || draft.trim().length === 0}
                  aria-label="Frage senden"
                >
                  <ArrowUp aria-hidden />
                </Button>
              )}
            </div>
          </form>
          <p className="text-muted-foreground mt-2 text-center text-xs">
            Antworten stützen sich nur auf die Quellen dieses Notizbuchs. Belege anklicken,
            um die Stelle zu sehen.
          </p>
        </div>
      </div>

      {viewer && (
        <SourceViewer
          sourceId={viewer.sourceId}
          title={viewer.title}
          range={viewer.range}
          open
          onOpenChange={(open) => {
            if (!open) setViewer(null);
          }}
        />
      )}
    </div>
  );
}

function MessageBubble({
  message,
  onOpenCitation,
  showCaret = false,
}: {
  readonly message: ChatMessage;
  readonly onOpenCitation: (citation: Citation) => void;
  readonly showCaret?: boolean;
}) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <p className="bg-primary text-primary-foreground max-w-[85%] rounded-2xl rounded-br-sm px-4 py-2.5 text-sm whitespace-pre-wrap">
          {message.content}
        </p>
      </div>
    );
  }

  const segments = segmentAnswer(message.content, message.citations);

  return (
    <div className="text-sm leading-relaxed">
      <p className="whitespace-pre-wrap">
        {segments.map((segment, index) => {
          if (segment.kind === 'citation') {
            return (
              <CitationChip
                key={`${segment.citation.label}-${String(index)}`}
                citation={segment.citation}
                onOpen={onOpenCitation}
              />
            );
          }
          if (segment.kind === 'broken') {
            /*
             * Ein Marker ohne passenden Auszug. Er wird sichtbar gelassen statt
             * entfernt: eine Antwort, die einen Beleg vortäuscht, soll auch so
             * aussehen — stillschweigend zu löschen hiesse, den Fehler zu
             * verstecken.
             */
            return (
              <span
                key={`broken-${String(index)}`}
                className="text-muted-foreground text-[0.7em]"
                title="Zu diesem Verweis gibt es keinen Auszug."
              >
                {segment.text}
              </span>
            );
          }
          return <span key={`text-${String(index)}`}>{segment.text}</span>;
        })}
        {showCaret && (
          <span className="bg-foreground animate-caret ml-0.5 inline-block h-4 w-[2px] align-middle" />
        )}
      </p>

      {message.citations.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground text-xs">Belege:</span>
          {message.citations.map((citation) => (
            <CitationChip
              key={citation.label}
              citation={citation}
              onOpen={onOpenCitation}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const EXAMPLES = [
  'Worum geht es in diesen Quellen?',
  'Fasse die wichtigsten Aussagen zusammen.',
  'Welche Fristen werden genannt?',
];

function EmptyChat({
  hasReadySources,
  onPick,
}: {
  readonly hasReadySources: boolean;
  readonly onPick: (question: string) => void;
}) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md text-center">
        <MessageSquareQuote className="text-border mx-auto size-10" aria-hidden />
        <h2 className="mt-5 font-medium">
          {hasReadySources ? 'Frag deine Quellen' : 'Noch keine Quelle bereit'}
        </h2>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          {hasReadySources
            ? 'Jede Antwort stützt sich ausschliesslich auf die Dokumente in diesem Notizbuch, mit klickbarem Verweis auf die Textstelle.'
            : 'Sobald eine Quelle verarbeitet ist, kannst du hier Fragen dazu stellen.'}
        </p>

        {/*
          Beispiele statt eines leeren Feldes. Vor einem leeren Chat weiss
          niemand, was er fragen soll — und die erste Frage entscheidet, ob
          jemand wiederkommt.
        */}
        {hasReadySources && (
          <div className="mt-6 flex flex-col gap-2">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => {
                  onPick(example);
                }}
                className="hover:bg-muted focus-visible:ring-ring rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                {example}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
