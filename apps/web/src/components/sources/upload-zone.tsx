'use client';

import {
  BUCKET_SOURCES,
  MAX_UPLOAD_BYTES,
  UPLOAD_ACCEPT_ATTRIBUTE,
  checkUpload,
  type SourceKind,
} from '@nlm/shared';
import { UploadCloud } from 'lucide-react';
import { useCallback, useId, useRef, useState } from 'react';

import { registerUploadedSource } from '@/app/(app)/notebooks/[id]/sources/actions';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

/**
 * Drag & Drop plus Dateiauswahl.
 *
 * Die Datei geht direkt vom Browser in den Storage-Bucket, nicht über den
 * Next.js-Server. Das spart einen kompletten Umweg über den Anwendungsserver
 * und macht Fortschrittsanzeige und Abbruch überhaupt erst möglich. Geschützt
 * ist der Weg durch dieselbe Row Level Security wie alles andere: die
 * Storage-Policy erlaubt Schreiben nur unter `{notebook_id}/` und nur
 * Mitgliedern mit Editor-Rolle.
 *
 * Die Prüfung hier im Browser ist **keine** Sicherheitsmaßnahme — sie erspart
 * dem Nutzer nur, 40 MB hochzuladen, bevor er erfährt, dass die Datei nicht
 * taugt. Verbindlich prüft der Worker, an den Bytes, die wirklich im Bucket
 * liegen.
 */

/*
 * Bewusst keine Prozentanzeige: supabase-js meldet beim Upload keinen
 * Fortschritt, eine Zahl wäre also erfunden. Ein Balken, der bei 90 % stehen
 * bleibt, ist schlimmer als gar keiner — er verspricht eine Genauigkeit, die
 * es nicht gibt.
 */
type UploadPhase = 'uploading' | 'registering' | 'failed';

type UploadState = {
  readonly name: string;
  readonly phase: UploadPhase;
  readonly error?: string;
};

const PHASE_LABEL: Record<UploadPhase, string> = {
  uploading: 'Wird übertragen …',
  registering: 'Wird eingetragen …',
  failed: 'Fehlgeschlagen',
};

/** Nur die ersten Bytes lesen — für jede Signatur reichen 8 KB. */
const HEADER_BYTES = 8192;

export function UploadZone({
  notebookId,
  disabled = false,
  onAdded,
}: {
  readonly notebookId: string;
  readonly disabled?: boolean;
  readonly onAdded?: () => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<readonly UploadState[]>([]);

  const upload = useCallback(
    async (file: File) => {
      const header = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
      const verdict = checkUpload({
        data: header,
        declaredName: file.name,
        declaredMime: file.type || undefined,
        totalBytes: file.size,
      });

      if (!verdict.ok) {
        setUploads((current) => [
          ...current,
          { name: file.name, phase: 'failed', error: verdict.detail },
        ]);
        return;
      }

      setUploads((current) => [...current, { name: file.name, phase: 'uploading' }]);

      const update = (patch: Partial<UploadState>) => {
        setUploads((current) =>
          current.map((entry) =>
            entry.name === file.name ? { ...entry, ...patch } : entry,
          ),
        );
      };

      /*
       * Der Dateiname des Nutzers geht **nicht** in den Pfad ein. Er kann
       * Schrägstriche, Steuerzeichen oder Unicode-Tricks enthalten, mit denen
       * sich das erste Pfadsegment — und damit die gesamte Zugriffsprüfung —
       * verschieben ließe. Eine UUID ist eindeutig, unstrittig und verrät
       * nebenbei nicht, wie die Datei auf dem Rechner des Nutzers hieß.
       */
      const storagePath = `${notebookId}/${crypto.randomUUID()}.${extensionFor(verdict.kind)}`;

      const supabase = createClient();
      const { error } = await supabase.storage
        .from(BUCKET_SOURCES)
        .upload(storagePath, file, { contentType: verdict.detectedMime, upsert: false });

      if (error) {
        update({ phase: 'failed', error: 'Der Upload ist fehlgeschlagen.' });
        return;
      }

      update({ phase: 'registering' });

      const result = await registerUploadedSource({
        notebookId,
        storagePath,
        kind: verdict.kind,
        title: file.name,
        byteSize: file.size,
        mimeType: verdict.detectedMime,
      });

      if (result.error) {
        update({ phase: 'failed', error: result.error });
        return;
      }

      // Aus der Liste nehmen: ab jetzt zeigt die Quellenliste selbst den
      // Fortschritt, zwei Anzeigen für dieselbe Sache wären verwirrend.
      setUploads((current) => current.filter((entry) => entry.name !== file.name));
      onAdded?.();
    },
    [notebookId, onAdded],
  );

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      // Nacheinander statt parallel: zehn gleichzeitige 50-MB-Uploads bringen
      // jede Leitung zum Erliegen und die Fortschrittsanzeige zum Flackern.
      void Array.from(files).reduce(
        (chain, file) => chain.then(() => upload(file)),
        Promise.resolve(),
      );
    },
    [upload],
  );

  return (
    <div>
      <div
        className={cn(
          'rounded-lg border border-dashed p-6 text-center transition-colors',
          dragging ? 'border-primary bg-primary/5' : 'border-border',
          disabled && 'pointer-events-none opacity-50',
        )}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => {
          setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          handleFiles(event.dataTransfer.files);
        }}
      >
        <UploadCloud className="text-muted-foreground mx-auto size-7" aria-hidden />
        <p className="mt-3 text-sm">
          {/*
            Der Text ist das Label des Eingabefelds, nicht nur Dekoration:
            damit ist die Zone auch per Tastatur und Screenreader bedienbar.
            Ein reines Drop-Ziel wäre für beide unsichtbar.
          */}
          <label
            htmlFor={inputId}
            className="text-primary cursor-pointer font-medium underline-offset-4 hover:underline"
          >
            Dateien auswählen
          </label>{' '}
          <span className="text-muted-foreground">oder hierher ziehen</span>
        </p>
        <p className="text-muted-foreground mt-1.5 text-xs">
          PDF, Word, Text oder Markdown · bis {Math.round(MAX_UPLOAD_BYTES / 1_000_000)} MB
        </p>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          multiple
          accept={UPLOAD_ACCEPT_ATTRIBUTE}
          className="sr-only"
          disabled={disabled}
          onChange={(event) => {
            handleFiles(event.target.files);
            // Zurücksetzen, damit dieselbe Datei erneut gewählt werden kann —
            // sonst löst das Feld beim zweiten Mal kein change-Ereignis aus.
            event.target.value = '';
          }}
        />
      </div>

      {uploads.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2" aria-live="polite">
          {uploads.map((entry) => (
            <li key={entry.name} className="text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate">{entry.name}</span>
                <span
                  className={cn(
                    'shrink-0 text-xs',
                    entry.phase === 'failed' ? 'text-destructive' : 'text-muted-foreground',
                  )}
                >
                  {PHASE_LABEL[entry.phase]}
                </span>
              </div>
              {entry.error ? (
                <p className="text-destructive mt-1 text-xs">{entry.error}</p>
              ) : (
                // Unbestimmter Fortschritt: der Balken zeigt, dass etwas läuft,
                // ohne zu behaupten, wie weit es ist.
                <div className="bg-muted mt-1.5 h-1 overflow-hidden rounded-full">
                  <div className="bg-primary animate-indeterminate h-full w-1/3 rounded-full" />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function extensionFor(kind: SourceKind): string {
  switch (kind) {
    case 'pdf':
      return 'pdf';
    case 'docx':
      return 'docx';
    case 'md':
      return 'md';
    default:
      return 'txt';
  }
}
