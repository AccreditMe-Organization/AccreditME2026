#!/usr/bin/env node
// ACC-90 — the theme carries exactly the components the app renders.
//
// AccreditMePreset (src/app/core/theme/accreditme-preset.ts) is built from
// Aura's base and one token module per component, instead of all of Aura (88
// components, ~70 kB of the start-up bundle the app never drew). That saving
// holds only while the list matches what is rendered, so this scan computes the
// list and fails, naming the key, in either direction:
//
//   1. a component the app renders has no tokens in the preset: it would draw
//      unstyled (or with stale tokens), silently;
//   2. the preset carries a component nothing renders: bytes in the start-up
//      bundle for nothing.
//
// HOW "RENDERED" IS COMPUTED, never hand-picked:
//   - every primeng/<module> imported by a non-spec file under src (primeng/api
//     and primeng/config excluded: no component);
//   - plus every primeng module those import, transitively, read from
//     node_modules/primeng/fesm2022 (select brings scroller, paginator brings
//     select and inputnumber, ...);
//   - each module's theme key is its own style class's name
//     (`class TableStyle extends BaseStyle { name = 'datatable' }`), which is
//     the key the theme is looked up by;
//   - kept only where Aura has a token module for that key (base, motion,
//     overlay and the like have none).
//
// Usage: node scripts/check-theme-components.mjs [--preset <path>]
// Run:   npm run check:theme-components            (CI discovers every check:*)

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const presetArg = process.argv.indexOf('--preset');
const presetPath = presetArg > 0 ? process.argv[presetArg + 1] : join(root, 'src/app/core/theme/accreditme-preset.ts');
const fesm = join(root, 'node_modules/primeng/fesm2022');
const auraDir = join(root, 'node_modules/@primeuix/themes/dist/aura');

const IMPORT = /from\s+['"]primeng\/([a-z0-9-]+)['"]/g;
const STYLE_NAME = /extends\s+BaseStyle\s*\{\s*name\s*=\s*['"]([a-z0-9-]+)['"]/g;

function sourceFiles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

// 1. Direct imports.
const direct = new Set();
for (const f of sourceFiles(join(root, 'src'))) {
  for (const m of readFileSync(f, 'utf8').matchAll(IMPORT)) direct.add(m[1]);
}
direct.delete('api');
direct.delete('config');

// 2. Their primeng imports, transitively.
const modules = new Set();
const queue = [...direct];
while (queue.length) {
  const mod = queue.shift();
  if (modules.has(mod)) continue;
  const file = join(fesm, `primeng-${mod}.mjs`);
  if (!existsSync(file)) {
    console.error(`check:theme-components: primeng/${mod} is imported but ${file} does not exist`);
    process.exit(1);
  }
  modules.add(mod);
  for (const m of readFileSync(file, 'utf8').matchAll(IMPORT)) queue.push(m[1]);
}

// 3. Each module's style names, kept where Aura has tokens for them.
const auraKeys = new Set(readdirSync(auraDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name));
auraKeys.delete('base');
auraKeys.delete('css');
const rendered = new Map(); // key -> the module that brings it
for (const mod of [...modules].sort()) {
  for (const m of readFileSync(join(fesm, `primeng-${mod}.mjs`), 'utf8').matchAll(STYLE_NAME)) {
    if (auraKeys.has(m[1]) && !rendered.has(m[1])) rendered.set(m[1], mod);
  }
}

// 4. What the preset carries: each identifier in RENDERED_COMPONENTS, by the
//    @primeuix/themes/aura/<key> module it is imported from.
const preset = readFileSync(presetPath, 'utf8');
const importedAs = new Map();
for (const m of preset.matchAll(/import\s+(\w+)\s+from\s+['"]@primeuix\/themes\/aura\/([a-z0-9-]+)['"]/g)) importedAs.set(m[1], m[2]);
const block = /RENDERED_COMPONENTS\s*=\s*\{([^}]*)\}/.exec(preset);
if (!block) {
  console.error('check:theme-components: RENDERED_COMPONENTS not found in the preset');
  process.exit(1);
}
const carried = new Set();
for (const entry of block[1].split(',').map((s) => s.trim()).filter(Boolean)) {
  const ident = entry.includes(':') ? entry.split(':')[1].trim() : entry;
  const key = importedAs.get(ident);
  if (!key) {
    console.error(`check:theme-components: "${entry}" in RENDERED_COMPONENTS is not imported from @primeuix/themes/aura/<key>`);
    process.exit(1);
  }
  carried.add(key);
}

const missing = [...rendered.keys()].filter((k) => !carried.has(k)).sort();
const unused = [...carried].filter((k) => !rendered.has(k)).sort();

if (missing.length || unused.length) {
  for (const k of missing) console.error(`check:theme-components: "${k}" is rendered (via primeng/${rendered.get(k)}) but the preset carries no tokens for it — add @primeuix/themes/aura/${k} to RENDERED_COMPONENTS`);
  for (const k of unused) console.error(`check:theme-components: the preset carries "${k}" but nothing renders it — remove it from RENDERED_COMPONENTS`);
  process.exit(1);
}
console.log(`check:theme-components: ${carried.size} components, exactly the ${rendered.size} rendered (${direct.size} direct primeng imports, ${modules.size} modules with their imports).`);
