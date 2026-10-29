#!/usr/bin/env node
// ACC-120 slice 5, PR B (R4) — every permission the matrix can show has a
// sentence in BOTH languages.
//
// The matrix labels each row with a sentence describing what the holder can
// do ("Approve terms and confirm a dissolution"), never the raw key. It shows
// only keys some code checks today (R2), so those are the keys that need one.
// A key that gains a check, by its constant leaving PERMISSIONS_NOT_YET_CHECKED,
// starts appearing in the matrix the same day. Without this scan it would
// appear under its raw key, or in English inside an Arabic session, and
// nothing would say so.
//
// WHERE THE LIST COMES FROM: the backend catalogue,
// backend/src/common/constants/permissions.ts. The keys are the values of its
// `export const X_PERMISSIONS = { … } as const` objects; the not-in-use ones
// are named in `PERMISSIONS_NOT_YET_CHECKED`. In use = the catalogue minus that
// list, the same rule as the backend's `isPermissionInUse()`.
//
// WHAT IS CHECKED, in en.json and ar.json:
//   roles.matrix.sentence["<module>:<action>"]   for every in-use key
//   roles.matrix.module.<module>.name            for every module with one
//   roles.matrix.module.<module>.description
// and NO sentence for a key that is not in use (ACC-272): the sentence table is
// then exactly the in-use list, which is what permission-groups.spec.ts reads
// to check the groups table against the catalogue from inside the frontend.
// Each must be a non-empty string, and in ar.json it must contain Arabic
// letters. An English sentence pasted into the Arabic file is the likeliest
// way this goes wrong, and an "exists" check would wave it through.
//
// NON-VACUITY: a catalogue it cannot parse, or that yields no in-use keys, is
// a failure. A scan that read nothing would pass forever.
//
// Run: npm run check:permission-sentences

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const repoRoot = join(frontendRoot, '..');
const CATALOGUE = join(repoRoot, 'backend', 'src', 'common', 'constants', 'permissions.ts');
const I18N = {
  en: join(frontendRoot, 'src', 'assets', 'i18n', 'en.json'),
  ar: join(frontendRoot, 'src', 'assets', 'i18n', 'ar.json'),
};

const failures = [];
const fail = (msg) => failures.push(msg);

// ── The catalogue ────────────────────────────────────────────────────────────
const source = readFileSync(CATALOGUE, 'utf8');
const constants = new Map(); // 'TASKS_PERMISSIONS.VIEW' -> 'tasks:view'
for (const block of source.matchAll(/export const (\w+_PERMISSIONS)\s*=\s*\{([\s\S]*?)\}\s*as const/g)) {
  for (const entry of block[2].matchAll(/(\w+):\s*'([a-z_]+:[a-z_]+)'/g)) {
    constants.set(`${block[1]}.${entry[1]}`, entry[2]);
  }
}
const notYet = /export const PERMISSIONS_NOT_YET_CHECKED\b[^=]*=\s*\[([\s\S]*?)\];/.exec(source);
if (constants.size === 0) fail(`no permission constants found in ${CATALOGUE}`);
if (!notYet) fail(`PERMISSIONS_NOT_YET_CHECKED not found in ${CATALOGUE}`);

const notInUse = new Set();
for (const ref of (notYet?.[1] ?? '').matchAll(/(\w+_PERMISSIONS\.\w+)/g)) {
  const key = constants.get(ref[1]);
  if (!key) fail(`PERMISSIONS_NOT_YET_CHECKED names ${ref[1]}, which is not a permission constant`);
  else notInUse.add(key);
}
const inUse = [...new Set(constants.values())].filter((k) => !notInUse.has(k)).sort();
if (inUse.length === 0) fail('the catalogue yields no in-use keys');
const modules = [...new Set(inUse.map((k) => k.split(':')[0]))].sort();

// ── The translations ─────────────────────────────────────────────────────────
const ARABIC_LETTER = /[؀-ۿ]/;
for (const [lang, file] of Object.entries(I18N)) {
  const matrix = JSON.parse(readFileSync(file, 'utf8'))?.roles?.matrix ?? {};
  const check = (label, value) => {
    if (typeof value !== 'string' || value.trim() === '') fail(`${lang}: ${label} is missing`);
    else if (lang === 'ar' && !ARABIC_LETTER.test(value)) fail(`${lang}: ${label} is not in Arabic: "${value}"`);
  };
  for (const key of inUse) check(`sentence for ${key}`, matrix.sentence?.[key]);
  for (const key of Object.keys(matrix.sentence ?? {})) {
    if (!inUse.includes(key)) fail(`${lang}: a sentence for ${key}, which is not an in-use catalogue key`);
  }
  for (const m of modules) {
    check(`module name for ${m}`, matrix.module?.[m]?.name);
    check(`module description for ${m}`, matrix.module?.[m]?.description);
  }
}

if (failures.length > 0) {
  console.error('check:permission-sentences FAILED');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`check:permission-sentences: ${inUse.length} in-use keys across ${modules.length} modules, both languages.`);
