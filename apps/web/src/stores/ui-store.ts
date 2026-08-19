import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** The six ranges the price chart offers (Phase 12). */
export type ChartRange = '7D' | '1M' | '3M' | '6M' | '1Y' | '15M';

/**
 * `label` is what the button shows; `spoken` is its accessible name.
 *
 * The two differ on purpose. A row of six buttons reading "7 Days / 1 Month /
 * 3 Months / 6 Months / 1 Year / 1Y 3M" is wide enough to wrap on a phone and
 * mixes singular and plural for no gain — the abbreviations scan as a scale,
 * which is what a range selector is.
 *
 * But "7D" read aloud is "seven dee", and "15M" is "fifteen em". Passing the
 * expanded form as the accessible name keeps the control usable by voice and
 * by screen reader while the visible text stays terse.
 */
export const CHART_RANGES: Array<{
  value: ChartRange;
  label: string;
  spoken: string;
  days: number;
}> = [
  { value: '7D', label: '7D', spoken: '7 days', days: 7 },
  { value: '1M', label: '1M', spoken: '1 month', days: 30 },
  { value: '3M', label: '3M', spoken: '3 months', days: 90 },
  { value: '6M', label: '6M', spoken: '6 months', days: 180 },
  { value: '1Y', label: '1Y', spoken: '1 year', days: 365 },
  // Matches the retention window; see price.schemas.ts in the API.
  { value: '15M', label: '15M', spoken: '15 months', days: 457 },
];

interface UiState {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;

  chartRange: ChartRange;
  setChartRange: (range: ChartRange) => void;

  showAmazon: boolean;
  showFlipkart: boolean;
  togglePlatform: (platform: 'amazon' | 'flipkart') => void;
}

/**
 * Client-only UI state.
 *
 * HARD RULE: nothing fetched from the API is ever stored here. Server data
 * lives in TanStack Query, which already owns caching, staleness,
 * deduplication and invalidation. Mirroring it into Zustand means reimplementing
 * all four by hand and then keeping two copies in sync — the single most common
 * way a React data layer rots.
 *
 * What belongs here is exactly what the server has no opinion about: which
 * chart range is selected, which platform series are visible, whether the
 * sidebar is open.
 *
 * Only durable preferences are persisted; `sidebarOpen` is intentionally
 * excluded so a narrow-viewport session cannot restore into a stuck-open
 * drawer on a later visit.
 */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarOpen: false,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

      chartRange: '3M',
      setChartRange: (range) => set({ chartRange: range }),

      showAmazon: true,
      showFlipkart: true,
      togglePlatform: (platform) =>
        set((state) =>
          platform === 'amazon'
            ? { showAmazon: !state.showAmazon }
            : { showFlipkart: !state.showFlipkart },
        ),
    }),
    {
      name: 'pricetrail-ui',
      partialize: (state) => ({
        chartRange: state.chartRange,
        showAmazon: state.showAmazon,
        showFlipkart: state.showFlipkart,
      }),
    },
  ),
);
