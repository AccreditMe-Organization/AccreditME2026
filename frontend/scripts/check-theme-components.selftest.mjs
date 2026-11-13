#!/usr/bin/env node
// ACC-90 — the mutation test for check-theme-components.mjs.
//
// A scan that has stopped computing the list looks exactly like one that
// agrees with it. This proves, against the real script run as CI runs it (a
// separate process, judged by its exit status):
//
//   1. clean before: the preset carries exactly the rendered components;
//   2. a component file importing a primeng component the preset has no tokens
//      for (primeng/knob) FAILS, naming "knob";
//   3. a preset with a rendered key removed (tag) FAILS, naming "tag";
//   4. a preset carrying a key nothing renders (card) FAILS, naming "card";
//   5. clean after, with every temporary file removed, so an interrupted run
//      cannot leave the tree dirty and green.
//
// The two broken presets are temporary copies passed with --preset; the real
// preset is never written.
//
// Run: npm run check:theme-components:selftest      (CI discovers every check:*)

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const scan = join(root, 'scripts', 'check-theme-components.mjs');
const realPreset = join(root, 'src', 'app', 'core', 'theme', 'accreditme-preset.ts');
const mutantComponent = join(root, 'src', 'app', 'acc90-theme-components-selftest.mutant.component.ts');
const mutantPreset = join(root, 'src', 'app', 'core', 'theme', 'acc90-theme-components-selftest.mutant-preset.ts');

function runScan(args = []) {
  try {
    const output = execFileSync(process.execPath, [scan, ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
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
  for (const p of [mutantComponent, mutantPreset]) if (existsSync(p)) rmSync(p);
};

try {
  cleanUp();
  const before = runScan();
  check(before.status === 0, `clean before: expected exit 0, got ${before.status}\n${before.output}`);

  // 2. A rendered component the preset has no tokens for.
  writeFileSync(
    mutantComponent,
    `// Temporary file written by check-theme-components.selftest.mjs. If you are
// reading this in a working tree, a self-test run was interrupted — delete it.
import { Component } from '@angular/core';
import { KnobModule } from 'primeng/knob';

@Component({ selector: 'am-acc90-knob-mutant', standalone: true, imports: [KnobModule], template: '' })
export class Acc90KnobMutantComponent {}
`,
  );
  const knob = runScan();
  check(knob.status !== 0, 'a rendered knob with no tokens: expected the scan to FAIL, it passed');
  check(/"knob" is rendered/.test(knob.output), `a rendered knob: the failure does not name "knob"\n${knob.output}`);
  rmSync(mutantComponent);

  const preset = readFileSync(realPreset, 'utf8');

  // 3. A rendered key removed from the preset.
  const withoutTag = preset.replace(/^\s*tag,\s*$/m, '');
  check(withoutTag !== preset, 'could not remove "tag" from the preset copy');
  writeFileSync(mutantPreset, withoutTag);
  const tag = runScan(['--preset', mutantPreset]);
  check(tag.status !== 0, 'a preset without "tag": expected the scan to FAIL, it passed');
  check(/"tag" is rendered/.test(tag.output), `a preset without "tag": the failure does not name "tag"\n${tag.output}`);

  // 4. A key nothing renders added to the preset.
  const withCard = preset
    .replace("import badge from '@primeuix/themes/aura/badge';", "import badge from '@primeuix/themes/aura/badge';\nimport card from '@primeuix/themes/aura/card';")
    .replace(/RENDERED_COMPONENTS\s*=\s*\{/, (m) => `${m}\n  card,`);
  check(withCard !== preset, 'could not add "card" to the preset copy');
  writeFileSync(mutantPreset, withCard);
  const card = runScan(['--preset', mutantPreset]);
  check(card.status !== 0, 'a preset carrying "card": expected the scan to FAIL, it passed');
  check(/carries "card" but nothing renders it/.test(card.output), `a preset carrying "card": the failure does not name "card"\n${card.output}`);
} finally {
  cleanUp();
}

const after = runScan();
check(after.status === 0, `clean after: expected exit 0, got ${after.status}\n${after.output}`);

if (failures.length) {
  console.error(`check:theme-components:selftest FAILED:\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log('check:theme-components:selftest: a missing key, an unused key and an untokened component each fail, named; clean before and after.');
