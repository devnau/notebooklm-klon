'use client';

import { useEffect } from 'react';

/**
 * Der letzte Auffangnetz — für Fehler im Wurzel-Layout selbst.
 *
 * `error.tsx` fängt alles, was *innerhalb* des Layouts passiert. Bricht das
 * Layout selbst ab, ist es nicht gerendert und kann nichts anzeigen; dann steht
 * ohne diese Datei eine weisse Seite ohne jeden Hinweis. Deshalb bringt sie
 * `<html>` und `<body>` selbst mit — es gibt zu diesem Zeitpunkt keine.
 *
 * Aus demselben Grund keine gemeinsamen Komponenten und keine
 * Tailwind-Klassen aus dem Token-Set: hätte das Stylesheet nicht geladen,
 * wären sie wirkungslos. Die Stile stehen deshalb inline und die Farben
 * ausgeschrieben — die einzige Stelle im Projekt, an der das richtig ist.
 */
export default function GlobalError({
  error,
}: {
  readonly error: Error & { digest?: string };
}) {
  useEffect(() => {
    console.error('Fehler im Wurzel-Layout:', error);
  }, [error]);

  return (
    <html lang="de">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.5rem',
          backgroundColor: '#faf9f6',
          color: '#1e1d1a',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <main style={{ maxWidth: '28rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>
            Die Anwendung konnte nicht geladen werden
          </h1>
          <p style={{ marginTop: '0.75rem', fontSize: '0.875rem', lineHeight: 1.6 }}>
            Ein erneutes Laden hilft meistens. Bleibt es dabei, liegt es am Server.
          </p>
          {/*
            Ein <a> und kein Button mit reset(): wenn das Wurzel-Layout
            abgebrochen ist, ist auch nicht verlässlich, dass React noch
            reagiert. Ein Link funktioniert ohne JavaScript.
          */}
          <p style={{ marginTop: '1.5rem' }}>
            <a
              href="/"
              style={{
                display: 'inline-block',
                padding: '0.5rem 1rem',
                borderRadius: '0.375rem',
                backgroundColor: '#0f6e7a',
                color: '#faf9f6',
                textDecoration: 'none',
                fontSize: '0.875rem',
                fontWeight: 500,
              }}
            >
              Neu laden
            </a>
          </p>
          {error.digest && (
            <p style={{ marginTop: '1.5rem', fontSize: '0.75rem', opacity: 0.6 }}>
              Kennung für das Protokoll: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
