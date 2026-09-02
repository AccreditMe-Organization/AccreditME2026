// CLAUDE.md's tenant-isolation CI gate (.github/workflows/ci.yml) runs
//   jest --testNamePattern="should NOT return records belonging to a different tenant"
// — a test is invisible to that gate unless its full name contains this
// exact literal substring. Until now that string was hand-copied at every
// call site (grep confirms 10+ occurrences across the backend), with no
// shared source of truth — and it has drifted or been paraphrased at
// least 5 times across this codebase's history (ACC-33, ACC-44 audits),
// each time a genuine, passing-locally test invisible to CI.
//
// itEnforcesTenantIsolation() bakes the required literal into one place.
// A call site can no longer get the gate string wrong or paraphrase it —
// it only supplies a short suffix identifying which query is under test.
export const TENANT_ISOLATION_GATE_STRING =
  'should NOT return records belonging to a different tenant';

/**
 * Use in place of `it(...)` for every cross-tenant-isolation test. The
 * CI-required literal is supplied for you — pass only a short suffix
 * describing what's under test (e.g. `'listCommittees'`, `'getById'`).
 * Jest's --testNamePattern does a regex substring match against the full
 * test name, so the appended suffix does not break the CI gate's match.
 */
export function itEnforcesTenantIsolation(
  suffix: string,
  testFn: Parameters<typeof it>[1],
): void {
  it(`${TENANT_ISOLATION_GATE_STRING} — ${suffix}`, testFn);
}
