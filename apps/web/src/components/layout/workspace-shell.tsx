'use client';

import { FileText, MessageSquareQuote, Sparkles } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';

import { cn } from '@/lib/utils';

type Pane = 'sources' | 'chat' | 'studio';

const TABS: readonly { id: Pane; label: string; icon: typeof FileText }[] = [
  { id: 'sources', label: 'Quellen', icon: FileText },
  { id: 'chat', label: 'Chat', icon: MessageSquareQuote },
  { id: 'studio', label: 'Studio', icon: Sparkles },
];

const PANEL_IDS = ['sources', 'chat', 'studio'];

/**
 * Speicher für die Spaltenbreiten, der auch auf dem Server funktioniert.
 *
 * `useDefaultLayout` greift standardmässig direkt auf `localStorage` zu — und
 * zwar beim Rendern, nicht in einem Effekt. Auf dem Server gibt es das Objekt
 * nicht, und Next bricht mit „localStorage is not defined" ab. Ein `'use
 * client'` an der Datei hilft nicht: Client Components werden trotzdem
 * serverseitig vorgerendert.
 *
 * Auf dem Server gibt der Speicher nichts zurück. Das ist genau richtig — dort
 * ist unbekannt, welche Breiten dieser Nutzer eingestellt hat, und der Hook
 * fällt dann auf die Standardaufteilung zurück. Sobald der Browser übernimmt,
 * liest er den echten Wert.
 */
const layoutStorage = {
  getItem(key: string): string | null {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      // Privater Modus oder gesperrte Speicher: dann eben keine gespeicherten
      // Breiten. Ein Absturz wäre die schlechtere Antwort.
      return null;
    }
  },
  setItem(key: string, value: string): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* siehe oben */
    }
  },
};

/**
 * Dreispaltiges Arbeitslayout: Quellen, Chat, Studio.
 *
 * Ab `lg` drei Spalten mit verschiebbaren Trennern, deren Breiten erhalten
 * bleiben. Darunter Tab-Navigation — drei Spalten auf einem Telefon wären drei
 * unbenutzbare Spalten.
 *
 * Die Aufteilung ist bewusst nicht „gestapelt" responsiv: Quellen und Chat
 * gleichzeitig zu sehen ist der eigentliche Zweck der Anwendung. Wo dafür kein
 * Platz ist, ist ein Wechsel besser als ein Kompromiss.
 */
export function WorkspaceShell({
  sources,
  chat,
  studio,
}: {
  readonly sources: ReactNode;
  readonly chat: ReactNode;
  readonly studio: ReactNode;
}) {
  const [activeTab, setActiveTab] = useState<Pane>('chat');

  // Übernimmt Speichern und Wiederherstellen der Breiten selbst. Vorher stand
  // hier eigener localStorage-Code — der Hook macht dasselbe, kennt aber
  // zusätzlich den serverseitig gerenderten Erstzustand und vermeidet damit
  // das Springen des Layouts nach der Hydration.
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'nlm:workspace',
    panelIds: PANEL_IDS,
    onlySaveAfterUserInteractions: true,
    storage: layoutStorage,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ── Mobil und Tablet: Tabs ───────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col lg:hidden">
        <div
          role="tablist"
          aria-label="Arbeitsbereiche"
          className="bg-background/85 sticky top-14 z-20 flex border-b backdrop-blur-sm"
        >
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              role="tab"
              id={`tab-${id}`}
              aria-selected={activeTab === id}
              aria-controls={`panel-${id}`}
              onClick={() => setActiveTab(id)}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 border-b-2 px-3 py-2.5',
                'text-sm font-medium transition-colors',
                'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
                activeTab === id
                  ? 'border-primary text-foreground'
                  : 'text-muted-foreground hover:text-foreground border-transparent',
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          ))}
        </div>

        {TABS.map(({ id }) => (
          <div
            key={id}
            role="tabpanel"
            id={`panel-${id}`}
            aria-labelledby={`tab-${id}`}
            // `hidden` statt Ausblenden per CSS: nur so ist der inaktive
            // Bereich auch für Screenreader und die Tab-Reihenfolge weg.
            hidden={activeTab !== id}
            className="min-h-0 flex-1 overflow-y-auto"
          >
            {id === 'sources' ? sources : id === 'chat' ? chat : studio}
          </div>
        ))}
      </div>

      {/* ── Desktop: drei Spalten ────────────────────────────────────────── */}
      <Group
        orientation="horizontal"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
        className="hidden min-h-0 flex-1 lg:flex"
      >
        <Panel id="sources" defaultSize="22%" minSize="16%" maxSize="38%">
          <section aria-label="Quellen" className="h-full overflow-y-auto">
            {sources}
          </section>
        </Panel>

        <ResizeSeparator label="Breite der Quellenspalte" />

        <Panel id="chat" defaultSize="50%" minSize="30%">
          <section aria-label="Chat" className="flex h-full flex-col">
            {chat}
          </section>
        </Panel>

        <ResizeSeparator label="Breite der Studiospalte" />

        <Panel id="studio" defaultSize="28%" minSize="18%" maxSize="42%">
          <section aria-label="Studio" className="h-full overflow-y-auto">
            {studio}
          </section>
        </Panel>
      </Group>
    </div>
  );
}

/**
 * Der Trenner ist mit den Pfeiltasten bedienbar, das übernimmt die Bibliothek.
 * Wichtig ist die Trefferfläche: eine 1-Pixel-Linie mit 9 Pixel Greifzone —
 * genau die Linie treffen zu müssen wäre mit der Maus eine Zumutung.
 */
function ResizeSeparator({ label }: { readonly label: string }) {
  return (
    <Separator
      aria-label={label}
      className={cn(
        'relative w-px shrink-0 bg-[var(--color-border)]',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        'data-[separator-state=dragging]:bg-[var(--color-primary)]',
      )}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 -left-1 w-2.5 cursor-col-resize hover:bg-[var(--color-primary)]/25"
      />
    </Separator>
  );
}
