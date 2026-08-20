'use client';

import { motion, useMotionValue, useReducedMotion, useSpring } from 'framer-motion';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A control that leans toward the cursor as it approaches.
 *
 * WHY THIS IS SAFE ON A PRIMARY ACTION
 * ------------------------------------
 * Magnetic buttons have a bad reputation, deservedly: done at full strength
 * they move the target away from where the user aimed, which is a Fitts's law
 * violation dressed up as delight. The two things that make it acceptable here:
 *
 *   - The pull is a FRACTION of the cursor's offset (0.22 by default), so the
 *     button always moves toward the pointer and never away from it. The gap
 *     closes; it never opens.
 *   - Travel is hard-capped, so the hit area and the visual never separate by
 *     more than a few pixels however fast the pointer moves.
 *
 * POINTER, NOT MOUSE
 * ------------------
 * Bound to pointer events and gated on `(hover: hover)`. On a touch screen
 * there is no cursor to be attracted to, and pointerdown would fire the whole
 * animation on tap — a button that jumps as you press it feels broken, not
 * lively.
 */
export function Magnetic({
  children,
  strength = 0.22,
  maxTravel = 9,
  className,
}: {
  children: ReactNode;
  /** Fraction of the pointer's offset the element follows. Keep below 0.35. */
  strength?: number;
  /** Hard cap in pixels, so the visual never leaves its own hit area. */
  maxTravel?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  const [enabled, setEnabled] = useState(false);

  const x = useMotionValue(0);
  const y = useMotionValue(0);

  // A spring rather than a transition: the release has to settle rather than
  // snap, and a spring gives the weight that makes this read as a physical
  // object instead of a CSS ease.
  const springX = useSpring(x, { stiffness: 240, damping: 18, mass: 0.6 });
  const springY = useSpring(y, { stiffness: 240, damping: 18, mass: 0.6 });

  // Coarse pointers get nothing. Checked in an effect rather than at render so
  // the server and the first client render agree.
  useEffect(() => {
    const query = window.matchMedia('(hover: hover) and (pointer: fine)');
    const update = () => setEnabled(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const active = enabled && !reduced;

  const onPointerMove = (event: React.PointerEvent<HTMLSpanElement>) => {
    if (!active) return;
    const element = ref.current;
    if (!element) return;

    const rect = element.getBoundingClientRect();
    const offsetX = event.clientX - (rect.left + rect.width / 2);
    const offsetY = event.clientY - (rect.top + rect.height / 2);

    const clamp = (value: number) =>
      Math.max(-maxTravel, Math.min(maxTravel, value * strength));

    x.set(clamp(offsetX));
    y.set(clamp(offsetY));
  };

  const reset = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.span
      ref={ref}
      onPointerMove={onPointerMove}
      onPointerLeave={reset}
      // Released on press as well as on leave. Without this the element stays
      // displaced under the finger through a click, and the ripple of a
      // navigation starting while the button is still off-centre reads as a
      // misfire.
      onPointerDown={reset}
      style={active ? { x: springX, y: springY } : undefined}
      className={className ?? 'inline-flex'}
    >
      {children}
    </motion.span>
  );
}
