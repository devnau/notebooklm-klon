import type { Metadata } from 'next';
import Link from 'next/link';

import { SignUpForm } from './sign-up-form';

export const metadata: Metadata = {
  title: 'Registrieren',
};

export default function SignUpPage() {
  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Konto anlegen</h1>
        <p className="text-muted-foreground mt-1.5 text-sm">
          Eigene Quellen hochladen und belegte Antworten daraus erhalten.
        </p>
      </div>

      <SignUpForm />

      <p className="text-muted-foreground mt-8 text-sm">
        Schon ein Konto?{' '}
        <Link
          href="/anmelden"
          className="text-primary rounded font-medium underline-offset-4 hover:underline"
        >
          Anmelden
        </Link>
      </p>
    </>
  );
}
