import { z } from 'zod';

/**
 * Environment contract for the API process.
 *
 * This schema is the single source of truth for what the API needs to run.
 * It is validated once at bootstrap and the process EXITS if anything is
 * missing or malformed — a server that starts with a broken DATABASE_URL and
 * fails on the first request is strictly worse than one that never starts.
 *
 * Note the deliberate absence of `.url()` / `.email()`: those helpers moved
 * between Zod 3 and 4, so URL shape is asserted with an explicit refine that
 * behaves identically on both.
 */
const urlWithProtocol = (protocols: string[], label: string) =>
  z
    .string()
    .min(1)
    .refine(
      (value) => {
        try {
          return protocols.includes(new URL(value).protocol);
        } catch {
          return false;
        }
      },
      { message: `must be a valid ${label} URL (${protocols.join(' or ')})` },
    );

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  PORT: z.coerce.number().int().min(1).max(65535).default(3001),

  /** Postgres connection used for all runtime queries. */
  DATABASE_URL: urlWithProtocol(['postgres:', 'postgresql:'], 'Postgres'),

  /**
   * Non-pooled Postgres connection. Only Prisma Migrate uses it, but it is
   * required here so a deploy fails at boot rather than at migration time.
   */
  DIRECT_URL: urlWithProtocol(['postgres:', 'postgresql:'], 'Postgres'),

  REDIS_URL: urlWithProtocol(['redis:', 'rediss:'], 'Redis'),

  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  /**
   * Comma-separated allowed origins. Empty means "same-origin only", which is
   * the correct default — a wildcard CORS policy on an authenticated API is a
   * vulnerability, not a convenience.
   */
  CORS_ORIGINS: z.string().default(''),

  /** Business timezone. Storage is always UTC; this decides what "today" means. */
  APP_TIMEZONE: z.string().min(1).default('Asia/Kolkata'),

  /** Fixed-window rate limit applied to every route unless overridden. */
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),

  /** Swagger is served only when explicitly enabled. Off by default. */
  SWAGGER_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // --- Authentication -------------------------------------------------------
  /**
   * `supabase`  — verify RS256/ES256 tokens against the project's JWKS.
   * `local-dev` — verify HS256 tokens this API mints itself, so the whole auth
   *               flow is exercisable before a Supabase project exists.
   *
   * See the cross-field refinement below: `local-dev` is rejected outright in
   * production.
   */
  AUTH_MODE: z.enum(['supabase', 'local-dev']).default('supabase'),

  /** Supabase project URL, e.g. https://abcdefgh.supabase.co */
  SUPABASE_URL: z.string().optional(),

  /**
   * Shared secret for local-dev token signing. Long enough that a leaked dev
   * environment is not trivially forgeable.
   */
  LOCAL_DEV_AUTH_SECRET: z.string().min(32).optional(),

  /** Access-token lifetime for locally minted dev tokens. */
  LOCAL_DEV_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Cross-field rules that a per-field schema cannot express.
 *
 * The first rule is the important one. `local-dev` auth means this API mints
 * and accepts its own tokens — anyone who can reach it can mint an admin
 * token. That is exactly what we want for local testing and catastrophic
 * anywhere else, so the combination is refused at boot rather than trusted to
 * a deployment checklist. A misconfigured deploy fails to start; it does not
 * quietly serve traffic with authentication disabled.
 */
const envSchemaWithRules = envSchema.superRefine((env, ctx) => {
  if (env.AUTH_MODE === 'local-dev' && env.NODE_ENV === 'production') {
    ctx.addIssue({
      code: 'custom',
      path: ['AUTH_MODE'],
      message:
        'AUTH_MODE="local-dev" is forbidden when NODE_ENV="production". ' +
        'This mode lets the API mint its own tokens and would disable authentication entirely.',
    });
  }

  if (env.AUTH_MODE === 'local-dev' && !env.LOCAL_DEV_AUTH_SECRET) {
    ctx.addIssue({
      code: 'custom',
      path: ['LOCAL_DEV_AUTH_SECRET'],
      message: 'Required when AUTH_MODE="local-dev" (minimum 32 characters).',
    });
  }

  if (env.AUTH_MODE === 'supabase' && !env.SUPABASE_URL) {
    ctx.addIssue({
      code: 'custom',
      path: ['SUPABASE_URL'],
      message: 'Required when AUTH_MODE="supabase".',
    });
  }
});

/**
 * Called by @nestjs/config at startup. Throwing here aborts the bootstrap.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchemaWithRules.safeParse(raw);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `Invalid environment configuration:\n${details}\n\n` +
        `Check your .env against .env.example.`,
    );
  }

  return result.data;
}
