/**
 * ACC-316 PR 3b — imported FIRST by meeting-invitees.wiring.spec.ts, before the
 * app's modules: which providers a module registers (the queue workers under
 * RUN_WORKERS) is decided when its decorator runs, at import time. Harmless
 * local values: compiling the graph connects to nothing (workers start in
 * onModuleInit, which compile() never runs).
 */
const VALUES: Record<string, string> = {
  RUN_WORKERS: 'true',
  API_ORIGIN: 'http://localhost:3000',
  FRONTEND_URL: 'http://localhost:4200',
  BETTER_AUTH_SECRET: 'wiring-spec-secret-wiring-spec-secret',
  JWT_SECRET: 'wiring-spec-jwt-secret',
  ENCRYPTION_KEY: 'f'.repeat(64),
  DATABASE_URL: 'postgresql://wiring:spec@localhost:5432/never-connected',
  RESEND_API_KEY: 're_wiring_spec_never_sends',
};

// process.env is shared by every spec file a Jest worker runs: what is set here
// is put back afterwards (restoreWiringEnv(), in the spec's afterAll).
const previous = new Map(Object.keys(VALUES).map((key) => [key, process.env[key]]));
for (const [key, value] of Object.entries(VALUES)) process.env[key] = value;

export function restoreWiringEnv(): void {
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
