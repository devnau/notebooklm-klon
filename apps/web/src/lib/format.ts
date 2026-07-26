/**
 * Relative Zeitangabe auf Deutsch. `Intl.RelativeTimeFormat` statt einer
 * eigenen Tabelle — das erledigt Pluralformen und Sprachregeln korrekt.
 */
export function formatRelativeDate(iso: string, locale = 'de-DE'): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';

  const diffSeconds = Math.round((then - Date.now()) / 1000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  const thresholds: readonly [Intl.RelativeTimeFormatUnit, number][] = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 7],
    ['week', 4.35],
    ['month', 12],
  ];

  let value = diffSeconds;
  for (const [unit, step] of thresholds) {
    if (Math.abs(value) < step) return format.format(Math.round(value), unit);
    value /= step;
  }
  return format.format(Math.round(value), 'year');
}

/** Absolutes Datum für Titel-Attribute, wo die relative Angabe zu unscharf ist. */
export function formatAbsoluteDate(iso: string, locale = 'de-DE'): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

/** Dateigrößen in der Einheit, die ein Mensch erwartet. */
export function formatBytes(bytes: number, locale = 'de-DE'): string {
  const units = ['B', 'kB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1000 && unitIndex < units.length - 1) {
    value /= 1000;
    unitIndex += 1;
  }
  const formatted = new Intl.NumberFormat(locale, {
    maximumFractionDigits: value < 10 && unitIndex > 0 ? 1 : 0,
  }).format(value);
  return `${formatted} ${units[unitIndex]}`;
}
