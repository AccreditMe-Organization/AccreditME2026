#!/usr/bin/env node
// ACC-111 — PrimeNG overlays inside a dialog, caught statically.
//
// The runtime guard (shared/overlay/overlay-guard.ts) only sees overlays WE
// construct. A raw p-select, p-datepicker or p-overlaypanel builds its own
// overlay inside PrimeNG, whose ConnectedOverlayScrollHandler closes it on ANY
// ancestor scroll — and a dialog body is a scrollable ancestor. Patching
// PrimeNG to satisfy our rule would be worse than the rule, so those cases are
// found here instead, by reading the templates.
//
// Artboard 7's answer for a dialog is not "use a different overlay": a panel
// inside a dialog EXPANDS IN FLOW, pushing the content below it, so there is
// no floating layer to dismiss. A date picker uses [inline], a long option
// list becomes its own picker dialog at the root, and typing is always a
// complete path to the value.
//
// ## Finding the dialog's CONTENT, not just its host
//
// The naive version of this scan — "does this file render a dialog?" — misses
// almost every real case, because a dialog's host and its form are different
// files: public-holiday-list.component.ts opens the dialog,
// public-holiday-form.component.ts holds the date picker. So this resolves one
// hop: it maps every component selector to its file, finds the components a
// dialog-hosting file renders, and scans those too.
//
// ## Known imprecision, stated rather than hidden
//
// Resolution is per FILE, not per template region: a component that hosts a
// dialog AND has controls elsewhere on its own page (user-profile is the
// example) has all of them reported. The scan over-reports rather than
// under-reports, deliberately — a missed p-datepicker in a dialog is the bug
// this exists to prevent, and a false positive costs a reader one look.
//
// ## An ALLOWLIST, not a baseline (ACC-120 slice 2)
//
// It used to be a ratchet: one number, lowered as dialogs migrated. That number
// reached 0 real defects while still reading 9, because every remaining finding
// was the over-report described above — a page-level control in a file that
// also hosts a dialog. A single number cannot tell those apart, so it was
// simultaneously too weak (a NEW p-select in user-profile's dialog would have
// sat inside the 9 and passed) and uninformative (nobody could tell which of
// the 9 were real).
//
// Now every finding must be matched by an explicit entry naming the file, the
// tag, HOW MANY are expected, and why. The count is checked for EQUALITY, not
// as a ceiling, which is what stops a casual fifth: adding one more p-datepicker
// to user-profile makes its 3 a 4, no entry matches, and CI fails naming the
// file. Removing one fails too, and says to lower the entry — so an allowance
// cannot outlive the thing it was written for.
//
// Run: npm run check:dialog-overlays   (CI: frontend job)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const appDir = join(root, 'src', 'app');

// Every allowed finding, with its reason. An entry is a claim that the scan's
// per-FILE resolution is over-reporting: the control exists on the page, not in
// the dialog the file happens to host. Nothing here is a deferred defect.
//
// `count` is EXACT. A file drifting either way fails.
const ALLOWED = [
  {
    file: 'src/app/foundation/user/components/user-profile/user-profile.component.ts',
    tag: 'p-datepicker',
    count: 3,
    reason:
      "Page-level: actingOrgUnitUntil, outOfOfficeFrom and outOfOfficeTo sit in " +
      "the profile form on the page. The dialog this file hosts holds only " +
      "<app-transfer-user-wizard>, which is a separate file and is scanned on " +
      "its own. Reported because resolution is per file, not per template region.",
  },
  {
    file: 'src/app/foundation/working-calendar/components/public-holiday-list/public-holiday-list.component.ts',
    tag: 'p-select',
    count: 1,
    reason:
      "Page-level: the year filter, in the page header's pageActions slot. The " +
      "dialog this file hosts holds only <app-public-holiday-form>, whose own " +
      "date field is already an [inline] layer at the root.",
  },
];

const OVERLAY_TAGS =
  /<(p-select|p-multiSelect|p-multiselect|p-datepicker|p-datePicker|p-overlayPanel|p-overlaypanel|p-autoComplete|p-autocomplete|p-cascadeSelect)\b([^>]*)>/g;

