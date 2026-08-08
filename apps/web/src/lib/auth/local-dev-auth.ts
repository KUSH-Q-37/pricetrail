import { apiClient, ApiError } from '@/lib/api-client';

import { AuthClientError, type AuthClient, type AuthSession } from './types';

const STORAGE_KEY = 'pricetrail.dev-session';

/**
 * Development auth client.
 *
 * Talks to the API's `/auth/dev-token` endpoint, which exists only while the
 * API runs with AUTH_MODE="local-dev". THE PASSWORD IS NOT CHECKED — there is
 * no credential store in this mode. It exists so the session lifecycle, route
 * protection and role-based UI can be built and tested before a Supabase
 * project exists.
 *
 * The token is kept in localStorage, which is readable by any script on the
 * origin and therefore XSS-exposed. That is acceptable for a token this API
 * only honours in local-dev; the Supabase client uses cookie-backed storage
 * for real sessions.
 */
export class LocalDevAuthClient implements AuthClient {
  async getSession(): Promise<AuthSession | null> {
    if (typeof window === 'undefined') return null;

    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    let session: AuthSession;
    try {
      session = JSON.parse(raw) as AuthSession;
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    // Trust nothing in localStorage: re-validate against the API. This catches
    // an expired token, a revoked user, and a hand-edited storage entry with
    // the same single round trip.
    try {
      const user = await apiClient.get<AuthSession['user']>('/api/v1/auth/me', {
        token: session.accessToken,
      });
      return { accessToken: session.accessToken, user };
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        window.localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      // A network blip must not silently sign the user out.
      throw error;
    }
  }

  /** `password` is accepted to satisfy the interface and then ignored. */
  async signIn(email: string, _password?: string): Promise<AuthSession> {
    void _password;

    const response = await apiClient.post<{
      accessToken: string;
      user: AuthSession['user'];
    }>('/api/v1/auth/dev-token', { email, role: 'USER' });

    const session: AuthSession = {
      accessToken: response.accessToken,
      user: response.user,
    };

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    return session;
  }

  /** Identical to signIn here — there is no credential to register. */
  async signUp(email: string, password: string): Promise<AuthSession> {
    return this.signIn(email, password);
  }

  async signOut(): Promise<void> {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}

export function assertDevModeAvailable(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new AuthClientError(
      'Local development auth cannot be used in a production build.',
    );
  }
}
