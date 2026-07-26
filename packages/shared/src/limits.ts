/**
 * Harte Grenzen der Anwendung. Zentral, weil sie an mehreren Stellen
 * durchgesetzt werden müssen (UI-Hinweis, API-Validierung, Worker) und
 * auseinanderlaufende Kopien der wahrscheinlichste Fehler wären.
 */

/** Upload-Grenzen. Bewusst konservativ — ein 200-MB-PDF blockiert den Worker minutenlang. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_PDF_PAGES = 1_000;
export const MAX_SOURCES_PER_NOTEBOOK = 100;
export const MAX_EXTRACTED_CHARS = 4_000_000;

/** Chunking. ~800 Tokens sind für deutsche Fachtexte ein guter Kompromiss. */
export const CHUNK_TARGET_TOKENS = 800;
export const CHUNK_OVERLAP_TOKENS = 120;
export const CHUNK_MIN_CHARS = 80;

/** Embeddings. 1024 Dimensionen halten den HNSW-Index kompakt. */
export const EMBEDDING_DIMENSIONS = 1024;
export const EMBEDDING_BATCH_SIZE = 128;

/** Retrieval. */
export const RETRIEVAL_CANDIDATES = 60;
export const RETRIEVAL_TOP_K = 20;
export const RRF_K = 60;

/** Worker. */
export const JOB_MAX_ATTEMPTS = 3;
export const JOB_LEASE_SECONDS = 900;
export const JOB_POLL_INTERVAL_MS = 2_000;

/** Rate-Limits pro Nutzer und Stunde — kostenrelevante Endpunkte. */
export const RATE_LIMIT_CHAT_PER_HOUR = 120;
export const RATE_LIMIT_UPLOAD_PER_HOUR = 60;
export const RATE_LIMIT_ARTIFACT_PER_HOUR = 30;
export const RATE_LIMIT_AUDIO_PER_HOUR = 5;

/** Storage-Buckets. */
export const BUCKET_SOURCES = 'sources';
export const BUCKET_AUDIO = 'audio';

/** Erlaubte Upload-MIME-Typen. Die Prüfung erfolgt zusätzlich über Magic Bytes. */
export const ALLOWED_UPLOAD_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
] as const;
