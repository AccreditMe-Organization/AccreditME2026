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
 * ACC-275 — A DECISION TO KEEP A PACKAGE IS RECORDED, WITH A REVIEW DATE.
 * `.github/audit-allowlist.json` lists accepted findings: workspace, advisory
 * (the GHSA id), package, a one-sentence reason, and reviewBy. An unfixable
 * finding is ACCEPTED when every entry in its `via` is accepted:
 *   - an advisory object, by an unexpired entry for this workspace naming that
 *     advisory and package;
 *   - a package name (string), when that package is itself a finding in the
 *     report whose own `via` is accepted, by these same rules. This is how a
 *     package that only inherits an advisory appears (karma and rimraf,
 *     through glob and minimatch). Whether npm marks the named package
 *     fixable does not matter: on CI's Linux install karma-jasmine-html-
 *     reporter named karma-jasmine, marked fixable, which reached only karma.
 * Accepted findings are printed with their review date and do not fail.
 * EVERYTHING ELSE IS AS BEFORE: a new unfixable finding, one not on the list,
 * still fails. An entry whose reviewBy has passed FAILS the gate, naming it:
 * the decision has to be taken again, not left to lapse into permanence. An
 * entry that matches nothing WARNS, so the list does not quietly accumulate
 * exceptions nobody needs.
 *
 * KNOWN GAP, stated rather than discovered later: this does NOT catch a
 * fixable HIGH left unpatched indefinitely. That is a real hole. The better
 * answer to it is Dependabot raising upgrade PRs — which keeps the pressure
 * on without blocking every merge behind a major version bump. Dependabot
 * remains unconfigured (no .github/dependabot.yml). Worth doing; deliberately
 * not done here.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_ALLOWLIST = path.join(__dirname, '..', 'audit-allowlist.json');
const REQUIRED_FIELDS = ['workspace', 'advisory', 'package', 'reason', 'reviewBy'];

/** The advisory's GHSA id, from its URL; npm's numeric source id otherwise. */
function advisoryId(via) {
  const match = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i.exec(via.url || '');
  return match ? match[0] : String(via.source);
}

/** Throws on a list a person could not have meant: a broken gate, never a pass. */
function validateAllowlist(entries) {
  if (!Array.isArray(entries)) throw new Error('the allowlist must be a JSON array');
  entries.forEach((entry, i) => {
    for (const field of REQUIRED_FIELDS) {
      if (typeof entry[field] !== 'string' || entry[field].trim() === '') {
        throw new Error(`entry ${i} has no ${field}`);
      }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.reviewBy)) {
      throw new Error(`entry ${i} (${entry.advisory}) has reviewBy "${entry.reviewBy}"; expected YYYY-MM-DD`);
    }
  });
  return entries;
}

const describe = (e) => `${e.advisory} (${e.package}, ${e.workspace})`;

/**
 * Decide the gate for one workspace's npm audit report. Pure: everything it
 * needs is passed in, so the tests can fix the date.
 *
 * @returns {{ exitCode: number, out: string[], err: string[] }}
 */
