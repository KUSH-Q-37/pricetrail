export type AppRole = 'USER' | 'ADMIN';

export interface AuthUser {
  id: string;
  supabaseUserId: string;
  email: string;
  role: AppRole;
  trackingQuota: number;
}

export interface AuthSession {
  accessToken: string;
  user: AuthUser;
}

/**
 * Auth provider seam, mirroring TOKEN_VERIFIER on the API.
 *
 * Both sides pivot on the same environment decision, so moving to real
 * Supabase is a configuration change on each side rather than a rewrite of
 * either.
 */
export interface AuthClient {
  /** Restore a session on page load. Returns null when signed out. */
  getSession(): Promise<AuthSession | null>;
  signIn(email: string, password: string): Promise<AuthSession>;
  signUp(email: string, password: string): Promise<AuthSession>;
  signOut(): Promise<void>;
}

export class AuthClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthClientError';
  }
}
