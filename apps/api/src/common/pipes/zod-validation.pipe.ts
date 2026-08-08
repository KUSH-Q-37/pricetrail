import { PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Validate-and-narrow pipe backed by a Zod schema.
 *
 * Used as `@Body(new ZodValidationPipe(CreateProductSchema)) body: CreateProduct`.
 *
 * Why Zod instead of class-validator (Nest's default):
 *
 *   - One schema, two jobs. The same schema that validates an HTTP body also
 *     validates *scraper output* in the worker. class-validator only works on
 *     decorated classes, so the worker would need a parallel implementation —
 *     and the two would drift.
 *
 *   - The parsed value is returned, not just checked. Coercions and defaults
 *     declared in the schema actually take effect, so handlers receive
 *     normalized input rather than raw strings.
 *
 * ZodError is deliberately left to propagate: AllExceptionsFilter already
 * renders it as an RFC 7807 document with per-field errors, and catching it
 * here would mean maintaining that mapping twice.
 */
export class ZodValidationPipe<TOutput> implements PipeTransform {
  constructor(private readonly schema: ZodType<TOutput>) {}

  transform(value: unknown): TOutput {
    return this.schema.parse(value);
  }
}

/** Convenience factory: `@Body(zodPipe(Schema))`. */
export function zodPipe<TOutput>(
  schema: ZodType<TOutput>,
): ZodValidationPipe<TOutput> {
  return new ZodValidationPipe(schema);
}