const HOSTS_DIALOG = /<app-edit-dialog\b|<p-dialog\b/;

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      yield* sourceFiles(path);
    } else if (/\.(ts|html)$/.test(entry) && !entry.endsWith('.spec.ts')) {
      yield path;
    }
  }
}

/**
 * Strips // and block comments. Without this the scan reports the long
 * explanatory comment in edit-dialog.component.ts, which NAMES p-select and
 * p-multiSelect while describing the very bug this scan exists for.
 */
function stripComments(source) {
  return (
    source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      // ACC-96 — HTML comments too. A template comment EXPLAINING why a tag is
      // not used ("NOT a <p-datepicker> with its own panel") was counted as
      // that tag, so documenting the fix re-reported the defect it fixed. The
      // JS-comment strip above exists for exactly this reason; this is the
      // same hazard in the other comment syntax, and check-create-gating.mjs
      // already strips both.
      .replace(/<!--[\s\S]*?-->/g, '')
  );
}

const lineOf = (source, index) => source.slice(0, index).split(/\r?\n/).length;

const files = [...sourceFiles(appDir)];
const cleaned = new Map(files.map((f) => [f, stripComments(readFileSync(f, 'utf8'))]));

// selector -> file, for every component in the app.
const selectorFile = new Map();
for (const [file, source] of cleaned) {
  for (const m of source.matchAll(/selector:\s*'([^']+)'/g)) selectorFile.set(m[1], file);
}

// Files that open a dialog, plus the component files they render inside it.
const toScan = new Set();
for (const [file, source] of cleaned) {
  if (!HOSTS_DIALOG.test(source)) continue;
  toScan.add(file);
  for (const m of source.matchAll(/<(app-[a-z0-9-]+)\b/g)) {
    const target = selectorFile.get(m[1]);
    if (target) toScan.add(target);
  }
}

const findings = [];
for (const file of [...toScan].sort()) {
  const source = cleaned.get(file);
  const name = relative(root, file);
  for (const m of source.matchAll(OVERLAY_TAGS)) {
    const [, tag, attrs] = m;
    // [inline] is the artboard-7 answer: it expands in flow, so there is no
    // overlay to dismiss.
    if (/\binline\b/.test(attrs)) continue;
    findings.push({
      file: name,
      tag,
      text: `${name}:${lineOf(source, m.index)}: <${tag}> reachable inside a dialog`,
    });
  }
}

// Group the findings the way the allowlist describes them: file + tag.
const observed = new Map();
for (const f of findings) {
  const key = `${f.file}::${f.tag}`;
  observed.set(key, (observed.get(key) ?? 0) + 1);
}

const problems = [];
const allowedKeys = new Set();

for (const entry of ALLOWED) {
  const key = `${entry.file.split('/').join(sep)}::${entry.tag}`;
  allowedKeys.add(key);
  const seen = observed.get(key) ?? 0;
  if (seen === entry.count) continue;
  problems.push(
    seen === 0
      ? `${entry.file}: allowlisted for ${entry.count} <${entry.tag}>, but none remain. ` +
          `Delete the entry — an allowance must not outlive what it allowed.`
      : `${entry.file}: allowlisted for ${entry.count} <${entry.tag}>, found ${seen}. ` +
          (seen > entry.count
            ? `A NEW overlay was added. If it is in the dialog, use [inline], ` +
              `OverlaySelectComponent, or a picker dialog at the root (artboard 7). ` +
              `If it is genuinely page-level, raise the count AND say so in the reason.`
            : `Raise nothing — lower the count to ${seen}.`),
  );
}

for (const [key, seen] of observed) {
  if (allowedKeys.has(key)) continue;
  const [file, tag] = key.split('::');
  problems.push(
    `${file.split(sep).join('/')}: ${seen} <${tag}> reachable inside a dialog, with no allowlist entry.`,
  );
}

console.log(
  `Dialog overlays (ACC-111): ${findings.length} PrimeNG overlay(s) reachable inside dialogs; ` +
    `${ALLOWED.reduce((n, e) => n + e.count, 0)} allowlisted as page-level.`,
);
if (findings.length > 0) {
  for (const f of findings) console.log(`  ${f.text}`);
}

if (problems.length > 0) {
  console.error('\nFAIL:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
