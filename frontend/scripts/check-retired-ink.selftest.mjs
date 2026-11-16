#!/usr/bin/env node
// ACC-311 — the mutation test for check-retired-ink.mjs.
//
// A scan that has stopped looking looks exactly like one that found nothing.
// This proves, against the real script run as CI runs it (a separate process,
// judged by its exit status):
//
//   1. clean before;
//   2. a file under shared/ using the retired token FAILS, naming the file and
//      its line;
//   3. the same under layout/ FAILS too;
//   4. the same under foundation/ does NOT fail (out of the scan's scope, so a
//      scan widened by accident is caught too);
//   5. clean after, with every temporary file removed, so an interrupted run
//      cannot leave the tree dirty and green.
//
// Run: npm run check:retired-ink:selftest      (CI discovers every check:*)

import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const scan = join(root, 'scripts', 'check-retired-ink.mjs');
const NAME = 'acc311-retired-ink-selftest.mutant.component.ts';
const inShared = join(root, 'src', 'app', 'shared', NAME);
const inLayout = join(root, 'src', 'app', 'layout', NAME);
const inFoundation = join(root, 'src', 'app', 'foundation', NAME);
// The retired token on line 3, so the failure must name line 3.
const MUTANT = `// Temporary file written by check-retired-ink.selftest.mjs. If you are
// reading this in a working tree, a self-test run was interrupted — delete it.
export const ACC311_MUTANT = 'color: var(--am-text-secondary)';
`;

function runScan() {
  try {
    const output = execFileSync(process.execPath, [scan], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, output };
  } catch (e) {
    return { status: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const failures = [];
const check = (ok, what) => {
  if (!ok) failures.push(what);
};
const cleanUp = () => {
  for (const p of [inShared, inLayout, inFoundation]) if (existsSync(p)) rmSync(p);
};

try {
  cleanUp();
  const before = runScan();
  check(before.status === 0, `clean before: expected exit 0, got ${before.status}\n${before.output}`);

  for (const [where, path, folder] of [
    ['shared/', inShared, 'shared'],
    ['layout/', inLayout, 'layout'],
  ]) {
    writeFileSync(path, MUTANT);
    const r = runScan();
    check(r.status !== 0, `the retired token under ${where}: expected the scan to FAIL, it passed`);
    check(
      r.output.includes(`src/app/${folder}/${NAME}:3:`),
      `the retired token under ${where}: the failure does not name the file and line 3\n${r.output}`,
    );
    rmSync(path);
  }

  writeFileSync(inFoundation, MUTANT);
  const outside = runScan();
  check(outside.status === 0, `the retired token under foundation/ (out of scope): expected exit 0, got ${outside.status}\n${outside.output}`);
  rmSync(inFoundation);

  const after = runScan();
  check(after.status === 0, `clean after: expected exit 0, got ${after.status}\n${after.output}`);
} finally {
  cleanUp();
}

if (failures.length > 0) {
  console.error(`check:retired-ink:selftest — ${failures.length} failure(s):\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('check:retired-ink:selftest — clean before and after; shared/ and layout/ fail naming file and line; foundation/ is out of scope.');
