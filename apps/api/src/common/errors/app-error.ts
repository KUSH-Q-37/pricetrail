import { HttpStatus } from '@nestjs/common';

/**
 * Stable, machine-readable error codes.
 *
 * Clients branch on these, never on message text. Adding a code is a
 * non-breaking change; renaming one is breaking — treat this list as API.
 */
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  RATE_LIMITED: 'RATE_LIMITED',
  UNSUPPORTED_MARKETPLACE: 'UNSUPPORTED_MARKETPLACE',
  /** A real product on a supported marketplace, in a category we do not track. */
  CATEGORY_NOT_TRACKED: 'CATEGORY_NOT_TRACKED',
  UPSTREAM_UNAVAILABLE: 'UPSTREAM_UNAVAILABLE',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Base class for every error this application raises deliberately.
 *
 * The distinction that matters: an `AppError` is an expected outcome with a
 * safe, client-facing message. Anything else reaching the exception filter is
 * a bug, and its message is withheld from the response in production.
 */
export class AppError extends Error {
  readonly code: ErrorCodeValue;
  readonly status: number;
  readonly details?: unknown;

  constructor(
    code: ErrorCodeValue,
    message: string,
    status: number,
    details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, identifier?: string) {
    super(
      ErrorCode.NOT_FOUND,
      identifier
        ? `${resource} '${identifier}' was not found`
        : `${resource} was not found`,
      HttpStatus.NOT_FOUND,
    );
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(ErrorCode.CONFLICT, message, HttpStatus.CONFLICT, details);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(
      ErrorCode.VALIDATION_FAILED,
      message,
      HttpStatus.BAD_REQUEST,
      details,
    );
  }
}

export class QuotaExceededError extends AppError {
  constructor(limit: number) {
    super(
      ErrorCode.QUOTA_EXCEEDED,
      `Tracking quota of ${limit} products reached. Upgrade your plan to track more.`,
      HttpStatus.FORBIDDEN,
      { limit },
    );
  }
}

export class RateLimitedError extends AppError {
  constructor(retryAfterSeconds: number) {
    super(
      ErrorCode.RATE_LIMITED,
      'Too many requests. Please retry shortly.',
      HttpStatus.TOO_MANY_REQUESTS,
      { retryAfterSeconds },
    );
  }
}

export class UpstreamUnavailableError extends AppError {
  constructor(upstream: string) {
    super(
      ErrorCode.UPSTREAM_UNAVAILABLE,
      `${upstream} is currently unavailable.`,
      HttpStatus.SERVICE_UNAVAILABLE,
      { upstream },
    );
  }
}
