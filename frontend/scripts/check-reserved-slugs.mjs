#!/usr/bin/env node
// ACC-139 — the frontend's copy of the infrastructure labels must equal the
// backend's.
//
// The backend list (backend/src/common/tenant/reserved-slugs.ts) is the
// authority: a tenant cannot be created with one of those slugs. The frontend
// copy (src/app/core/tenant/reserved-labels.ts) makes the same addresses show
// the "open your organisation's address" note instead of a sign-in form. Two
// hand-kept lists drift — so this fails CI the moment they differ, in either
// direction, and names each label that is in one and not the other.
//
// NON-VACUITY: a list it cannot find, or finds empty, is a failure. A scan that
// silently compares two empty lists would pass forever.
//
// Run: npm run check:reserved-slugs

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const repoRoot = join(frontendRoot, '..');

const SOURCES = {
  backend: join(repoRoot, 'backend', 'src', 'common', 'tenant', 'reserved-slugs.ts'),
  frontend: join(frontendRoot, 'src', 'app', 'core', 'tenant', 'reserved-labels.ts'),
};

/** The string literals of `export const INFRASTRUCTURE_LABELS … = [ … ];`. */
function labelsIn(file) {
  const text = readFileSync(file, 'utf8');
  const match = /export const INFRASTRUCTURE_LABELS\b[^=]*=\s*\[([\s\S]*?)\];/.exec(text);
  if (!match) return null;
  return [...match[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

let failed = false;
const lists = {};
for (const [side, file] of Object.entries(SOURCES)) {
  const labels = labelsIn(file);
  if (!labels || labels.length === 0) {
    console.error(`check:reserved-slugs — no INFRASTRUCTURE_LABELS found in ${file}`);
    failed = true;
    continue;
  }
  const dupes = labels.filter((l, i) => labels.indexOf(l) !== i);
  if (dupes.length) {
    console.error(`check:reserved-slugs — ${side} lists ${dupes.join(', ')} more than once`);
    failed = true;
  }
  lists[side] = new Set(labels);
}

if (lists.backend && lists.frontend) {
  const onlyBackend = [...lists.backend].filter((l) => !lists.frontend.has(l));
  const onlyFrontend = [...lists.frontend].filter((l) => !lists.backend.has(l));
  if (onlyBackend.length) {
    console.error(`check:reserved-slugs — in the backend list only: ${onlyBackend.join(', ')}`);
    failed = true;
  }
  if (onlyFrontend.length) {
    console.error(`check:reserved-slugs — in the frontend list only: ${onlyFrontend.join(', ')}`);
    failed = true;
  }
  if (!failed) {
    console.log(`check:reserved-slugs — ${lists.backend.size} infrastructure labels, identical in both lists.`);
  }
}

if (failed) {
  console.error('Change both lists in the same commit: the backend file is the authority.');
  process.exit(1);
}
