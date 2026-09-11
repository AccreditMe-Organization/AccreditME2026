#!/usr/bin/env node
/**
 * ACC-75 — CI dependency gate.
 *
 * FAILS ONLY ON FINDINGS WITH NO FIX AVAILABLE. Not on severity.
 *
 * Why not severity: an unfixable HIGH is qualitatively different from one
 * awaiting a version bump. `xlsx` was dangerous precisely because there was
 * nowhere to go — SheetJS left the npm registry, so the published fixes
 * (0.19.3, 0.20.2) simply do not exist there. A HIGH with a fix available is
 * a maintenance task; one without is a decision about whether to keep the
 * package at all.
 *
 * The practical half matters just as much: at the time this was written the
 * tree carried 26 HIGH findings across both workspaces, every one of them
 * fixable, several needing a semver-major Prisma upgrade. A gate failing on
 * severity would have red-flagged `dev` on its first run — and a gate that
 * does that gets disabled within a week, leaving no scanning AND a disabled
 * job that still looks like scanning. This one goes green immediately and
 * stays meaningful.
 *
 * KNOWN GAP, stated rather than discovered later: this does NOT catch a
 * fixable HIGH left unpatched indefinitely. That is a real hole. The better
 * answer to it is Dependabot raising upgrade PRs — which keeps the pressure
 * on without blocking every merge behind a major version bump. Dependabot
 * remains unconfigured (no .github/dependabot.yml). Worth doing; deliberately
 * not done here.
 */

const fs = require('fs');

const [, , reportPath, label = reportPath] = process.argv;

if (!reportPath) {
  console.error('usage: audit-gate.js <path-to-npm-audit-json> [label]');
  process.exit(2);
}

let report;
try {
  report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
} catch (err) {
  // A missing or malformed report is a broken gate, not a clean tree —
  // never pass by default here.
  console.error(`Could not read audit report at ${reportPath}: ${err.message}`);
  process.exit(2);
}

const vulnerabilities = report.vulnerabilities || {};
const totals = (report.metadata && report.metadata.vulnerabilities) || {};

// `fixAvailable` has THREE shapes in npm's output:
//   true    — a straightforward upgrade fixes it
//   false   — nothing to upgrade to (what this gate exists for)
//   object  — { name, version, isSemVerMajor }, a breaking upgrade fixes it
//
// Only `false` means there is nowhere to go. An object is truthy, so testing
// falsiness happens to work today — but compare identity so the intent is
// explicit and a future shape change cannot silently widen the gate.
const unfixable = Object.entries(vulnerabilities).filter(
  ([, v]) => v.fixAvailable === false,
);

console.log(`[${label}] findings: ${JSON.stringify(totals)}`);

if (unfixable.length === 0) {
  console.log(`[${label}] no findings without a fix available — gate passed.`);
  process.exit(0);
}

console.error('');
console.error(`[${label}] dependencies with NO fix available:`);
for (const [name, v] of unfixable) {
  console.error(`  ${name} (${v.severity}) — ${v.range || 'unknown range'}`);
  for (const via of v.via || []) {
    if (via && typeof via === 'object') {
      console.error(`      ${via.title}  ${via.url || ''}`);
    }
  }
}
console.error('');
console.error('These cannot be patched by upgrading. Each is a decision about');
console.error('whether to keep the package, not a maintenance task.');
console.error('Context: ACC-75.');
process.exit(1);
