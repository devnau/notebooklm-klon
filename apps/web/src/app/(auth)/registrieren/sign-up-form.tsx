'use client';

import { useActionState } from 'react';

import { signUp, type AuthResult } from '@/app/(auth)/actions';
import { AuthFormStatus } from '@/components/auth/auth-form-status';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

const EMPTY: AuthResult = {};

export function SignUpForm() {
  const [state, submit, pending] = useActionState(signUp, EMPTY);

  return (
    <form action={submit} className="flex flex-col gap-4" noValidate>
      <Field
        label="Anzeigename"
        error={state.fieldErrors?.displayName}
        hint="Optional. Wird geteilten Notebooks angezeigt."
      >
        {(props) => (
          <Input {...props} name="displayName" autoComplete="name" placeholder="Vorname" />
        )}
      </Field>

      <Field label="E-Mail-Adresse" error={state.fieldErrors?.email}>
        {(props) => (
          <Input
            {...props}
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="du@example.com"
          />
        )}
      </Field>

      <Field
        label="Passwort"
        error={state.fieldErrors?.password}
        hint="Mindestens 12 Zeichen. Mehrere Wörter sind sicherer und leichter zu merken als Sonderzeichen."
      >
        {(props) => (
          <Input
            {...props}
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
          />
        )}
      </Field>

      <AuthFormStatus state={state} />

      <Button type="submit" loading={pending} className="mt-1 w-full">
        Konto anlegen
      </Button>
    </form>
  );
}
