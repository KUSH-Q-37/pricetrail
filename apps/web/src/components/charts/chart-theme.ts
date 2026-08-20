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
 * WATCHED, NOT SAMPLED ONCE.
 *
 * This observer has now been removed and restored, so the reasoning is worth
 * recording. It was originally here because next-themes wrote to <html> after
 * hydration and a chart that read its colours during the first render would
 * have kept light axes on a dark surface. It was then deleted, correctly, when
 * the product went down to a single theme: it watched for an event that could
 * no longer happen.
 *
 * Three themes and five accents later the event happens again, and it is now
 * the ONLY thing standing between a theme switch and a chart left rendering
 * #2275e8 axes on a near-black card. ECharts holds its own copy of every colour
 * it was given, so nothing repaints it unless this hook produces a new object.
 *
 * `data-accent` is watched alongside `data-theme` even though the marketplace
 * series deliberately do not follow the accent — because `surface`, `text` and
 * `grid` resolve through tokens that can, and a chart whose gridlines lag a
 * theme change by one interaction is exactly the kind of drift this hook exists
 * to prevent.
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

      const next: ChartTokens = {
        amazon: read(style, '--chart-amazon', FALLBACK.amazon),
        flipkart: read(style, '--chart-flipkart', FALLBACK.flipkart),
        // The chart sits on a card, so the card colour is the plot surface —
        // that is what the palette was validated against.
        surface: read(style, '--card', '#ffffff'),
        text: read(style, '--card-foreground', '#22252b'),
        muted: read(style, '--muted-foreground', FALLBACK.muted),
        grid: read(style, '--border', FALLBACK.grid),
        border: read(style, '--border', FALLBACK.border),
      };

      // Bail out when nothing moved. Returning a fresh object on every
      // attribute change would give ECharts a new `option` identity and make it
      // re-render the whole chart when only, say, the accent had changed.
      setTokens((current) =>
        (Object.keys(next) as Array<keyof ChartTokens>).every(
          (key) => current[key] === next[key],
        )
          ? current
          : next,
      );
    };

    sample();

    const observer = new MutationObserver(sample);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-accent'],
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
