'use client';

import { useActionState } from 'react';

import { changePassword, type AuthResult } from '@/app/(auth)/actions';
import { AuthFormStatus } from '@/components/auth/auth-form-status';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

const EMPTY: AuthResult = {};

export function ChangePasswordForm() {
  const [state, submit, pending] = useActionState(changePassword, EMPTY);

  return (
    <form action={submit} className="flex flex-col gap-4" noValidate>
      <Field
        label="Neues Passwort"
        error={state.fieldErrors?.password}
        hint="Mindestens 12 Zeichen."
      >
        {(props) => (
          <Input
            {...props}
            name="password"
            type="password"
            autoComplete="new-password"
            autoFocus
            required
            minLength={12}
          />
        )}
      </Field>

      <Field label="Wiederholen" error={state.fieldErrors?.passwordRepeat}>
        {(props) => (
          <Input
            {...props}
            name="passwordRepeat"
            type="password"
            autoComplete="new-password"
            required
          />
        )}
      </Field>

      <AuthFormStatus state={state} />

      <Button type="submit" loading={pending} className="w-full">
        Passwort speichern
      </Button>
    </form>
  );
}
