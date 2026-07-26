import { z } from 'zod';

/**
 * Die Werte hier spiegeln 1:1 die CHECK-Constraints der Migrationen.
 * Wird hier etwas ergänzt, muss dieselbe Änderung als Migration nachgezogen
 * werden — die Tests in `tests/security` prüfen beide Seiten gegeneinander.
 */

export const LANGUAGES = ['de', 'en'] as const;
export const languageSchema = z.enum(LANGUAGES);
export type Language = z.infer<typeof languageSchema>;

export const NOTEBOOK_ROLES = ['owner', 'editor', 'viewer'] as const;
export const notebookRoleSchema = z.enum(NOTEBOOK_ROLES);
export type NotebookRole = z.infer<typeof notebookRoleSchema>;

/** Rangfolge für Berechtigungsvergleiche — höher schließt niedriger ein. */
export const ROLE_RANK: Record<NotebookRole, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
};

export function hasAtLeastRole(actual: NotebookRole, required: NotebookRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export const SOURCE_KINDS = ['pdf', 'docx', 'txt', 'md', 'url', 'paste'] as const;
export const sourceKindSchema = z.enum(SOURCE_KINDS);
export type SourceKind = z.infer<typeof sourceKindSchema>;

export const SOURCE_STATUSES = [
  'pending',
  'extracting',
  'embedding',
  'ready',
  'failed',
] as const;
export const sourceStatusSchema = z.enum(SOURCE_STATUSES);
export type SourceStatus = z.infer<typeof sourceStatusSchema>;

export const ARTIFACT_KINDS = [
  'summary',
  'study_guide',
  'faq',
  'timeline',
  'briefing',
  'mindmap',
  'audio',
] as const;
export const artifactKindSchema = z.enum(ARTIFACT_KINDS);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;

export const ARTIFACT_STATUSES = ['pending', 'running', 'ready', 'failed'] as const;
export const artifactStatusSchema = z.enum(ARTIFACT_STATUSES);
export type ArtifactStatus = z.infer<typeof artifactStatusSchema>;

export const JOB_KINDS = ['ingest_source', 'generate_artifact', 'render_audio'] as const;
export const jobKindSchema = z.enum(JOB_KINDS);
export type JobKind = z.infer<typeof jobKindSchema>;

export const JOB_STATUSES = ['queued', 'running', 'done', 'failed'] as const;
export const jobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const NOTE_KINDS = ['user', 'generated'] as const;
export const noteKindSchema = z.enum(NOTE_KINDS);
export type NoteKind = z.infer<typeof noteKindSchema>;

export const MESSAGE_ROLES = ['user', 'assistant'] as const;
export const messageRoleSchema = z.enum(MESSAGE_ROLES);
export type MessageRole = z.infer<typeof messageRoleSchema>;

/** Sichtbarer Status-Text pro Quellen-Zustand, für die UI. */
export const SOURCE_STATUS_LABELS: Record<SourceStatus, string> = {
  pending: 'In Warteschlange',
  extracting: 'Wird gelesen',
  embedding: 'Wird indexiert',
  ready: 'Bereit',
  failed: 'Fehlgeschlagen',
};
