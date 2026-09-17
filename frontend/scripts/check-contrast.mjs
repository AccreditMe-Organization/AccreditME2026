#!/usr/bin/env node
// ACC-111 — the design system's contrast table, asserted against the TOKENS.
//
// Artboard 9 of frontend/design-reference/AccreditMe Design System.dc.html
// lists the colour pairs the product depends on and their WCAG 2.2 verdicts,
// and states that the table is "asserted in CI against the token values
// rather than maintained by hand". This is that assertion. A token change that
// breaks a pair fails the build, so the table cannot drift from the code.
//
// Ratios are COMPUTED here from src/styles/design-tokens.scss, never copied
// from the artboard. About half of the artboard's printed figures differ from
// the WCAG formula (e.g. #C9D3E0 on #1E2A38 is 9.61, printed 7.9; #4A5568 on
// white is 7.53, printed 8.0) even though every verdict holds — a printed
// figure is a claim, the formula is the check.
//
// Two kinds of row:
//   - `must: 'pass'`  a pair the product uses. Below its threshold → fails CI.
//   - `must: 'fail'`  a pair the design documents as unusable (the reason a
//                     rule exists: controls live on white, the accent is never
//                     text). Reported, never fatal: if a token change made one
//                     pass, nothing is broken, but the rule it justifies should
//                     be re-read before anyone relaxes it.
//
// Thresholds: 4.5 for text (1.4.3), 3.0 for control borders and other
// non-text UI (1.4.11).
//
// Run: npm run check:contrast        (CI: frontend job, beside check:formatting)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const tokenFile = join(root, 'src', 'styles', 'design-tokens.scss');

const TEXT = 4.5;
const NON_TEXT = 3.0;

// Artboard 9, in its order, then the chip rule from artboard 5 ("any chip
// whose text is under 4.5:1 on its own fill" is banned) for the semantic sets
// artboard 9 does not list. #718096 is not a token any more, so its two rows
// ("today's label") are carried as literals, marked as such.
const PAIRS = [
  { fg: 'ink-900', bg: 'surface-raised', min: TEXT, must: 'pass', use: 'body' },
  { fg: 'ink-700', bg: 'surface-raised', min: TEXT, must: 'pass', use: 'table value' },
  { fg: 'ink-500', bg: 'surface', min: TEXT, must: 'pass', use: 'label, meta' },
  { fg: '#718096', bg: 'surface', min: TEXT, must: 'fail', use: 'retired secondary text (literal, no longer a token)' },
  { fg: 'surface-raised', bg: 'primary-600', min: TEXT, must: 'pass', use: 'primary button' },
  { fg: 'primary-600', bg: 'surface-raised', min: TEXT, must: 'pass', use: 'link' },
  { fg: 'danger-ink', bg: 'danger-bg', min: TEXT, must: 'pass', use: 'danger chip' },
  { fg: 'warning-ink', bg: 'warning-bg', min: TEXT, must: 'pass', use: 'warning chip' },
  { fg: 'success-ink', bg: 'success-bg', min: TEXT, must: 'pass', use: 'success chip' },
  { fg: 'accent-500', bg: 'surface-raised', min: TEXT, must: 'fail', use: 'brand accent as text — never' },
  { fg: 'sidebar-ink', bg: 'sidebar', min: TEXT, must: 'pass', use: 'rail label' },
  { fg: 'control-border', bg: 'surface-raised', min: NON_TEXT, must: 'pass', use: 'control border at rest' },
  { fg: 'control-border', bg: 'surface', min: NON_TEXT, must: 'fail', use: 'same border on surface — why controls sit on white' },
  { fg: 'control-border-hover', bg: 'surface-raised', min: NON_TEXT, must: 'pass', use: 'control border, hover' },
  { fg: 'control-border-hover', bg: 'surface', min: NON_TEXT, must: 'pass', use: 'control border on surface' },
  { fg: 'border-strong', bg: 'surface-raised', min: NON_TEXT, must: 'fail', use: 'the old control border — structural only' },
  { fg: 'focus-ring', bg: 'surface-raised', min: NON_TEXT, must: 'pass', use: 'focus ring' },
  { fg: 'focus-ring', bg: 'surface', min: NON_TEXT, must: 'pass', use: 'focus ring on surface' },
  { fg: 'ink-500', bg: 'surface-raised', min: TEXT, must: 'pass', use: 'label, meta on white' },
  { fg: 'info-ink', bg: 'info-bg', min: TEXT, must: 'pass', use: 'info chip' },
  { fg: 'neutral-chip-ink', bg: 'neutral-chip-bg', min: TEXT, must: 'pass', use: 'neutral chip' },
  { fg: 'restricted-ink', bg: 'restricted-hatch-dark', min: TEXT, must: 'pass', use: 'restricted type word, darker hatch stripe' },
  { fg: 'ink-700', bg: 'primary-100', min: TEXT, must: 'pass', use: 'table value on a selected row' },
  { fg: 'ink-700', bg: 'primary-50', min: TEXT, must: 'pass', use: 'table value on a hovered row' },
];

// Only the top-level :root block: the [lang] and media-query blocks override
// sizes, never colours, and must not shadow a colour by accident.
function readTokens() {
  const source = readFileSync(tokenFile, 'utf8');
  const start = source.indexOf(':root {');
  const end = source.indexOf('\n}', start);
  if (start < 0 || end < 0) throw new Error(`no :root block in ${tokenFile}`);
  const tokens = new Map();
  for (const m of source.slice(start, end).matchAll(/--am-([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)) {
    tokens.set(m[1], m[2]);
  }
  return tokens;
}

function luminance(hex) {
  const channel = (i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const tokens = readTokens();
const resolve = (ref) => (ref.startsWith('#') ? ref : tokens.get(ref));

const failures = [];
const notices = [];
const lines = [];
for (const pair of PAIRS) {
  const fg = resolve(pair.fg);
  const bg = resolve(pair.bg);
  const name = `${pair.fg} on ${pair.bg} (${pair.use})`;
  if (!fg || !bg) {
    failures.push(`${name}: token not found in design-tokens.scss (${!fg ? pair.fg : pair.bg})`);
    continue;
  }
  const ratio = contrast(fg, bg);
  const passes = ratio >= pair.min;
  lines.push(`  ${passes ? 'pass' : 'fail'}  ${ratio.toFixed(2).padStart(5)}:1  (min ${pair.min})  ${name}  ${fg}/${bg}`);
  if (pair.must === 'pass' && !passes) {
    failures.push(`${name}: ${ratio.toFixed(2)}:1 is below ${pair.min}:1 (${fg} on ${bg})`);
  }
  if (pair.must === 'fail' && passes) {
    notices.push(`${name}: now ${ratio.toFixed(2)}:1 — the design documents this pair as failing; re-read the rule it justifies before relaxing it`);
  }
}

console.log(lines.join('\n'));
for (const n of notices) console.log(`notice: ${n}`);
if (failures.length > 0) {
  console.error(`\nContrast (ACC-111): ${failures.length} failure(s)\n`);
  console.error(failures.join('\n'));
  console.error('\nPairs are artboard 9 of the design system; values come from src/styles/design-tokens.scss.');
  process.exit(1);
}
console.log(`\nContrast (ACC-111): ${PAIRS.length} pairs checked, no failures.`);
