/** A daily slot. `value` is null when no observation was recorded that day. */
export interface SeriesPoint {
  t: number;
  value: number | null;
}

/**
 * Largest-Triangle-Three-Buckets downsampling.
 *
 * Chosen over naive nth-point sampling because LTTB preserves visual EXTREMES.
 * Taking every 4th point on a year of prices will eventually skip the one day a
 * product dropped 40% — the single most interesting fact in the chart — and the
 * result looks smooth and plausible, so nobody notices the deletion. LTTB keeps
 * whichever point forms the largest triangle with its neighbours, which is
 * exactly the peaks and troughs a price chart exists to show.
 */
function lttb(points: Array<{ t: number; value: number }>, threshold: number): Array<{ t: number; value: number }> {
  if (threshold >= points.length || threshold < 3) return points;

  const sampled: Array<{ t: number; value: number }> = [];
  const bucketSize = (points.length - 2) / (threshold - 2);

  // First point is always kept.
  sampled.push(points[0]!);
  let a = 0;

  for (let i = 0; i < threshold - 2; i++) {
    const rangeStart = Math.floor((i + 1) * bucketSize) + 1;
    const rangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, points.length);

    // Average of the NEXT bucket forms the third triangle vertex.
    let avgT = 0;
    let avgValue = 0;
    let count = 0;
    for (let j = rangeStart; j < rangeEnd; j++) {
      avgT += points[j]!.t;
      avgValue += points[j]!.value;
      count++;
    }
    if (count === 0) continue;
    avgT /= count;
    avgValue /= count;

    const currentStart = Math.floor(i * bucketSize) + 1;
    const currentEnd = Math.floor((i + 1) * bucketSize) + 1;

    const pointA = points[a]!;
    let maxArea = -1;
    let chosen = currentStart;

    for (let j = currentStart; j < Math.min(currentEnd, points.length); j++) {
      const point = points[j]!;
      const area = Math.abs(
        (pointA.t - avgT) * (point.value - pointA.value) -
          (pointA.t - point.t) * (avgValue - pointA.value),
      );
      if (area > maxArea) {
        maxArea = area;
        chosen = j;
      }
    }

    sampled.push(points[chosen]!);
    a = chosen;
  }

  sampled.push(points[points.length - 1]!);
  return sampled;
}

/**
 * Downsample a series that contains gaps.
 *
 * Runs LTTB over each contiguous run of observations INDEPENDENTLY, then
 * re-inserts the nulls between them. Running it across a null would let the
 * algorithm draw a triangle spanning the gap and quietly bridge it — turning a
 * period where we recorded nothing into a smooth, confident line. That is the
 * one thing this chart must never do.
 */
export function downsampleWithGaps(points: SeriesPoint[], threshold: number): SeriesPoint[] {
  if (points.length <= threshold) return points;

  // Split into runs of consecutive non-null observations.
  const runs: Array<{ startIndex: number; values: Array<{ t: number; value: number }> }> = [];
  let current: Array<{ t: number; value: number }> = [];
  let startIndex = 0;

  points.forEach((point, index) => {
    if (point.value === null) {
      if (current.length > 0) {
        runs.push({ startIndex, values: current });
        current = [];
      }
    } else {
      if (current.length === 0) startIndex = index;
      current.push({ t: point.t, value: point.value });
    }
  });
  if (current.length > 0) runs.push({ startIndex, values: current });

  const observed = runs.reduce((sum, run) => sum + run.values.length, 0);
  if (observed <= threshold) return points;

  // Budget each run proportionally to its size, with a floor of 2 so a short
  // run is never collapsed out of existence.
  const output: SeriesPoint[] = [];
  let lastEmittedIndex = -1;

  for (const run of runs) {
    const budget = Math.max(2, Math.round((run.values.length / observed) * threshold));
    const reduced = lttb(run.values, budget);

    // Preserve one null between runs so the renderer breaks the line.
    if (lastEmittedIndex >= 0) {
      output.push({ t: points[run.startIndex - 1]?.t ?? run.values[0]!.t, value: null });
    }
    for (const point of reduced) output.push(point);
    lastEmittedIndex = run.startIndex;
  }

  return output;
}
