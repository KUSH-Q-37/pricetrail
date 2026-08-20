'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  ACCENT_STORAGE_KEY,
  DEFAULT_ACCENT,
  isAccent,
  type Accent,
} from '@/lib/accent';

/**
 * Client half of the accent system.
 *
 * The constants, the type and the pre-hydration script live in `@/lib/accent`
 * because the server layout needs them too — see the note at the top of that
 * file. This module owns only the parts that need a browser: React state, the
 * DOM attribute, storage, and cross-tab sync.
 */

interface AccentContextValue {
  accent: Accent;
  setAccent: (accent: Accent) => void;
  /**
   * False until the client has read what the head script applied. The picker
   * uses it to avoid rendering a selected state the server could not have
   * known — the same class of hydration mismatch next-themes guards against
   * for the theme.
   */
  ready: boolean;
}

const AccentContext = createContext<AccentContextValue | null>(null);

export function AccentProvider({ children }: { children: ReactNode }) {
  // Always starts at the default so the first client render matches the HTML
  // the server produced. The real value arrives in the effect below; the
  // ATTRIBUTE is already correct by then thanks to ACCENT_SCRIPT, so nothing
  // repaints — only React's idea of the value catches up.
  const [accent, setAccentState] = useState<Accent>(DEFAULT_ACCENT);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Read the attribute the head script already applied rather than
    // localStorage directly: it is the single source of what is actually on
    // screen, so React cannot disagree with the DOM even if storage holds a
    // value written by an older build that we have since removed.
    const applied = document.documentElement.getAttribute('data-accent');
    if (isAccent(applied)) setAccentState(applied);
    setReady(true);
  }, []);

  const setAccent = useCallback((next: Accent) => {
    setAccentState(next);
    document.documentElement.setAttribute('data-accent', next);
    try {
      localStorage.setItem(ACCENT_STORAGE_KEY, next);
    } catch {
      // Storage unavailable (private mode, blocked cookies). The accent still
      // applies for this session — it just will not survive a reload, which is
      // a far better outcome than throwing out of a click handler.
    }
  }, []);

  // Keep tabs in step. Someone who changes accent in one tab and switches to
  // another should not find two differently-coloured copies of the same app.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== ACCENT_STORAGE_KEY) return;
      const next = isAccent(event.newValue) ? event.newValue : DEFAULT_ACCENT;
      setAccentState(next);
      document.documentElement.setAttribute('data-accent', next);
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value = useMemo(() => ({ accent, setAccent, ready }), [accent, setAccent, ready]);

  return <AccentContext.Provider value={value}>{children}</AccentContext.Provider>;
}

export function useAccent(): AccentContextValue {
  const context = useContext(AccentContext);
  if (!context) {
    throw new Error('useAccent must be used within <AccentProvider>');
  }
  return context;
}
