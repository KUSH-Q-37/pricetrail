/**
 * Reading-progress bar across the top of the page.
 *
 * NO 'use client', NO JAVASCRIPT AT ALL.
 *
 * This is driven entirely by `animation-timeline: scroll(root block)` — see
 * `.scroll-progress` in globals.css. A scroll listener would be the obvious
 * implementation and the wrong one: it runs on the main thread, fires far more
 * often than it paints, and forces a layout read on every event to find the
 * document height. The native scroll timeline runs on the compositor, and it
 * costs one server-rendered <div> to use.
 *
 * WHY IT IS SAFE TO SHIP UNSUPPORTED
 * ----------------------------------
 * Where `animation-timeline` is missing the bar sits at scaleX(0) and is simply
 * never visible. That is acceptable ONLY because the bar is decorative and
 * duplicates no information — the scrollbar already says the same thing. If it
 * carried anything a reader needed, this would have to be a client component
 * with a real fallback.
 */
export function ScrollProgress() {
  return (
    <div
      // Fixed and above the sticky header, which is z-30.
      className="pointer-events-none fixed inset-x-0 top-0 z-40 h-0.5"
      aria-hidden="true"
    >
      <div className="scroll-progress h-full bg-gradient-to-r from-primary/40 via-primary to-primary/40" />
    </div>
  );
}
