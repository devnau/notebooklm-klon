import Anthropic from '@anthropic-ai/sdk';
import { JOB_LEASE_SECONDS, JOB_POLL_INTERVAL_MS } from '@nlm/shared';
import { createClient } from '@supabase/supabase-js';
import { pino } from 'pino';

import { generateArtifact, type ArtifactPayload } from './handlers/generate-artifact.js';
import { ingestSource, type IngestPayload } from './handlers/ingest-source.js';
import { renderAudio, type RenderAudioPayload } from './handlers/render-audio.js';
import { loadConfig } from './lib/config.js';
import { EmbeddingClient } from './lib/embeddings.js';
import { TtsClient } from './lib/tts.js';

/**
 * Der Job-Worker.
 *
 * Greift Jobs über `claim_job()` auf, das intern `FOR UPDATE SKIP LOCKED`
 * verwendet — mehrere Worker können damit parallel laufen, ohne sich zu
 * blockieren und ohne Broker.
 *
 * Zwei Dinge, die ein Worker können muss und die leicht vergessen werden:
 *
 *  * **Sauber beenden.** Auf SIGTERM wird der laufende Job zu Ende gebracht und
 *    erst dann beendet. Wer mitten im Schreiben abbricht, hinterlässt eine
 *    Quelle mit halbem Index.
 *  * **Liegengebliebenes einsammeln.** Stirbt ein Worker hart, bleibt sein Job
 *    für immer auf `running`. `requeue_stale_jobs()` gibt ihn nach Ablauf der
 *    Lease wieder frei.
 */

const config = loadConfig();

const logger = pino({
  level: config.LOG_LEVEL,
  base: { worker: config.WORKER_ID },
  // Zeitstempel als ISO-String: in Docker-Logs ist ein Unix-Timestamp
  // unlesbar, und genau dort landet die Ausgabe.
  timestamp: pino.stdTimeFunctions.isoTime,
});

// Ohne generische Parameter: der Worker arbeitet mit service_role und
// schreibt in Tabellen, deren generierte Typen im Web-Paket liegen. Die
// Zeilenformen sind in den Handlern lokal beschrieben.
const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const embeddings = new EmbeddingClient({
  apiKey: config.VOYAGE_API_KEY,
  onRetry: ({ attempt, delayMs, reason }) => {
    logger.warn(
      { attempt, delayMs: Math.round(delayMs), reason },
      'Embedding wird wiederholt',
    );
  },
});

/*
 * Erst beim ersten Bedarf erzeugt: der Import von Quellen braucht Anthropic
 * nicht, und ein Worker, der nur importiert, soll ohne diesen Schlüssel laufen.
 */
let anthropicClient: Anthropic | null = null;

function anthropic(): Anthropic {
  if (!config.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY fehlt — ohne ihn lassen sich keine Übersichten erzeugen.',
    );
  }
  anthropicClient ??= new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  return anthropicClient;
}

const tts = new TtsClient({
  piperUrl: config.PIPER_URL,
  kokoroUrl: config.KOKORO_URL,
});

type ClaimedJob = {
  readonly job_id: number;
  readonly kind: string;
  readonly notebook_id: string;
  readonly payload: Record<string, unknown>;
  readonly attempts: number;
};

let shuttingDown = false;
let activeJob: number | null = null;

async function claimJob(): Promise<ClaimedJob | null> {
  // Ergebnis als unknown entgegennehmen: die generierten Typen für RPCs liegen
  // im Web-Paket, der Worker beschreibt die Form hier lokal.
  const result: { data: unknown; error: { message: string } | null } = await supabase.rpc(
    'claim_job',
    { worker_id: config.WORKER_ID },
  );

  if (result.error) {
    logger.error({ err: result.error }, 'Job konnte nicht aufgegriffen werden');
    return null;
  }

  const jobs: ClaimedJob[] = Array.isArray(result.data)
    ? (result.data as ClaimedJob[])
    : [];
  return jobs[0] ?? null;
}

async function finishJob(jobId: number, status: 'done' | 'failed', error?: string) {
  const { error: updateError } = await supabase
    .from('jobs')
    .update({
      status,
      locked_by: null,
      locked_at: null,
      ...(error ? { error } : {}),
    })
    .eq('id', jobId);

  if (updateError) {
    logger.error({ err: updateError, jobId }, 'Job-Status nicht speicherbar');
  }
}

/**
 * Legt einen fehlgeschlagenen Job zurück in die Warteschlange — mit Backoff,
 * damit ein wiederkehrender Fehler nicht sofort erneut läuft und die
 * Warteschlange blockiert.
 */
