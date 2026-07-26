'use client';

import { createBrowserClient } from '@supabase/ssr';

import { clientEnv } from '@/lib/env';

import type { Database } from './types';

/**
 * Supabase-Client für Client Components. Verwendet den anon-Key, unterliegt
 * damit vollständig der Row Level Security.
 *
 * `createBrowserClient` gibt bei mehrfachem Aufruf dieselbe Instanz zurück,
 * ein Singleton hier ist also unnötig.
 */
export function createClient() {
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = clientEnv();
  return createBrowserClient<Database>(
    NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
