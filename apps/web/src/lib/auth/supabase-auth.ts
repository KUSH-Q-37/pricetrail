import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { apiClient } from '@/lib/api-client';

import { AuthClientError, type AuthClient, type AuthSession } from './types';

/**
 * Real Supabase authentication.
 *
 * Supabase owns credentials and issues the JWT; the API verifies it against
 * the project's JWKS. The user object comes from OUR `/auth/me`, not from
 * Supabase — role and quota are application state and are never read from
 * token metadata, which the account holder can write to.
 */
export class SupabaseAuthClient implements AuthClient {
  private readonly supabase: SupabaseClient;

  constructor(url: string, anonKey: string) {
    this.supabase = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  private async hydrate(accessToken: string): Promise<AuthSession> {
    const user = await apiClient.get<AuthSession['user']>('/api/v1/auth/me', {
      token: accessToken,
    });
    return { accessToken, user };
  }

  async getSession(): Promise<AuthSession | null> {
    const { data, error } = await this.supabase.auth.getSession();
    if (error) throw new AuthClientError(error.message);
    if (!data.session) return null;
    return this.hydrate(data.session.access_token);
  }

  async signIn(email: string, password: string): Promise<AuthSession> {
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw new AuthClientError(error.message);
    if (!data.session) throw new AuthClientError('No session returned');
    return this.hydrate(data.session.access_token);
  }

  async signUp(email: string, password: string): Promise<AuthSession> {
    const { data, error } = await this.supabase.auth.signUp({ email, password });
    if (error) throw new AuthClientError(error.message);

    // With email confirmation enabled, signUp succeeds without a session.
    // Surfacing that as an error would be wrong — the account was created.
    if (!data.session) {
      throw new AuthClientError(
        'Check your inbox to confirm your email address before signing in.',
      );
    }
    return this.hydrate(data.session.access_token);
  }

  async signOut(): Promise<void> {
    const { error } = await this.supabase.auth.signOut();
    if (error) throw new AuthClientError(error.message);
  }
}
