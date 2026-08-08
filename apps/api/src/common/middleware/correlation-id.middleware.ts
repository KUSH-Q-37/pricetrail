import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { RequestContextStore } from '../context/request-context';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

/** Reject absurd or non-printable client-supplied IDs before echoing them. */
const SAFE_CORRELATION_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * Establishes the per-request context and correlation ID.
 *
 * Deliberately a plain Express handler rather than a Nest `NestMiddleware`
 * class, and mounted with `app.use()` in main.ts. Ordering is the reason:
 * module-registered middleware runs during `app.init()`, which happens *after*
 * everything already attached to the Express instance. nestjs-pino registers
 * its logger middleware at module level, so a NestMiddleware version of this
 * could run second — and every log line for the request would be missing the
 * correlation ID it was supposed to carry.
 *
 * An inbound `x-correlation-id` is honoured so a trace started at the frontend
 * or an upstream gateway stays intact across process boundaries — but it is
 * pattern-checked first. The value is echoed in the response and written into
 * logs, so accepting arbitrary client input would give an attacker both log
 * injection and a response-header reflection primitive.
 */
export function correlationIdMiddleware(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const inbound = req.headers[CORRELATION_ID_HEADER];
    const candidate = Array.isArray(inbound) ? inbound[0] : inbound;

    const correlationId =
      candidate && SAFE_CORRELATION_ID.test(candidate)
        ? candidate
        : randomUUID();

    res.setHeader(CORRELATION_ID_HEADER, correlationId);

    RequestContextStore.run({ correlationId }, () => next());
  };
}
