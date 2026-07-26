'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { KeyRound, LogOut, User } from 'lucide-react';
import Link from 'next/link';
import { useTransition } from 'react';

import { signOut } from '@/app/(auth)/actions';
import { cn } from '@/lib/utils';

const itemClasses = cn(
  'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm',
  'outline-none select-none',
  'data-[highlighted]:bg-muted data-[highlighted]:text-foreground',
);

export function UserMenu({
  displayName,
  email,
}: {
  readonly displayName: string | null;
  readonly email: string | null;
}) {
  const [pending, startTransition] = useTransition();

  const label = displayName ?? email ?? 'Konto';
  const initial = (displayName ?? email ?? '?').charAt(0).toUpperCase();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className={cn(
          'bg-primary-subtle text-primary flex size-9 items-center justify-center',
          'rounded-full text-sm font-medium',
          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2',
          'focus-visible:ring-offset-background focus-visible:outline-none',
        )}
        aria-label={`Konto-Menü für ${label}`}
      >
        {initial}
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className={cn(
            'bg-surface-raised shadow-popover z-50 min-w-56 rounded-lg border p-1',
            'animate-slide-up',
          )}
        >
          <div className="px-2 py-2">
            <p className="truncate text-sm font-medium">{displayName ?? 'Konto'}</p>
            {email && <p className="text-muted-foreground truncate text-xs">{email}</p>}
          </div>
          <DropdownMenu.Separator className="bg-border my-1 h-px" />

          <DropdownMenu.Item asChild>
            <Link href="/konto" className={itemClasses}>
              <User className="size-4" aria-hidden />
              Profil
            </Link>
          </DropdownMenu.Item>

          <DropdownMenu.Item asChild>
            <Link href="/passwort-aendern" className={itemClasses}>
              <KeyRound className="size-4" aria-hidden />
              Passwort ändern
            </Link>
          </DropdownMenu.Item>

          <DropdownMenu.Separator className="bg-border my-1 h-px" />

          {/*
            Die Server Action wird direkt aufgerufen, nicht über ein <form>.
            Zwei naheliegende Varianten funktionieren hier nicht: ein <form>
            als Item (via asChild) macht das Formular selbst zum Klickziel, der
            Submit-Button darin wird nie ausgelöst; und ein Button mit
            form="…"-Attribut wird von Radix beim Schließen des Menüs aus dem
            DOM entfernt, bevor der Browser abschickt.

            Kein Verlust an Progressive Enhancement: das Menü braucht
            JavaScript, um sich überhaupt zu öffnen. Und es bleibt ein POST —
            Server Actions sind keine GET-Anfragen und damit nicht über ein
            fremdes <img src="…"> auslösbar.
          */}
          <DropdownMenu.Item
            className={itemClasses}
            disabled={pending}
            onSelect={() => {
              startTransition(async () => {
                await signOut();
              });
            }}
          >
            <LogOut className="size-4" aria-hidden />
            {pending ? 'Wird abgemeldet …' : 'Abmelden'}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
