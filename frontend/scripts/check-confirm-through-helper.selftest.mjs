#!/usr/bin/env node
// ACC-120 slice 10 — the mutation test for check-confirm-through-helper.mjs.
//
// Same shape as check-action-gating.selftest.mjs: a scan that has quietly
// stopped matching reports a clean app, and a green build looks the same
// either way. This writes a real direct ConfirmationService.confirm() call
// into a file under src/app, runs the scan as a separate process (what CI
// does), and asserts it fails naming the file. Then it removes the file and
// asserts the scan passes again, so an interrupted run cannot leave the repo
// dirty and green.
//
// Run: npm run check:confirm-through-helper:selftest      (CI: frontend job)
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const scan = join(root, 'scripts', 'check-confirm-through-helper.mjs');

// Deliberately NOT a plausible component path: if cleanup ever fails, the name
// says what it is and where it came from.
const mutantPath = join(root, 'src', 'app', 'acc120-confirm-helper-selftest.mutant.component.ts');

const MUTANT = `// Temporary file written by check-confirm-through-helper.selftest.mjs. If you
// are reading this in a working tree, a self-test run was interrupted — delete it.
import { Component, inject } from '@angular/core';
import { ConfirmationService } from 'primeng/api';

@Component({ selector: 'am-acc120-confirm-mutant', standalone: true, template: '' })
export class Acc120ConfirmMutantComponent {
  private readonly prompts = inject(ConfirmationService);

  remove(): void {
    this.prompts.confirm({ header: 'x', message: 'y', accept: () => undefined });
  }

  // The options passed through a variable: caught by the injected name.
  removeQuietly(): void {
    const options = { header: 'x', message: 'y', accept: () => undefined };
    this.prompts.confirm(options);
  }
}
`;

function runScan() {
  try {
    const output = execFileSync(process.execPath, [scan], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, output };
  } catch (error) {
    return { status: error.status ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

const failures = [];

try {
  // ── 1. Clean to begin with, so a failing tree cannot pass for the mutation ──
  const before = runScan();
  if (before.status !== 0) {
    failures.push(`the scan already fails on an unmutated tree, so this self-test proves nothing:\n${before.output}`);
  }

  // ── 2. A direct confirm() call, under another name, must fail the build ──
  writeFileSync(mutantPath, MUTANT, 'utf8');
  const during = runScan();
  if (during.status === 0) {
    failures.push(
      'the scan PASSED with a direct ConfirmationService.confirm() call in src/app. It has stopped ' +
        'recognising them, and every build since has reported a clean app it never checked.',
    );
  }
  if (!during.output.includes('prompts.confirm(')) {
    failures.push(
      'the scan missed a confirm() whose options were passed in a variable: it only sees ' +
        `the object-literal shape, not the injected service. Output:\n${during.output}`,
    );
  }
  if (!during.output.includes('acc120-confirm-helper-selftest.mutant')) {
    failures.push(`the scan failed but did not name the offending file. Output:\n${during.output}`);
  }
} finally {
  if (existsSync(mutantPath)) rmSync(mutantPath);
}

// ── 3. Clean again, so the mutation is genuinely gone ──
const after = runScan();
if (after.status !== 0) {
  failures.push(`the mutation was not cleaned up — the scan still fails:\n${after.output}`);
}

if (failures.length > 0) {
  console.error('FAIL: check-confirm-through-helper.mjs is not doing its job.\n');
  console.error(failures.map((f) => `  - ${f}`).join('\n\n'));
  process.exit(1);
}

console.log('check-confirm-through-helper self-test: clean before, fails on a direct confirm() naming the file, clean after.');
