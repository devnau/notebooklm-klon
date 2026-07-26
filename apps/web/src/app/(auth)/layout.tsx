import type { ReactNode } from 'react';

import { Logo } from '@/components/brand/logo';

/**
 * Zweispaltiges Layout: links das Formular, rechts eine ruhige Fläche mit dem
 * Nutzenversprechen. Auf kleinen Bildschirmen fällt die rechte Spalte weg —
 * dort ist der Platz für das Formular besser investiert.
 */
export default function AuthLayout({ children }: { readonly children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <main id="main" className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <Logo className="mb-10" />
          {children}
        </div>
      </main>

      <aside
        className="bg-surface-sunken relative hidden overflow-hidden border-l lg:block"
        aria-hidden
      >
        {/*
          Dezentes Linienmuster als Platzhalter, bis backgrounds/auth.png
          vorliegt (Prompt 4 in assets/PROMPTS.md). Gleiche Bildwirkung, damit
          der Austausch später kein Layout verschiebt.
        */}
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)',
            backgroundSize: '32px 32px',
          }}
        />
        <div className="relative flex h-full flex-col justify-end p-16">
          <blockquote className="max-w-md">
            <p className="font-serif text-2xl leading-snug text-balance">
              „Jede Antwort führt zurück auf die Stelle, aus der sie stammt."
            </p>
            <p className="text-muted-foreground mt-4 text-sm">
              Belegte Antworten aus den eigenen Quellen — nachprüfbar mit einem Klick, statt
              geraten.
            </p>
          </blockquote>
        </div>
      </aside>
    </div>
  );
}
