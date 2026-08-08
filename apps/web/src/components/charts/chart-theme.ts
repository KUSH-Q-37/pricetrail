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
  isDark: boolean;
}

const FALLBACK: ChartTokens = {
  amazon: '#d1780f',
  flipkart: '#2275e8',
  surface: '#ffffff',
  text: '#22252b',
  muted: '#6b7280',
  grid: '#e6e7ea',
  border: '#e6e7ea',
  isDark: false,
};

function read(style: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = style.getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * Track the active theme.
 *
 * A MutationObserver on <html>'s class list is required rather than reading
 * once: next-themes toggles the class after mount, and a chart that sampled
 * its colours during the first render would keep light-mode axes on a dark
 * surface until something else forced a re-render.
 */
export function useChartTokens(): ChartTokens {
  const [tokens, setTokens] = useState<ChartTokens>(FALLBACK);

  useEffect(() => {
    const sample = (): void => {
      const style = getComputedStyle(document.documentElement);
      const isDark = document.documentElement.classList.contains('dark');

      setTokens({
        amazon: read(style, '--chart-amazon', FALLBACK.amazon),
        flipkart: read(style, '--chart-flipkart', FALLBACK.flipkart),
        // The chart sits on a card, so the card colour is the plot surface —
        // that is what the palette was validated against.
        surface: read(style, '--card', isDark ? '#14161b' : '#ffffff'),
        text: read(style, '--card-foreground', isDark ? '#f1f2f4' : '#22252b'),
        muted: read(style, '--muted-foreground', FALLBACK.muted),
        grid: read(style, '--border', FALLBACK.grid),
        border: read(style, '--border', FALLBACK.border),
        isDark,
      });
    };

    sample();

    const observer = new MutationObserver(sample);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => observer.disconnect();
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
