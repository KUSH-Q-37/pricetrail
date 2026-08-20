'use client';

import { motion, useReducedMotion, useScroll, useSpring, useTransform } from 'framer-motion';
import { useRef, type ReactNode } from 'react';

/**
 * Moves its children at a different rate to the page as it scrolls.
 *
 * DEPTH, NOT DECORATION
 * ---------------------
 * Parallax earns its place when different layers genuinely sit at different
 * distances — the ambient field furthest back, the hero card nearest. Applied
 * to a single element with nothing behind it, it is just content that scrolls
 * wrong.
 *
 * So `distance` is small and signed: negative for things that should feel
 * further away (they lag), positive for things that should feel nearer (they
 * lead). Anything past about 60px stops reading as depth and starts reading as
 * a scroll bug.
 *
 * WHY THE OFFSETS ARE WHAT THEY ARE
 * ---------------------------------
 * `['start end', 'end start']` tracks the element across the ENTIRE time it is
 * on screen, from first appearance at the bottom to disappearance at the top.
 * The commonly-copied `['start start', 'end end']` only progresses while the
 * element fills the viewport, which for a short element is never — the value
 * pins at 0 and nothing moves at all.
 */
export function Parallax({
  children,
  distance = -40,
  className,
}: {
  children: ReactNode;
  /** Pixels of travel across the full pass. Negative lags, positive leads. */
  distance?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  });

  // Smoothed, because raw scroll progress on a trackpad or a smooth-scrolling
  // mouse arrives in uneven steps and an element driven directly off it judders
  // against the page it is meant to be moving with.
  const eased = useSpring(scrollYProgress, {
    stiffness: 90,
    damping: 26,
    restDelta: 0.001,
  });

  const y = useTransform(eased, [0, 1], [-distance, distance]);

  // Travel is exactly the thing that causes trouble for a vestibular disorder,
  // so this is not softened under the preference — it is removed. A plain div
  // rather than a motion one, so no transform is written at all.
  if (reduced) {
    return (
      <div ref={ref} className={className}>
        {children}
      </div>
    );
  }

  return (
    <motion.div ref={ref} style={{ y }} className={className}>
      {children}
    </motion.div>
  );
}
