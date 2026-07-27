'use client';

import type { Citation } from '@nlm/shared';
import { Check, Pencil, Plus, StickyNote, Trash2, X } from 'lucide-react';
import { useState, useTransition } from 'react';

import {
  createNote,
  deleteNote,
  updateNote,
} from '@/app/(app)/notebooks/[id]/studio/actions';
import { CitationChip } from '@/components/chat/citation-chip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Markdown } from '@/components/ui/markdown';
import { cn } from '@/lib/utils';

/**
 * Notizen.
 *
 * Zwei Sorten in einer Liste: selbst geschriebene und aus einer Antwort
 * übernommene. Übernommene tragen ihre Belege mit — ohne sie wäre eine Notiz
 * eine Behauptung ohne Herkunft, und genau das unterscheidet die Anwendung von
 * einem Textfeld neben einem Chatfenster.
 *
 * Bearbeitet wird direkt in der Liste, nicht in einem Dialog. Eine Notiz ist
 * kurz, und ein modaler Dialog für drei Zeilen Text unterbricht mehr, als er
 * ordnet.
 */

export type NoteRow = {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly kind: string;
  readonly citations: unknown;
  readonly updated_at: string;
};

export function NotesSection({
  notebookId,
  initialNotes,
  canEdit,
  onOpenCitation,
}: {
  readonly notebookId: string;
  readonly initialNotes: readonly NoteRow[];
  readonly canEdit: boolean;
  readonly onOpenCitation: (citation: Citation) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <StickyNote className="text-muted-foreground size-4" aria-hidden />
          Notizen
          {initialNotes.length > 0 && (
            <span className="text-muted-foreground font-normal">
              ({initialNotes.length})
            </span>
          )}
        </h2>
        {canEdit && !creating && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setCreating(true);
            }}
          >
            <Plus aria-hidden />
            Neu
          </Button>
        )}
      </div>

      {creating && (
        <form
          action={(formData) => {
            setError(null);
            startTransition(async () => {
              const result = await createNote({}, formData);
              if (result.error) setError(result.error);
              else setCreating(false);
            });
          }}
          className="bg-surface mb-2 flex flex-col gap-2 rounded-lg border p-3"
        >
          <input type="hidden" name="notebookId" value={notebookId} />
          <label htmlFor="note-title" className="sr-only">
            Titel der Notiz
          </label>
          <Input id="note-title" name="title" placeholder="Titel" required autoFocus />
          <label htmlFor="note-content" className="sr-only">
            Inhalt der Notiz
          </label>
          <textarea
            id="note-content"
            name="content"
            rows={4}
            placeholder="Markdown wird unterstützt …"
            className={cn(
              'bg-background w-full resize-y rounded-md border px-3 py-2 text-sm',
              'placeholder:text-muted-foreground',
              'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
            )}
          />
          {error && (
            <p role="alert" className="text-destructive text-xs">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setCreating(false);
                setError(null);
              }}
            >
              Abbrechen
            </Button>
            <Button type="submit" size="sm" loading={pending}>
              Speichern
            </Button>
          </div>
        </form>
      )}

      {initialNotes.length === 0 && !creating ? (
        <p className="text-muted-foreground rounded-md border border-dashed px-3 py-4 text-sm">
          {canEdit
            ? 'Noch keine Notizen. Eigene anlegen oder eine Antwort aus dem Chat übernehmen — die Belege kommen mit.'
            : 'In diesem Notizbuch liegen noch keine Notizen.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {initialNotes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              notebookId={notebookId}
              canEdit={canEdit}
              onOpenCitation={onOpenCitation}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function NoteCard({
  note,
  notebookId,
  canEdit,
  onOpenCitation,
}: {
  readonly note: NoteRow;
  readonly notebookId: string;
  readonly canEdit: boolean;
  readonly onOpenCitation: (citation: Citation) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const citations = (note.citations ?? []) as Citation[];

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await updateNote(note.id, notebookId, { title, content });
      if (result.error) setError(result.error);
      else setEditing(false);
    });
  };

  if (editing) {
    return (
      <li className="bg-surface flex flex-col gap-2 rounded-lg border p-3">
        <label htmlFor={`title-${note.id}`} className="sr-only">
          Titel
        </label>
        <Input
          id={`title-${note.id}`}
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
          }}
        />
        <label htmlFor={`content-${note.id}`} className="sr-only">
          Inhalt
        </label>
        <textarea
          id={`content-${note.id}`}
          value={content}
          onChange={(event) => {
            setContent(event.target.value);
          }}
          rows={6}
          className={cn(
            'bg-background w-full resize-y rounded-md border px-3 py-2 text-sm',
            'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
          )}
        />
        {error && (
          <p role="alert" className="text-destructive text-xs">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              setTitle(note.title);
              setContent(note.content);
              setEditing(false);
              setError(null);
            }}
          >
            <X aria-hidden />
            Verwerfen
          </Button>
          <Button size="sm" loading={pending} onClick={save}>
            <Check aria-hidden />
            Speichern
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className={cn('bg-surface rounded-lg border p-3', pending && 'opacity-60')}>
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-sm font-medium">{note.title}</p>
        {note.kind === 'generated' && (
          <span
            className="text-muted-foreground bg-muted shrink-0 rounded-full px-1.5 py-0.5 text-[0.65rem]"
            title="Aus einer Antwort im Chat übernommen"
          >
            übernommen
          </span>
        )}
      </div>

      {note.content.trim().length > 0 && (
        <div className="text-muted-foreground mt-1.5">
          <Markdown>{note.content}</Markdown>
        </div>
      )}

      {citations.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <span className="text-muted-foreground text-xs">Belege:</span>
          {citations.map((citation) => (
            <CitationChip
              key={citation.label}
              citation={citation}
              onOpen={onOpenCitation}
            />
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="text-destructive mt-2 text-xs">
          {error}
        </p>
      )}

      {canEdit && (
        <div className="mt-2 flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              setEditing(true);
            }}
          >
            <Pencil aria-hidden />
            Bearbeiten
          </Button>
          {/* Zweistufig, wie beim Löschen einer Quelle. */}
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            className={cn(confirmDelete && 'text-destructive')}
            onBlur={() => {
              setConfirmDelete(false);
            }}
            onClick={() => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              setError(null);
              startTransition(async () => {
                const result = await deleteNote(note.id, notebookId);
                if (result.error) setError(result.error);
              });
            }}
          >
            <Trash2 aria-hidden />
            <span className="sr-only">{note.title} </span>
            {confirmDelete ? 'Wirklich löschen?' : 'Löschen'}
          </Button>
        </div>
      )}
    </li>
  );
}
