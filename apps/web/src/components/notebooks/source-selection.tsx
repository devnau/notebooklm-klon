'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { SourceStatus } from '@/components/sources/status-pill';
import { subscribeToTable } from '@/lib/supabase/realtime';

/**
 * Der Stand der Quellen — für alle Spalten der Arbeitsfläche.
 *
 * **Warum das hier liegt und nicht in der Quellenspalte.** Drei Bereiche
 * brauchen dieselbe Information, und sie müssen sich einig sein:
 *
 *  * die **Quellenspalte** zeigt die Liste samt Status,
 *  * der **Chat** braucht die Auswahl, auf die er sich stützen soll,
 *  * das **Studio** darf Übersichten erst anbieten, wenn eine Quelle fertig
 *    verarbeitet ist.
 *
 * Vorher hielt die Quellenspalte ihren Stand selbst und das Studio bekam eine
 * Liste als Prop vom Server. Das ging schief, sobald eine Quelle *während* der
 * Sitzung fertig wurde: die Quellenspalte zeigte „Bereit", das Studio bestand
 * weiter darauf, es gebe keine verarbeitete Quelle — bis jemand neu lud. Ein
 * Zustand an zwei Stellen läuft auseinander, sobald nur eine davon
 * aktualisiert wird.
 *
 * Nebeneffekt: es gibt nur noch **ein** Realtime-Abonnement für Quellen statt
 * eines je Spalte.
 *
 * Die Abwahl speichert, was **ausgeschlossen** ist, nicht was ausgewählt ist.
 * Der Normalfall ist „alle Quellen", und eine neu hinzugefügte soll automatisch
 * dazugehören. Mit einer Liste ausgewählter IDs wäre sie stillschweigend
 * ausgeschlossen — der Chat kennte sie nicht, und niemand wüsste warum.
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

type SourcesValue = {
  readonly sources: readonly SourceRow[];
  /** IDs der fertig verarbeiteten Quellen — Voraussetzung für Chat und Studio. */
  readonly readySourceIds: readonly string[];
  readonly excluded: ReadonlySet<string>;
  readonly toggle: (sourceId: string) => void;
  readonly includeAll: () => void;
  /** `undefined` bedeutet „kein Filter"; sonst die ausgewählten IDs. */
  readonly selectedIds: () => string[] | undefined;
  /** Zuletzt erreichter Endzustand, für die Ansage an Screenreader. */
  readonly announcement: string;
};

const SourcesContext = createContext<SourcesValue | null>(null);

export function SourceSelectionProvider({
  notebookId,
  initialSources,
  children,
}: {
  readonly notebookId: string;
  readonly initialSources: readonly SourceRow[];
  readonly children: ReactNode;
}) {
  const [sources, setSources] = useState<readonly SourceRow[]>(initialSources);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [announcement, setAnnouncement] = useState('');

  /*
   * Der Serverstand gewinnt, wenn die Seite neu gerendert wird — etwa nach
   * `revalidatePath`. Ohne das bliebe eine gerade hinzugefügte Quelle
   * unsichtbar, bis das Realtime-Ereignis eintrifft.
   */
  useEffect(() => {
    setSources(initialSources);
  }, [initialSources]);

  useEffect(
    () =>
      subscribeToTable<SourceRow>({
        table: 'sources',
        notebookId,
        onChange: (payload) => {
          if (payload.eventType === 'DELETE') {
            const removed = payload.old as { id?: string };
            setSources((current) => current.filter((entry) => entry.id !== removed.id));
            return;
          }

          const row = payload.new;
          setSources((current) => {
            const index = current.findIndex((entry) => entry.id === row.id);
            if (index === -1) return [row, ...current];
            /*
             * Nur die Endzustände ansagen. „Wird gelesen" und „Wird indexiert"
             * folgen dicht aufeinander; sie vorzulesen würde einen
             * Screenreader-Nutzer beim Arbeiten unterbrechen, ohne ihm etwas zu
             * sagen, das er nicht schon weiß.
             */
            const vorher = current[index]?.status;
            if (
              vorher !== row.status &&
              (row.status === 'ready' || row.status === 'failed')
            ) {
              setAnnouncement(
                row.status === 'ready'
                  ? `${row.title} ist bereit.`
                  : `${row.title} konnte nicht verarbeitet werden.`,
              );
            }
            return current.map((entry) => (entry.id === row.id ? row : entry));
          });
        },
      }),
    [notebookId],
  );

  const readySourceIds = useMemo(
    () => sources.filter((source) => source.status === 'ready').map((source) => source.id),
    [sources],
  );

  const toggle = useCallback((sourceId: string) => {
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
  }, []);

  const includeAll = useCallback(() => {
    setExcluded(new Set());
  }, []);

  const selectedIds = useCallback(() => {
    if (excluded.size === 0) return undefined;
    const selected = readySourceIds.filter((id) => !excluded.has(id));
    /*
     * Sind alle abgewählt, wird trotzdem gefiltert — mit einer ID, die nichts
     * trifft. Ein leerer Filter käme in der Datenbank als „keine
     * Einschränkung" an, also als das Gegenteil der Absicht. Die Oberfläche
     * verhindert diesen Zustand ohnehin, aber ein Datenleck soll nicht davon
     * abhängen, dass die Oberfläche sich richtig verhält.
     */
    return selected.length > 0 ? selected : ['00000000-0000-0000-0000-000000000000'];
  }, [excluded, readySourceIds]);

  const value = useMemo(
    () => ({
      sources,
      readySourceIds,
      excluded,
      toggle,
      includeAll,
      selectedIds,
      announcement,
    }),
    [sources, readySourceIds, excluded, toggle, includeAll, selectedIds, announcement],
  );

  return <SourcesContext value={value}>{children}</SourcesContext>;
}

export function useSourceSelection(): SourcesValue {
  const value = useContext(SourcesContext);
  if (!value) {
    throw new Error('useSourceSelection benötigt einen SourceSelectionProvider.');
  }
  return value;
}
