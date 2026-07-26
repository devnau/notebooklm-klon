import Link from 'next/link';

import { CreateNotebookDialog } from '@/components/notebooks/create-notebook-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { formatRelativeDate } from '@/lib/format';

type NotebookRow = {
  readonly id: string;
  readonly title: string;
  readonly emoji: string;
  readonly language: string;
  readonly updated_at: string;
};

export function NotebookGrid({
  notebooks,
}: {
  readonly notebooks: readonly NotebookRow[];
}) {
  if (notebooks.length === 0) {
    return (
      <EmptyState
        title="Noch kein Notebook"
        description="Lege eines an, lade deine Quellen hoch und stelle Fragen dazu. Jede Antwort verweist auf die Stelle, aus der sie stammt."
        action={<CreateNotebookDialog triggerVariant="primary" />}
      />
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {notebooks.map((notebook) => (
        <li key={notebook.id}>
          <Link
            href={`/notebooks/${notebook.id}`}
            className="bg-surface shadow-card hover:border-border-strong focus-visible:ring-ring focus-visible:ring-offset-background group flex h-full flex-col rounded-lg border p-5 transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <span className="text-2xl leading-none" aria-hidden>
              {notebook.emoji}
            </span>
            <h2 className="group-hover:text-primary mt-3 font-medium transition-colors">
              {notebook.title}
            </h2>
            <p className="text-muted-foreground mt-auto pt-4 text-xs">
              Geändert {formatRelativeDate(notebook.updated_at)}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
