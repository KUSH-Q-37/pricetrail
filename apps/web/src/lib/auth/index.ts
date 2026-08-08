import { LocalDevAuthClient } from './local-dev-auth';
import { SupabaseAuthClient } from './supabase-auth';
import { AuthClientError, type AuthClient } from './types';

export * from './types';

export const AUTH_MODE =
  process.env.NEXT_PUBLIC_AUTH_MODE === 'local-dev' ? 'local-dev' : 'supabase';

let client: AuthClient | undefined;

/**
 * Resolve the configured auth client.
 *
 * Memoised because SupabaseAuthClient owns a session subscription and a
 * refresh timer — constructing it per render would leak both.
 */
export function getAuthClient(): AuthClient {
  if (client) return client;

  if (AUTH_MODE === 'local-dev') {
    client = new LocalDevAuthClient();
    return client;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new AuthClientError(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required ' +
        'when NEXT_PUBLIC_AUTH_MODE is not "local-dev".',
    );
  }

  client = new SupabaseAuthClient(url, anonKey);
  return client;
}
