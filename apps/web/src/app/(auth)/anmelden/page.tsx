import type { Metadata } from 'next';
import Link from 'next/link';

import { SignInForm } from './sign-in-form';

export const metadata: Metadata = {
  title: 'Anmelden',
};

export default async function SignInPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ weiter?: string }>;
}) {
  const { weiter } = await searchParams;

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Anmelden</h1>
        <p className="text-muted-foreground mt-1.5 text-sm">Weiter zu deinen Notebooks.</p>
      </div>

      <SignInForm redirectTo={weiter} />

      <p className="text-muted-foreground mt-8 text-sm">
        Noch kein Konto?{' '}
        <Link
          href="/registrieren"
          className="text-primary rounded font-medium underline-offset-4 hover:underline"
        >
          Registrieren
        </Link>
      </p>
    </>
  );
}
