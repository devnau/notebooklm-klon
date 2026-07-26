'use client';

import { Link2, Plus, Type } from 'lucide-react';
import { useActionState, useEffect, useState } from 'react';

import {
  addPasteSource,
  addUrlSource,
  type SourceActionResult,
} from '@/app/(app)/notebooks/[id]/sources/actions';
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
import { UploadZone } from '@/components/sources/upload-zone';
import { cn } from '@/lib/utils';

/**
 * Quellen hinzufügen: Datei, Adresse oder eingefügter Text.
 *
 * Drei Wege in einem Dialog statt drei Schaltflächen im Panel — die Spalte ist
 * schmal, und der Nutzer entscheidet sich ohnehin erst *nachdem* er „Quelle
 * hinzufügen" gedrückt hat, in welcher Form seine Quelle vorliegt.
 */

type Tab = 'datei' | 'adresse' | 'text';

const TABS: readonly { id: Tab; label: string; icon: typeof Plus }[] = [
  { id: 'datei', label: 'Datei', icon: Plus },
  { id: 'adresse', label: 'Adresse', icon: Link2 },
  { id: 'text', label: 'Text', icon: Type },
];

const EMPTY: SourceActionResult = {};

export function AddSourceDialog({ notebookId }: { readonly notebookId: string }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('datei');

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="w-full">
          <Plus aria-hidden />
          Quelle hinzufügen
        </Button>
      </DialogTrigger>

      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Quelle hinzufügen</DialogTitle>
          <DialogDescription>
            Was hinzugefügt wird, wird gelesen, in Abschnitte zerlegt und durchsuchbar
            gemacht. Danach kann der Chat sich darauf berufen.
          </DialogDescription>
        </DialogHeader>

        {/*
          Eigene Tab-Leiste statt einer Komponente aus der Bibliothek: drei
          Schaltflächen mit `role="tab"` sind weniger Code als der Umgang mit
          einer weiteren Abstraktion — und die Tastaturbedienung, die es dafür
          braucht, sind hier die Pfeiltasten, die ohnehin über die
          Schaltflächenreihe laufen.
        */}
        <div
          role="tablist"
          aria-label="Art der Quelle"
          className="bg-muted flex rounded-lg p-1"
        >
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`panel-${id}`}
              onClick={() => {
                setTab(id);
              }}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5',
                'text-sm font-medium transition-colors',
                'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                tab === id
                  ? 'bg-surface-raised text-foreground shadow-subtle'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          ))}
        </div>

        <div className="mt-5">
          {tab === 'datei' && (
            <div role="tabpanel" id="panel-datei" aria-labelledby="tab-datei">
              <UploadZone
                notebookId={notebookId}
                onAdded={() => {
                  setOpen(false);
                }}
              />
            </div>
          )}

          {tab === 'adresse' && (
            <UrlForm
              notebookId={notebookId}
              onDone={() => {
                setOpen(false);
              }}
            />
          )}

          {tab === 'text' && (
            <PasteForm
              notebookId={notebookId}
              onDone={() => {
                setOpen(false);
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function UrlForm({
  notebookId,
  onDone,
}: {
  readonly notebookId: string;
  readonly onDone: () => void;
}) {
  const [state, action, pending] = useActionState(addUrlSource, EMPTY);

  useEffect(() => {
    if (state.saved) onDone();
  }, [state.saved, onDone]);

  return (
    <form action={action} role="tabpanel" id="panel-adresse" aria-labelledby="tab-adresse">
      <input type="hidden" name="notebookId" value={notebookId} />
      <Field
        label="Adresse der Seite"
        error={state.error}
        hint="Die Seite wird abgerufen und ihr Haupttext übernommen. Adressen im lokalen Netz werden abgelehnt."
      >
        {(field) => (
          <Input
            {...field}
            name="url"
            type="url"
            inputMode="url"
            placeholder="https://beispiel.de/artikel"
            required
            autoFocus
          />
        )}
      </Field>
      <DialogFooter>
        <Button type="submit" loading={pending}>
          Hinzufügen
        </Button>
      </DialogFooter>
    </form>
  );
}

function PasteForm({
  notebookId,
  onDone,
}: {
  readonly notebookId: string;
  readonly onDone: () => void;
}) {
  const [state, action, pending] = useActionState(addPasteSource, EMPTY);

  useEffect(() => {
    if (state.saved) onDone();
  }, [state.saved, onDone]);

  return (
    <form action={action} role="tabpanel" id="panel-text" aria-labelledby="tab-text">
      <input type="hidden" name="notebookId" value={notebookId} />
      <Field label="Titel">
        {(field) => (
          <Input
            {...field}
            name="title"
            placeholder="Notiz aus der Sitzung"
            required
            autoFocus
          />
        )}
      </Field>
      <Field label="Text" error={state.error} className="mt-4">
        {(field) => (
          <textarea
            {...field}
            name="text"
            rows={8}
            required
            className={cn(
              'bg-surface w-full rounded-md border px-3 py-2 text-sm',
              'placeholder:text-muted-foreground resize-y',
              'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
            )}
            placeholder="Text hier einfügen …"
          />
        )}
      </Field>
      <DialogFooter>
        <Button type="submit" loading={pending}>
          Hinzufügen
        </Button>
      </DialogFooter>
    </form>
  );
}
