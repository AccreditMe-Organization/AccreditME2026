#!/usr/bin/env node
// ACC-265 — the mutation test for check-formatting-rules.mjs's time-unit rule.
//
// A scan rule nobody has watched fail is a hypothesis (CLAUDE.md, ACC-120).
// This writes a component into src/app holding each shape the rule exists for,
// one at a time, runs the REAL script as CI runs it (a separate process,
// judged by its exit status), and checks:
//
//   1. clean before: the app has no violation;
//   2. each hand-written unit FAILS the scan, naming the file:
//        `n + 'h'`, `${n} days`, `{{ n }}h`;
//   3. a counted string through amCount, and a CSS length in a template
//      string, do not;
//   4. clean after, with the file removed, so an interrupted run cannot leave
//      the tree dirty and green.
//
// Run: npm run check:formatting:selftest      (CI discovers every check:*)

import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const scan = join(root, 'scripts', 'check-formatting-rules.mjs');
const mutantName = 'acc265-formatting-selftest.mutant.component.ts';
const mutantPath = join(root, 'src', 'app', mutantName);

const component = (template, body = '') => `// Temporary file written by check-formatting-rules.selftest.mjs. If you are
// reading this in a working tree, a self-test run was interrupted — delete it.
import { Component } from '@angular/core';

@Component({
  selector: 'am-acc265-formatting-mutant',
  standalone: true,
  template: \`${template}\`,
})
export class Acc265FormattingMutantComponent {
  hours = 40;
${body}
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

const BAD = [
  ['concatenated "h"', component(`<span>{{ hours + 'h' }}</span>`)],
  ['a template string with "days"', component('<span>{{ label }}</span>', '  label = `${this.hours} days`;')],
  ['a unit after an interpolation', component('<span>{{ hours }}h</span>')],
];
const GOOD = [
  ['a counted string through amCount', component(`<span>{{ hours | amCount: 'workflow.workingHours' }}</span>`)],
  ['a CSS length in a template string', component('<span [style.width]="width"></span>', '  width = `${this.hours}px`;')],
];

try {
  if (existsSync(mutantPath)) rmSync(mutantPath);

  const before = runScan();
  check(before.status === 0, `clean before: expected exit 0, got ${before.status}\n${before.output}`);

  for (const [what, source] of BAD) {
    writeFileSync(mutantPath, source);
    const r = runScan();
    check(r.status !== 0, `${what}: expected the scan to FAIL, it passed`);
    check(r.output.includes(mutantName), `${what}: the failure does not name the file`);
  }
  for (const [what, source] of GOOD) {
    writeFileSync(mutantPath, source);
    const r = runScan();
    check(r.status === 0, `${what}: expected exit 0, got ${r.status}\n${r.output}`);
  }
} finally {
  if (existsSync(mutantPath)) rmSync(mutantPath);
}

const after = runScan();
check(after.status === 0, `clean after: expected exit 0, got ${after.status}`);
check(!existsSync(mutantPath), 'the mutant file was left behind');

if (failures.length) {
  console.error('FAIL: check-formatting-rules self-test\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
console.log('check-formatting-rules self-test: three hand-written units fail, amCount and a CSS length pass, clean before and after.');
