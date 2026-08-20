'use client';

import { useEffect, useRef } from 'react';

/**
 * The field behind the hero.
 *
 * WHAT IT DRAWS
 * -------------
 * Two things, in one canvas and one animation loop:
 *
 *   1. A perspective-projected point cloud with proximity links — a mesh that
 *      breathes in depth rather than sliding around a flat plane.
 *   2. Price-history ribbons drifting at fixed depths behind it. These are
 *      real random walks with the shape of real price data, not decorative
 *      squiggles, and they are the reason this belongs on THIS product rather
 *      than being a generic particle background.
 *
 * WHY NOT three.js
 * ----------------
 * It is not installed, and a background is a poor reason to add ~150kB gzipped
 * plus a WebGL context to a page whose entire argument is that it loads fast
 * and tells the truth. What is actually needed here is perspective projection
 * of a few hundred points, which is four lines of arithmetic. The 2D canvas
 * does the rest and degrades on hardware where WebGL would not run at all.
 *
 * WHY ONE CANVAS AND ONE LOOP
 * ---------------------------
 * Two components would mean two rAF callbacks, two resize observers and two
 * compositor layers fighting over the same 60fps. Everything below shares a
 * single frame budget and a single allocation.
 *
 * COST CONTROL
 * ------------
 * The loop stops completely when the section scrolls out of view or the tab is
 * hidden, the point count scales with viewport area, and device pixel ratio is
 * capped at 2 — beyond that a background field costs real battery to render at
 * a fidelity nobody is looking at.
 */

/* --- projection ---------------------------------------------------------- */

const Z_NEAR = 0.75;
const Z_FAR = 3.2;
/** Focal length in world units. Larger flattens the perspective. */
const FOCAL = 1.35;

/** Screen distance within which two points get a link drawn between them. */
const LINK_DISTANCE = 132;

/* --- deterministic randomness -------------------------------------------- */

/**
 * A seeded LCG rather than Math.random.
 *
 * The field has to survive a resize without reshuffling: rebuilding on
 * Math.random would teleport every point the moment someone drags a window
 * edge, which is far more distracting than the animation itself.
 */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

/**
 * A price walk: drifting trend plus noise, bounded.
 *
 * Deliberately not a sine wave. Price series have persistence — they trend for
 * a while and then turn — and a sine reads as decoration the instant you look
 * at it. The drift term is what produces the long flat stretches and sudden
 * runs that make these read as data.
 *
 * The tail is blended back to the head so the series can tile seamlessly; a
 * visible seam scrolling past every few seconds is worse than no ribbon.
 */
function priceWalk(rng: () => number, count: number): number[] {
  const values: number[] = [];
  let value = 0.5;
  let drift = (rng() - 0.5) * 0.01;

  for (let i = 0; i < count; i += 1) {
    drift = clamp(drift + (rng() - 0.5) * 0.006, -0.022, 0.022);
    value = clamp(value + drift + (rng() - 0.5) * 0.018, 0.06, 0.94);
    values.push(value);
  }

  // Ease the last eighth back toward the first sample so head meets tail.
  const blend = Math.max(2, Math.floor(count / 8));
  const head = values[0] as number;
  for (let i = 0; i < blend; i += 1) {
    const index = count - blend + i;
    const t = (i + 1) / blend;
    values[index] = (values[index] as number) * (1 - t) + head * t;
  }

  return values;
}

/* --- scene --------------------------------------------------------------- */

interface Point {
  x: number;
  y: number;
  z: number;
  /** World units per second along x. */
  vx: number;
  /** Vertical bob, so the field is never a rigid lattice sliding sideways. */
  bobAmp: number;
  bobFreq: number;
  bobPhase: number;
  /** Depth oscillation. This is what makes it read as 3D rather than layered. */
  zAmp: number;
  zFreq: number;
  zPhase: number;
}

interface Ribbon {
  values: number[];
  z: number;
  /** World units per second, leftward. */
  speed: number;
  /** Vertical placement in world units. */
  offsetY: number;
  amplitude: number;
  /** 0 = Amazon hue, 1 = Flipkart hue. */
  series: 0 | 1;
}

interface Palette {
  point: string;
  link: string;
  amazon: string;
  flipkart: string;
}

/** World half-width the points roam across, in units of the vertical half-height. */
const WORLD_HALF_WIDTH = 2.6;

function buildPoints(count: number): Point[] {
  const rng = makeRng(0x5f3a91);
  const points: Point[] = [];

  for (let i = 0; i < count; i += 1) {
    points.push({
      x: (rng() * 2 - 1) * WORLD_HALF_WIDTH,
      y: (rng() * 2 - 1) * 1.15,
      z: Z_NEAR + rng() * (Z_FAR - Z_NEAR),
      vx: (rng() * 2 - 1) * 0.035,
      bobAmp: 0.02 + rng() * 0.05,
      bobFreq: 0.09 + rng() * 0.16,
      bobPhase: rng() * Math.PI * 2,
      zAmp: 0.12 + rng() * 0.3,
      zFreq: 0.05 + rng() * 0.1,
      zPhase: rng() * Math.PI * 2,
    });
  }

  return points;
}

