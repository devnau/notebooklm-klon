import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Klassen zusammenführen und Tailwind-Konflikte auflösen — Konvention aus
 * shadcn/ui, damit die CLI später zusätzliche Komponenten generieren kann.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
