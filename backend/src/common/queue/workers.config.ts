/**
 * ACC-92 — whether THIS process registers BullMQ workers.
 *
 * ## The problem this exists for
 *
 * `REDIS_URL` points at one shared Railway Redis, so a backend started on a
 * laptop joined the same queues as the deployment and competed for its jobs.
 * That is not a care problem: starting the API for ninety seconds to answer
 * one question is enough, and the 15-minute and hourly ticks land inside some
 * of those sessions. It happened twice — once through orphaned watchers, once
 * through a deliberate ninety-second session — and the second is the one that
 * settled it, because nothing went wrong and the work simply got done by
 * whichever machine happened to be running.
 *
 * ## THE DEFAULT IS OFF, AND THE FAILURE MODE THAT BUYS IS REAL
 *
 * A process registers workers only when `RUN_WORKERS=true`. So a DEPLOYMENT
 * that does not set it runs no scheduled work at all — no SLA sweeps, no
 * Setup health reconciliation, no head-vacancy recompute — and today nothing
 * reports that, because ACC-93 does not exist yet. That is a silent failure
 * and it is the cost of this choice.
 *
 * It was still the right way round, because the two failures are not
 * symmetrical:
 *
 * - Default OFF fails ONCE, at a deploy, when a person is watching, and one
 *   configuration entry fixes it permanently.
 * - Default ON fails REPEATEDLY and forever — every fresh clone and every new
 *   machine is one missing `.env` line away from this bug, and nobody chooses
 *   it or notices it. It would make the control care-bounded again, which is
 *   exactly what this ticket found does not work.
 *
 * Off is also the fail-safe direction: the failure is "the work did not
 * happen" rather than "the wrong machine did the work, to the shared
 * database, and nothing recorded which".
 *
 * The accepted failure is made visible rather than left implicit — see
 * `logWorkerRegistration()`, which escalates to ERROR when a process that
 * looks like a deployment has workers disabled.
 *
 * ## What this does NOT fix, stated so it is not assumed
 *
 * Gating the CONSUMER does not stop a local API from PRODUCING jobs onto the
 * shared queue, and it does not touch the shared DATABASE at all. A local
 * backend still reads and writes the deployment's tables. That is the larger
 * open question CLAUDE.md already records under shared infrastructure, and
 * this change narrows the hazard rather than closing it.
 */

export const RUN_WORKERS_ENV = 'RUN_WORKERS';

/** The queues a worker process consumes, named in the startup log. */
export const WORKER_QUEUES = ['sla-monitor', 'setup-health', 'workflow-actions', 'email-delivery'];

/**
 * Only the exact string `true` enables workers. Anything else — unset, empty,
 * `1`, `TRUE`, a typo — leaves them off, because the safe state should not
 * depend on guessing what someone meant.
 */
export function workersEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[RUN_WORKERS_ENV] === 'true';
}

/**
 * Used ONLY to choose a log level, never to change behaviour. Deriving the
 * gate itself from this would trade a visible one-time setup step for an
 * invisible dependency on a host's env injection — the same class of silent
 * failure this ticket is about.
 */
export function looksLikeDeployment(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['NODE_ENV'] === 'production' || Boolean(env['RAILWAY_ENVIRONMENT']);
}

/** The subset of Nest's Logger this needs, so the spec can assert on levels. */
export interface WorkerRegistrationLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/**
 * Says plainly, at startup, whether this process is a worker. Not a debug
 * line: a person reading a deploy log has to see it without looking for it,
 * because a deployment with workers off is indistinguishable from a quiet
 * week until something downstream goes stale.
 */
export function logWorkerRegistration(
  logger: WorkerRegistrationLogger,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (workersEnabled(env)) {
    logger.log(
      `Queue processors ENABLED (${RUN_WORKERS_ENV}=true) — this process consumes the shared ` +
        `queues: ${WORKER_QUEUES.join(', ')}.`,
    );
    return;
  }

  const consequence =
    `Queue processors DISABLED — this process runs NO scheduled work ` +
    `(SLA sweeps, Setup health reconciliation, head-vacancy recompute) and consumes no queue jobs. ` +
    `Set ${RUN_WORKERS_ENV}=true to enable.`;

  if (looksLikeDeployment(env)) {
    logger.error(
      `${consequence} This process looks like a DEPLOYMENT, so this is almost certainly wrong — ` +
        `scheduled work is not running anywhere.`,
    );
    return;
  }

  logger.warn(`${consequence} This is the correct default for local development.`);
}
