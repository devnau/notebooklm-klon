# Datenmodell

Alle Anwendungstabellen liegen im Schema `public`, haben Row Level Security
aktiviert **und** erzwungen (`FORCE`), und ihre Policies delegieren an
`public.is_notebook_member()`.

Stand: Phase 1. Tabellen späterer Phasen sind unten unter „Geplant" skizziert,
damit die Beziehungen vollständig sichtbar sind.

## Beziehungen

```
auth.users
   │
   ├──1:1── profiles
   │
   ├──1:n── notebooks ──1:n── notebook_members ──n:1── auth.users
   │                     │
   │                     ├──1:n── sources ──1:n── chunks
   │                     ├──1:n── chats ──1:n── messages
   │                     ├──1:n── notes
   │                     ├──1:n── artifacts
   │                     ├──1:n── share_links
   │                     └──1:n── jobs
```

`notebook_id` liegt bewusst auch auf `chunks`, obwohl es über `source_id`
herleitbar wäre. Zwei Gründe: die RLS-Policy kommt ohne Join aus (bei
zehntausenden Chunks messbar), und der Vektorindex kann direkt auf
`notebook_id` filtern.

## Tabellen

### profiles

Spiegel von `auth.users`, weil das `auth`-Schema von der Anwendung aus nicht
lesbar ist. Wird per Trigger `on_auth_user_created` gefüllt.

| Spalte                     | Typ         | Anmerkung                         |
| -------------------------- | ----------- | --------------------------------- |
| `id`                       | uuid, PK    | → `auth.users.id`, cascade delete |
| `display_name`             | text        | Default: lokaler Teil der E-Mail  |
| `email`                    | text        |                                   |
| `created_at`, `updated_at` | timestamptz | `updated_at` per Trigger          |

**RLS:** Eigenes Profil immer lesbar; fremde nur, wenn man mindestens ein
Notebook teilt. Ohne diese Einschränkung wäre die Tabelle ein Verzeichnis aller
registrierten E-Mail-Adressen. Schreiben nur am eigenen Profil.

### notebooks

| Spalte                     | Typ         | Anmerkung                                             |
| -------------------------- | ----------- | ----------------------------------------------------- |
| `id`                       | uuid, PK    |                                                       |
| `owner_id`                 | uuid        | → `auth.users.id`                                     |
| `title`                    | text        | 1–200 Zeichen nach `btrim`                            |
| `emoji`                    | text        | max. 8 Zeichen, Default `📓`                          |
| `language`                 | text        | `de` oder `en`; steuert Prompt-Sprache und TTS-Stimme |
| `created_at`, `updated_at` | timestamptz |                                                       |

**RLS:**

| Aktion | Bedingung                                          |
| ------ | -------------------------------------------------- |
| SELECT | `owner_id = auth.uid()` **oder** Mitglied (viewer) |
| INSERT | `owner_id = auth.uid()`                            |
| UPDATE | Mitglied mit Rolle editor oder owner               |
| DELETE | Mitglied mit Rolle owner                           |

Der `owner_id`-Zweig bei SELECT ist nicht redundant. Bei
`insert ... returning` — was PostgREST und `supabase-js` immer verwenden — prüft
Postgres die SELECT-Policy auf der neuen Zeile, **bevor** der AFTER-Trigger die
Mitgliedschaft anlegt. Ohne diesen Zweig könnte kein Client ein Notebook
erzeugen: der Insert gelingt, das `returning` scheitert, PostgREST meldet
`42501`. Eine Rechteerweiterung ist es nicht, weil der Owner per Trigger
ohnehin immer Mitglied ist.

### notebook_members

| Spalte                   | Typ         | Anmerkung                               |
| ------------------------ | ----------- | --------------------------------------- |
| `notebook_id`, `user_id` | uuid        | zusammen PK                             |
| `role`                   | text        | `owner`, `editor` oder `viewer`         |
| `invited_by`             | uuid        | → `auth.users.id`, `on delete set null` |
| `created_at`             | timestamptz |                                         |

**RLS:** Mitglieder sehen einander (für die Mitgliederliste). Einladen,
Rollen ändern und andere entfernen darf nur der Owner; austreten darf jeder
selbst.

**Zwei Trigger sichern Invarianten:**

- `notebooks_add_owner_member` trägt den Ersteller nach dem Insert als `owner`
  ein. Ohne ihn hätte niemand Zugriff auf sein eigenes Notebook, weil alle
  Policies über diese Tabelle laufen.
