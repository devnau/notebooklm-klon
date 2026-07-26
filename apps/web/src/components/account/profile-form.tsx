'use client';

import { useActionState } from 'react';

import { updateProfile, type ProfileResult } from '@/app/(app)/konto/actions';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

const EMPTY: ProfileResult = {};

export function ProfileForm({ displayName }: { readonly displayName: string }) {
  const [state, submit, pending] = useActionState(updateProfile, EMPTY);

  return (
    <form action={submit} className="flex flex-col gap-4" noValidate>
      <Field label="Anzeigename" error={state.fieldErrors?.displayName}>
        {(props) => (
          <Input
            {...props}
            name="displayName"
            defaultValue={displayName}
            maxLength={80}
            placeholder="Vorname"
          />
        )}
      </Field>

      <div aria-live="polite" className="empty:hidden">
        {state.error && (
          <p
            role="alert"
            className="bg-destructive-subtle text-destructive rounded-md p-3 text-sm"
          >
            {state.error}
          </p>
        )}
        {state.saved && <p className="text-success text-sm">Gespeichert.</p>}
      </div>

      <Button type="submit" loading={pending} className="self-start">
        Speichern
      </Button>
    </form>
  );
}
