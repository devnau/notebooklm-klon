'use client';

import { useActionState, useEffect, useState, type ReactNode } from 'react';

import { renameNotebook, type NotebookActionResult } from '@/app/(app)/notebooks/actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

const EMPTY: NotebookActionResult = {};

export function RenameNotebookDialog({
  notebook,
  trigger,
}: {
  readonly notebook: {
    readonly id: string;
    readonly title: string;
    readonly emoji: string;
  };
  readonly trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [state, submit, pending] = useActionState(renameNotebook, EMPTY);

  // Schließen, sobald die Aktion Erfolg gemeldet hat. Der Dispatch von
  // useActionState gibt kein Promise zurück, das man abwarten könnte — der
  // Zustand ist der einzige verlässliche Weg, den Abschluss zu erkennen.
  useEffect(() => {
    if (state.saved) setOpen(false);
  }, [state.saved]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Notebook umbenennen</DialogTitle>
        </DialogHeader>

        <form action={submit} className="flex flex-col gap-4" noValidate>
          <input type="hidden" name="id" value={notebook.id} />
          <input type="hidden" name="emoji" value={notebook.emoji} />

          <Field label="Titel" error={state.fieldErrors?.title}>
            {(props) => (
              <Input
                {...props}
                name="title"
                defaultValue={notebook.title}
                autoFocus
                required
                maxLength={200}
              />
            )}
          </Field>

          {state.error && (
            <p
              role="alert"
              className="bg-destructive-subtle text-destructive rounded-md p-3 text-sm"
            >
              {state.error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Abbrechen
            </Button>
            <Button type="submit" loading={pending}>
              Speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
