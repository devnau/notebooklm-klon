# Mitarbeiten

Lokales Setup, Befehle und Konventionen stehen in
[docs/development.md](docs/development.md). Hier nur, was einen Beitrag
akzeptabel macht.

## Commits

Conventional Commits, Betreff kleingeschrieben. Erlaubte Typen: `feat`, `fix`,
`docs`, `test`, `refactor`, `perf`, `chore`, `ci`, `build`, `style`, `revert`.
Erlaubte Scopes stehen in `commitlint.config.mjs` — kommt ein neuer Bereich dazu,
gehört er zuerst dort hinein.

```
feat(rag): hybrid retrieval with reciprocal rank fusion
fix(ingest): keep trailing newline in extracted markdown
test(security): cover cross-notebook chunk access
```

Der Betreff beschreibt das Ergebnis, nicht die Tätigkeit. Der Rumpf erklärt,
**warum** — besonders wenn die Lösung auf den ersten Blick überraschend ist.

Ein Commit ist ein lauffähiger Schritt. Kein Commit, der eine ganze Phase
enthält.

`husky` prüft vor jedem Commit: gitleaks, Prettier, ESLint auf den gestageten
Dateien. Fehlt gitleaks lokal, warnt der Hook und lässt durch — die CI prüft
verbindlich.

## Vor dem Pull Request

```bash
npm run lint && npm run typecheck && npm test
docker compose up -d --wait && node scripts/smoke-test.mjs
```

## Checkliste

- [ ] `npm run lint`, `npm run typecheck`, `npm test` laufen durch
- [ ] Neue Logik ist getestet — bei Berechtigungslogik in `tests/security/`
- [ ] Neue Tabellen haben RLS **und** `FORCE`, Policies delegieren an
      `is_notebook_member`, `anon` bekommt keine Grants
      (Checkliste in [docs/development.md](docs/development.md))
- [ ] Keine Secrets, keine echten Schlüssel, kein `.env` im Diff
- [ ] `service_role`-Key wird nirgends clientseitig verwendet
- [ ] Neue interaktive Elemente sind tastaturbedienbar und haben einen sichtbaren
      Fokus-Ring
- [ ] Farben und Abstände kommen aus den Tokens, keine Hex-Werte im Markup
- [ ] Dokumentation mitgeführt, wenn sich Verhalten oder Schema ändert
- [ ] Neue Statuswerte oder Enums auch in `packages/shared/src/domain.ts`

## Was in einem Review auffällt

Diese Punkte führen zuverlässig zu Rückfragen — besser vorher klären:

- Berechtigungsprüfung nur im Route Handler statt in einer Policy. Der Client
  spricht über PostgREST direkt mit der Datenbank und geht daran vorbei.
- `security definer`-Funktion ohne `set search_path = ''`.
- Eine bereits angewandte Migration verändert statt einer neuen angelegt.
- Eigene Typdefinition für etwas, das `@nlm/shared` oder das Supabase-SDK schon
  hat.
- Wechselnde Werte im gecachten Prompt-Prefix (Zeitstempel, IDs, unsortierte
  Auszüge) — das macht Prompt Caching still unwirksam.

## Sicherheitslücken

Nicht als öffentliches Issue. An <dev@dennis-nau.de>.
