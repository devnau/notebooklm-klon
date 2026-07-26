import type { Metadata } from 'next';

import { CreateNotebookDialog } from '@/components/notebooks/create-notebook-dialog';
import { NotebookGrid } from '@/components/notebooks/notebook-grid';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Notebooks',
};

export default async function NotebooksPage() {
  const supabase = await createClient();

  /*
   * Kein Filter auf owner_id oder Mitgliedschaft: die RLS-Policy liefert
   * ohnehin nur Notebooks, auf die der Nutzer Zugriff hat. Ein zusätzlicher
   * Filter wäre eine zweite Wahrheit — und würde geteilte Notebooks ausblenden.
   */
  const { data: notebooks, error } = await supabase
    .from('notebooks')
    .select('id, title, emoji, language, updated_at, owner_id')
    .order('updated_at', { ascending: false });

  return (
    <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notebooks</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {notebooks?.length
              ? `${notebooks.length} ${notebooks.length === 1 ? 'Notebook' : 'Notebooks'}`
              : 'Ein Notebook bündelt Quellen, Chat und Notizen zu einem Thema.'}
          </p>
        </div>
        <CreateNotebookDialog />
      </div>

      {error ? (
        <p className="bg-destructive-subtle text-destructive rounded-md p-4 text-sm">
          Die Notebooks konnten nicht geladen werden. Bitte die Seite neu laden.
        </p>
      ) : (
        <NotebookGrid notebooks={notebooks ?? []} />
      )}
    </main>
  );
}
