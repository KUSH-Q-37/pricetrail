'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { setAuthTokenProvider, setUnauthorizedHandler } from '@/lib/api-client';
import { getAuthClient, type AuthSession, type AuthUser } from '@/lib/auth';

interface AuthContextValue {
  user: AuthUser | null;
  /** True until the initial session restore settles. */
  isLoading: boolean;
  isAuthenticated: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within <AuthProvider>');
  }
  return context;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const queryClient = useQueryClient();

  // Read through a ref so the token provider closure stays stable while always
  // seeing the current value. Re-registering it on every session change would
  // race with in-flight requests.
  const sessionRef = useRef<AuthSession | null>(null);
  sessionRef.current = session;

  const clearSession = useCallback(() => {
    setSession(null);
    // Cached data belongs to the user who fetched it. Leaving it would show
    // the previous account's products to whoever signs in next on this device.
    queryClient.clear();
  }, [queryClient]);

  // Install the ambient auth wiring exactly once.
  useEffect(() => {
    setAuthTokenProvider(() => sessionRef.current?.accessToken ?? null);
    setUnauthorizedHandler(() => {
      clearSession();
      router.replace('/login');
    });

    return () => {
      setAuthTokenProvider(undefined);
      setUnauthorizedHandler(undefined);
    };
  }, [clearSession, router]);

  // Restore any existing session on first mount.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const restored = await getAuthClient().getSession();
        if (!cancelled) setSession(restored);
      } catch {
        // A failed restore means "not signed in", not "crash the app".
        if (!cancelled) setSession(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const next = await getAuthClient().signIn(email, password);
      queryClient.clear();
      setSession(next);
    },
    [queryClient],
  );

  const signUp = useCallback(
    async (email: string, password: string) => {
      const next = await getAuthClient().signUp(email, password);
      queryClient.clear();
      setSession(next);
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    try {
      await getAuthClient().signOut();
    } finally {
      // Clear locally even if the remote sign-out failed — otherwise a network
      // error leaves the user apparently still signed in.
      clearSession();
      router.replace('/login');
    }
  }, [clearSession, router]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      isLoading,
      isAuthenticated: session !== null,
      signIn,
      signUp,
      signOut,
    }),
    [session, isLoading, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
