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
          Als <picture> statt über next/image: das Bild füllt eine dekorative
          Fläche, deren Grösse vom Layout kommt und nicht von der Bildgrösse.
          next/image bringt hier nur Zusatzarbeit — es gibt nichts zu
          skalieren, was nicht schon der Browser besser macht, und die beiden
          Formate liegen fertig vor.

          Im dunklen Modus wird das Bild abgeblendet: die Vorlage ist auf
          Papierweiss gezeichnet und leuchtete sonst als heller Block neben
          einem dunklen Formular.
        */}
        <picture>
          <source srcSet="/backgrounds/auth.avif" type="image/avif" />
          <img
            src="/backgrounds/auth.webp"
            alt=""
            className="absolute inset-0 size-full object-cover dark:opacity-15 dark:invert"
          />
        </picture>
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
