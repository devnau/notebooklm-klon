import type { Metadata } from 'next';

import { ChangePasswordForm } from './change-password-form';

export const metadata: Metadata = {
  title: 'Passwort ändern',
};

export default function ChangePasswordPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-sm px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Neues Passwort setzen</h1>
      <p className="text-muted-foreground mt-1.5 mb-8 text-sm">
        Danach bist du direkt angemeldet.
      </p>
      <ChangePasswordForm />
    </main>
  );
}
