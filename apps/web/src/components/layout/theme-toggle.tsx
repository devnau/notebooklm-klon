'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '@/components/theme-provider';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

const ORDER = ['light', 'dark', 'system'] as const;

const LABELS: Record<(typeof ORDER)[number], string> = {
  light: 'Hell',
  dark: 'Dunkel',
  system: 'Systemeinstellung',
};

/**
 * Dreistufiger Umschalter: hell, dunkel, System. Die Systemoption ist kein
 * Beiwerk — wer sein Betriebssystem abends umstellt, will das hier nicht
 * doppelt pflegen.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Vor der Hydration ist das aktive Theme unbekannt. Würde man raten, blitzt
  // beim ersten Rendern das falsche Icon auf.
  useEffect(() => setMounted(true), []);

  const current = theme;
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length] ?? 'system';

  const Icon = current === 'light' ? Sun : current === 'dark' ? Moon : Monitor;

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(next)}
      title={`Darstellung: ${LABELS[current]}`}
      aria-label={`Darstellung: ${LABELS[current]}. Umschalten auf ${LABELS[next]}.`}
    >
      {mounted ? <Icon aria-hidden /> : <Monitor aria-hidden className="opacity-0" />}
    </Button>
  );
}
