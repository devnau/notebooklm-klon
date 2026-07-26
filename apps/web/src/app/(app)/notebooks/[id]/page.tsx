import { FileText, MessageSquareQuote, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { NotebookHeader } from '@/components/notebooks/notebook-header';
import { WorkspaceShell } from '@/components/layout/workspace-shell';
import { EmptyState } from '@/components/ui/empty-state';
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

  const role = membership?.role ?? 'viewer';

  return (
    <>
      <NotebookHeader notebook={notebook} role={role} />
      <WorkspaceShell
        sources={<SourcesPlaceholder />}
        chat={<ChatPlaceholder />}
        studio={<StudioPlaceholder />}
      />
    </>
  );
}

/* Die drei Bereiche entstehen in Phase 2 bis 4. Bis dahin steht hier, was
   kommt — ein leerer Kasten würde wie ein Fehler wirken. */

function SourcesPlaceholder() {
  return (
    <div className="border-b p-4 lg:border-b-0">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
        <FileText className="text-muted-foreground size-4" aria-hidden />
        Quellen
      </h2>
      <EmptyState
        className="border-0 px-2 py-8"
        title="Noch keine Quellen"
        description="Ab Phase 2: PDFs, Dokumente, Webseiten und eingefügter Text — hochgeladen, extrahiert und durchsuchbar gemacht."
      />
    </div>
  );
}

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