async function requeueJob(job: ClaimedJob, error: string) {
  const delayMinutes = Math.min(2 ** job.attempts, 30);
  const runAfter = new Date(Date.now() + delayMinutes * 60_000).toISOString();

  const { error: updateError } = await supabase
    .from('jobs')
    .update({
      status: 'queued',
      locked_by: null,
      locked_at: null,
      run_after: runAfter,
      error,
    })
    .eq('id', job.job_id);

  if (updateError) {
    logger.error({ err: updateError, jobId: job.job_id }, 'Job nicht zurücklegbar');
  } else {
    logger.info(
      { jobId: job.job_id, attempts: job.attempts, delayMinutes },
      'Job zurückgelegt',
    );
  }
}

async function runJob(job: ClaimedJob): Promise<void> {
  const log = logger.child({ jobId: job.job_id, kind: job.kind });
  const started = Date.now();

  try {
    switch (job.kind) {
      case 'ingest_source':
        await ingestSource(job.payload as unknown as IngestPayload, {
          supabase,
          embeddings,
          logger: log,
        });
        break;
      case 'generate_artifact':
        await generateArtifact(job.payload as unknown as ArtifactPayload, {
          supabase,
          anthropic: anthropic(),
          logger: log,
        });
        break;
      case 'render_audio':
        await renderAudio(job.payload as unknown as RenderAudioPayload, {
          supabase,
          anthropic: anthropic(),
          tts,
          logger: log,
        });
        break;
      // Ein unbekannter Job wird als fehlgeschlagen markiert statt endlos
      // wiederholt — sonst blockiert er die Warteschlange.
      default:
        await finishJob(job.job_id, 'failed', `Unbekannter Job-Typ: ${job.kind}`);
        log.error('Unbekannter Job-Typ');
        return;
    }

    await finishJob(job.job_id, 'done');
    log.info({ ms: Date.now() - started }, 'Job abgeschlossen');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ err: error, ms: Date.now() - started }, 'Job fehlgeschlagen');

    if (job.attempts >= 3) {
      await finishJob(job.job_id, 'failed', message);
      log.error({ attempts: job.attempts }, 'Job endgültig aufgegeben');
    } else {
      await requeueJob(job, message);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  logger.info(
    { supabaseUrl: config.SUPABASE_URL, pollMs: JOB_POLL_INTERVAL_MS },
    'Worker gestartet',
  );

  // Beim Start einmal aufräumen: Jobs eines Workers, der beim letzten Neustart
  // mitten in der Arbeit war, hängen sonst dauerhaft auf 'running'.
  const requeueResult = await supabase.rpc('requeue_stale_jobs', {
    lease_seconds: JOB_LEASE_SECONDS,
  });
  const requeued: unknown = requeueResult.data;
  if (typeof requeued === 'number' && requeued > 0) {
    logger.warn({ count: requeued }, 'Liegengebliebene Jobs zurückgelegt');
  }

  let idleTicks = 0;

  while (!shuttingDown) {
    const job = await claimJob();

    if (!job) {
      idleTicks += 1;
      // Bei längerer Ruhe seltener nachsehen. Spart Anfragen, ohne die
      // Reaktionszeit bei Betrieb spürbar zu verschlechtern.
      const wait = idleTicks > 30 ? JOB_POLL_INTERVAL_MS * 5 : JOB_POLL_INTERVAL_MS;
      await sleep(wait);

      // Gelegentlich nach hängenden Jobs sehen.
      if (idleTicks % 60 === 0) {
        await supabase.rpc('requeue_stale_jobs', { lease_seconds: JOB_LEASE_SECONDS });
      }
      continue;
    }

    idleTicks = 0;
    activeJob = job.job_id;
    await runJob(job);
    activeJob = null;
  }

  logger.info('Worker beendet');
}

/**
 * Sauberes Beenden: den laufenden Job zu Ende bringen, dann aussteigen.
 * Docker gibt dafür standardmäßig 10 Sekunden — in docker-compose.prod.yml ist
 * `stop_grace_period` entsprechend höher gesetzt.
 */
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (shuttingDown) {
      logger.warn('Zweites Signal, sofortiger Abbruch');
      process.exit(1);
    }
    shuttingDown = true;
    logger.info(
      { activeJob },
      activeJob === null
        ? 'Signal empfangen, Worker wird beendet'
        : 'Signal empfangen, laufender Job wird noch abgeschlossen',
    );
  });
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Worker abgestürzt');
  process.exit(1);
});
