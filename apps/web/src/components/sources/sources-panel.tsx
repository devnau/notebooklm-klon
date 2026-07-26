'use client';

import { hasAtLeastRole, type NotebookRole } from '@nlm/shared';
import { FileText, Globe, RotateCcw, Trash2, Type } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';

import { deleteSource, retrySource } from '@/app/(app)/notebooks/[id]/sources/actions';
import { AddSourceDialog } from '@/components/sources/add-source-dialog';
import {
  StatusPill,
  statusAnnouncement,
  type SourceStatus,
} from '@/components/sources/status-pill';
import { SourceViewer } from '@/components/sources/source-viewer';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

/**
 * Die Quellenspalte.
 *
 * Der Anfangszustand kommt vom Server (kein Ladezustand beim ersten Aufruf),
 * Änderungen kommen danach über Supabase Realtime. Bewusst kein Polling: der
 * Import einer großen Datei läuft Minuten, und ein Intervall wäre entweder zu
 * träge für die Anzeige oder zu gesprächig für den Server.
 *
 * Die Statusänderungen schreibt der Worker mit `service_role`. Dass sie hier
 * ankommen, entscheidet trotzdem die RLS-Policy auf `sources` — Realtime prüft
 * sie für jeden Abonnenten einzeln. Ein Fremder bekäme die Ereignisse also
 * nicht, auch wenn er den Kanalnamen erriete.
 */

export type SourceRow = {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly status: SourceStatus;
  readonly error: string | null;
  readonly page_count: number | null;
  readonly char_count: number | null;
  readonly created_at: string;
};

