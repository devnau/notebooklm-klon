import type { Metadata } from 'next';
import Link from 'next/link';

import { ForgotPasswordForm } from './forgot-password-form';

export const metadata: Metadata = {
  title: 'Passwort vergessen',
};

export default function ForgotPasswordPage() {
  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Passwort zurücksetzen</h1>
        <p className="text-muted-foreground mt-1.5 text-sm">
          Wir schicken einen Link, mit dem du ein neues Passwort setzen kannst.
        </p>
      </div>

      <ForgotPasswordForm />

      <p className="text-muted-foreground mt-8 text-sm">
        <Link
          href="/anmelden"
          className="text-primary rounded font-medium underline-offset-4 hover:underline"
        >
          Zurück zur Anmeldung
        </Link>
      </p>
    </>
  );
}
