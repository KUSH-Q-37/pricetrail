'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, Monitor, Moon, Palette, Stars, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useId, useRef, useState } from 'react';

import { useAccent } from '@/components/theme/accent';
import { ACCENTS, type Accent } from '@/lib/accent';
import { cn } from '@/lib/utils';

/**
 * Theme and accent control.
 *
 * ONE POPOVER, TWO CHOICES
 * ------------------------
 * Theme and accent are separate settings (see accent.tsx) but they are one
 * DECISION — "how should this look" — and splitting them into two controls in
 * the header would put two low-frequency buttons where the product wants
 * attention on a search box. They share a surface and stay distinct inside it.
 *
 * Both groups are radiogroups rather than menus. The semantics matter: a menu
 * announces a list of actions, a radiogroup announces a set of options with one
 * currently chosen, which is what these are. A screen reader user gets "Dark,
 * radio button, 3 of 4, selected" instead of having to hunt for the current
 * value.
 */

const THEMES = [
  { value: 'system', label: 'System', Icon: Monitor, hint: 'Follow the OS' },
  { value: 'light', label: 'Light', Icon: Sun, hint: 'Warm off-white' },
  { value: 'dark', label: 'Dark', Icon: Moon, hint: 'Neutral, quiet' },
  { value: 'midnight', label: 'Midnight', Icon: Stars, hint: 'Deep and cool' },
] as const;

export function ThemePicker({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const { accent, setAccent } = useAccent();
  const reduced = useReducedMotion();

  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  // next-themes cannot know the stored theme on the server, so the selected
  // state is unknowable during the first render. Rendering it anyway is the
  // classic next-themes hydration mismatch; showing nothing selected until
  // mount is the documented answer.
  useEffect(() => setMounted(true), []);

  // Click outside and Escape. Both, because either one alone leaves a way to
  // get stuck: mouse users who click away expect it gone, keyboard users who
  // press Escape expect focus back on the trigger.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      // Returning focus is the part that is usually missed. Without it focus
      // falls back to <body> and the next Tab restarts from the top of the page.
      triggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        aria-label="Appearance"
        className={cn(
          'inline-flex size-9 items-center justify-center rounded-lg border border-border',
          'bg-card/60 text-muted-foreground backdrop-blur-sm',
          'transition-all duration-200 hover:border-primary/40 hover:text-foreground',
          open && 'border-primary/40 text-foreground',
        )}
      >
        <Palette className="size-4" aria-hidden="true" />
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            id={panelId}
            role="dialog"
            aria-label="Appearance"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: reduced ? 0.12 : 0.18, ease: [0.22, 1, 0.36, 1] }}
            // Right-anchored: the trigger lives at the right edge of a header,
            // so a left-anchored panel would hang off the viewport on mobile.
            className={cn(
              'glass edge-light absolute right-0 top-full z-50 mt-2 w-60 origin-top-right',
              'rounded-xl border border-border p-3 shadow-[var(--shadow-lg)]',
            )}
          >
            {/* --- theme ------------------------------------------------- */}
            <p className="px-1 pb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Theme
            </p>

            <div role="radiogroup" aria-label="Theme" className="flex flex-col gap-0.5">
              {THEMES.map(({ value, label, Icon, hint }) => {
                const selected = mounted && theme === value;

                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setTheme(value)}
                    className={cn(
                      'group flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left',
                      'transition-colors duration-150 hover:bg-accent',
                      selected && 'bg-accent',
                    )}
                  >
                    <Icon
                      className={cn(
                        'size-4 shrink-0 transition-colors',
                        selected ? 'text-primary' : 'text-muted-foreground',
                      )}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm leading-tight">{label}</span>
                      <span className="block text-[11px] leading-tight text-muted-foreground">
                        {hint}
                      </span>
                    </span>
                    {selected ? (
                      <Check className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                    ) : null}
                  </button>
                );
              })}
            </div>

            {/* --- accent ------------------------------------------------ */}
            <p className="mt-3 border-t border-border px-1 pb-2 pt-3 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Accent
            </p>

            <div
              role="radiogroup"
              aria-label="Accent colour"
              className="flex items-center gap-1.5 px-1 pb-1"
            >
              {ACCENTS.map(({ value, label }) => {
                const selected = accent === value;

                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={label}
                    title={label}
                    onClick={() => setAccent(value as Accent)}
                    // The swatch carries data-accent so its own hue variables
                    // resolve locally — see .accent-swatch in globals.css. That
                    // is what keeps the five hues defined in exactly one place
                    // instead of being duplicated into this file as hex.
                    data-accent={value}
                    className={cn(
                      'grid size-7 place-items-center rounded-full transition-transform duration-150',
                      'hover:scale-110 focus-visible:scale-110',
                      selected && 'ring-2 ring-offset-2',
                    )}
                    style={
                      selected
                        ? {
                            // Ring in the accent itself, offset against the
                            // panel. Using the token would give every swatch
                            // the CURRENT accent's ring, which is confusing at
                            // the moment of switching.
                            ['--tw-ring-color' as string]:
                              'oklch(var(--accent-l) var(--accent-c) var(--accent-h))',
                            ['--tw-ring-offset-color' as string]: 'var(--card)',
                          }
                        : undefined
                    }
                  >
                    <span className="accent-swatch size-4 rounded-full" aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
