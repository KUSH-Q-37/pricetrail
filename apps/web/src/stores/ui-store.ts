import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** The six ranges the price chart offers (Phase 12). */
export type ChartRange = '7D' | '1M' | '3M' | '6M' | '1Y' | '15M';

export const CHART_RANGES: Array<{ value: ChartRange; label: string; days: number }> = [
  { value: '7D', label: '7 Days', days: 7 },
  { value: '1M', label: '1 Month', days: 30 },
  { value: '3M', label: '3 Months', days: 90 },
  { value: '6M', label: '6 Months', days: 180 },
  { value: '1Y', label: '1 Year', days: 365 },
  // Matches the retention window; see price.schemas.ts in the API.
  { value: '15M', label: '1Y 3M', days: 457 },
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
