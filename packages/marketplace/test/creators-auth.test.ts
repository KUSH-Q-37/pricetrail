import { describe, expect, it } from 'vitest';

import { AmazonApiFetcher } from '../src/amazon/amazon.api';
import {
  CREATORS_TOKEN_ENDPOINT,
  CreatorsTokenProvider,
} from '../src/amazon/creators-auth';

/**
 * Creators API authentication, offline.
 *
 * These live in the vitest suite rather than run-integration.ts because CI
 * never runs that harness — it makes live network calls and drives real
 * Chromium, so it is a local tool. Everything here stubs the transport, so
 * there is no reason for it to sit outside the suite that actually gates
 * merges. Without this, a regression in token caching or the response parser
 * would reach production unchallenged.
 */

const CREDENTIALS = {
  clientId: 'amzn1.application-oa2-client.test',
  clientSecret: 'amzn1.oa2-cs.v1.test',
  version: 'v3.2' as const,
};

/** A stub fetch that records calls and returns a fresh token each time. */
function tokenStub(): { fetch: typeof fetch; calls: () => number; lastUrl: () => string; lastBody: () => Record<string, unknown> } {
  let calls = 0;
  let lastUrl = '';
  let lastBody: Record<string, unknown> = {};

  const impl = async (url: string | URL, init?: RequestInit): Promise<Response> => {
    calls += 1;
    lastUrl = String(url);
    lastBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    return new Response(
      JSON.stringify({ access_token: `token-${calls}`, expires_in: 3600 }),
      { status: 200 },
    );
  };

  return {
    fetch: impl as unknown as typeof fetch,
    calls: () => calls,
    lastUrl: () => lastUrl,
    lastBody: () => lastBody,
  };
}

describe('Creators API token endpoints', () => {
  // India is EU. This is the single most error-prone fact in the integration:
  // amazon.in credentials are v3.2 and authenticate against the UK host, not
  // the Japanese one. Asserted so a plausible-looking "tidy-up" that moves IN
  // to Far East fails here rather than in production, where it surfaces as
  // invalid_client and reads like a wrong secret.
  it('routes India (v3.2) to the EU host', () => {
    expect(CREATORS_TOKEN_ENDPOINT['v3.2']).toBe('https://api.amazon.co.uk/auth/o2/token');
  });

  it('routes NA and FE to their own hosts', () => {
    expect(CREATORS_TOKEN_ENDPOINT['v3.1']).toBe('https://api.amazon.com/auth/o2/token');
    expect(CREATORS_TOKEN_ENDPOINT['v3.3']).toBe('https://api.amazon.co.jp/auth/o2/token');
  });
});

describe('CreatorsTokenProvider', () => {
  it('fetches once and reuses the cached token', async () => {
    const stub = tokenStub();
    const provider = new CreatorsTokenProvider(CREDENTIALS, stub.fetch);

    expect(await provider.getToken()).toBe('token-1');
    expect(await provider.getToken()).toBe('token-1');
    expect(stub.calls()).toBe(1);
  });

  it('posts client_credentials to the endpoint for its version', async () => {
    const stub = tokenStub();
    await new CreatorsTokenProvider(CREDENTIALS, stub.fetch).getToken();

    expect(stub.lastUrl()).toBe(CREATORS_TOKEN_ENDPOINT['v3.2']);
    expect(stub.lastBody()).toMatchObject({
      grant_type: 'client_credentials',
      scope: 'creatorsapi::default',
      client_id: CREDENTIALS.clientId,
    });
  });

  it('re-authenticates after invalidate', async () => {
    // Rotating a credential revokes the token server-side before its stated
    // expiry. Without this, every request until the natural expiry fails.
    const stub = tokenStub();
    const provider = new CreatorsTokenProvider(CREDENTIALS, stub.fetch);

    await provider.getToken();
    provider.invalidate();

    expect(await provider.getToken()).toBe('token-2');
    expect(stub.calls()).toBe(2);
  });

  it('shares one request between concurrent cold-start callers', async () => {
    // A sweep firing several requests at once on a cold cache must not send
    // that many identical token requests — each valid, each counting against
    // the auth quota, all but one discarded.
    let calls = 0;
    const slow = (async (): Promise<Response> => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response(JSON.stringify({ access_token: 'shared', expires_in: 3600 }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const provider = new CreatorsTokenProvider(CREDENTIALS, slow);
    const tokens = await Promise.all([
      provider.getToken(),
      provider.getToken(),
      provider.getToken(),
    ]);

    expect(calls).toBe(1);
    expect(tokens).toEqual(['shared', 'shared', 'shared']);
  });

  it('does not cache a token shorter than the expiry margin', async () => {
    // 30s is inside the 60s margin, so it must be treated as already expired
    // rather than handed to a request it would expire underneath.
    let calls = 0;
    const shortLived = (async (): Promise<Response> => {
      calls += 1;
      return new Response(
        JSON.stringify({ access_token: `short-${calls}`, expires_in: 30 }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const provider = new CreatorsTokenProvider(CREDENTIALS, shortLived);
    await provider.getToken();
    await provider.getToken();

    expect(calls).toBe(2);
  });

  it('surfaces the status and Amazon reason on failure', async () => {
    // invalid_client means a wrong id/secret AND a credential sent to the
    // wrong regional host. Indistinguishable from the status alone, so the
    // body is passed through verbatim.
    const failing = (async () =>
      new Response('{"error":"invalid_client"}', { status: 401 })) as unknown as typeof fetch;

    await expect(
      new CreatorsTokenProvider(CREDENTIALS, failing).getToken(),
    ).rejects.toThrow(/401[\s\S]*invalid_client/);
  });
});

describe('AmazonApiFetcher without credentials', () => {
  // The state every deployment starts in, and the one this project has been in
  // for its whole life. Degrading to "unavailable, do not retry" rather than
  // throwing is what lets counterpart discovery treat Amazon as a coverage gap
  // instead of a failed job.
  it('reports unavailable and does not throw', async () => {
    const fetcher = new AmazonApiFetcher(undefined);
    expect(fetcher.isAvailable()).toBe(false);

    const result = await fetcher.searchProducts('anything');
    expect(result.available).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.candidates).toEqual([]);
  });

  it('treats a missing partner tag as unconfigured', () => {
    // The realistic partial configuration: id and secret pasted in, tracking
    // ID forgotten. Must read as unconfigured rather than as a working
    // integration that fails on every call.
    const fetcher = new AmazonApiFetcher({
      clientId: CREDENTIALS.clientId,
      clientSecret: CREDENTIALS.clientSecret,
      partnerTag: '',
    });

    expect(fetcher.isAvailable()).toBe(false);
  });

  it('rejects an empty query without a network call', async () => {
    const result = await new AmazonApiFetcher(undefined).searchProducts('   ');
    expect(result.available).toBe(false);
  });
});
