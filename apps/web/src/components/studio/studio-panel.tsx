'use client';

import {
  ARTIFACT_META,
  GENERATED_ARTIFACT_KINDS,
  hasAtLeastRole,
  type Citation,
  type GeneratedArtifactKind,
  type NotebookRole,
} from '@nlm/shared';
import {
  AlertCircle,
  ChevronDown,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';

import { deleteArtifact, requestArtifact } from '@/app/(app)/notebooks/[id]/studio/actions';
import { useSourceSelection } from '@/components/notebooks/source-selection';
import { SourceViewer, type TextRange } from '@/components/sources/source-viewer';
import { ArtifactView } from '@/components/studio/artifact-view';
import { AudioOverview } from '@/components/studio/audio-overview';
import { NotesSection, type NoteRow } from '@/components/studio/notes-section';
import { Button } from '@/components/ui/button';
import { subscribeToTable } from '@/lib/supabase/realtime';
import { cn } from '@/lib/utils';

/**
 * Die Studio-Spalte: Übersichten und Notizen.
 *
 * Die Übersichten sind immer alle sichtbar, auch die noch nicht erzeugten —
 * als Schaltfläche mit Beschreibung. Eine Liste, die nur zeigt, was schon da
 * ist, verrät nicht, was möglich wäre; und „Lernleitfaden" erklärt sich nicht
 * von selbst.
 */

export type ArtifactRow = {
  readonly id: string;
  readonly kind: string;
  readonly status: 'pending' | 'running' | 'ready' | 'failed';
  readonly payload: unknown;
  readonly error: string | null;
  readonly source_ids: string[] | null;
};

export function StudioPanel({
  notebookId,
  role,
  initialArtifacts,
  initialNotes,
}: {
  readonly notebookId: string;
  readonly role: NotebookRole;
  readonly initialArtifacts: readonly ArtifactRow[];
  readonly initialNotes: readonly NoteRow[];
}) {
  /*
   * Aus dem Provider, nicht als Prop vom Server. Als Prop blieb der Wert stehen,
   * sobald eine Quelle *während* der Sitzung fertig wurde — das Studio bestand
   * dann weiter darauf, es gebe keine verarbeitete Quelle, während die
   * Quellenspalte daneben „Bereit" zeigte.
   */
  const { readySourceIds } = useSourceSelection();
  const [artifacts, setArtifacts] = useState<readonly ArtifactRow[]>(initialArtifacts);
  const [viewer, setViewer] = useState<{
    sourceId: string;
    title: string;
    range: TextRange;
  } | null>(null);
  const canEdit = hasAtLeastRole(role, 'editor');

  useEffect(() => {
    setArtifacts(initialArtifacts);
  }, [initialArtifacts]);

  // Wie bei den Quellen: Statuswechsel kommen über Realtime, nicht über
  // Polling. Ein Lernleitfaden über zehn Dokumente braucht seine Zeit.
  useEffect(
    () =>
      subscribeToTable<ArtifactRow>({
        table: 'artifacts',
        notebookId,
        onChange: (change) => {
          setArtifacts((current) => {
            if (change.eventType === 'DELETE') {
              const removed = change.old as { id?: string };
              return current.filter((entry) => entry.id !== removed.id);
            }
            const row = change.new;
            const index = current.findIndex((entry) => entry.id === row.id);
            if (index === -1) return [...current, row];
            return current.map((entry) => (entry.id === row.id ? row : entry));
          });
        },
      }),
    [notebookId],
  );

  const byKind = new Map(artifacts.map((artifact) => [artifact.kind, artifact]));

  return (
    <div className="flex min-h-0 flex-col gap-5 overflow-y-auto p-4">
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Sparkles className="text-muted-foreground size-4" aria-hidden />
          Studio
        </h2>

        {readySourceIds.length === 0 ? (
          <p className="text-muted-foreground rounded-md border border-dashed px-3 py-4 text-sm">
            Sobald eine Quelle verarbeitet ist, lassen sich hier Übersichten erzeugen.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {GENERATED_ARTIFACT_KINDS.map((kind) => (
              <ArtifactCard
                key={kind}
                kind={kind}
                notebookId={notebookId}
                artifact={byKind.get(kind) ?? null}
                canEdit={canEdit}
                readySourceIds={readySourceIds}
                onOpenCitation={(citation) => {
                  setViewer({
                    sourceId: citation.sourceId,
                    title: citation.sourceTitle,
                    range: { charStart: citation.charStart, charEnd: citation.charEnd },
                  });
                }}
              />
            ))}
          </ul>
        )}
      </section>

      <AudioOverview
        notebookId={notebookId}
        artifact={byKind.get('audio') ?? null}
        canEdit={canEdit}
        hasReadySources={readySourceIds.length > 0}
      />

      <NotesSection
        notebookId={notebookId}
        initialNotes={initialNotes}
        canEdit={canEdit}
        onOpenCitation={(citation) => {
          setViewer({
            sourceId: citation.sourceId,
            title: citation.sourceTitle,
            range: { charStart: citation.charStart, charEnd: citation.charEnd },
          });
        }}
      />

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

function ArtifactCard({
  kind,
  notebookId,
  artifact,
  canEdit,
  readySourceIds,
  onOpenCitation,
}: {
  readonly kind: GeneratedArtifactKind;
  readonly notebookId: string;
  readonly artifact: ArtifactRow | null;
  readonly canEdit: boolean;
  readonly readySourceIds: readonly string[];
  readonly onOpenCitation: (citation: Citation) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const meta = ARTIFACT_META[kind];

  const running = artifact?.status === 'pending' || artifact?.status === 'running';
  const ready = artifact?.status === 'ready';

  /*
   * Ist eine Quelle dazugekommen, seit das Artefakt erzeugt wurde, ist es
   * veraltet. Das anzuzeigen ist wichtiger, als es automatisch neu zu erzeugen:
   * Nachgenerieren kostet Geld, und vielleicht will der Nutzer die alte Fassung
   * behalten.
   */
  const stale =
    ready &&
    artifact.source_ids !== null &&
    readySourceIds.some((id) => !artifact.source_ids?.includes(id));

  const run = (work: () => Promise<{ error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (result.error) setError(result.error);
    });
  };

  return (
    <li className="bg-surface rounded-lg border">
      <div className="flex items-start gap-2 p-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">{meta.label}</p>
            {running && (
              <Loader2 className="text-primary size-3.5 animate-spin" aria-hidden />
            )}
            {artifact?.status === 'failed' && (
              <AlertCircle className="text-destructive size-3.5" aria-hidden />
            )}
            {stale && (
              <span className="text-muted-foreground bg-muted rounded-full px-1.5 py-0.5 text-[0.65rem]">
                veraltet
              </span>
            )}
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {running ? 'Wird erzeugt …' : meta.description}
          </p>
        </div>

        {canEdit && (
          <div className="flex shrink-0 gap-1">
            {ready ? (
              <Button
                variant="ghost"
                size="icon"
                disabled={pending}
                aria-label={`${meta.label} neu erzeugen`}
                title="Neu erzeugen"
                onClick={() => {
                  run(() => requestArtifact(notebookId, kind));
                }}
              >
                <RefreshCw aria-hidden />
              </Button>
            ) : (
              !running && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    run(() => requestArtifact(notebookId, kind));
                  }}
                >
                  <Plus aria-hidden />
                  Erzeugen
                </Button>
              )
            )}
            {artifact && (
              <Button
                variant="ghost"
                size="icon"
                disabled={pending}
                aria-label={`${meta.label} löschen`}
                title="Löschen"
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

      {artifact?.status === 'failed' && artifact.error && (
        <p className="text-destructive px-3 pb-3 text-xs leading-relaxed">
          {artifact.error}
        </p>
      )}

      {error && (
        <p role="alert" className="text-destructive px-3 pb-3 text-xs">
          {error}
        </p>
      )}

      {ready && artifact.payload !== null && (
        <div className="border-t">
          <button
            type="button"
            onClick={() => {
              setOpen((current) => !current);
            }}
            aria-expanded={open}
            className="hover:bg-muted focus-visible:ring-ring flex w-full items-center justify-between px-3 py-2 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            {open ? 'Einklappen' : 'Anzeigen'}
            <ChevronDown
              className={cn('size-3.5 transition-transform', open && 'rotate-180')}
              aria-hidden
            />
          </button>
          {open && (
            <div className="border-t p-3">
              <ArtifactView
                kind={kind}
                payload={artifact.payload}
                onOpenCitation={onOpenCitation}
              />
            </div>
          )}
        </div>
      )}
    </li>
  );
}
