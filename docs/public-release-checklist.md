# Checkliste für die öffentliche Veröffentlichung

Diese Checkliste gehört unmittelbar vor und nach dem Wechsel der Repository-
Sichtbarkeit von privat auf öffentlich abgearbeitet.

## Vor der Veröffentlichung

- [ ] CI auf dem aktuellen Stand von `main` vollständig erfolgreich
- [ ] Secret-Scan über die vollständige Git-Historie erfolgreich
- [ ] Keine echten `.env`-Dateien, Backups, Logs, Datenbank-Dumps oder Uploads im
      Repository
- [ ] Keine API-Schlüssel, Tokens, Passwörter oder privaten URLs in Code,
      Dokumentation oder Tests
- [ ] GitHub-Actions-Logs stichprobenartig auf sensible Ausgaben geprüft
- [ ] Testdateien und Screenshots auf personenbezogene oder vertrauliche Daten
      geprüft
- [ ] Commit-Autoren und veröffentlichte E-Mail-Adressen geprüft
- [ ] Rechte an Code, Texten, Grafiken, Testdateien und sonstigen Assets geklärt
- [ ] `LICENSE`, `README.md` und `SECURITY.md` geprüft
- [ ] Bewusst bestätigt, dass bestehende Klone und Forks später nicht zuverlässig
      zurückgerufen werden können

## Empfohlener lokaler Secret-Scan

```bash
docker run --rm -v "$PWD:/repo" -w /repo \
  zricethezav/gitleaks:v8.30.1 \
  detect --source . --config .gitleaks.toml \
  --redact --no-banner --verbose --exit-code 1
```

Ein Fund muss vor der Veröffentlichung geprüft werden. War ein echter Schlüssel
jemals committed, muss er unabhängig von einer späteren Löschung widerrufen oder
rotiert werden.

## Direkt nach der Veröffentlichung

- [ ] Repository in einem ausgeloggten Browserfenster öffnen
- [ ] README, Lizenz und Sicherheitsrichtlinie kontrollieren
- [ ] Sichtbarkeit alter Actions-Läufe und Artefakte kontrollieren
- [ ] Branch-Ruleset für `main` weiterhin auf `Active` prüfen
- [ ] Direkte Pushes, Force-Pushes und Löschen von `main` blockieren
- [ ] Pull Requests und erforderliche CI-Prüfungen für `main` verlangen
- [ ] Repository-Beschreibung und Topics ergänzen
- [ ] GitHub Secret Scanning und Dependabot Alerts prüfen beziehungsweise
      aktivieren

## Empfohlene Topics

```text
notebooklm
rag
nextjs
typescript
supabase
pgvector
anthropic
document-chat
self-hosted
docker
```

## Hinweis

Diese Checkliste reduziert typische Veröffentlichungsrisiken, ersetzt aber keine
vollständige Sicherheits- oder Lizenzprüfung.
