'use client';

import { hasAtLeastRole, type NotebookRole } from '@nlm/shared';
import { ArrowLeft, Eye, Pencil } from 'lucide-react';
import Link from 'next/link';

import { NotebookMenu } from '@/components/notebooks/notebook-menu';
import { RenameNotebookDialog } from '@/components/notebooks/rename-notebook-dialog';
import { Button } from '@/components/ui/button';

type Notebook = {
  readonly id: string;
  readonly title: string;
  readonly emoji: string;
  readonly language: string;
};

export function NotebookHeader({
  notebook,
  role,
}: {
  readonly notebook: Notebook;
  readonly role: string;
}) {
  // Die Rolle steuert hier nur die Sichtbarkeit von Bedienelementen. Die
  // Berechtigung selbst prüft die Datenbank — ein manipuliertes Frontend
  // gewinnt dadurch nichts.
  const canEdit = hasAtLeastRole(role as NotebookRole, 'editor');

  return (
    <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-6">
      <Button variant="ghost" size="icon" asChild>
        <Link href="/notebooks" aria-label="Zurück zur Übersicht">
          <ArrowLeft aria-hidden />
        </Link>
      </Button>

      <span className="text-xl leading-none" aria-hidden>
        {notebook.emoji}
      </span>

      <h1 className="mr-auto truncate font-medium">{notebook.title}</h1>

      {!canEdit && (
        <span className="text-muted-foreground flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
          <Eye className="size-3.5" aria-hidden />
          Nur Lesen
        </span>
      )}

      {canEdit && (
        <RenameNotebookDialog
          notebook={notebook}
          trigger={
            <Button variant="ghost" size="sm">
              <Pencil aria-hidden />
              Umbenennen
            </Button>
          }
        />
      )}

      <NotebookMenu notebookId={notebook.id} role={role} />
    </div>
  );
}
