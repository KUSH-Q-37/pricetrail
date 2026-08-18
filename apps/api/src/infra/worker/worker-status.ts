/**
 * Liveness of the co-hosted queue consumers, readable by the health check.
 *
 * Why this exists
 * ---------------
 * On 15 Aug 2026 Redis timed out for a few seconds while the service was
 * booting. `startWorkerRuntime` threw, the catch block logged and continued —
 * by design, because a queue that will not start must not take request serving
 * down with it. The API then served traffic normally for three days with
 * nothing consuming the queue, and no probe noticed, because /health/ready
 * only asked whether Postgres and Redis were reachable. They were.
 *
 * Two days of price observations were lost, and they cannot be recovered:
 * neither marketplace publishes past prices.
 *
 * A process-local mutable singleton rather than a Nest provider, because
 * main.ts writes to it during bootstrap — outside the injector's lifecycle,
 * before and after app.listen(). Module state is the only thing both sides can
 * see without restructuring bootstrap around DI.
 */

export type WorkerState =
  /** RUN_WORKERS_IN_API is false. Not an error — a dedicated worker is expected. */
  | 'not-enabled'
  /** Enabled and attempting its first start. */
  | 'starting'
  /** Consuming jobs. The only healthy state when enabled. */
  | 'running'
  /** Failed at least once; a retry is scheduled. */
  | 'retrying'
  /** Retries exhausted. Nothing will consume the queue until a redeploy. */
  | 'failed';

interface WorkerStatus {
  state: WorkerState;
  /** Failed start attempts so far. Reset once running. */
  attempts: number;
  /** Message from the most recent failure, for the health payload. */
  lastError?: string;
  /** When the runtime last reached `running`. */
  runningSince?: string;
}

export const workerStatus: WorkerStatus = {
  state: 'not-enabled',
  attempts: 0,
};

export function setWorkerState(state: WorkerState, error?: unknown): void {
  workerStatus.state = state;

  if (state === 'running') {
    workerStatus.attempts = 0;
    workerStatus.lastError = undefined;
    workerStatus.runningSince = new Date().toISOString();
    return;
  }

  if (error !== undefined) {
    workerStatus.attempts += 1;
    workerStatus.lastError = error instanceof Error ? error.message : String(error);
  }
}

/**
 * Whether the absence of a running runtime should fail readiness.
 *
 * `not-enabled` is healthy: it means a dedicated worker service owns the
 * queues. Only a runtime that was supposed to be here and is not counts.
 */
export function isWorkerUnhealthy(): boolean {
  return workerStatus.state === 'failed';
}
