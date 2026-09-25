#!/usr/bin/env node
// ACC-120 slice 2 — Design System Rev 7, artboard 13's field-count rule,
// mechanised.
//
// A dialog is compact when its standard-density body would exceed the 420px cap
// OR when it holds FIVE OR MORE field blocks. Only the second half can be
// checked statically, and saying so plainly matters more than pretending
// otherwise: A STATIC SCAN CANNOT MEASURE RENDERED HEIGHT HONESTLY. Fonts, the
// user's language, a wrapped hint and a projected control's own chrome all move
// it. The height half stays a design-time measurement, recorded in each
// dialog's own comment — this scan enforces the half a machine can count.
//
// ## Why it resolves one hop, like check-dialog-overlays.mjs
//
// A dialog's host and its form are different files: the host renders
// <app-edit-dialog>, the fields live in the component it projects. Counting
// per file would find five fields nowhere and report nothing.
//
// ## Known imprecision, stated rather than hidden
//
// Resolution is per FILE, not per template region. A component that hosts a
// dialog AND has fields elsewhere on its own page has all of them counted, so
// the scan over-reports rather than under-reports. That is the deliberate
// direction: a crowded dialog left at form density is the defect this exists to
// prevent, and a false positive costs a reader one look — and can be answered
// by declaring the density, which is never wrong.
//
// Run: npm run check:dialog-density   (CI: frontend job)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const appDir = join(root, 'src', 'app');

// Artboard 13: "five or more field blocks".
const COMPACT_AT_FIELDS = 5;

const HOSTS_DIALOG = /<app-edit-dialog\b/;
const FIELD_TAG = /<am-field\b/g;
const DECLARES_COMPACT = /<app-edit-dialog\b[^>]*\bdensity\s*=\s*"compact"/;

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

// Same hazard as the overlay scan: a comment EXPLAINING the rule names the very
// tags it describes, so documenting the fix would report it as a defect.
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

const files = [...sourceFiles(appDir)];
const cleaned = new Map(files.map((f) => [f, stripComments(readFileSync(f, 'utf8'))]));

const selectorFile = new Map();
for (const [file, source] of cleaned) {
  for (const m of source.matchAll(/selector:\s*'([^']+)'/g)) selectorFile.set(m[1], file);
}

const findings = [];
let dialogsSeen = 0;

for (const [file, source] of cleaned) {
  if (!HOSTS_DIALOG.test(source)) continue;
  dialogsSeen += 1;

  // The host's own fields, plus those of every component it renders.
  const group = new Set([file]);
  for (const m of source.matchAll(/<(app-[a-z0-9-]+)\b/g)) {
    const target = selectorFile.get(m[1]);
    if (target) group.add(target);
  }

  let fields = 0;
  for (const member of group) {
    fields += [...(cleaned.get(member) ?? '').matchAll(FIELD_TAG)].length;
  }

  if (fields >= COMPACT_AT_FIELDS && !DECLARES_COMPACT.test(source)) {
    findings.push(
      `${relative(root, file)}: ${fields} field blocks reachable in this dialog, ` +
        `but it does not declare density="compact"`,
    );
  }
}

console.log(
  `Dialog density (ACC-120): ${dialogsSeen} dialog host(s) scanned; ` +
    `${findings.length} at or past ${COMPACT_AT_FIELDS} fields without a compact declaration.`,
);
if (findings.length > 0) console.log(findings.map((f) => `  ${f}`).join('\n'));

if (findings.length > 0) {
  console.error(
    `\nFAIL: artboard 13 applies compact density to a WHOLE dialog at ` +
      `${COMPACT_AT_FIELDS}+ field blocks. Declare it once on the shell — ` +
      `<app-edit-dialog density="compact"> — and give each field a ` +
      `message="reserved" | "none". Never mix densities inside one dialog.`,
  );
  process.exit(1);
}
