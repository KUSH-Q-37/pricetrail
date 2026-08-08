import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  /** Correlation ID, echoed in responses and carried onto queue jobs. */
  correlationId: string;
  /** Populated by the auth guard in Phase 5. */
  userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Ambient per-request state.
 *
 * AsyncLocalStorage rather than a request-scoped Nest provider on purpose:
 * request scoping forces Nest to re-instantiate the entire dependency subtree
 * per request, which is a real throughput cost. More importantly, this context
 * survives into code that has no access to the DI container at all — the
 * matching pipeline, the queue producers — which is exactly where a
 * correlation ID needs to reach.
 *
 * In Phase 11 the worker seeds the same store from the job payload, so a log
 * line emitted deep inside a scrape can be traced back to the HTTP request
 * that queued it.
 */
export const RequestContextStore = {
  run<T>(context: RequestContext, callback: () => T): T {
    return storage.run(context, callback);
  },

  get(): RequestContext | undefined {
    return storage.getStore();
  },

  get correlationId(): string | undefined {
    return storage.getStore()?.correlationId;
  },

  /** Attach the authenticated user to the in-flight context. */
  setUserId(userId: string): void {
    const context = storage.getStore();
    if (context) {
      context.userId = userId;
    }
  },
};
