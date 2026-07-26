'use client';

import { Plus } from 'lucide-react';
import { useActionState, useState } from 'react';

import { createNotebook, type NotebookActionResult } from '@/app/(app)/notebooks/actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const EMPTY: NotebookActionResult = {};

/** Eine kleine Auswahl statt eines Emoji-Pickers — das genügt hier völlig. */
const EMOJI_CHOICES = ['📓', '📚', '🔬', '⚖️', '💼', '🧭', '🗂️', '🩺'] as const;

export function CreateNotebookDialog({
  triggerVariant = 'primary',
}: {
  readonly triggerVariant?: 'primary' | 'secondary';
}) {
  const [open, setOpen] = useState(false);
  const [emoji, setEmoji] = useState<string>('📓');
  const [state, submit, pending] = useActionState(createNotebook, EMPTY);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant}>
          <Plus aria-hidden />
          Neues Notebook
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Neues Notebook</DialogTitle>
          <DialogDescription>
            Der Titel lässt sich später jederzeit ändern.
          </DialogDescription>
        </DialogHeader>

        <form action={submit} className="flex flex-col gap-4" noValidate>
          <input type="hidden" name="emoji" value={emoji} />

          <Field label="Titel" error={state.fieldErrors?.title}>
            {(props) => (
              <Input
                {...props}
                name="title"
                autoFocus
                required
                maxLength={200}
                placeholder="z. B. Doktorarbeit Kapitel 3"
              />
            )}
          </Field>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm leading-none font-medium">Symbol</legend>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {EMOJI_CHOICES.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  onClick={() => setEmoji(choice)}
                  aria-pressed={emoji === choice}
                  className={cn(
                    'flex size-9 items-center justify-center rounded-md border text-lg',
                    'focus-visible:ring-ring transition-colors focus-visible:ring-2',
                    'focus-visible:ring-offset-background focus-visible:ring-offset-2 focus-visible:outline-none',
                    emoji === choice
                      ? 'border-primary bg-primary-subtle'
                      : 'hover:bg-muted',
                  )}
                >
                  <span aria-hidden>{choice}</span>
                  <span className="sr-only">Symbol {choice}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <Field
            label="Sprache der Quellen"
            error={state.fieldErrors?.language}
            hint="Bestimmt die Sprache der Antworten und der Sprachausgabe."
          >
            {(props) => (
              <select
                {...props}
                name="language"
                defaultValue="de"
                className={cn(
                  'bg-surface border-input h-9 w-full rounded-md border px-3 text-sm',
                  'shadow-subtle focus-visible:ring-ring focus-visible:border-ring',
                  'focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none',
                  'focus-visible:ring-offset-background',
                )}
              >
                <option value="de">Deutsch</option>
                <option value="en">Englisch</option>
              </select>
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
              Anlegen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
