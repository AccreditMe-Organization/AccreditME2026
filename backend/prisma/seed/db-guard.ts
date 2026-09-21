// ACC-107 — the one place that decides whether a destructive dev-data command
// may touch the database it is pointed at.
//
// Shared by the seed and by the reset. They had no shared implementation
// before because the reset had no guard at all: `npx prisma migrate reset
// --force` was a manual step, so the seed's careful checks protected the
// SECOND half of a two-step operation and the first half — the one that
// actually drops every table — was unprotected.
//
// ## THE HOST ALLOWLIST WAS NOT A GUARD, AND THIS IS THE CORRECTION
//
// The previous check allowed any host containing `pooler.supabase.com`. That
// reads like it names our database. It does not: `aws-1-eu-central-1.pooler
// .supabase.com` is the SHARED pooler endpoint for an entire Supabase region,
// identical for every project in it. A customer's connection string would have
// passed that check unchanged.
//
// What identifies the database is the PROJECT REF, and it lives in the
// USERNAME (`postgres.<projectref>`), not the host. So the host stays as a
// cheap first filter and the confirmation now binds to the project ref.
//
// ## Why confirmation rather than a committed allowlist of refs
//
// A ref hardcoded here is config that goes stale, and a `SEED_ALLOWED_DB_REF`
// env var is set once and forgotten — both end up asserting that whatever is
// configured is correct, which is the thing being doubted. Typing the ref is
// the one form that cannot be satisfied by a stale file, and it is the same
// reasoning ACC-62 used for typing the host, applied to the value that
// actually distinguishes one database from another.
//
// ## This does NOT re-open ACC-62's decision
//
// seed-realistic.ts records that a committed "reset-and-seed" one-liner is
// exactly what eventually runs against the wrong database, so resetting stays
// deliberate. That still holds: `db:reset:dev` resets and STOPS. It does not
// seed, it does not chain, and it is harder to run than the bare prisma
// command it replaces. The objection was to a one-liner that does everything,
// not to guarding the destructive step.

export interface DatabaseIdentity {
  /** Hostname, e.g. `aws-1-eu-central-1.pooler.supabase.com` or `localhost`. */
  host: string;
  /**
   * The value an operator must type to confirm. For Supabase this is the
   * project ref from the username — the only part of the URL that names THIS
   * database. For a local database it is the host, where the ref concept does
   * not exist and "localhost" is already unambiguous.
   */
  confirmationValue: string;
  /** What to call it in prompts, so the operator knows what is being asked. */
  confirmationLabel: string;
  isLocal: boolean;
}

const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

// A remote host still has to look like infrastructure we recognise. This is
// the cheap filter, NOT the guard — see the header.
const ALLOWED_REMOTE_HOST_FRAGMENTS = ['pooler.supabase.com'];

/** Supabase pooler usernames are `postgres.<projectref>`. */
function projectRefFrom(username: string): string | null {
  const decoded = decodeURIComponent(username);
  const dot = decoded.indexOf('.');
  if (dot === -1) return null;
  const ref = decoded.slice(dot + 1);
  return ref.length > 0 ? ref : null;
}

export function describeDatabase(url: string | undefined): DatabaseIdentity {
  if (!url) {
    throw new Error('Refusing to continue: DATABASE_URL is unset.');
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Refusing to continue: DATABASE_URL is unparseable.');
  }

  const host = parsed.hostname;
  if (LOCAL_HOSTS.includes(host)) {
    return { host, confirmationValue: host, confirmationLabel: 'database host', isLocal: true };
  }

  if (!ALLOWED_REMOTE_HOST_FRAGMENTS.some((fragment) => host.includes(fragment))) {
    throw new Error(
      `Refusing to continue: DATABASE_URL host '${host}' is not recognised ` +
        `(allowed: ${[...LOCAL_HOSTS, ...ALLOWED_REMOTE_HOST_FRAGMENTS].join(', ')}). ` +
        'This command DESTROYS data — add the host deliberately if it really is disposable.',
    );
  }

  const ref = projectRefFrom(parsed.username);
  if (!ref) {
    throw new Error(
      `Refusing to continue: DATABASE_URL host '${host}' is a shared Supabase pooler, but its ` +
        'username carries no project ref, so there is no way to tell WHICH database this is. ' +
        'Expected a username of the form postgres.<projectref>.',
    );
  }

  return {
    host,
    confirmationValue: ref,
    confirmationLabel: 'Supabase project ref',
    isLocal: false,
  };
}

export function assertNotProduction(): void {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('Refusing to continue: NODE_ENV is production.');
  }
}

/**
 * Answers "did you MEAN to run this, against THIS database?" — which the host
 * check cannot, because a correctly-configured wrong database passes it.
 *
 * Non-interactive callers pass `--confirm-db=<value>`. The bare `--confirm`
 * flag that used to exist is deliberately rejected: it confirmed intent
 * without naming a target, so it stayed valid after DATABASE_URL changed
 * underneath it, which is precisely the accident being guarded against.
 */
export async function confirmDestructiveIntent(
  identity: DatabaseIdentity,
  summary: Record<string, string>,
): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--confirm')) {
    throw new Error(
      'Refusing to continue: --confirm no longer exists because it named no target. ' +
        `Pass --confirm-db=${identity.confirmationValue} instead — it fails if DATABASE_URL ` +
        'changes underneath it.',
    );
  }

  console.log('\nThis DESTROYS data in a real database.');
  console.log(`  host                : ${identity.host}`);
  console.log(`  ${identity.confirmationLabel.padEnd(20)}: ${identity.confirmationValue}`);
  for (const [label, value] of Object.entries(summary)) {
    console.log(`  ${label.padEnd(20)}: ${value}`);
  }

  const flag = args.find((a) => a.startsWith('--confirm-db='));
  if (flag) {
    const supplied = flag.slice('--confirm-db='.length);
    if (supplied !== identity.confirmationValue) {
      throw new Error(
        `Refusing to continue: --confirm-db='${supplied}' does not match this database's ` +
          `${identity.confirmationLabel} ('${identity.confirmationValue}'). ` +
          'DATABASE_URL may not be pointing where you think.',
      );
    }
    console.log(`\nProceeding: --confirm-db matched the ${identity.confirmationLabel}.`);
    return;
  }

  if (!process.stdin.isTTY) {
    throw new Error(
      'Refusing to continue: not an interactive terminal and no --confirm-db was supplied. ' +
        `Pass --confirm-db=${identity.confirmationValue} only when the run is genuinely intended.`,
    );
  }

  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(
      `\nType the ${identity.confirmationLabel} to proceed (${identity.confirmationValue}): `,
    );
    if (answer.trim() !== identity.confirmationValue) {
      throw new Error(
        `Refusing to continue: confirmation did not match the ${identity.confirmationLabel}.`,
      );
    }
  } finally {
    rl.close();
  }
}

/**
 * Booting AppModule starts BullMQ workers unless RUN_WORKERS is off (ACC-92),
 * and against the SHARED Redis those compete with the deployed instance.
 * Stated rather than hidden — someone running this deserves to know.
 */
export function warnIfSharedRedis(): void {
  const url = process.env['REDIS_URL'];
  if (!url) return;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return;
  }
  if (LOCAL_HOSTS.includes(host)) return;

  if (process.env['RUN_WORKERS'] === 'true') {
    console.warn(
      `\n⚠  REDIS_URL points at '${host}' and RUN_WORKERS=true, so this process will\n` +
        '   register BullMQ workers and compete with any deployed instance for jobs\n' +
        '   (ACC-51, ACC-92). Unset RUN_WORKERS unless that is deliberate.\n',
    );
  }
}
