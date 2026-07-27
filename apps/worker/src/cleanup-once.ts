import { createClient } from '@supabase/supabase-js';
import { pino } from 'pino';

import { cleanupOrphans } from './handlers/cleanup.js';
import { loadConfig } from './lib/config.js';

/**
 * Führt das Aufräumen einmal aus und beendet sich.
 *
 * Im Betrieb erledigt das der Worker in seiner Leerlaufschleife. Diesen Weg
 * braucht es trotzdem: nach einer Aufräumaktion mit vielen gelöschten
 * Notizbüchern will man nicht warten, bis der Worker von selbst dazu kommt —
 * und für die Probe (scripts/cleanup-probe.mjs) ist ein Aufruf mit klarem Ende
 * das Einzige, was sich prüfen lässt.
 *
 * Aufruf:  npm run cleanup --workspace=@nlm/worker
 */

const config = loadConfig();

const logger = pino({
  level: config.LOG_LEVEL,
  base: { worker: 'cleanup-once' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ergebnis = await cleanupOrphans(supabase, logger);

/*
 * Maschinenlesbar auf stdout, damit die Probe das Ergebnis auswerten kann, ohne
 * das Protokollformat zu kennen. `console.log` ist im Rest des Projekts
 * verboten — hier ist es die Schnittstelle, nicht eine vergessene
 * Fehlersuchzeile.
 */
// eslint-disable-next-line no-console
console.log(`ERGEBNIS ${JSON.stringify(ergebnis)}`);