function evaluate({ report, allowlist, workspace, today, label = workspace }) {
  const out = [];
  const err = [];
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
  const isUnfixable = (name) => !!vulnerabilities[name] && vulnerabilities[name].fixAvailable === false;
  const unfixable = Object.keys(vulnerabilities).filter(isUnfixable);

  const mine = allowlist.filter((e) => e.workspace === workspace);
  const expired = mine.filter((e) => e.reviewBy < today);
  const live = mine.filter((e) => e.reviewBy >= today);
  const entryFor = (via, finding) =>
    live.find((e) => e.advisory === advisoryId(via) && e.package === (via.name || finding));

  // The earliest review date that accepts this finding, or null when it is not
  // accepted. A package named in a `via` must itself be in the report and
  // reach only accepted advisories; whether npm marks IT fixable does not
  // matter (CI's Linux install marked karma-jasmine fixable while it reached
  // only karma). `seen` stops a cycle of package names accepting itself.
  function acceptedUntil(name, seen = new Set()) {
    if (!vulnerabilities[name] || seen.has(name)) return null;
    const via = vulnerabilities[name].via || [];
    if (via.length === 0) return null;
    seen.add(name);
    let until = null;
    for (const item of via) {
      const date =
        typeof item === 'string' ? acceptedUntil(item, seen) : (entryFor(item, name) || {}).reviewBy || null;
      if (!date) {
        seen.delete(name);
        return null;
      }
      if (!until || date < until) until = date;
    }
    seen.delete(name);
    return until;
  }

  out.push(`[${label}] findings: ${JSON.stringify(totals)}`);

  const accepted = [];
  const failing = [];
  for (const name of unfixable) {
    const until = acceptedUntil(name);
    if (until) accepted.push([name, until]);
    else failing.push(name);
  }
  for (const [name, until] of accepted) {
    out.push(`[${label}] ${name} (${vulnerabilities[name].severity}) — accepted (reviewBy ${until})`);
  }

  // An entry matches something when its advisory is in the via of an
  // unfixable finding in this workspace, accepted or not.
  const matches = (e) =>
    unfixable.some((name) =>
      (vulnerabilities[name].via || []).some(
        (item) => typeof item === 'object' && item && advisoryId(item) === e.advisory && (item.name || name) === e.package,
      ),
    );
  for (const e of live.filter((entry) => !matches(entry))) {
    out.push(`[${label}] WARNING: allowlist entry ${describe(e)} matches nothing; remove it if it is no longer needed.`);
  }

  if (failing.length === 0 && expired.length === 0) {
    out.push(
      accepted.length === 0
        ? `[${label}] no findings without a fix available — gate passed.`
        : `[${label}] every finding without a fix available is accepted — gate passed.`,
    );
    return { exitCode: 0, out, err };
  }

  for (const e of expired) {
    err.push(`[${label}] allowlist entry ${describe(e)} expired: reviewBy ${e.reviewBy} has passed.`);
    err.push('    Review it: renew it with a new date and reason, or remove the package.');
  }
  if (failing.length > 0) {
    err.push('');
    err.push(`[${label}] dependencies with NO fix available:`);
    for (const name of failing) {
      const v = vulnerabilities[name];
      err.push(`  ${name} (${v.severity}) — ${v.range || 'unknown range'}`);
      for (const item of v.via || []) {
        if (item && typeof item === 'object') err.push(`      ${item.title}  ${item.url || ''}`);
      }
      // A package that only inherits a finding names where it comes from.
      const through = (v.via || []).filter((item) => typeof item === 'string');
      if (through.length > 0) err.push(`      comes through: ${through.join(', ')}`);
    }
    err.push('');
    err.push('These cannot be patched by upgrading. Each is a decision about');
    err.push('whether to keep the package, not a maintenance task. To keep one,');
    err.push('record it in .github/audit-allowlist.json with a reason and a reviewBy date.');
    err.push('Context: ACC-75, ACC-275.');
  }
  return { exitCode: 1, out, err };
}

function main() {
  const [, , reportPath, label = reportPath, allowlistPath = DEFAULT_ALLOWLIST] = process.argv;
  if (!reportPath) {
    console.error('usage: audit-gate.js <path-to-npm-audit-json> [workspace] [allowlist]');
    process.exit(2);
  }

  let report;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch (error) {
    // A missing or malformed report is a broken gate, not a clean tree —
    // never pass by default here.
    console.error(`Could not read audit report at ${reportPath}: ${error.message}`);
    process.exit(2);
  }

  let allowlist = [];
  if (fs.existsSync(allowlistPath)) {
    try {
      allowlist = validateAllowlist(JSON.parse(fs.readFileSync(allowlistPath, 'utf8')));
    } catch (error) {
      // Same rule: a list nobody can read accepts nothing and passes nothing.
      console.error(`Could not use the allowlist at ${allowlistPath}: ${error.message}`);
      process.exit(2);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const { exitCode, out, err } = evaluate({ report, allowlist, workspace: label, today, label });
  out.forEach((line) => console.log(line));
  err.forEach((line) => console.error(line));
  // In GitHub Actions, the reasons also become annotations: they show on the
  // PR's checks and can be read without the job log, which needs admin rights.
  if (process.env.GITHUB_ACTIONS === 'true') {
    for (const line of [...out, ...err]) {
      const text = line.trim();
      if (/^\S+ \(\w+\) — /.test(text) || text.includes('expired: reviewBy') || text.startsWith('comes through:')) {
        if (!text.includes('accepted (reviewBy')) console.log(`::error title=Audit gate (${label})::${text}`);
      } else if (text.includes('WARNING: allowlist entry')) {
        console.log(`::warning title=Audit gate (${label})::${text}`);
      }
    }
  }
  process.exit(exitCode);
}

module.exports = { evaluate, validateAllowlist, advisoryId };

if (require.main === module) main();
