'use client';

import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'framer-motion';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * A surface that tips toward the pointer, with a highlight that tracks it.
 *
 * WHY THE GLARE MATTERS MORE THAN THE ROTATION
 * --------------------------------------------
 * Rotation alone reads as a card being turned. Rotation plus a light source
 * that stays PUT while the card turns under it reads as a physical object,
 * because that is the cue the eye actually uses to infer a surface angle. The
 * glare is a radial gradient positioned at the pointer, and it is doing most of
 * the work here — the rotation is only 6 degrees.
 *
 * KEEPING IT OFF THE TEXT
 * -----------------------
 * The tilt is small on purpose. Anything past about 8 degrees starts to shear
 * the type badly enough that a reader notices the distortion rather than the
 * effect, and this card carries prices — numbers someone is meant to read
 * precisely, not admire.
 *
 * The whole thing is inert on touch and under reduced motion, where it renders
 * as a completely ordinary static card.
 */
export function Tilt({
  children,
  className,
  /** Maximum rotation in degrees on either axis. */
  max = 6,
  glare = true,
}: {
  children: ReactNode;
  className?: string;
  max?: number;
  glare?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [enabled, setEnabled] = useState(false);

  // Pointer position within the element, normalised to -0.5..0.5.
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  // ...and 0..1, for positioning the glare.
  const gx = useMotionValue(50);
  const gy = useMotionValue(50);

  const spring = { stiffness: 200, damping: 22, mass: 0.5 };
  // Y position drives rotation about X, and vice versa — that inversion is what
  // makes the near edge come toward you rather than away.
  const rotateX = useSpring(useTransform(py, [-0.5, 0.5], [max, -max]), spring);
  const rotateY = useSpring(useTransform(px, [-0.5, 0.5], [-max, max]), spring);
  const glareOpacity = useSpring(useMotionValue(0), { stiffness: 160, damping: 24 });

  const glareBackground = useMotionTemplate`radial-gradient(circle at ${gx}% ${gy}%, color-mix(in oklab, var(--foreground) 14%, transparent), transparent 55%)`;

  useEffect(() => {
    const query = window.matchMedia('(hover: hover) and (pointer: fine)');
    const update = () => setEnabled(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const active = enabled && !reduced;

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!active) return;
    const element = ref.current;
    if (!element) return;

    const rect = element.getBoundingClientRect();
    const nx = (event.clientX - rect.left) / rect.width;
    const ny = (event.clientY - rect.top) / rect.height;

    px.set(nx - 0.5);
    py.set(ny - 0.5);
    gx.set(nx * 100);
    gy.set(ny * 100);
    glareOpacity.set(1);
  };

  const reset = () => {
    px.set(0);
    py.set(0);
    glareOpacity.set(0);
  };

  if (!active) {
    return <div className={className}>{children}</div>;
  }

  return (
    // The perspective lives on the WRAPPER, not the rotating element. Set on
    // the element itself, each card would get its own vanishing point at its
    // own centre and a row of them would splay outward like a fan.
    <div style={{ perspective: 900 }} className="[transform-style:preserve-3d]">
      <motion.div
        ref={ref}
        onPointerMove={onPointerMove}
        onPointerLeave={reset}
        style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }}
        className={cn('relative', className)}
      >
        {children}

        {glare ? (
          <motion.span
            aria-hidden="true"
            style={{ background: glareBackground, opacity: glareOpacity }}
            // `inherit` so the highlight is clipped to whatever radius the card
            // it wraps happens to use, rather than hard-coding one here.
            className="pointer-events-none absolute inset-0 rounded-[inherit]"
          />
        ) : null}
      </motion.div>
    </div>
  );
}
