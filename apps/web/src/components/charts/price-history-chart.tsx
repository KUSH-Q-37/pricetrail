'use client';

import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import ReactECharts from 'echarts-for-react/lib/core';
import { useMemo } from 'react';

import { PLATFORM_LABEL, seriesColor, useChartTokens } from './chart-theme';
import type { HistorySeries } from '@/hooks/use-price-history';

// Tree-shaken registration: importing the full `echarts` bundle ships every
// chart type, map and toolbox we do not use.
echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
  CanvasRenderer,
]);

interface PriceHistoryChartProps {
  series: HistorySeries[];
  /** Platform visibility, driven by the Zustand UI store. */
  visible?: Record<'AMAZON' | 'FLIPKART', boolean>;
  height?: number;
  /** Dim while a new range loads instead of unmounting. */
  loading?: boolean;
}

const rupees = (minor: number): string =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(minor / 100);

export function PriceHistoryChart({
  series,
  visible,
  height = 340,
  loading = false,
}: PriceHistoryChartProps) {
  const tokens = useChartTokens();

  const shown = useMemo(
    () => series.filter((entry) => visible?.[entry.platform] ?? true),
    [series, visible],
  );

  const option = useMemo(() => {
    return {
      // The palette was validated against the CARD surface, so the plot must
      // actually sit on it.
      backgroundColor: 'transparent',
      animationDuration: 400,
      animationEasing: 'cubicOut' as const,

      // Room for the x-axis band. A fixed height that excludes it produces a
      // nested scrollbar inside the card.
      grid: { left: 8, right: 16, top: 32, bottom: 64, containLabel: true },

      legend: {
        /*
         * Off — the panel renders a richer legend directly above the plot:
         * swatch + platform name + current price + change. That row carries
         * everything a legend box would and more, sits adjacent to the marks,
         * and keeps identity off colour-alone. A second legend here would just
         * repeat it three inches away.
         */
        show: false,
        top: 0,
        right: 0,
        itemWidth: 10,
        itemHeight: 10,
        icon: 'roundRect',
        // Legend text wears INK, not the series colour. The swatch beside it
        // carries identity.
        textStyle: { color: tokens.muted, fontSize: 12 },
        data: shown.map((entry) => PLATFORM_LABEL[entry.platform]),
      },

      tooltip: {
        trigger: 'axis' as const,
        axisPointer: {
          type: 'line' as const,
          lineStyle: { color: tokens.muted, width: 1, opacity: 0.5 },
        },
        backgroundColor: tokens.surface,
        borderColor: tokens.border,
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: tokens.text, fontSize: 12 },
        formatter: (params: unknown) => {
          const rows = Array.isArray(params) ? params : [params];
          if (rows.length === 0) return '';

          const first = rows[0] as { axisValue: number };
          const date = new Date(first.axisValue).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          });

          const lines = rows
            .map((row) => {
              const typed = row as {
                seriesName: string;
                color: string;
                value: [number, number | null];
              };
              const value = typed.value?.[1];
              // A missing observation is stated, never blanked or interpolated.
              const text = value === null || value === undefined
                ? 'not recorded'
                : rupees(value);
              return `<div style="display:flex;align-items:center;gap:8px;margin-top:4px">
                <span style="width:8px;height:8px;border-radius:2px;background:${typed.color}"></span>
                <span style="color:${tokens.muted}">${typed.seriesName}</span>
                <span style="margin-left:auto;font-variant-numeric:tabular-nums;color:${tokens.text}">${text}</span>
              </div>`;
            })
            .join('');

          return `<div style="font-weight:600;color:${tokens.text}">${date}</div>${lines}`;
        },
      },

      // Zoom + pan. Wheel zoom inside the plot, plus a draggable slider.
      dataZoom: [
        { type: 'inside' as const, throttle: 50 },
        {
          type: 'slider' as const,
          height: 22,
          bottom: 8,
          borderColor: 'transparent',
          backgroundColor: tokens.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
          fillerColor: tokens.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
          handleStyle: { color: tokens.muted, borderColor: tokens.border },
          moveHandleStyle: { color: tokens.muted },
          textStyle: { color: tokens.muted, fontSize: 10 },
        },
      ],

      xAxis: {
        type: 'time' as const,
        // Solid hairlines only. Dashed grid reads as "projection" or
        // "threshold" when it is just a grid.
        axisLine: { lineStyle: { color: tokens.grid, width: 1 } },
        axisTick: { show: false },
        axisLabel: { color: tokens.muted, fontSize: 11, hideOverlap: true },
        splitLine: { show: false },
      },

      yAxis: {
        type: 'value' as const,
        // NOT zero-based: price movement of a few percent on a six-figure
        // product would be invisible against a zero baseline.
        scale: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: tokens.muted,
          fontSize: 11,
          // tabular-nums where numbers stack vertically.
          fontFamily: 'ui-monospace, monospace',
          /*
           * TWO decimals, not one.
           *
           * Price charts are zoomed to a narrow band (yAxis.scale = true), so
           * on a six-figure product every tick sits within a few percent of
           * its neighbours. At one decimal, en-IN compact renders 1,00,984 and
           * 1,10,000 BOTH as "1.1L" — six ticks, one repeated label, an axis
           * that tells the reader nothing. Caught by rendering it; no colour
           * or type check would have.
           */
          formatter: (value: number) =>
            new Intl.NumberFormat('en-IN', {
              notation: 'compact',
              maximumFractionDigits: 2,
            }).format(value / 100),
        },
        splitLine: {
          lineStyle: { color: tokens.grid, width: 1, opacity: 0.6 },
        },
      },

      series: shown.map((entry) => {
        const color = seriesColor(entry.platform, tokens);
        return {
          name: PLATFORM_LABEL[entry.platform],
          type: 'line' as const,
          // THE HONESTY SETTING. The API emits null for days with no
          // observation; connectNulls:true would draw a confident straight
          // line across a two-week outage and invent prices we never saw.
          connectNulls: false,
          showSymbol: false,
          // Hover target is generous even though symbols are hidden.
          symbolSize: 8,
          sampling: 'lttb' as const,
          smooth: false,
          lineStyle: { width: 2, color },
          itemStyle: {
            color,
            // 2px surface ring so overlapping markers stay separable.
            borderColor: tokens.surface,
            borderWidth: 2,
          },
          emphasis: { focus: 'series' as const },
          areaStyle: {
            // Thin, low-opacity fill. A saturated block at this size reads
            // loud and buries the line that carries the actual information.
            opacity: 0.12,
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color },
              { offset: 1, color: 'transparent' },
            ]),
          },
          data: entry.points,
        };
      }),
    };
  }, [shown, tokens]);

  return (
    <div
      // Dim on refetch rather than unmounting: no skeleton flash, no layout
      // jump when the user changes range.
      style={{ opacity: loading ? 0.55 : 1, transition: 'opacity 150ms' }}
    >
      <ReactECharts
        echarts={echarts}
        option={option}
        style={{ height, width: '100%' }}
        notMerge
        lazyUpdate
        opts={{ renderer: 'canvas' }}
      />
    </div>
  );
}