- `notebook_members_keep_owner` (und die UPDATE-Variante) verhindert, dass der
  letzte Owner entfernt oder herabgestuft wird. Sonst wäre ein Notebook
  unverwaltbar — niemand könnte mehr einladen oder löschen.

## Funktionen

### `public.is_notebook_member(nb uuid, min_role text default 'viewer')`

Die einzige Stelle, an der Zugriff entschieden wird.

```sql
select exists (
  select 1 from public.notebook_members m
  where m.notebook_id = nb
    and m.user_id = auth.uid()
    and case min_role
          when 'viewer' then true
          when 'editor' then m.role in ('owner', 'editor')
          when 'owner'  then m.role = 'owner'
          else false
        end
);
```

`security definer`, weil die Funktion `notebook_members` lesen muss, ohne dass
dafür eine Policy greifen soll — sonst würde sich die Policy dieser Tabelle
selbst rekursiv aufrufen. `set search_path = ''` ist bei `security definer`
Pflicht: ohne das könnte ein manipulierter `search_path` eigene Funktionen
oder Tabellen unterschieben. Alle Objektnamen sind deshalb voll qualifiziert.

`stable`, damit der Planner den Aufruf pro Anfrage cachen kann.

### `public.set_updated_at()`

BEFORE-UPDATE-Trigger. Als Trigger und nicht in der Anwendung, damit kein
Schreibpfad das Feld vergessen kann.

### `public.generate_url_token(byte_length int default 32)`

32 Byte aus `gen_random_bytes`, base64url-kodiert. Für Share-Links (Phase 6).

## Geplant

Diese Tabellen entstehen in den folgenden Phasen; die Felder stehen hier, weil
sie das Bild vervollständigen und in `packages/shared/src/domain.ts` schon als
Typen existieren.

| Tabelle             | Phase | Kern                                                                                                                    |
| ------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------- |
| `sources`           | 2     | `kind`, `title`, `storage_path`, `source_url`, `status`, `error`, `char_count`, `summary`, `key_topics`                 |
| `chunks`            | 2     | `source_id`, `notebook_id`, `idx`, `content`, `heading_path`, `page`, `char_start/end`, `embedding vector(1024)`, `tsv` |
| `jobs`              | 2     | `kind`, `payload`, `status`, `attempts`, `run_after`, `locked_by`, `locked_at`, `error`                                 |
| `chats`, `messages` | 3     | `messages.citations jsonb` hält die geprüften Zitatverweise                                                             |
| `notes`             | 4     | `kind` (`user` oder `generated`), `content` (Markdown)                                                                  |
| `artifacts`         | 4/5   | `kind`, `status`, `payload jsonb`, `storage_path` (MP3)                                                                 |
| `share_links`       | 6     | `token`, `role`, `expires_at`                                                                                           |
| `llm_usage`         | 7     | Token-Verbrauch je Anfrage für die Kostenübersicht                                                                      |

### Indizes für die Suche (Phase 2)

```sql
create index on chunks using hnsw (embedding vector_cosine_ops);
create index on chunks using gin (tsv);
create index on chunks (notebook_id, source_id, idx);
```

HNSW und nicht IVFFlat: kein Trainingsschritt nötig, und bei laufend
hinzukommenden Quellen muss der Index nicht neu aufgebaut werden.

## Migrationen

Nummeriert und **unveränderlich**. `docker/db/migrate.sh` speichert eine
MD5-Summe je Datei und bricht ab, wenn eine bereits angewandte Migration
nachträglich verändert wurde — sonst driften Entwicklungs- und Produktionsschema
unbemerkt auseinander. Änderungen kommen als neue Migration.

| Datei                               | Inhalt                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| `0001_extensions_and_helpers.sql`   | `vector`, `pg_trgm`, `pgcrypto`, `set_updated_at`, `generate_url_token`        |
| `0002_notebooks_and_membership.sql` | `profiles`, `notebooks`, `notebook_members`, `is_notebook_member`, RLS, Grants |

Rollen (`anon`, `authenticated`, `service_role`, `authenticator`) und die
Schemas `auth` und `storage` legt das `supabase/postgres`-Image selbst an; sie
sind nicht Teil unserer Migrationen.

## Grants

`anon` erhält bewusst **keine** Rechte auf Anwendungstabellen. Es gibt keine
öffentlich lesbaren Daten; geteilte Notebooks laufen über Share-Tokens, nicht
über die anonyme Rolle. Der Worker verwendet den `service_role`-Key und umgeht
RLS bewusst — deshalb darf dieser Key ausschließlich serverseitig existieren.
