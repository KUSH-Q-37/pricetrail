/**
 * Typed HTTP client for the PriceTrail API.
 *
 * The API answers every failure with an RFC 7807 problem document
 * (`application/problem+json`). This client is the only place in the frontend
 * that knows that — everything above it sees a typed `ApiError` with a stable
 * `code` to branch on.
 */

/** Machine-readable codes. Mirrors ErrorCode in apps/api. */
export type ApiErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'UNSUPPORTED_MARKETPLACE'
  | 'UPSTREAM_UNAVAILABLE'
  | 'INTERNAL'
  | 'NETWORK'
  | 'TIMEOUT';

export interface ProblemFieldError {
  path: string;
  message: string;
  code?: string;
}

export interface ProblemDocument {
  type: string;
  title: ApiErrorCode;
  status: number;
  detail: string;
  instance: string;
  correlationId: string;
  timestamp: string;
  errors?: ProblemFieldError[];
}

/**
 * Every failed request surfaces as this, including transport failures — so a
 * caller never has to distinguish "server said no" from "fetch threw".
 *
 * `correlationId` is the reason this class exists: it ties a message the user
 * saw to the exact server-side log line, which turns most support reports into
 * a single log query.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly correlationId: string;
  readonly fieldErrors: ProblemFieldError[];

  constructor(problem: ProblemDocument) {
    super(problem.detail);
    this.name = 'ApiError';
    this.code = problem.title;
    this.status = problem.status;
    this.correlationId = problem.correlationId;
    this.fieldErrors = problem.errors ?? [];
  }

  /** Retrying these is pointless — the request itself is the problem. */
  get isClientFault(): boolean {
    return this.status >= 400 && this.status < 500 && this.status !== 429;
  }

  get isRetryable(): boolean {
    return !this.isClientFault;
  }

  /** Copy safe to render in a toast. Never exposes raw 5xx text. */
  get userMessage(): string {
    switch (this.code) {
      case 'UNAUTHENTICATED':
        return 'Your session has expired. Please sign in again.';
      case 'FORBIDDEN':
        return 'You do not have access to this.';
      case 'NOT_FOUND':
        return 'We could not find what you were looking for.';
      case 'RATE_LIMITED':
        return 'Too many requests. Please wait a moment and try again.';
      case 'QUOTA_EXCEEDED':
        return this.message;
      case 'UPSTREAM_UNAVAILABLE':
        return 'A service we depend on is temporarily unavailable.';
      case 'TIMEOUT':
        return 'The request took too long. Please try again.';
      case 'NETWORK':
        return 'Could not reach the server. Check your connection.';
      case 'VALIDATION_FAILED':
        return this.fieldErrors[0]?.message ?? this.message;
      case 'UNSUPPORTED_MARKETPLACE':
        // Pass the server's text through verbatim. It names the supported
        // hosts, which is the one thing that lets the user fix the mistake.
        // Falling through to the generic message here turned an actionable
        // error into "Something went wrong on our end" — caught by E2E.
        return this.message;
      default:
        return 'Something went wrong on our end. Please try again.';
    }
  }
}

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Ambient auth wiring, installed by AuthProvider.
 *
 * Threading a token argument through every hook and query function would mean
 * each one has to remember to do it — and the one that forgets produces a 401
 * that looks like a session bug. A single registration point means auth is
 * applied uniformly and cannot be omitted by accident.
 *
 * These are module-level rather than React context because the fetch layer is
 * called from query functions that sit outside the component tree.
 */
let tokenProvider: (() => string | null) | undefined;
let unauthorizedHandler: (() => void) | undefined;

export function setAuthTokenProvider(provider: (() => string | null) | undefined): void {
  tokenProvider = provider;
}

/** Invoked once when the API reports the session is no longer valid. */
export function setUnauthorizedHandler(handler: (() => void) | undefined): void {
  unauthorizedHandler = handler;
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  timeoutMs?: number;
  /** Bearer token. Wired to the Supabase session in Phase 5. */
  token?: string;
}

/** Build a problem document for failures that never reached the server. */
function syntheticProblem(
  title: ApiErrorCode,
  detail: string,
  status: number,
  instance: string,
): ProblemDocument {
  return {
    type: `client/${title.toLowerCase()}`,
    title,
    status,
    detail,
    instance,
    correlationId: 'client-generated',
    timestamp: new Date().toISOString(),
  };
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, timeoutMs = DEFAULT_TIMEOUT_MS, token, ...init } = options;

  const url = `${API_BASE_URL}${path}`;

  // A hung request must not leave a spinner on screen forever. AbortSignal is
  // the only thing that actually cancels an in-flight fetch.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (body !== undefined) headers.set('Content-Type', 'application/json');

  // An explicit token wins, so session-validation calls can pass a token that
  // is not yet installed as the ambient one.
  const bearer = token ?? tokenProvider?.();
  if (bearer) headers.set('Authorization', `Bearer ${bearer}`);

  // Generated here so a failure that never reaches the server still has an ID
  // the user can quote. The API validates and echoes it back.
  if (!headers.has('x-correlation-id') && typeof crypto !== 'undefined') {
    headers.set('x-correlation-id', crypto.randomUUID());
  }

  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      credentials: 'include',
    });
  } catch (error) {
    clearTimeout(timeout);

    const isAbort = error instanceof DOMException && error.name === 'AbortError';
    throw new ApiError(
      syntheticProblem(
        isAbort ? 'TIMEOUT' : 'NETWORK',
        isAbort
          ? `Request timed out after ${timeoutMs}ms`
          : 'Could not reach the API',
        isAbort ? 408 : 0,
        path,
      ),
    );
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const rawBody = await response.text();

  if (!response.ok) {
    // A 401 means the session the client believes it has is no longer
    // accepted. Handled centrally so every screen reacts identically instead
    // of each one inventing its own redirect.
    if (response.status === 401 && !token) {
      unauthorizedHandler?.();
    }

    // Trust the envelope when it is there; synthesize one when it is not.
    // A 502 from a load balancer returns HTML, and JSON.parse on that would
    // throw a parse error that hides the real status code.
    try {
      const parsed = JSON.parse(rawBody) as ProblemDocument;
      if (parsed && typeof parsed.title === 'string') {
        throw new ApiError(parsed);
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
    }

    throw new ApiError(
      syntheticProblem(
        'INTERNAL',
        `Unexpected response (HTTP ${response.status})`,
        response.status,
        path,
      ),
    );
  }

  try {
    return JSON.parse(rawBody) as T;
  } catch {
    throw new ApiError(
      syntheticProblem('INTERNAL', 'Malformed JSON in response', 500, path),
    );
  }
}

export const apiClient = {
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'GET' }),

  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),

  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),

  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'DELETE' }),
};

export { API_BASE_URL };
