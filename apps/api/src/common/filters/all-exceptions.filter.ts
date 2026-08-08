import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Prisma } from '@pricetrail/database';
import type { Request, Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ZodError } from 'zod';

import { RequestContextStore } from '../context/request-context';
import { AppError, ErrorCode, type ErrorCodeValue } from '../errors/app-error';

/** RFC 7807 problem document, plus the extensions this API guarantees. */
interface ProblemDocument {
  type: string;
  title: ErrorCodeValue;
  status: number;
  detail: string;
  instance: string;
  correlationId: string;
  timestamp: string;
  errors?: FieldError[];
}

interface FieldError {
  path: string;
  message: string;
  code?: string;
}

const PROBLEM_BASE_URI = 'https://pricetrail.app/errors';

/**
 * The single exit point for every error leaving the API.
 *
 * Two rules drive the design:
 *
 *  1. One response shape, always. Clients parse one thing whether the failure
 *     came from Zod, Prisma, Nest, or a bug. `title` is a stable machine code;
 *     `detail` is human text and may change freely.
 *
 *  2. Unexpected errors never leak. An `AppError` was raised deliberately and
 *     its message is safe to return. Anything else is a bug, and in production
 *     its message is replaced — Prisma in particular puts table names, column
 *     names and query fragments into exception messages, which is a free schema
 *     disclosure to an attacker.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    @InjectPinoLogger(AllExceptionsFilter.name)
    private readonly logger: PinoLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const problem = this.toProblem(exception, request);

    // 5xx means we broke something — full stack. 4xx is the client's problem
    // and is logged at warn without a stack, so real incidents stay visible.
    if (problem.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        { err: exception, problem },
        'Unhandled error serving %s %s',
        request.method,
        request.url,
      );
    } else {
      this.logger.warn(
        { problem },
        'Request failed: %s %s',
        request.method,
        request.url,
      );
    }

    response
      .status(problem.status)
      .type('application/problem+json')
      .json(problem);
  }

  private toProblem(exception: unknown, request: Request): ProblemDocument {
    const base = {
      instance: request.url,
      correlationId: RequestContextStore.correlationId ?? 'unknown',
      timestamp: new Date().toISOString(),
    };

    const build = (
      code: ErrorCodeValue,
      status: number,
      detail: string,
      errors?: FieldError[],
    ): ProblemDocument => ({
      type: `${PROBLEM_BASE_URI}/${code.toLowerCase().replace(/_/g, '-')}`,
      title: code,
      status,
      detail,
      ...base,
      ...(errors ? { errors } : {}),
    });

    // --- deliberate application errors ------------------------------------
    if (exception instanceof AppError) {
      return build(
        exception.code,
        exception.status,
        exception.message,
        this.asFieldErrors(exception.details),
      );
    }

    // --- validation --------------------------------------------------------
    if (exception instanceof ZodError) {
      return build(
        ErrorCode.VALIDATION_FAILED,
        HttpStatus.BAD_REQUEST,
        'Request validation failed',
        exception.issues.map((issue) => ({
          path: issue.path.join('.') || '(root)',
          message: issue.message,
          code: issue.code,
        })),
      );
    }

    // --- Prisma ------------------------------------------------------------
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrisma(exception, build);
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      // A malformed query is our bug, not the caller's.
      return build(
        ErrorCode.INTERNAL,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'An unexpected error occurred',
      );
    }

    // --- Nest's own exceptions --------------------------------------------
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const detail =
        typeof payload === 'string'
          ? payload
          : ((payload as { message?: string | string[] }).message ??
            exception.message);

      return build(
        this.codeForStatus(status),
        status,
        Array.isArray(detail) ? detail.join('; ') : detail,
      );
    }

    // --- anything else is a bug -------------------------------------------
    return build(
      ErrorCode.INTERNAL,
      HttpStatus.INTERNAL_SERVER_ERROR,
      'An unexpected error occurred',
    );
  }

  private fromPrisma(
    exception: Prisma.PrismaClientKnownRequestError,
    build: (
      code: ErrorCodeValue,
      status: number,
      detail: string,
      errors?: FieldError[],
    ) => ProblemDocument,
  ): ProblemDocument {
    switch (exception.code) {
      case 'P2002': {
        // Unique constraint violation. The target field names are safe to
        // surface — they are part of the public request contract.
        const target = exception.meta?.['target'];
        const fields = Array.isArray(target) ? target.map(String) : [];
        return build(
          ErrorCode.CONFLICT,
          HttpStatus.CONFLICT,
          fields.length > 0
            ? `A record with this ${fields.join(', ')} already exists`
            : 'A record with these values already exists',
          fields.map((path) => ({ path, message: 'must be unique' })),
        );
      }

      case 'P2025':
        return build(
          ErrorCode.NOT_FOUND,
          HttpStatus.NOT_FOUND,
          'The requested record was not found',
        );

      case 'P2003':
        return build(
          ErrorCode.CONFLICT,
          HttpStatus.CONFLICT,
          'A referenced record does not exist',
        );

      case 'P1001':
      case 'P1002':
        return build(
          ErrorCode.UPSTREAM_UNAVAILABLE,
          HttpStatus.SERVICE_UNAVAILABLE,
          'The database is currently unavailable',
        );

      default:
        return build(
          ErrorCode.INTERNAL,
          HttpStatus.INTERNAL_SERVER_ERROR,
          'An unexpected error occurred',
        );
    }
  }

  private codeForStatus(status: number): ErrorCodeValue {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.VALIDATION_FAILED;
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.UNAUTHENTICATED;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ErrorCode.CONFLICT;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ErrorCode.RATE_LIMITED;
      default:
        return ErrorCode.INTERNAL;
    }
  }

  private asFieldErrors(details: unknown): FieldError[] | undefined {
    if (!Array.isArray(details)) return undefined;
    return details.filter(
      (item): item is FieldError =>
        typeof item === 'object' &&
        item !== null &&
        'path' in item &&
        'message' in item,
    );
  }
}
