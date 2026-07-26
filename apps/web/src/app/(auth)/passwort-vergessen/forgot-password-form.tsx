'use client';

import { useActionState } from 'react';

import { requestPasswordReset, type AuthResult } from '@/app/(auth)/actions';
import { AuthFormStatus } from '@/components/auth/auth-form-status';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

const EMPTY: AuthResult = {};

export function ForgotPasswordForm() {
  const [state, submit, pending] = useActionState(requestPasswordReset, EMPTY);

  return (
    <form action={submit} className="flex flex-col gap-4" noValidate>
      <Field label="E-Mail-Adresse" error={state.fieldErrors?.email}>
        {(props) => (
          <Input
            {...props}
            name="email"
            type="email"
            autoComplete="email"
            autoFocus
            required
            placeholder="du@example.com"
          />
        )}
      </Field>

      <AuthFormStatus state={state} />

      <Button type="submit" loading={pending} className="w-full">
        Link senden
      </Button>
    </form>
  );
}
