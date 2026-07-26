import { FileText, MessageSquareQuote, Sparkles } from 'lucide-react';

/**
 * Platzhalter-Startseite für Phase 0. Sie belegt, dass Design-Tokens, Fonts und
 * Dark Mode greifen; die echte App-Shell entsteht in Phase 1.
 */
export default function HomePage() {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center px-6 py-16"
    >
      <p className="text-muted-foreground font-mono text-xs tracking-widest uppercase">
        Phase 0 · Fundament
      </p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
        Notebook Studio
      </h1>
      <p className="text-muted-foreground mt-4 max-w-xl text-lg leading-relaxed">
        Eigene Quellen hochladen und mit belegten Antworten durcharbeiten. Jede Aussage
        führt per Klick zur Textstelle, aus der sie stammt.
      </p>

      <ul className="mt-10 grid gap-3 sm:grid-cols-3">
        {[
          { icon: FileText, label: 'Quellen', hint: 'PDF, DOCX, URL, Text' },
          {
            icon: MessageSquareQuote,
            label: 'Belegter Chat',
            hint: 'Antworten mit Zitaten',
          },
          { icon: Sparkles, label: 'Studio', hint: 'Zusammenfassung bis Audio' },
        ].map(({ icon: Icon, label, hint }) => (
          <li
            key={label}
            className="bg-surface shadow-card rounded-lg border p-4 transition-colors"
          >
            <Icon className="text-primary size-5" aria-hidden />
            <p className="mt-3 font-medium">{label}</p>
            <p className="text-muted-foreground mt-0.5 text-sm">{hint}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
