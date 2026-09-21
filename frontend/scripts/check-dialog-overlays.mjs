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
// A RATCHET, like check-icon-labels.mjs: it prints what has not migrated and
// fails only when the count grows. Lower BASELINE as dialogs are converted.
//
// Run: npm run check:dialog-overlays   (CI: frontend job)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const appDir = join(root, 'src', 'app');

// Measured on the branch that introduced this scan, lowered as screens migrate.
// 12 -> 10 (ACC-96): task-form's and org-unit-head-panel's date pickers became
// their own root layers, so neither builds a floating overlay any more. The
// ten that remain are six p-selects, which are a DIFFERENT defect with a
// different remedy (OverlaySelectComponent), plus user-profile's three, which
// the scan over-reports per file — its pickers are page-level, not in a dialog.
const BASELINE = 10;

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
    findings.push(`${name}:${lineOf(source, m.index)}: <${tag}> reachable inside a dialog`);
  }
}

const count = findings.length;
console.log(`Dialog overlays (ACC-111): ${count} PrimeNG overlay(s) inside dialogs; baseline ${BASELINE}.`);
if (count > 0) console.log(findings.map((f) => `  ${f}`).join('\n'));

if (count > BASELINE) {
  console.error(
    `\nFAIL: ${count - BASELINE} more than the baseline. Inside a dialog a panel expands in flow —` +
      ` use [inline], OverlaySelectComponent, or a picker dialog at the root (artboard 7).`,
  );
  process.exit(1);
}

if (count < BASELINE) {
  console.log(`\n${BASELINE - count} fewer than the baseline. Lower BASELINE to ${count} in this script.`);
}
