/**
 * Library surface of the worker app.
 *
 * `main.ts` is the process entry point; this is what another deployable
 * imports when it needs to host the queue consumers in its own process.
 * Importing this file must never start anything on its own.
 */

export {
  startWorkerRuntime,
  type RuntimeLogger,
  type WorkerRuntime,
  type WorkerRuntimeOptions,
} from './runtime';
