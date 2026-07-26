import { notebookRoleSchema } from '@nlm/shared';
import { MessageSquareQuote, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { NotebookHeader } from '@/components/notebooks/notebook-header';
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

  return (
    <>
      <NotebookHeader notebook={notebook} role={role} />
      <WorkspaceShell
        sources={
          <SourcesPanel
            notebookId={id}
            role={role}
            initialSources={(sources ?? []) as SourceRow[]}
          />
        }
        chat={<ChatPlaceholder />}
        studio={<StudioPlaceholder />}
      />
    </>
  );
}

/* Chat und Studio entstehen in Phase 3 und 4. Bis dahin steht hier, was
   kommt — ein leerer Kasten würde wie ein Fehler wirken. */

function ChatPlaceholder() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-8">
      <div className="max-w-md text-center">
        <MessageSquareQuote className="text-border mx-auto size-10" aria-hidden />
        <h2 className="mt-5 font-medium">Belegter Chat</h2>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          Ab Phase 3: Fragen an die eigenen Quellen, Antwort im Streaming, jede Aussage mit
          klickbarem Verweis auf die Textstelle.
        </p>
      </div>
    </div>
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
