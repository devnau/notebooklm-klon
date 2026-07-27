'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * Welche Quellen der Chat berücksichtigen soll.
 *
 * Der Zustand liegt hier und nicht in einer der beiden Spalten, weil ihn beide
 * brauchen: die Quellenspalte setzt ihn, der Chat liest ihn. Beide sind
 * Geschwister unter der Arbeitsfläche, also gibt es keinen gemeinsamen
 * Elternteil, durch den man ihn durchreichen könnte, ohne die Arbeitsfläche zu
 * einer Client-Komponente zu machen — und die soll auf dem Server gerendert
 * bleiben.
 *
 * Die Darstellung ist bewusst umgekehrt: gespeichert wird, was **abgewählt**
 * ist. Der Normalfall ist „alle Quellen", und eine neu hinzugefügte Quelle soll
 * automatisch dazugehören. Mit einer Liste der ausgewählten IDs wäre sie
 * stillschweigend ausgeschlossen — der Chat würde sie nicht kennen, und niemand
 * wüsste warum.
 */

type SelectionValue = {
  readonly excluded: ReadonlySet<string>;
  readonly toggle: (sourceId: string) => void;
  readonly includeAll: () => void;
  /** `undefined` bedeutet „kein Filter"; sonst die ausgewählten IDs. */
  readonly selectedIds: (allIds: readonly string[]) => string[] | undefined;
};

const SelectionContext = createContext<SelectionValue | null>(null);

export function SourceSelectionProvider({ children }: { readonly children: ReactNode }) {
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());

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

  const selectedIds = useCallback(
    (allIds: readonly string[]) => {
      if (excluded.size === 0) return undefined;
      const selected = allIds.filter((id) => !excluded.has(id));
      /*
       * Sind alle abgewählt, wird trotzdem nicht gefiltert. Ein leerer Filter
       * käme in der Datenbank als „keine Einschränkung" an — das Gegenteil der
       * Absicht. Die Oberfläche verhindert diesen Zustand ohnehin, aber ein
       * Datenleck durch eine Randbedingung soll nicht von der Oberfläche
       * abhängen.
       */
      return selected.length > 0 ? selected : ['00000000-0000-0000-0000-000000000000'];
    },
    [excluded],
  );

  const value = useMemo(
    () => ({ excluded, toggle, includeAll, selectedIds }),
    [excluded, toggle, includeAll, selectedIds],
  );

  return <SelectionContext value={value}>{children}</SelectionContext>;
}

export function useSourceSelection(): SelectionValue {
  const value = useContext(SelectionContext);
  if (!value) {
    throw new Error('useSourceSelection benötigt einen SourceSelectionProvider.');
  }
  return value;
}
