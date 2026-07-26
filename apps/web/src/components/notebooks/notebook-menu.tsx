'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { hasAtLeastRole, type NotebookRole } from '@nlm/shared';
import { MoreVertical, Trash2, Users } from 'lucide-react';
import { useState } from 'react';

import { deleteNotebook } from '@/app/(app)/notebooks/actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

const itemClasses = cn(
  'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm',
  'outline-none select-none data-[highlighted]:bg-muted',
  'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
);

export function NotebookMenu({
  notebookId,
  role,
}: {
  readonly notebookId: string;
  readonly role: string;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isOwner = hasAtLeastRole(role as NotebookRole, 'owner');

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button variant="ghost" size="icon" aria-label="Weitere Aktionen">
            <MoreVertical aria-hidden />
          </Button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={8}
            className="bg-surface-raised shadow-popover animate-slide-up z-50 min-w-52 rounded-lg border p-1"
          >
            <DropdownMenu.Item className={itemClasses} disabled>
              <Users className="size-4" aria-hidden />
              Teilen
              <span className="text-muted-foreground ml-auto text-xs">Phase 6</span>
            </DropdownMenu.Item>

            {isOwner && (
              <>
                <DropdownMenu.Separator className="bg-border my-1 h-px" />
                <DropdownMenu.Item
                  className={cn(itemClasses, 'text-destructive')}
                  onSelect={() => setConfirmOpen(true)}
                >
                  <Trash2 className="size-4" aria-hidden />
                  Notebook löschen
                </DropdownMenu.Item>
              </>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {/*
        Löschen wird bestätigt, weil es alles am Notebook mitnimmt: Quellen,
        Chats, Notizen. Das ist nicht rückholbar.
      */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Notebook löschen?</DialogTitle>
            <DialogDescription>
              Alle Quellen, Chats, Notizen und Artefakte dieses Notebooks werden endgültig
              entfernt. Das lässt sich nicht rückgängig machen.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Abbrechen
            </Button>
            <form action={deleteNotebook}>
              <input type="hidden" name="id" value={notebookId} />
              <Button type="submit" variant="destructive">
                <Trash2 aria-hidden />
                Endgültig löschen
              </Button>
            </form>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
