#!/usr/bin/env node
// ACC-255 PR 3 (plan §10.2) — the mutation test for check-icon-labels.mjs.
//
// The scan is a ratchet, and a ratchet that has quietly stopped counting looks
// exactly like one at its baseline. This proves, against the real script run
// as CI runs it (a separate process, judged by its exit status):
//
//   1. clean before: the app is at or under the baseline;
//   2. an unnamed <p-button icon> written into src/app FAILS the scan, naming
//      the file;
//   3. a named one does not — including a name given AFTER an attribute whose
//      value holds a '>' (an arrow function), which the old [^>]* matcher
//      stopped at;
//   4. clean after, with the file removed, so an interrupted run cannot leave
//      the tree dirty and green.
//
// Run: npm run check:icon-labels:selftest      (CI discovers every check:*)

import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const scan = join(root, 'scripts', 'check-icon-labels.mjs');
const mutantPath = join(root, 'src', 'app', 'acc255-icon-labels-selftest.mutant.component.ts');

const component = (button) => `// Temporary file written by check-icon-labels.selftest.mjs. If you are
// reading this in a working tree, a self-test run was interrupted — delete it.
import { Component } from '@angular/core';

@Component({
  selector: 'am-acc255-icon-mutant',
  standalone: true,
  template: \`
    <div>
      ${button}
    </div>
  \`,
})
export class Acc255IconMutantComponent {
  rows: number[] = [];
}
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

try {
  if (existsSync(mutantPath)) rmSync(mutantPath);

  const before = runScan();
  check(before.status === 0, `clean before: expected exit 0, got ${before.status}\n${before.output}`);

  // An unnamed icon button must fail the build, naming the file.
  writeFileSync(mutantPath, component(`<p-button icon="pi pi-trash" (onClick)="rows = rows.filter((r) => r > 0)" />`));
  const unnamed = runScan();
  check(unnamed.status !== 0, 'an unnamed icon button: expected the scan to FAIL, it passed');
  check(unnamed.output.includes('acc255-icon-labels-selftest.mutant.component.ts'), 'an unnamed icon button: the failure does not name the file');

  // A name after an arrow-function attribute is still a name.
  writeFileSync(
    mutantPath,
    component(`<p-button icon="pi pi-trash" (onClick)="rows = rows.filter((r) => r > 0)" ariaLabel="Remove the row" />`),
  );
  const named = runScan();
  check(named.status === 0, `a named icon button (name after "=>"): expected exit 0, got ${named.status}\n${named.output}`);
} finally {
  if (existsSync(mutantPath)) rmSync(mutantPath);
}

const after = runScan();
check(after.status === 0, `clean after: expected exit 0, got ${after.status}`);
check(!existsSync(mutantPath), 'the mutant file was left behind');

if (failures.length) {
  console.error('FAIL: check-icon-labels self-test\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
console.log('check-icon-labels self-test: unnamed fails, named passes (even after "=>"), clean before and after.');
