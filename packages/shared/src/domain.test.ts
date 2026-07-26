import { describe, expect, it } from 'vitest';

import {
  ARTIFACT_KINDS,
  hasAtLeastRole,
  NOTEBOOK_ROLES,
  notebookRoleSchema,
  ROLE_RANK,
  SOURCE_STATUS_LABELS,
  SOURCE_STATUSES,
  sourceKindSchema,
  sourceStatusSchema,
} from './domain.js';

describe('Rollenhierarchie', () => {
  it('erlaubt jeder Rolle ihre eigene Stufe', () => {
    for (const role of NOTEBOOK_ROLES) {
      expect(hasAtLeastRole(role, role)).toBe(true);
    }
  });

  it('lässt owner alles und viewer nur lesen', () => {
    expect(hasAtLeastRole('owner', 'editor')).toBe(true);
    expect(hasAtLeastRole('owner', 'viewer')).toBe(true);
    expect(hasAtLeastRole('editor', 'viewer')).toBe(true);

    expect(hasAtLeastRole('viewer', 'editor')).toBe(false);
    expect(hasAtLeastRole('viewer', 'owner')).toBe(false);
    expect(hasAtLeastRole('editor', 'owner')).toBe(false);
  });

  it('vergibt jeder Rolle einen eindeutigen Rang', () => {
    const ranks = Object.values(ROLE_RANK);
    expect(new Set(ranks).size).toBe(ranks.length);
    expect(Object.keys(ROLE_RANK).sort()).toEqual([...NOTEBOOK_ROLES].sort());
  });
});

describe('Schemas und Konstanten bleiben synchron', () => {
  it('akzeptiert jede deklarierte Rolle', () => {
    for (const role of NOTEBOOK_ROLES) {
      expect(notebookRoleSchema.parse(role)).toBe(role);
    }
    expect(notebookRoleSchema.safeParse('admin').success).toBe(false);
  });

  it('akzeptiert jeden deklarierten Quellen-Status', () => {
    for (const status of SOURCE_STATUSES) {
      expect(sourceStatusSchema.parse(status)).toBe(status);
    }
    expect(sourceStatusSchema.safeParse('done').success).toBe(false);
  });

  it('weist unbekannte Quellen-Typen ab', () => {
    expect(sourceKindSchema.safeParse('pdf').success).toBe(true);
    // SVG ist bewusst nicht erlaubt — XSS-Vektor, siehe docs/security.md.
    expect(sourceKindSchema.safeParse('svg').success).toBe(false);
    expect(sourceKindSchema.safeParse('html').success).toBe(false);
  });

  it('hat für jeden Quellen-Status ein UI-Label', () => {
    for (const status of SOURCE_STATUSES) {
      expect(SOURCE_STATUS_LABELS[status]).toBeTruthy();
    }
    expect(Object.keys(SOURCE_STATUS_LABELS).sort()).toEqual([...SOURCE_STATUSES].sort());
  });

  it('führt audio als Artefakt-Typ, damit der Player denselben Job-Pfad nutzt', () => {
    expect(ARTIFACT_KINDS).toContain('audio');
  });
});
