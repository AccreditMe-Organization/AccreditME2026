#!/usr/bin/env node
// ACC-118 — a create action in a page header must sit behind a permission gate.
//
// ## What this catches, and what it deliberately does not
//
// The ten pages this ticket fixed were found by a person signing in as a
// restricted persona, not by anything systematic. Specs now pin all ten, but a
// spec only ever covers the page it names: an ELEVENTH list page added next
// month would ship ungated with every spec still green. That is the gap this
// closes, and it is the same argument as check-worker-gate.mjs.
//
// **It proves a gate is PRESENT, not that it is wired correctly.** Those are
// different jobs and it is worth being plain about the split:
//
//   this scan  -> every page-header create action has a permission gate at all
//   the specs  -> that gate is the right one, and works in both directions
//
// A scan cannot do the second: deciding whether `canCreate` checks the
// permission the ENDPOINT enforces means reading the controller's decorator,
// and getting that wrong is invisible in the template. So neither replaces the
// other, and a page needs both.
//
// ## Known blind spot, stated rather than discovered
//
// It recognises the shape these pages actually use: a `pi-plus` control inside
// a `pageActions` slot. A create action drawn some other way — a different
// icon, a link in the body, a control outside the header — is invisible to it.
// Widening the pattern would trade those misses for false positives on every
// `pi-plus` in the app, which is the wrong trade for a gate that fails a build.
//
// A GATE, not a ratchet: all ten are gated, so the allowed count is zero.
//
// Run: npm run check:create-gating     (CI: frontend job)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const appDir = join(root, 'src', 'app');

// Any of these in the guarding condition counts: pages gate on their own
// `canCreate`, and the underlying checks are named so a future page that
// inlines one is still recognised.
const GATE_TOKENS = ['canCreate', 'hasPermission', 'isPlatformAdmin'];

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* sourceFiles(path);
    else if (/\.(ts|html)$/.test(entry) && !entry.endsWith('.spec.ts')) yield path;
  }
}

const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');

const lineOf = (s, i) => s.slice(0, i).split(/\r?\n/).length;

const findings = [];
let gatedCount = 0;

for (const file of sourceFiles(appDir)) {
  const source = stripComments(readFileSync(file, 'utf8'));

  // A page header's action slot, bounded by the header it belongs to. Bounding
  // on </app-page-header> rather than a matching </div> avoids counting the
  // page body, where a pi-plus means something else entirely.
  for (const m of source.matchAll(/pageActions[\s\S]*?<\/app-page-header>/g)) {
    const region = m[0];
    if (!/pi-plus/.test(region)) continue; // no create action in this header

    const gated = GATE_TOKENS.some((token) => region.includes(token));
    if (gated) {
      gatedCount += 1;
      continue;
    }
    findings.push(
      `${relative(root, file)}:${lineOf(source, m.index)}: create action in a page header with no permission gate`,
    );
  }
}

console.log(
  `Create-action gating (ACC-118): ${gatedCount} gated, ${findings.length} ungated.`,
);

// Zero gated means the detection broke, not that the app is clean — ten pages
// have one. Same reasoning as check-worker-gate.mjs's own floor.
if (gatedCount === 0) {
  console.error(
    '\nFAIL: found no gated create actions at all. This scan has stopped working —' +
      ' ten pages carry one, so it should never legitimately reach zero.',
  );
  process.exit(1);
}

if (findings.length > 0) {
  console.error(`\n${findings.map((f) => `  ${f}`).join('\n')}`);
  console.error(
    '\nFAIL: a create action offered to a caller who cannot use it is refused by the API' +
      ' and reads as a broken screen. Wrap it: @if (canCreate()) { ... }, with canCreate' +
      " reading the permission that endpoint's @Permissions() enforces.",
  );
  process.exit(1);
}

console.log('\nEvery page-header create action is behind a gate.');