export function SourcesPanel({
  notebookId,
  role,
  initialSources,
}: {
  readonly notebookId: string;
  readonly role: NotebookRole;
  readonly initialSources: readonly SourceRow[];
}) {
  const [sources, setSources] = useState<readonly SourceRow[]>(initialSources);
  const [announcement, setAnnouncement] = useState('');
  const canEdit = hasAtLeastRole(role, 'editor');

  /*
   * Der Server-Zustand gewinnt, wenn die Seite neu gerendert wird (etwa nach
   * revalidatePath). Ohne das bliebe eine gerade hinzugefügte Quelle
   * unsichtbar, bis das Realtime-Ereignis eintrifft — und wäre doppelt zu
   * sehen, falls beides kommt.
   */
  useEffect(() => {
    setSources(initialSources);
  }, [initialSources]);

  // Für die Ansage: den vorherigen Status je Quelle behalten, damit nur echte
  // Übergänge vorgelesen werden und nicht jedes eintreffende Ereignis.
  const previousStatus = useRef(new Map<string, SourceStatus>());

  useEffect(() => {
    const supabase = createClient();

    /*
     * Der Kanalname bekommt eine Zufallskomponente. `supabase.channel()` gibt
     * bei gleichem Namen dieselbe Instanz zurück — und React ruft Effekte im
     * Strict Mode zweimal auf. Der zweite Durchlauf träfe damit auf einen
     * bereits abonnierten Kanal, auf dem `.on()` nicht mehr erlaubt ist:
     * „cannot add postgres_changes callbacks after subscribe()". Der Abbau des
     * ersten Kanals läuft asynchron und ist zu diesem Zeitpunkt nicht fertig.
     *
     * Der Name ist ohnehin nur ein lokaler Bezeichner; welche Zeilen jemand zu
     * sehen bekommt, entscheidet die RLS-Policy auf `sources`, nicht der Name.
     */
    const channel = supabase
      .channel(`sources:${notebookId}:${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sources',
          filter: `notebook_id=eq.${notebookId}`,
        },
        (payload) => {
          setSources((current) => {
            if (payload.eventType === 'DELETE') {
              const removed = payload.old as { id?: string };
              return current.filter((entry) => entry.id !== removed.id);
            }

            const row = payload.new as SourceRow;
            const before = previousStatus.current.get(row.id);
            if (before !== row.status) {
              previousStatus.current.set(row.id, row.status);
              // Nur die Endzustände ansagen. „Wird gelesen" und „Wird
              // indexiert" folgen dicht aufeinander; sie vorzulesen würde einen
              // Screenreader-Nutzer beim Arbeiten unterbrechen, ohne ihm etwas
              // zu sagen, das er nicht schon weiß.
              if (row.status === 'ready' || row.status === 'failed') {
                setAnnouncement(statusAnnouncement(row.title, row.status));
              }
            }

            const index = current.findIndex((entry) => entry.id === row.id);
            if (index === -1) return [row, ...current];
            return current.map((entry) => (entry.id === row.id ? row : entry));
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [notebookId]);

  return (
    <div className="flex min-h-0 flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <FileText className="text-muted-foreground size-4" aria-hidden />
          Quellen
          {sources.length > 0 && (
            <span className="text-muted-foreground font-normal">({sources.length})</span>
          )}
        </h2>
      </div>

      {canEdit && <AddSourceDialog notebookId={notebookId} />}

      {/* Ansagen für Screenreader; visuell zeigt die Statuspille dasselbe. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {sources.length === 0 ? (
        <EmptyState
          className="border-0 px-2 py-8"
          title="Noch keine Quellen"
          description={
            canEdit
              ? 'Lade ein PDF hoch, füge eine Adresse ein oder kopiere Text hierher. Danach kann der Chat sich darauf berufen.'
              : 'In diesem Notebook liegen noch keine Quellen.'
          }
        />
      ) : (
        <ul className="flex min-h-0 flex-col gap-2 overflow-y-auto">
          {sources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              notebookId={notebookId}
              canEdit={canEdit}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

const KIND_ICON: Record<string, typeof FileText> = {
  url: Globe,
  paste: Type,
};

function SourceCard({
  source,
  notebookId,
  canEdit,
}: {
  readonly source: SourceRow;
  readonly notebookId: string;
  readonly canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const Icon = KIND_ICON[source.kind] ?? FileText;

  const run = (work: () => Promise<{ error?: string }>) => {
    setActionError(null);
    startTransition(async () => {
      const result = await work();
      if (result.error) setActionError(result.error);
    });
  };

  return (
    <li
      className={cn(
        'bg-surface rounded-lg border p-3 transition-colors',
        pending && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-2.5">
        <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          {/*
            Nur fertige Quellen sind anklickbar. Eine Schaltfläche, die
            zuverlässig „wird noch verarbeitet" antwortet, ist keine
            Schaltfläche, sondern eine Einladung zum Frust.
          */}
          {source.status === 'ready' ? (
            <button
              type="button"
              onClick={() => {
                setViewerOpen(true);
              }}
              className="focus-visible:ring-ring block max-w-full truncate rounded-sm text-left text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
              title={source.title}
            >
              {source.title}
            </button>
          ) : (
            <p className="truncate text-sm font-medium" title={source.title}>
              {source.title}
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <StatusPill status={source.status} />
            {source.status === 'ready' && source.page_count !== null && (
              <span className="text-muted-foreground text-xs">
                {source.page_count} Seiten
              </span>
            )}
          </div>
        </div>
      </div>

      {/*
        Die Fehlermeldung steht im Klartext an der Quelle, nicht in einem
        Toast, der wegfliegt: Wer sie liest, will genau hier entscheiden, ob er
        es noch einmal versucht oder die Quelle löscht.
      */}
      {source.status === 'failed' && source.error && (
        <p className="text-destructive mt-2.5 text-xs leading-relaxed">{source.error}</p>
      )}

      {actionError && (
        <p role="alert" className="text-destructive mt-2 text-xs">
          {actionError}
        </p>
      )}

      {canEdit && (
        <div className="mt-2.5 flex gap-1">
          {source.status === 'failed' && (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => {
                run(() => retrySource(notebookId, source.id));
              }}
            >
              <RotateCcw aria-hidden />
              Erneut versuchen
            </Button>
          )}
          {/*
            Zweistufig statt Bestätigungsdialog. Löschen ist hier endgültig —
            die Datei, alle Abschnitte und damit jedes Zitat, das darauf zeigt,
            sind weg. Ein versehentlicher Klick darf das nicht auslösen, aber
            ein modaler Dialog für eine Quelle unter zwanzig wäre schwerfällig.
          */}
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            className={cn(confirmDelete && 'text-destructive')}
            onClick={() => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              run(() => deleteSource(notebookId, source.id));
            }}
            onBlur={() => {
              setConfirmDelete(false);
            }}
          >
            <Trash2 aria-hidden />
            <span className="sr-only">{source.title} </span>
            {confirmDelete ? 'Wirklich löschen?' : 'Löschen'}
          </Button>
        </div>
      )}

      {/*
        Der Viewer wird erst gemountet, wenn er gebraucht wird. Bei zwanzig
        Quellen wären das sonst zwanzig Dialoge im DOM, von denen keiner
        sichtbar ist.
      */}
      {viewerOpen && (
        <SourceViewer
          sourceId={source.id}
          title={source.title}
          open={viewerOpen}
          onOpenChange={setViewerOpen}
        />
      )}
    </li>
  );
}
