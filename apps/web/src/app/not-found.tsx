import Link from 'next/link';

import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 text-center"
    >
      <p className="text-muted-foreground font-mono text-sm">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Nicht gefunden</h1>
      <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
        Diese Seite existiert nicht — oder du hast keinen Zugriff darauf. Beides sieht von
        hier aus gleich aus, und das ist Absicht.
      </p>
      <Button asChild className="mx-auto mt-8">
        <Link href="/notebooks">Zu den Notebooks</Link>
      </Button>
    </main>
  );
}
