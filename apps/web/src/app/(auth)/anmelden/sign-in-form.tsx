'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';

import { sendMagicLink, signIn, type AuthResult } from '@/app/(auth)/actions';
import { AuthFormStatus } from '@/components/auth/auth-form-status';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

const EMPTY: AuthResult = {};

export function SignInForm({ redirectTo }: { readonly redirectTo?: string | undefined }) {
  const [mode, setMode] = useState<'password' | 'magic'>('password');
  const [passwordState, submitPassword, passwordPending] = useActionState(signIn, EMPTY);
  const [magicState, submitMagic, magicPending] = useActionState(sendMagicLink, EMPTY);

  if (mode === 'magic') {
    return (
      <div className="flex flex-col gap-5">
        <form action={submitMagic} className="flex flex-col gap-4" noValidate>
          <Field
            label="E-Mail-Adresse"
            error={magicState.fieldErrors?.email}
            hint="Wir schicken einen Link, mit dem du dich ohne Passwort anmeldest."
          >
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

          <AuthFormStatus state={magicState} />

          <Button type="submit" loading={magicPending} className="w-full">
            Anmeldelink senden
          </Button>
        </form>

        <Button variant="ghost" size="sm" onClick={() => setMode('password')}>
          Stattdessen Passwort verwenden
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <form action={submitPassword} className="flex flex-col gap-4" noValidate>
        {/* Rücksprungziel aus der Middleware; wird serverseitig geprüft. */}
        {redirectTo && <input type="hidden" name="weiter" value={redirectTo} />}

        <Field label="E-Mail-Adresse" error={passwordState.fieldErrors?.email}>
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

        <Field label="Passwort" error={passwordState.fieldErrors?.password}>
          {(props) => (
            <Input
              {...props}
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          )}
        </Field>

        <AuthFormStatus state={passwordState} />

        <Button type="submit" loading={passwordPending} className="w-full">
          Anmelden
        </Button>
      </form>

      <div className="flex items-center justify-between text-sm">
        <Button variant="link" size="sm" className="px-0" onClick={() => setMode('magic')}>
          Ohne Passwort anmelden
        </Button>
        <Link
          href="/passwort-vergessen"
          className="text-muted-foreground hover:text-foreground rounded underline-offset-4 hover:underline"
        >
          Passwort vergessen?
        </Link>
      </div>
    </div>
  );
}
