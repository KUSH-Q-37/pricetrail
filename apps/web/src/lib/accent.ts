/**
 * Accent configuration — shared by the server layout and the client provider.
 *
 * WHY THIS IS ITS OWN MODULE, WITH NO 'use client'
 * ------------------------------------------------
 * The root layout is a server component and has to emit ACCENT_SCRIPT into
 * <head>. Exports from a `'use client'` module are not values on the server —
 * they are client REFERENCES — so importing this string from the provider file
 * would hand the layout a proxy where it expected script text.
 *
 * A module with no directive is genuinely shared: the server reads the real
 * values, and the client bundle gets them too.
 *
 * Accent is kept separate from theme throughout. They look like the same
 * problem — a string on <html>, persisted, applied before paint — but they are
 * ORTHOGONAL: picking a new accent must not disturb which theme you are in, and
 * switching to dark must not reset your accent. Crossing them into one value
 * ("dark-amber", "light-rose", …) makes every change a two-dimensional lookup
 * and makes `system` mean fifteen things.
 *
 * There is deliberately no `system` accent. The OS exposes a light/dark
 * preference; it does not expose "this person likes green", so an accent has no
 * sensible automatic value and always represents an explicit choice.
 */

export const ACCENTS = [
  { value: 'indigo', label: 'Indigo' },
  { value: 'violet', label: 'Violet' },
  { value: 'emerald', label: 'Emerald' },
  { value: 'amber', label: 'Amber' },
  { value: 'rose', label: 'Rose' },
] as const;

export type Accent = (typeof ACCENTS)[number]['value'];

export const DEFAULT_ACCENT: Accent = 'indigo';

export const ACCENT_STORAGE_KEY = 'pricetrail-accent';

const ACCENT_VALUES: readonly string[] = ACCENTS.map((accent) => accent.value);

export function isAccent(value: unknown): value is Accent {
  return typeof value === 'string' && ACCENT_VALUES.includes(value);
}

/**
 * Runs before first paint, in <head>, ahead of React.
 *
 * Without it the server sends no `data-accent`, the CSS falls back to indigo,
 * and a user who chose rose watches the page repaint from blue to rose the
 * instant hydration lands. That flash is the entire reason this is an inline
 * blocking script rather than an effect.
 *
 * Written as a string because it must execute before the bundle exists. It is
 * deliberately tiny and dependency-free — every byte here is render-blocking.
 *
 * The try/catch is not decorative: localStorage throws outright in Safari's
 * private mode and under some enterprise cookie policies, and an uncaught throw
 * in a head script would take the whole document down.
 *
 * Everything interpolated is JSON.stringify'd from module constants. No user
 * input reaches this string, so there is nothing for an injection to ride in
 * on — and stringify keeps it that way if the list ever gains an odd character.
 */
export const ACCENT_SCRIPT = `(function(){try{var v=${JSON.stringify(
  ACCENT_VALUES,
)},a=localStorage.getItem(${JSON.stringify(
  ACCENT_STORAGE_KEY,
)});document.documentElement.setAttribute("data-accent",v.indexOf(a)>-1?a:${JSON.stringify(
  DEFAULT_ACCENT,
)})}catch(e){document.documentElement.setAttribute("data-accent",${JSON.stringify(
  DEFAULT_ACCENT,
)})}})();`;
