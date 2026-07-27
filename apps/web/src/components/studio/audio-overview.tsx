'use client';

import type { DialogueTurn } from '@nlm/shared';
import { AlertCircle, Headphones, Loader2, Play, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';

import {
  createAudioUrl,
  deleteArtifact,
  requestAudioOverview,
} from '@/app/(app)/notebooks/[id]/studio/actions';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Der Audio-Überblick: Player mit mitlaufendem Transkript.
 *
 * Das Transkript ist nicht Beiwerk. Ein synthetisch gesprochener Dialog ist
 * über zwanzig Minuten anstrengend zu verfolgen, und wer den Faden verliert,
 * findet ihn im Text wieder. Ausserdem ist es die einzige Möglichkeit, gezielt
 * an eine Stelle zu springen — bei einer Audiodatei ohne Gliederung sucht man
 * sonst blind.
 *
 * Deshalb ist jeder Beitrag anklickbar: Klick setzt die Abspielposition.
 */

type AudioPayload = {
  readonly title?: string;
  readonly turns?: DialogueTurn[];
  readonly offsets?: number[];
  readonly durationSeconds?: number;
  readonly estimatedSeconds?: number;
  readonly renderedTurns?: number;
};

export function AudioOverview({
  notebookId,
  artifact,
  canEdit,
  hasReadySources,
}: {
  readonly notebookId: string;
  readonly artifact: {
    readonly id: string;
    readonly status: 'pending' | 'running' | 'ready' | 'failed';
    readonly payload: unknown;
    readonly error: string | null;
  } | null;
  readonly canEdit: boolean;
  readonly hasReadySources: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [position, setPosition] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  const payload = (artifact?.payload ?? {}) as AudioPayload;
  const running = artifact?.status === 'pending' || artifact?.status === 'running';
  const ready = artifact?.status === 'ready';
  const turns = payload.turns ?? [];
  const offsets = payload.offsets ?? [];

  /*
   * Die Adresse ist signiert und kurzlebig; sie wird erst geholt, wenn der
   * Überblick fertig ist. Beim Neuerzeugen wird sie verworfen — sonst spielte
   * der Player die alte Datei weiter, während daneben „wird erzeugt" steht.
   */
  useEffect(() => {
    if (!ready || !artifact) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const result = await createAudioUrl(artifact.id);
      if (!cancelled) setUrl(result.url ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, artifact]);

  const run = (work: () => Promise<{ error?: string }>) => {
    setActionError(null);
    startTransition(async () => {
      const result = await work();
      if (result.error) setActionError(result.error);
    });
  };

  /** Index des Beitrags, der gerade läuft. */
  const activeIndex = offsets.reduce(
    (active, offset, index) => (position + 0.15 >= offset ? index : active),
    -1,
  );

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Headphones className="text-muted-foreground size-4" aria-hidden />
          Audio-Überblick
          {running && (
            <Loader2 className="text-primary size-3.5 animate-spin" aria-hidden />
          )}
        </h2>

        {canEdit && hasReadySources && !running && (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => {
                run(() => requestAudioOverview(notebookId));
              }}
            >
              {artifact ? <RefreshCw aria-hidden /> : <Play aria-hidden />}
              {artifact ? 'Neu erzeugen' : 'Erzeugen'}
            </Button>
            {artifact && (
              <Button
                variant="ghost"
                size="icon"
                disabled={pending}
                aria-label="Audio-Überblick löschen"
                onClick={() => {
                  run(() => deleteArtifact(artifact.id, notebookId));
                }}
              >
                <Trash2 aria-hidden />
              </Button>
            )}
          </div>
        )}
      </div>

      {!hasReadySources ? (
        <p className="text-muted-foreground rounded-md border border-dashed px-3 py-4 text-sm">
          Sobald eine Quelle verarbeitet ist, lässt sich hier ein Gespräch über die Inhalte
          erzeugen.
        </p>
      ) : !artifact ? (
        <p className="text-muted-foreground rounded-md border border-dashed px-3 py-4 text-sm">
          Zwei Stimmen im Gespräch über die Quellen dieses Notizbuchs. Die Erzeugung dauert
          einige Minuten.
        </p>
      ) : (
        <div className="bg-surface rounded-lg border">
          {running && <Progress payload={payload} />}

          {artifact.status === 'failed' && (
            <p className="text-destructive flex items-start gap-2 p-3 text-sm">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {artifact.error ?? 'Der Überblick konnte nicht erzeugt werden.'}
            </p>
          )}

          {ready && (
            <div className="p-3">
              {payload.title && <p className="mb-2 text-sm font-medium">{payload.title}</p>}

              {url ? (
                // Der eingebaute Player des Browsers statt eines eigenen:
                // Tastaturbedienung, Geschwindigkeit und Lautstärke bringt er
                // mit, und auf dem Telefon erscheint er auf dem Sperrbildschirm.
                <audio
                  ref={audioRef}
                  src={url}
                  controls
                  preload="metadata"
                  className="w-full"
                  onTimeUpdate={(event) => {
                    setPosition(event.currentTarget.currentTime);
                  }}
                >
                  Ihr Browser kann kein Audio abspielen.
                </audio>
              ) : (
                <p className="text-muted-foreground text-sm">Wird geladen …</p>
              )}

              {turns.length > 0 && (
                <ol className="mt-3 flex max-h-80 flex-col gap-1 overflow-y-auto">
                  {turns.map((turn, index) => (
                    <li key={index}>
                      <button
                        type="button"
                        onClick={() => {
                          const target = offsets[index];
                          if (audioRef.current && target !== undefined) {
                            audioRef.current.currentTime = target;
                            void audioRef.current.play();
                          }
                        }}
                        // aria-current sagt einem Screenreader, welcher Beitrag
                        // gerade läuft — die farbliche Hervorhebung allein
                        // sieht er nicht.
                        aria-current={index === activeIndex ? 'true' : undefined}
                        className={cn(
                          'focus-visible:ring-ring w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none',
                          index === activeIndex
                            ? 'bg-citation-bg text-foreground'
                            : 'text-muted-foreground hover:bg-muted',
                        )}
                      >
                        <span className="text-primary mr-1.5 text-xs font-medium">
                          {turn.speaker === 'host' ? 'Moderation' : 'Gast'}
                        </span>
                        {turn.text}
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {actionError && (
            <p role="alert" className="text-destructive px-3 pb-3 text-xs">
              {actionError}
            </p>
          )}
        </div>
      )}

      {actionError && !artifact && (
        <p role="alert" className="text-destructive mt-2 text-xs">
          {actionError}
        </p>
      )}
    </section>
  );
}

/**
 * Fortschritt während der Erzeugung.
 *
 * Sobald das Skript steht, ist die Anzahl der Beiträge bekannt — ab da ist der
 * Fortschritt echt und keine Schätzung. Davor läuft ein unbestimmter Balken:
 * wie lange das Modell für das Skript braucht, wissen wir nicht.
 */
function Progress({ payload }: { readonly payload: AudioPayload }) {
  const total = payload.turns?.length ?? 0;
  const done = payload.renderedTurns ?? 0;

  return (
    <div className="p-3" aria-live="polite">
      <p className="text-muted-foreground text-sm">
        {total === 0
          ? 'Das Gespräch wird geschrieben …'
          : `Beitrag ${String(Math.min(done + 1, total))} von ${String(total)} wird gesprochen …`}
      </p>
      <div className="bg-muted mt-2 h-1 overflow-hidden rounded-full">
        {total === 0 ? (
          <div className="bg-primary animate-indeterminate h-full w-1/3 rounded-full" />
        ) : (
          <div
            className="bg-primary h-full transition-[width] duration-500"
            style={{ width: `${String(Math.round((done / total) * 100))}%` }}
          />
        )}
      </div>
      {payload.estimatedSeconds !== undefined && total > 0 && (
        <p className="text-muted-foreground mt-1.5 text-xs">
          Etwa {Math.ceil(payload.estimatedSeconds / 60)} Minuten Spielzeit
        </p>
      )}
    </div>
  );
}
