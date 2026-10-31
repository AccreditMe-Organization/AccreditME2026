// ACC-275 — the audit gate's accepted findings. node:test only, no
// dependencies: `node --test .github/scripts/`, run in the dependencies job
// before the gate itself.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, validateAllowlist } = require('./audit-gate');

const TODAY = '2026-10-31';
const GLOB = 'GHSA-3g3m-2fjr-6pw4';
const MINIMATCH = 'GHSA-g3hv-75wg-m249';

// The shape npm audit --json gave on 31 Oct: two advisories with no fix, and
// two packages (karma, rimraf) that only inherit them, named by string.
const advisory = (name, ghsa) => ({
  source: 1,
  name,
  title: `${name} advisory`,
  url: `https://github.com/advisories/${ghsa}`,
  severity: 'moderate',
  range: '*',
});
const finding = (via, fixAvailable = false) => ({ severity: 'moderate', via, range: '*', fixAvailable });
const report = (vulnerabilities) => ({ vulnerabilities, metadata: { vulnerabilities: { moderate: Object.keys(vulnerabilities).length } } });
const KARMA_TREE = {
  glob: finding([advisory('glob', GLOB), 'minimatch']),
  minimatch: finding([advisory('minimatch', MINIMATCH)]),
  karma: finding(['glob', 'minimatch', 'rimraf']),
  rimraf: finding(['glob']),
};
const entry = (pkg, ghsa, reviewBy = '2027-01-31', workspace = 'frontend') => ({
  workspace,
  advisory: ghsa,
  package: pkg,
  reason: 'Reaches us only through Karma, the test runner, which never ships; no fixed version exists yet.',
  reviewBy,
});
const BOTH = [entry('glob', GLOB), entry('minimatch', MINIMATCH)];
const run = (vulnerabilities, allowlist, workspace = 'frontend') =>
  evaluate({ report: report(vulnerabilities), allowlist, workspace, today: TODAY });

test('accepted findings pass, each printed with its review date', () => {
  const result = run(KARMA_TREE, BOTH);
  assert.equal(result.exitCode, 0);
  for (const name of ['glob', 'minimatch', 'karma', 'rimraf']) {
    assert.ok(result.out.some((l) => l.includes(`${name} (moderate) — accepted (reviewBy 2027-01-31)`)), name);
  }
  assert.deepEqual(result.err, []);
});

test('an unlisted unfixable finding still fails, named', () => {
  const result = run({ ...KARMA_TREE, lodash: finding([advisory('lodash', 'GHSA-aaaa-bbbb-cccc')]) }, BOTH);
  assert.equal(result.exitCode, 1);
  assert.ok(result.err.some((l) => l.startsWith('  lodash (moderate)')));
  // The accepted ones are still accepted, and not listed as failures.
  assert.ok(!result.err.some((l) => l.startsWith('  glob ')));
});

test('an entry whose reviewBy has passed fails, naming it', () => {
  const result = run(KARMA_TREE, [entry('glob', GLOB, '2026-10-30'), entry('minimatch', MINIMATCH)]);
  assert.equal(result.exitCode, 1);
  assert.ok(result.err.some((l) => l.includes(`allowlist entry ${GLOB} (glob, frontend) expired: reviewBy 2026-10-30 has passed`)));
  // An expired entry accepts nothing: glob is a failure again.
  assert.ok(result.err.some((l) => l.startsWith('  glob (moderate)')));
});

test('a karma-style string via passes only when every package it names is accepted', () => {
  assert.equal(run(KARMA_TREE, BOTH).exitCode, 0);
  // minimatch not accepted: karma (which names it) and glob (which names it) fail.
  const result = run(KARMA_TREE, [entry('glob', GLOB)]);
  assert.equal(result.exitCode, 1);
  for (const name of ['minimatch', 'karma', 'glob']) {
    assert.ok(result.err.some((l) => l.startsWith(`  ${name} (moderate)`)), name);
  }
  // rimraf names only glob, which is itself failing, so rimraf fails too.
  assert.ok(result.err.some((l) => l.startsWith('  rimraf (moderate)')));
});

// The shape CI's Linux install gave on 31 Oct: the reporter has no fix and
// names karma (accepted) and karma-jasmine, which npm marks fixable and which
// itself only names karma. What it reaches is all accepted, so it passes.
test('a named package that is fixable but reaches only accepted advisories does not block', () => {
  const tree = {
    ...KARMA_TREE,
    'karma-jasmine': finding(['karma'], true),
    'karma-jasmine-html-reporter': finding(['karma', 'karma-jasmine']),
  };
  const result = run(tree, BOTH);
  assert.equal(result.exitCode, 0);
  assert.ok(result.out.some((l) => l.includes('karma-jasmine-html-reporter (moderate) — accepted (reviewBy 2027-01-31)')));

  // The same chain reaching an advisory that is NOT on the list still fails.
  const leaking = {
    ...tree,
    'karma-jasmine': finding(['karma', advisory('karma-jasmine', 'GHSA-9999-8888-7777')], true),
  };
  const refused = run(leaking, BOTH);
  assert.equal(refused.exitCode, 1);
  assert.ok(refused.err.some((l) => l.startsWith('  karma-jasmine-html-reporter (moderate)')));
  assert.ok(refused.err.some((l) => l.includes('comes through: karma, karma-jasmine')));
});

test('a named package that is not a finding at all blocks', () => {
  const result = run({ ...KARMA_TREE, reporter: finding(['karma', 'not-in-the-report']) }, BOTH);
  assert.equal(result.exitCode, 1);
  assert.ok(result.err.some((l) => l.startsWith('  reporter (moderate)')));
});

test('an entry that matches nothing warns, without failing', () => {
  const stale = entry('left-pad', 'GHSA-dddd-eeee-ffff');
  const result = run(KARMA_TREE, [...BOTH, stale]);
  assert.equal(result.exitCode, 0);
  assert.ok(result.out.some((l) => l.includes('WARNING: allowlist entry GHSA-dddd-eeee-ffff (left-pad, frontend) matches nothing')));
});

test('an entry counts only for its own workspace', () => {
  const result = run(KARMA_TREE, BOTH, 'backend');
  assert.equal(result.exitCode, 1);
  assert.ok(!result.out.some((l) => l.includes('WARNING')), 'another workspace\'s entries are not stale here');
});

test('a clean report passes exactly as before', () => {
  const result = run({ axios: finding([advisory('axios', 'GHSA-1111-2222-3333')], true) }, BOTH);
  assert.equal(result.exitCode, 0);
  assert.ok(result.out.some((l) => l.includes('no findings without a fix available — gate passed.')));
});

test('an allowlist a person could not have meant is refused, never read as empty', () => {
  assert.throws(() => validateAllowlist({}), /JSON array/);
  assert.throws(() => validateAllowlist([{ ...entry('glob', GLOB), reason: '' }]), /no reason/);
  assert.throws(() => validateAllowlist([entry('glob', GLOB, '31/01/2027')]), /expected YYYY-MM-DD/);
  assert.doesNotThrow(() => validateAllowlist(BOTH));
});
