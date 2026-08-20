'use client';

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

import { formatPrice } from '@/lib/utils';

/**
 * A price that counts to its value on arrival.
 *
 * WHY ONLY A PRICE, AND WHY QUICKLY
 * ---------------------------------
 * A number that ticks upward reads as a number being computed. For most values
 * that is a harmless flourish; for a price it is a small lie, because this one
 * was observed rather than derived. So the count is fast and lands — 0.9s,
 * easing hard into the real figure. Anything slower stops looking like a value
 * resolving and starts looking like a slot machine, which is a strange note to
 * strike on a page whose entire argument is "here is what this actually cost".
 *
 * It counts from a floor near the target rather than from zero. Sweeping
 * 0 -> 45,990 crosses four orders of magnitude and every digit column changes,
 * which is a lot of movement to say one thing. Starting at 88% travels the
 * distance that carries meaning and none of the distance that does not.
 */
export function CountUp({
  valueMinor,
  currency,
  className,
}: {
  valueMinor: number;
  currency: string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(valueMinor);
  const frame = useRef<number | undefined>(undefined);

  useEffect(() => {
    // The setting is a medical accommodation, not a preference: land on the
    // value immediately and never animate.
    if (reduced) {
      setDisplay(valueMinor);
      return;
    }

    const DURATION = 900;
    const from = Math.round(valueMinor * 0.88);
    const start = performance.now();

    const tick = (nowMs: number): void => {
      const t = Math.min(1, (nowMs - start) / DURATION);
      // easeOutExpo: nearly all the distance is covered early, so the number
      // is legible for most of the animation instead of blurring past.
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);

      setDisplay(Math.round(from + (valueMinor - from) * eased));
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };

    frame.current = requestAnimationFrame(tick);

    return () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    };
  }, [valueMinor, reduced]);

  return (
    <span className={className}>
      {/*
        The animating digits are hidden from assistive technology, and the real
        value is announced once. A screen reader reading sixty intermediate
        numbers would be actively worse than no animation at all.
      */}
      <span aria-hidden="true" className="count-up">
        {formatPrice(display, currency)}
      </span>
      <span className="sr-only">{formatPrice(valueMinor, currency)}</span>
    </span>
  );
}
