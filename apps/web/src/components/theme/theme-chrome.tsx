'use client';

import { useEffect } from 'react';

/**
 * Keeps the browser's own chrome in step with the active theme.
 *
 * WHY THIS IS NOT JUST A `viewport.themeColor` EXPORT
 * ---------------------------------------------------
 * Next's static export can only branch on `prefers-color-scheme`, which is the
 * OS preference — not the theme the user actually chose in this app. Someone on
 * a light OS who picks Midnight would get a near-black page framed by a
 * light-tinted status bar on iOS. The old single-theme code called that seam
 * out by name, and it is more visible now that there are three themes rather
 * than fewer.
 *
 * So the static export stays as a sensible pre-hydration default, and this
 * syncs it to the truth once a theme is applied.
 *
 * It reads the COMPUTED --background rather than a table of hex values kept in
 * this file, so a palette change in globals.css cannot leave the status bar
 * behind. The observer is on the attribute, so it also catches an OS-driven
 * `system` flip, which no React state in this component would see.
 */
export function ThemeChrome() {
  useEffect(() => {
    const root = document.documentElement;

    const sync = (): void => {
      // getComputedStyle resolves oklch() to a real colour string. Safari once
      // needed a hex here; every browser that supports oklch (which the whole
      // palette requires) accepts the computed form in a meta tag.
      const background = getComputedStyle(root).getPropertyValue('background-color').trim();
      if (!background) return;

      // There may be several from the static export's media-query pair. They
      // all have to move, or whichever one matches the OS wins and undoes this.
      const tags = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');

      if (tags.length === 0) {
        const meta = document.createElement('meta');
        meta.name = 'theme-color';
        meta.content = background;
        document.head.appendChild(meta);
        return;
      }

      tags.forEach((tag) => {
        // Drop the media constraint: once the user has expressed a choice in
        // the app, the OS preference is no longer the thing to follow.
        tag.removeAttribute('media');
        tag.content = background;
      });
    };

    sync();

    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });

    return () => observer.disconnect();
  }, []);

  return null;
}

/**
 * Enables colour transitions, but only after the first paint.
 *
 * globals.css scopes its `transition: background-color …` rule to
 * `[data-theme-ready]`. Without that guard the initial render would ANIMATE
 * from the default palette to the user's stored one — a visible half-second
 * wash on every page load, which is precisely the flash the pre-hydration
 * scripts exist to prevent.
 *
 * Setting the attribute in an effect rather than in the head script is what
 * guarantees the ordering: effects run after paint, so the first frame is
 * always transition-free and every subsequent switch crossfades.
 */
export function ThemeReady() {
  useEffect(() => {
    document.documentElement.setAttribute('data-theme-ready', '');
  }, []);

  return null;
}
