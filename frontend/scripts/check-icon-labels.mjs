#!/usr/bin/env node
// ACC-111 — icon-only controls must carry a name.
//
// `IconButtonComponent` makes this structural for anything built on it: its
// `label` is a required input, so an unlabelled one is a compile error
// (NG8008) and `ng build` fails. Verified by mutation, not assumed.
//
// But that only covers components the build actually REACHES, and it says
// nothing about the raw `<p-button icon="...">` and `<button><i class="pi">`
// controls already in the app — largely the action buttons on table rows,
// which is exactly where the design says an unnamed control hurts most,
// because twenty rows give a screen-reader user twenty identical buttons.
//
// So this scan counts what has not migrated yet. It is deliberately a RATCHET
// rather than a gate:
//
//   count <= BASELINE   -> passes, and prints the count
//   count >  BASELINE   -> FAILS: a new unlabelled control was added
//
// Lower BASELINE as screens migrate. At 0 it becomes a plain gate and this
// comment can go. A number that goes down on every migration is visible in a
// way that "enforce it later" never is — "later" is how ACC-91 and ACC-93
// both happened.
//
// Run: npm run check:icon-labels     (CI: frontend job, beside check:contrast)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const appDir = join(root, 'src', 'app');

// Measured on the branch that introduced this scan. See the header.
const BASELINE = 29;

// A TOOLTIP IS NOT A NAME. pTooltip is deliberately absent here: a tooltip is
// unreachable to a screen reader and to a touch user, so a control carrying
// only a tooltip is still unnamed — which is the design's own rule ("no
// meaning lives in the tooltip alone"). Counting it as a name would have
// hidden the org-unit-tree row buttons, the densest case in the app.
const NAMED = /\baria-label\b|\baria-labelledby\b|\[?ariaLabel\]?\s*=/;
const HAS_ICON = /\bicon\s*=|\[icon\]\s*=/;
const HAS_TEXT_LABEL = /\blabel\s*=|\[label\]\s*=/;

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

const lineOf = (source, index) => source.slice(0, index).split(/\r?\n/).length;

const findings = [];

for (const file of sourceFiles(appDir)) {
  const source = readFileSync(file, 'utf8');
  const name = relative(root, file);

  // A <p-button> with an icon and no visible label is icon-only.
  for (const m of source.matchAll(/<p-button\b([^>]*)>/g)) {
    const attrs = m[1];
    if (!HAS_ICON.test(attrs)) continue;
    if (HAS_TEXT_LABEL.test(attrs) || NAMED.test(attrs)) continue;
    findings.push(`${name}:${lineOf(source, m.index)}: <p-button> with an icon and no label`);
  }

  // A native <button> whose only content is an icon element.
  for (const m of source.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const [, attrs, inner] = m;
    const hasIcon = /<i\b|class="[^"]*\bpi\b|class="[^"]*\bti\b/.test(inner);
    if (!hasIcon) continue;
    const text = inner
      .replace(/<[^>]*>/g, '')
      .replace(/\{\{[^}]*\}\}/g, 'X') // an interpolation IS visible text
      .trim();
    if (text.length > 0) continue;
    if (NAMED.test(attrs)) continue;
    findings.push(`${name}:${lineOf(source, m.index)}: icon-only <button> with no accessible name`);
  }
}

const count = findings.length;
console.log(`Icon labels (ACC-111): ${count} unlabelled icon-only control(s); baseline ${BASELINE}.`);

if (count > 0) {
  console.log(findings.map((f) => `  ${f}`).join('\n'));
}

if (count > BASELINE) {
  console.error(
    `\nFAIL: ${count - BASELINE} more than the baseline. A new icon-only control needs a name —` +
      ` use IconButtonComponent, whose label is required.`,
  );
  process.exit(1);
}

if (count < BASELINE) {
  console.log(`\n${BASELINE - count} fewer than the baseline. Lower BASELINE to ${count} in this script.`);
}

if (count === 0) {
  console.log('\nNone left: drop the ratchet and make this a plain gate.');
}
