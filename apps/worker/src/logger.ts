/**
 * Minimal structured logger.
 *
 * Newline-delimited JSON in production so a log platform can index it, and
 * readable text in development. Deliberately not pino here: the worker's log
 * volume is low and a hand-rolled 30 lines avoids a dependency whose only job
 * would be formatting.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = (process.env['LOG_LEVEL'] as Level) ?? 'info';
const IS_PRODUCTION = process.env['NODE_ENV'] === 'production';

function emit(level: Level, message: string, context: Record<string, unknown> = {}): void {
  if (LEVEL_ORDER[level] < (LEVEL_ORDER[MIN_LEVEL] ?? 20)) return;

  if (IS_PRODUCTION) {
    process.stdout.write(
      `${JSON.stringify({ level, time: new Date().toISOString(), msg: message, ...context })}\n`,
    );
    return;
  }

  const suffix = Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : '';
  process.stdout.write(`[${level.toUpperCase().padEnd(5)}] ${message}${suffix}\n`);
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => emit('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => emit('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => emit('error', message, context),
};
