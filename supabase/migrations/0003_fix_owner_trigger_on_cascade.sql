-- ═══════════════════════════════════════════════════════════════════════════
-- 0003 · Owner-Trigger blockierte das Löschen eines Notebooks
--
-- Fehlerbild: `delete from notebooks` scheiterte immer mit
-- „Das Notebook braucht mindestens einen Owner." (SQLSTATE 23514).
--
-- Ursache: das Löschen eines Notebooks kaskadiert auf notebook_members. Dabei
-- feuert prevent_last_owner_removal() für die Owner-Zeile und stellt fest, dass
-- danach kein Owner übrig bleibt — was korrekt ist, aber hier irrelevant: das
-- Notebook selbst verschwindet ja gerade. Der Schutz griff also genau dann,
-- wenn er nicht greifen sollte, und machte Notebooks unlöschbar.
--
-- Aufgefallen ist das erst im End-to-End-Test. Der Smoke-Test prüfte das
-- Entfernen der Mitgliedschaft (korrekt abgewiesen) und nie das Löschen des
-- Notebooks — die Prüfung war also grün, während die Funktion kaputt war.
--
-- Behebung: die Kaskade erkennen. Wenn das zugehörige Notebook nicht mehr
-- existiert, ist der Löschvorgang Teil des Aufräumens und der Trigger hält sich
-- heraus. Beim direkten Entfernen einer Mitgliedschaft existiert das Notebook
-- weiterhin, dort schützt er unverändert.
-- ═══════════════════════════════════════════════════════════════════════════

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

  -- Kaskade vom Notebook: die Elternzeile ist zu diesem Zeitpunkt bereits
  -- gelöscht. Dann gibt es nichts zu schützen.
  if not exists (select 1 from public.notebooks n where n.id = target_notebook) then
    return coalesce(new, old);
  end if;

  select count(*) into remaining_owners
  from public.notebook_members m
  where m.notebook_id = target_notebook
    and m.role = 'owner'
    and m.user_id <> old.user_id;

  if remaining_owners = 0 then
    raise exception 'Das Notebook braucht mindestens einen Owner.'
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$$;

comment on function public.prevent_last_owner_removal() is
  'Verhindert, dass der letzte Owner entfernt oder herabgestuft wird. Hält sich beim Löschen des Notebooks heraus (Kaskade).';
