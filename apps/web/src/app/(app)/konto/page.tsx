import type { Metadata } from 'next';
import Link from 'next/link';

import { ProfileForm } from '@/components/account/profile-form';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { createClient } from '@/lib/supabase/server';
import { formatAbsoluteDate } from '@/lib/format';

export const metadata: Metadata = { title: 'Profil' };

export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, email, created_at')
    .eq('id', user?.id ?? '')
    .maybeSingle();

  return (
    <main id="main" className="mx-auto w-full max-w-xl flex-1 px-4 py-10 sm:px-6">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Profil</h1>

      <Card>
        <CardHeader>
          <CardTitle>Anzeigename</CardTitle>
          <CardDescription>Wird Mitgliedern geteilter Notebooks angezeigt.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm displayName={profile?.display_name ?? ''} />
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Konto</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">E-Mail</span>
            <span className="truncate">{profile?.email ?? user?.email ?? '—'}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Registriert</span>
            <span>
              {profile?.created_at ? formatAbsoluteDate(profile.created_at) : '—'}
            </span>
          </div>
          <div className="pt-2">
            <Button variant="secondary" size="sm" asChild>
              <Link href="/passwort-aendern">Passwort ändern</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
