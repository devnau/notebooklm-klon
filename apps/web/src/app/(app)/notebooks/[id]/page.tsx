import { hasAtLeastRole, notebookRoleSchema, type Citation } from '@nlm/shared';
import { Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ChatPanel, type ChatMessage } from '@/components/chat/chat-panel';
import { NotebookHeader } from '@/components/notebooks/notebook-header';
import { SourceSelectionProvider } from '@/components/notebooks/source-selection';
import { SourcesPanel, type SourceRow } from '@/components/sources/sources-panel';
import { WorkspaceShell } from '@/components/layout/workspace-shell';
import { createClient } from '@/lib/supabase/server';

type Params = { readonly params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from('notebooks')
    .select('title')
    .eq('id', id)
    .maybeSingle();

  return { title: data?.title ?? 'Notebook' };
}

export default async function NotebookPage({ params }: Params) {
  const { id } = await params;
  const supabase = await createClient();

  /*
   * `maybeSingle` und dann notFound(): existiert das Notebook nicht ODER fehlt
   * dem Nutzer der Zugriff, kommt in beiden Fällen null zurück. Genau so soll
   * es sein — eine Unterscheidung würde verraten, dass die ID existiert.
   */
  const { data: notebook } = await supabase
    .from('notebooks')
    .select('id, title, emoji, language, owner_id, created_at')
    .eq('id', id)
    .maybeSingle();

  if (!notebook) notFound();

  const { data: membership } = await supabase
    .from('notebook_members')
    .select('role')
    .eq('notebook_id', id)
    .maybeSingle();

  // Der generierte Typ kennt nur `string`, weil die Rolle in der Datenbank per
  // CHECK-Constraint eingegrenzt ist und nicht als Enum-Typ. Das Schema aus
  // @nlm/shared spiegelt dieselben Werte und macht daraus wieder einen Typ.
  const role = notebookRoleSchema.catch('viewer').parse(membership?.role);

  /*
   * Die Quellen kommen vom Server, damit die Spalte beim ersten Aufruf gefüllt
   * ist. Alles Weitere — Statuswechsel während des Imports — läuft danach über
   * Realtime im Client-Teil.
   */
  const { data: sources } = await supabase
    .from('sources')
    .select('id, kind, title, status, error, page_count, char_count, created_at')
    .eq('notebook_id', id)
    .order('created_at', { ascending: false });

  /*
   * Die zuletzt bearbeitete Unterhaltung wird fortgesetzt. Bei jedem Aufruf
   * eine neue anzulegen würde den Verlauf in unzusammenhängende Fragmente
   * zerlegen — und der Verlauf ist es, der Rückfragen erst möglich macht.
   */
  const { data: chat } = await supabase
    .from('chats')
    .select('id')
    .eq('notebook_id', id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: history } = chat
    ? await supabase
        .from('messages')
        .select('id, role, content, citations')
        .eq('chat_id', chat.id)
        .order('id')
        .limit(100)
    : { data: null };

  const messages: ChatMessage[] = (history ?? []).map((message) => ({
    id: message.id,
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: message.content,
    // `citations` ist jsonb; die generierten Typen kennen nur `Json`. Die Form
    // wird beim Schreiben in der Chat-Route festgelegt.
    citations: (message.citations ?? []) as unknown as Citation[],
  }));

  const readySourceIds = (sources ?? [])
    .filter((source) => source.status === 'ready')
    .map((source) => source.id);

  return (
    <>
      <NotebookHeader notebook={notebook} role={role} />
      {/*
        Der Provider umschliesst beide Spalten: die Quellenspalte setzt die
        Auswahl, der Chat liest sie. Ein gemeinsamer Elternteil, durch den man
        sie durchreichen könnte, existiert nicht — die Arbeitsfläche soll auf
        dem Server gerendert bleiben.
      */}
      <SourceSelectionProvider>
        <WorkspaceShell
          sources={
            <SourcesPanel
              notebookId={id}
              role={role}
              initialSources={(sources ?? []) as SourceRow[]}
            />
          }
          chat={
            <ChatPanel
              notebookId={id}
              initialMessages={messages}
              initialChatId={chat?.id ?? null}
              canAsk={hasAtLeastRole(role, 'editor')}
              hasReadySources={readySourceIds.length > 0}
              readySourceIds={readySourceIds}
            />
          }
          studio={<StudioPlaceholder />}
        />
      </SourceSelectionProvider>
    </>
  );
}

function StudioPlaceholder() {
  return (
    <div className="border-t p-4 lg:border-t-0 lg:border-l">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
        <Sparkles className="text-muted-foreground size-4" aria-hidden />
        Studio
      </h2>
      <ul className="flex flex-col gap-2">
        {[
          'Zusammenfassung',
          'Lernleitfaden',
          'FAQ',
          'Zeitleiste',
          'Briefing',
          'Mindmap',
          'Audio-Überblick',
        ].map((item) => (
          <li
            key={item}
            className="text-muted-foreground rounded-md border border-dashed px-3 py-2.5 text-sm"
          >
            {item}
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground mt-3 text-xs">
        Ab Phase 4 verfügbar, sobald Quellen indexiert sind.
      </p>
    </div>
  );
}