function buildRibbons(): Ribbon[] {
  const rng = makeRng(0x2c81ff);

  // Four, at clearly separated depths. Fewer reads as an accident; more and
  // they start to cross-hatch and stop looking like individual series.
  return [
    { values: priceWalk(rng, 88), z: 2.85, speed: 0.052, offsetY: -0.34, amplitude: 0.34, series: 0 },
    { values: priceWalk(rng, 88), z: 2.4, speed: 0.07, offsetY: 0.26, amplitude: 0.4, series: 1 },
    { values: priceWalk(rng, 88), z: 1.85, speed: 0.096, offsetY: -0.05, amplitude: 0.46, series: 0 },
    { values: priceWalk(rng, 88), z: 1.35, speed: 0.13, offsetY: 0.42, amplitude: 0.3, series: 1 },
  ];
}

export function AmbientCanvas({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;
    const ctx = context;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    const points = buildPoints(1);
    const ribbons = buildRibbons();

    let width = 0;
    let height = 0;
    let dpr = 1;
    let frame: number | undefined;
    let running = false;
    let visible = true;
    let onScreen = true;
    /** Scene clock in seconds. Held separately from wall time so a pause does
        not fast-forward the whole field when the tab comes back. */
    let clock = 0;
    let lastTs = 0;

    let palette: Palette = {
      point: '#6b7280',
      link: '#6b7280',
      amazon: '#d1780f',
      flipkart: '#2275e8',
    };

    /**
     * Colours come from the live CSS custom properties, never from constants
     * here. That is what lets a theme switch AND an accent switch repaint the
     * field without this file knowing either exists.
     *
     * Values are read as computed strings and handed straight to the canvas —
     * oklch() included, which every browser supporting the palette also accepts
     * in a 2D context. Alpha is applied via globalAlpha rather than baked into
     * the colour, so the format never has to be parsed.
     */
    const readPalette = (): void => {
      const style = getComputedStyle(document.documentElement);
      const read = (name: string, fallback: string): string =>
        style.getPropertyValue(name).trim() || fallback;

      palette = {
        point: read('--primary', '#6b7280'),
        link: read('--foreground', '#6b7280'),
        amazon: read('--chart-amazon', '#d1780f'),
        flipkart: read('--chart-flipkart', '#2275e8'),
      };
    };

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      width = rect.width;
      height = rect.height;
      // Capped at 2. A background field at DPR 3 costs 2.25x the fill rate of
      // DPR 2 to render detail nobody is looking at.
      dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Point count scales with area so a phone does not run the same field as
      // a 5K display, and is hard-capped because the link pass is O(n^2).
      const target = clamp(Math.round((width * height) / 15000), 34, 104);
      if (target > points.length) {
        points.push(...buildPoints(target).slice(points.length));
      } else if (target < points.length) {
        points.length = target;
      }
    };

    /* --- drawing ------------------------------------------------------- */

    const draw = (): void => {
      const cx = width / 2;
      const cy = height / 2;
      // One world unit = half the viewport height, so the field scales with the
      // section rather than with the window.
      const unit = height / 2;

      ctx.clearRect(0, 0, width, height);

      /* --- ribbons (far, behind everything) --------------------------- */
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (const ribbon of ribbons) {
        const scale = FOCAL / ribbon.z;
        const span = WORLD_HALF_WIDTH * 2;
        // Wrap into [-span, 0) so the two passes below always straddle the view.
        const shift = -(((clock * ribbon.speed) % span) + span) % span;

        ctx.strokeStyle = ribbon.series === 0 ? palette.amazon : palette.flipkart;
        ctx.lineWidth = Math.max(1, 1.6 * scale);
        // Nearer ribbons are stronger, which is what sells them as depth rather
        // than as four lines of different opacity.
        ctx.globalAlpha = 0.1 + (1 - (ribbon.z - Z_NEAR) / (Z_FAR - Z_NEAR)) * 0.16;

        // Drawn twice, one span apart. The walk's tail is blended to its head,
        // so the join is invisible and the ribbon scrolls forever.
        for (let pass = 0; pass < 2; pass += 1) {
          const originX = shift + pass * span;

          ctx.beginPath();
          for (let i = 0; i < ribbon.values.length; i += 1) {
            const t = i / (ribbon.values.length - 1);
            const worldX = -WORLD_HALF_WIDTH + originX + t * span;
            const worldY =
              ribbon.offsetY + ((ribbon.values[i] as number) - 0.5) * ribbon.amplitude;

            const sx = cx + worldX * scale * unit;
            const sy = cy + worldY * scale * unit;

            if (i === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
          }
          ctx.stroke();
        }
      }

      /* --- point cloud -------------------------------------------------- */
      // Projected once into these parallel arrays, because the link pass needs
      // every point's screen position and re-projecting inside the O(n^2) loop
      // would do the same arithmetic n times over.
      const count = points.length;
      const sx = new Float32Array(count);
      const sy = new Float32Array(count);
      const depth = new Float32Array(count);

      for (let i = 0; i < count; i += 1) {
        const point = points[i] as Point;

        const z = point.z + Math.sin(clock * point.zFreq + point.zPhase) * point.zAmp;
        const safeZ = Math.max(0.35, z);
        const scale = FOCAL / safeZ;

        const worldY = point.y + Math.sin(clock * point.bobFreq + point.bobPhase) * point.bobAmp;

        sx[i] = cx + point.x * scale * unit;
        sy[i] = cy + worldY * scale * unit;
        // 0 at the back, 1 at the front.
        depth[i] = clamp(1 - (safeZ - Z_NEAR) / (Z_FAR - Z_NEAR), 0, 1);
      }

      /* --- links -------------------------------------------------------- */
      // Before the dots, so a dot always sits on top of the lines it anchors.
      ctx.strokeStyle = palette.link;
      ctx.lineWidth = 1;

      for (let i = 0; i < count; i += 1) {
        for (let j = i + 1; j < count; j += 1) {
          const dx = (sx[i] as number) - (sx[j] as number);
          const dy = (sy[i] as number) - (sy[j] as number);
          // Squared comparison first: sqrt on every pair is the single most
          // expensive thing in this loop and most pairs fail the test.
          const distanceSq = dx * dx + dy * dy;
          if (distanceSq > LINK_DISTANCE * LINK_DISTANCE) continue;

          const distance = Math.sqrt(distanceSq);
          const closeness = 1 - distance / LINK_DISTANCE;
          const near = ((depth[i] as number) + (depth[j] as number)) / 2;

          ctx.globalAlpha = closeness * closeness * 0.16 * (0.35 + near * 0.65);
          ctx.beginPath();
          ctx.moveTo(sx[i] as number, sy[i] as number);
          ctx.lineTo(sx[j] as number, sy[j] as number);
          ctx.stroke();
        }
      }

      /* --- dots --------------------------------------------------------- */
      ctx.fillStyle = palette.point;

      for (let i = 0; i < count; i += 1) {
        const near = depth[i] as number;
        const radius = 0.7 + near * 1.7;

        ctx.globalAlpha = 0.14 + near * 0.42;
        ctx.beginPath();
        ctx.arc(sx[i] as number, sy[i] as number, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = 1;
    };

    /* --- loop ---------------------------------------------------------- */

    const step = (timestamp: number): void => {
      // Clamped to ~3 frames. Without this, returning to a backgrounded tab
      // delivers one enormous delta and the whole field jumps.
      const delta = lastTs === 0 ? 0 : Math.min((timestamp - lastTs) / 1000, 0.05);
      lastTs = timestamp;
      clock += delta;

      for (const point of points) {
        point.x += point.vx * delta;
        // Wrap well outside the frustum so a point never pops in mid-view.
        if (point.x > WORLD_HALF_WIDTH) point.x -= WORLD_HALF_WIDTH * 2;
        else if (point.x < -WORLD_HALF_WIDTH) point.x += WORLD_HALF_WIDTH * 2;
      }

      draw();
      frame = requestAnimationFrame(step);
    };

    const start = (): void => {
      if (running || reduceMotion.matches) return;
      running = true;
      lastTs = 0;
      frame = requestAnimationFrame(step);
    };

    const stop = (): void => {
      running = false;
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
    };

    /** Only run when the canvas is both on screen and in a visible tab. */
    const sync = (): void => {
      if (visible && onScreen) start();
      else stop();
    };

    /* --- wiring -------------------------------------------------------- */

    readPalette();
    resize();
    draw();

    const resizeObserver = new ResizeObserver(() => {
      resize();
      // Repaint immediately: while the loop is stopped (reduced motion, or off
      // screen mid-resize) nothing else would redraw at the new size.
      draw();
    });
    resizeObserver.observe(canvas);

    // Repaint on theme or accent change. The palette lives in CSS, so this
    // component finds out the same way anything else would — by watching the
    // attribute that selects it.
    const themeObserver = new MutationObserver(() => {
      readPalette();
      draw();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-accent'],
    });

    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        onScreen = entries.some((entry) => entry.isIntersecting);
        sync();
      },
      { rootMargin: '96px' },
    );
    intersectionObserver.observe(canvas);

    const onVisibility = (): void => {
      visible = document.visibilityState === 'visible';
      sync();
    };
    document.addEventListener('visibilitychange', onVisibility);

    // A user can turn reduced motion on while the page is open. Honour it
    // immediately rather than at the next reload — the setting is an
    // accommodation, and "after you refresh" is not an acceptable latency.
    const onMotionPreference = (): void => {
      if (reduceMotion.matches) {
        stop();
        draw();
      } else {
        sync();
      }
    };
    reduceMotion.addEventListener('change', onMotionPreference);

    sync();

    return () => {
      stop();
      resizeObserver.disconnect();
      themeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      reduceMotion.removeEventListener('change', onMotionPreference);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className ?? 'ambient-canvas'}
      // Purely decorative and duplicates nothing. Announcing it would put "a
      // canvas" between a screen reader user and the headline for no gain.
      aria-hidden="true"
      role="presentation"
    />
  );
}
