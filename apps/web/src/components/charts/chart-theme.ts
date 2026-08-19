'use client';

import { useEffect, useState } from 'react';

/**
 * Chart tokens resolved from CSS custom properties at runtime.
 *
 * Reading the live computed values rather than hardcoding hex here means the
 * chart and the rest of the UI can never drift: one source of truth in
 * globals.css, and a theme switch repaints both together.
 */
export interface ChartTokens {
  amazon: string;
  flipkart: string;
  surface: string;
  text: string;
  muted: string;
  grid: string;
  border: string;
}

const FALLBACK: ChartTokens = {
  amazon: '#d1780f',
  flipkart: '#2275e8',
  surface: '#ffffff',
  text: '#22252b',
  muted: '#6b7280',
  grid: '#e6e7ea',
  border: '#e6e7ea',
};

function read(style: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = style.getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * Read the chart tokens from CSS custom properties.
 *
 * Sampled once on mount rather than watched. There used to be a
 * MutationObserver on <html>'s class list, because next-themes toggled a class
 * after hydration and a chart that read its colours during the first render
 * would have kept light axes on a dark surface. With a single theme the class
 * never changes, so the observer watched for an event that cannot happen.
 *
 * Still read from CSS rather than hardcoded here: the palette lives in
 * globals.css, and duplicating it would let the chart drift away from the rest
 * of the interface one careless edit at a time.
 */
export function useChartTokens(): ChartTokens {
  const [tokens, setTokens] = useState<ChartTokens>(FALLBACK);

  useEffect(() => {
    const sample = (): void => {
      const style = getComputedStyle(document.documentElement);

      setTokens({
        amazon: read(style, '--chart-amazon', FALLBACK.amazon),
        flipkart: read(style, '--chart-flipkart', FALLBACK.flipkart),
        // The chart sits on a card, so the card colour is the plot surface —
        // that is what the palette was validated against.
        surface: read(style, '--card', '#ffffff'),
        text: read(style, '--card-foreground', '#22252b'),
        muted: read(style, '--muted-foreground', FALLBACK.muted),
        grid: read(style, '--border', FALLBACK.grid),
        border: read(style, '--border', FALLBACK.border),
      });
    };

    sample();
  }, []);

  return tokens;
}

export const PLATFORM_LABEL: Record<'AMAZON' | 'FLIPKART', string> = {
  AMAZON: 'Amazon',
  FLIPKART: 'Flipkart',
};

export function seriesColor(
  platform: 'AMAZON' | 'FLIPKART',
  tokens: ChartTokens,
): string {
  return platform === 'AMAZON' ? tokens.amazon : tokens.flipkart;
}
