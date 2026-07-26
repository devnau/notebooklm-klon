import type { ReactNode } from 'react';

import { AppHeader } from '@/components/layout/app-header';
import { createClient } from '@/lib/supabase/server';

/**
 * Layout für alle angemeldeten Bereiche. Die Middleware hat den Zugriff schon
 * geprüft; hier wird das Profil nur noch für die Kopfzeile geladen.
 */
export default async function AppLayout({ children }: { readonly children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase
        .from('profiles')
        .select('display_name, email')
        .eq('id', user.id)
        .maybeSingle()
    : { data: null };

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader
        displayName={profile?.display_name ?? null}
        email={profile?.email ?? user?.email ?? null}
      />
      {children}
    </div>
  );
}
