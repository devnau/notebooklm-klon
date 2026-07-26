-- ═══════════════════════════════════════════════════════════════════════════
-- 0002 · Notebooks, Mitgliedschaften und die zentrale Zugriffsfunktion
--
-- Das gesamte Berechtigungsmodell hängt an einer Funktion:
-- public.is_notebook_member(). Jede weitere Tabelle delegiert ihre Policies
-- dorthin, damit es nur eine Stelle gibt, an der Zugriff entschieden wird.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Profile ────────────────────────────────────────────────────────────────
-- auth.users ist von der Anwendung aus nicht direkt lesbar. Für Anzeigenamen
-- in geteilten Notebooks brauchen wir eine Spiegeltabelle im public-Schema.
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  email        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is
  'Öffentlich lesbares Profil je Nutzer. Spiegel von auth.users, per Trigger gepflegt.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Profil bei Registrierung automatisch anlegen. security definer, weil der
-- Trigger im Kontext von auth.users läuft und dort auf public schreiben muss.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Notebooks ──────────────────────────────────────────────────────────────
create table public.notebooks (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  title       text not null check (length(btrim(title)) between 1 and 200),
  emoji       text not null default '📓' check (length(emoji) <= 8),
  -- Steuert Prompt-Sprache und TTS-Stimme.
  language    text not null default 'de' check (language in ('de', 'en')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.notebooks is
  'Ein Arbeitsbereich: Quellen, Chats, Notizen und Artefakte hängen daran.';

create index notebooks_owner_idx on public.notebooks (owner_id, updated_at desc);

create trigger notebooks_set_updated_at
  before update on public.notebooks
  for each row execute function public.set_updated_at();

-- ── Mitgliedschaften ───────────────────────────────────────────────────────
create table public.notebook_members (
  notebook_id uuid not null references public.notebooks (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null check (role in ('owner', 'editor', 'viewer')),
  invited_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (notebook_id, user_id)
);

comment on table public.notebook_members is
  'Wer darf was in welchem Notebook. Grundlage aller RLS-Policies.';

create index notebook_members_user_idx on public.notebook_members (user_id);

-- Owner beim Anlegen automatisch eintragen. Ohne diesen Trigger hätte der
-- Ersteller keinen Zugriff auf sein eigenes Notebook, weil alle Policies über
-- notebook_members gehen.
create or replace function public.add_owner_as_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notebook_members (notebook_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (notebook_id, user_id) do update set role = 'owner';
  return new;
end;
$$;

create trigger notebooks_add_owner_member
  after insert on public.notebooks
  for each row execute function public.add_owner_as_member();

-- Es muss immer genau einen Owner geben: ohne diese Sperre könnte sich der
-- letzte Owner selbst herabstufen und das Notebook wäre nicht mehr verwaltbar.
create or replace function public.prevent_last_owner_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  remaining_owners int;
  target_notebook uuid;
begin
  target_notebook := coalesce(old.notebook_id, new.notebook_id);

  select count(*) into remaining_owners
  from public.notebook_members
  where notebook_id = target_notebook
    and role = 'owner'
    and not (user_id = old.user_id);

  if remaining_owners = 0 then
    raise exception 'Das Notebook braucht mindestens einen Owner.'
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger notebook_members_keep_owner
  before delete on public.notebook_members
  for each row when (old.role = 'owner')
  execute function public.prevent_last_owner_removal();

create trigger notebook_members_keep_owner_on_update
  before update on public.notebook_members
  for each row when (old.role = 'owner' and new.role <> 'owner')
  execute function public.prevent_last_owner_removal();

-- ═══════════════════════════════════════════════════════════════════════════
-- Die zentrale Zugriffsfunktion
--
-- security definer, damit sie notebook_members lesen kann, ohne dass dafür
-- eine eigene RLS-Policy nötig wäre (die sich sonst selbst rekursiv aufrufen
-- würde). `set search_path = ''` verhindert Schema-Hijacking über einen
-- manipulierten search_path — bei security definer ist das Pflicht, nicht
-- Geschmackssache.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.is_notebook_member(
  nb uuid,
  min_role text default 'viewer'
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.notebook_members m
    where m.notebook_id = nb
      and m.user_id = auth.uid()
      and case min_role
            when 'viewer' then true
            when 'editor' then m.role in ('owner', 'editor')
            when 'owner'  then m.role = 'owner'
            else false
          end
  );
$$;

comment on function public.is_notebook_member(uuid, text) is
  'Prüft, ob der aktuelle Nutzer im Notebook mindestens die angegebene Rolle hat. Basis aller RLS-Policies.';

revoke all on function public.is_notebook_member(uuid, text) from public;
grant execute on function public.is_notebook_member(uuid, text) to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.profiles          enable row level security;
alter table public.notebooks         enable row level security;
alter table public.notebook_members  enable row level security;

-- Für alle drei Tabellen: FORCE, damit selbst der Tabelleneigentümer den
-- Policies unterliegt. Ohne FORCE umgeht `postgres` sie stillschweigend.
alter table public.profiles          force row level security;
alter table public.notebooks         force row level security;
alter table public.notebook_members  force row level security;

-- ── profiles ───────────────────────────────────────────────────────────────
-- Eigenes Profil immer; fremde nur, wenn man ein Notebook teilt. Sonst wäre
-- die Tabelle ein Verzeichnis aller registrierten E-Mail-Adressen.
create policy profiles_select_self_or_shared on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.notebook_members mine
      join public.notebook_members theirs on theirs.notebook_id = mine.notebook_id
      where mine.user_id = auth.uid()
        and theirs.user_id = public.profiles.id
    )
  );

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ── notebooks ──────────────────────────────────────────────────────────────
-- Der owner_id-Zweig ist nicht redundant, sondern notwendig: bei
-- `insert ... returning` (was PostgREST und supabase-js immer verwenden) prüft
-- Postgres die SELECT-Policy auf der neuen Zeile, *bevor* der AFTER-Trigger die
-- Mitgliedschaft anlegt. Ohne diesen Zweig wäre das Anlegen eines Notebooks vom
-- Client aus unmöglich — die Policy würde die eigene, gerade erzeugte Zeile
-- verstecken. Eine Rechteerweiterung ist es nicht: der Owner ist per Trigger
-- ohnehin immer Mitglied.
create policy notebooks_select_member on public.notebooks
  for select to authenticated
  using (owner_id = auth.uid() or public.is_notebook_member(id, 'viewer'));

-- Anlegen darf jeder, aber nur für sich selbst als Owner.
create policy notebooks_insert_self on public.notebooks
  for insert to authenticated
  with check (owner_id = auth.uid());

create policy notebooks_update_editor on public.notebooks
  for update to authenticated
  using (public.is_notebook_member(id, 'editor'))
  with check (public.is_notebook_member(id, 'editor'));

create policy notebooks_delete_owner on public.notebooks
  for delete to authenticated
  using (public.is_notebook_member(id, 'owner'));

-- ── notebook_members ───────────────────────────────────────────────────────
-- Mitglieder sehen einander (nötig für die Mitgliederliste), aber verwalten
-- darf nur der Owner.
create policy notebook_members_select_member on public.notebook_members
  for select to authenticated
  using (public.is_notebook_member(notebook_id, 'viewer'));

create policy notebook_members_insert_owner on public.notebook_members
  for insert to authenticated
  with check (public.is_notebook_member(notebook_id, 'owner'));

create policy notebook_members_update_owner on public.notebook_members
  for update to authenticated
  using (public.is_notebook_member(notebook_id, 'owner'))
  with check (public.is_notebook_member(notebook_id, 'owner'));

-- Owner kann jeden entfernen; Mitglieder können selbst austreten.
create policy notebook_members_delete_owner_or_self on public.notebook_members
  for delete to authenticated
  using (public.is_notebook_member(notebook_id, 'owner') or user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════════════
-- Grants
--
-- anon bekommt bewusst nichts: es gibt keine öffentlich lesbaren Daten.
-- Freigegebene Notebooks laufen über Share-Tokens (Phase 6), nicht über anon.
-- ═══════════════════════════════════════════════════════════════════════════
grant usage on schema public to authenticated, service_role;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.notebooks to authenticated;
grant select, insert, update, delete on public.notebook_members to authenticated;

grant all on public.profiles, public.notebooks, public.notebook_members to service_role;
