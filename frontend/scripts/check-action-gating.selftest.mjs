#!/usr/bin/env node
// ACC-123 — the mutation test for check-action-gating.mjs.
//
// A gate scan that has quietly stopped matching anything reports a clean app,
// and nothing about a green build distinguishes the two. The floor check
// inside the scan catches TOTAL failure (zero gated controls found); this
// catches the subtler half — that it still RECOGNISES an ungated control and
// still fails the build for it.
//
// It is a real mutation, not a simulation: it writes an ungated write control
// into a component file under src/app, runs the scan as a separate process,
// and asserts the exit status and the message. Then it removes the file and
// asserts the scan passes again, so a run that crashed halfway cannot leave
// the repo dirty and green.
//
// Why a separate process rather than importing the scan: the thing under test
// is "does this fail CI", and that is an exit status. Importing it would test
// a function that no longer resembles how CI calls it.
//
// Run: npm run check:action-gating:selftest      (CI: frontend job)

import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const scan = join(root, 'scripts', 'check-action-gating.mjs');

// Deliberately NOT a plausible component path: if cleanup ever fails, the name
// says what it is and where it came from.
const mutantPath = join(
  root,
  'src',
  'app',
  'acc123-action-gating-selftest.mutant.component.ts',
);

const MUTANT = `// Temporary file written by check-action-gating.selftest.mjs. If you are
// reading this in a working tree, a self-test run was interrupted — delete it.
import { Component } from '@angular/core';

@Component({
  selector: 'am-acc123-mutant',
  standalone: true,
  template: \`
    <div>
      <p-button icon="pi pi-trash" (onClick)="onDelete()" />
    </div>
  \`,
})
export class Acc123MutantComponent {
  onDelete(): void {
    /* nothing */
  }
}
`;

/** Runs the scan and returns {status, output}, never throwing on a failure. */
function runScan() {
  try {
    const output = execFileSync(process.execPath, [scan], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    return {
      status: error.status ?? 1,
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
    };
  }
}

const failures = [];

try {
  // ── 1. Clean to begin with ───────────────────────────────────────────────
  // Asserted BEFORE the mutation, so a repo that was already failing cannot
  // be mistaken for the mutation working.
  const before = runScan();
  if (before.status !== 0) {
    failures.push(
      'the scan already fails on an unmutated tree, so this self-test proves ' +
        `nothing. Fix the real findings first:\n${before.output}`,
    );
  }

  // ── 2. An ungated write control must fail the build ──────────────────────
  writeFileSync(mutantPath, MUTANT, 'utf8');
  const during = runScan();

  if (during.status === 0) {
    failures.push(
      'the scan PASSED with an ungated pi-trash control in src/app. It has ' +
        'stopped recognising write controls, and every build since it broke ' +
        'has been reporting a clean app it never checked.',
    );
  }
  if (!during.output.includes('acc123-action-gating-selftest.mutant')) {
    failures.push(
      'the scan failed but did not name the offending file, so a real ' +
        `finding would be unactionable. Output:\n${during.output}`,
    );
  }
  if (!during.output.includes('pi-trash')) {
    failures.push(
      'the scan failed but did not name the control, only the file.',
    );
  }
} finally {
  if (existsSync(mutantPath)) rmSync(mutantPath);
}

// ── 3. Clean again, so the mutation is genuinely gone ──────────────────────
const after = runScan();
if (after.status !== 0) {
  failures.push(
    `the mutation was not cleaned up — the scan still fails:\n${after.output}`,
  );
}

if (failures.length > 0) {
  console.error('FAIL: check-action-gating.mjs is not doing its job.\n');
  console.error(failures.map((f) => `  - ${f}`).join('\n\n'));
  process.exit(1);
}

console.log(
  'check-action-gating self-test: clean before, fails on an ungated control ' +
    'naming both file and icon, clean after.',
);
