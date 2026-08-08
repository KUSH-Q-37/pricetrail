import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge class names with Tailwind conflict resolution.
 *
 * clsx alone would leave `px-2 px-4` both present and let source order decide.
 * twMerge understands Tailwind's grouping, so a caller-supplied `px-4` reliably
 * beats a component's default `px-2` — which is what makes `className` props on
 * these components actually work.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Render minor currency units (paise) as rupees.
 *
 * The API sends integers to keep arithmetic exact; formatting is the client's
 * job. Division happens once, here, so no other module is tempted to do float
 * maths on money.
 */
export function formatPrice(
  minorUnits: number,
  currency = 'INR',
  options: { compact?: boolean } = {},
): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
    notation: options.compact ? 'compact' : 'standard',
  }).format(minorUnits / 100);
}

export function formatPercent(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(value / 100);
}

/** Short relative time ("3h ago") for "last checked" labels. */
export function formatRelativeTime(input: string | Date): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];

  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  for (const [unit, secondsPerUnit] of units) {
    if (Math.abs(seconds) >= secondsPerUnit) {
      return formatter.format(-Math.round(seconds / secondsPerUnit), unit);
    }
  }

  return 'just now';
}
