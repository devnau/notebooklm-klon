'use client';

import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

import { SANITIZE_SCHEMA } from '@/lib/markdown-schema';
import { cn } from '@/lib/utils';

/**
 * Markdown-Ausgabe, sanitisiert.
 *
 * Hier laufen zwei Arten fremden Textes zusammen: was Nutzer in Notizen
 * schreiben und was das Modell ausgibt. Beides kann Markup enthalten, und
 * beides wird anderen Mitgliedern eines geteilten Notizbuchs angezeigt — ein
 * eingeschleustes `<script>` oder ein `javascript:`-Link träfe also nicht den
 * Verfasser, sondern seine Kollegen.
 *
 * Deshalb: **sanitisiert wird beim Anzeigen, nicht beim Speichern.** Was jemand
 * geschrieben hat, bleibt erhalten — auch wenn es zufällig wie Markup aussieht.
 * Die Entscheidung, was gerendert wird, gehört an die Stelle, an der gerendert
 * wird. Umgekehrt wäre der Text unwiederbringlich beschnitten, und jede neue
 * Anzeigestelle müsste darauf vertrauen, dass beim Speichern richtig geputzt
 * wurde.
 *
 * Das Schema selbst liegt in `lib/markdown-schema.ts` — als reines Modul ohne
 * React, damit es sich ohne Browserumgebung testen lässt. Bei einer
 * Sicherheitsgrenze reicht ein Kommentar nicht; sie muss geprüft sein.
 */

export function Markdown({
  children,
  className,
}: {
  readonly children: string;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        'text-sm leading-relaxed',
        // Typografie über Nachfahren-Selektoren statt über eine
        // Prose-Bibliothek: es sind acht Regeln, und ein weiteres Plugin nur
        // dafür wäre unverhältnismässig.
        '[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold',
        '[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold',
        '[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-sm [&_h3]:font-medium',
        '[&_p]:my-2',
        '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5',
        '[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5',
        '[&_li]:my-0.5',
        '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2',
        '[&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs',
        '[&_pre]:bg-muted [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:p-3',
        '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
        '[&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:italic',
        '[&_table]:my-2 [&_table]:w-full [&_table]:text-xs',
        '[&_th]:border-b [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium',
        '[&_td]:border-b [&_td]:px-2 [&_td]:py-1',
        '[&_hr]:my-4',
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, SANITIZE_SCHEMA]]}
        components={{
          a: ({ children: linkChildren, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer nofollow">
              {linkChildren}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
