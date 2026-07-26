-- ═══════════════════════════════════════════════════════════════════════════
-- 0001 · Extensions und Hilfsfunktionen
--
-- Rollen (anon, authenticated, service_role, authenticator) sowie die Schemas
-- auth und storage bringt das supabase/postgres-Image bereits mit. Hier kommt
-- nur dazu, was diese Anwendung zusätzlich braucht.
-- ═══════════════════════════════════════════════════════════════════════════

-- pgvector für die Embeddings, pg_trgm für unscharfe Titelsuche.
create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ── updated_at automatisch pflegen ─────────────────────────────────────────
-- Ein Trigger statt Anwendungslogik: so kann kein Schreibpfad das Feld
-- versehentlich vergessen.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'BEFORE UPDATE Trigger: setzt updated_at auf now().';

-- ── Zufälliger, URL-sicherer Token ─────────────────────────────────────────
-- Für Share-Links. 32 Bytes aus gen_random_bytes, base64url-kodiert.
create or replace function public.generate_url_token(byte_length int default 32)
returns text
language sql
volatile
as $$
  select translate(
    encode(extensions.gen_random_bytes(byte_length), 'base64'),
    '+/=',
    '-_'
  );
$$;

comment on function public.generate_url_token(int) is
  'Kryptografisch zufälliger, URL-sicherer Token für Share-Links.';
