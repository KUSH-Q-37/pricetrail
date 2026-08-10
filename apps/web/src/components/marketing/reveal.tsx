'use client';

import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

/**
 * Scroll-triggered reveal.
 *
 * A client component deliberately kept tiny. The landing page itself stays a
 * server component so its text is in the HTML a crawler receives — wrapping the
 * whole page in motion would make the entire subtree client-only and undo that.
 * Only the wrapper ships to the browser; the children are still server-rendered
 * and passed through.
 *
 * `once: true` matters. Re-animating every time a section scrolls back into
 * view reads as a glitch, not a flourish.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  // Honour the OS setting. Vestibular disorders make large motion genuinely
  // unpleasant, and "attractive" is not worth making someone ill — so the
  // content still appears, it just stops travelling.
  const reduced = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{
        duration: reduced ? 0.2 : 0.55,
        delay: reduced ? 0 : delay,
        // Custom bezier rather than a spring: content should settle, not
        // bounce. Bounce is playful; this page is asking to be trusted.
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      {children}
    </motion.div>
  );
}
