#!/usr/bin/env node
// ACC-130 — the BUILT index.html must run under the app's Content-Security-
// Policy, whose script-src allows no inline script: 'self' plus only
// 'wasm-unsafe-eval' for pdf.js's decoders (frontend/vercel.json, ACC-189).
//
// Angular's critical-CSS inlining wrote
//   <link rel="stylesheet" href="styles-….css" media="print" onload="this.media='all'">
// into the built page. That onload is an inline event handler: script-src
// 'self' blocks it, the stylesheet stays media="print", and the app renders
// unstyled. angular.json's production configuration now sets
// optimization.styles.inlineCritical to false. This checks the BUILD OUTPUT,
// not angular.json — the thing, not a proxy for it — so whatever reintroduces
// an inline handler or an inline script is caught, whichever setting did it.
//
// Not a check:* script, deliberately: it needs `npm run build` first, and the
// discovered check:* step runs before the build. CI runs it right after the
// build step.
//
// NON-VACUITY: a missing page, or one with no external module script, is a
// failure. An empty or wrong file has no inline handlers either.
//
// Run: npm run build && npm run verify:built-index

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const indexPath = join(frontendRoot, 'dist', 'frontend', 'browser', 'index.html');

if (!existsSync(indexPath)) {
  console.error(`verify:built-index — ${indexPath} does not exist. Run npm run build first.`);
  process.exit(1);
}

const html = readFileSync(indexPath, 'utf8');
const problems = [];

// Non-vacuity: a real build loads its bundle from a file.
const externalScripts = html.match(/<script\b[^>]*\bsrc\s*=/gi) ?? [];
if (externalScripts.length === 0) {
  problems.push('no <script src=…> at all — this is not a built Angular page');
}

// An inline event handler in any tag: onload=, onclick=, onerror=, …
for (const tag of html.match(/<[a-z][^>]*>/gi) ?? []) {
  if (/\son[a-z]+\s*=/i.test(tag)) problems.push(`inline event handler: ${tag}`);
  if (/(href|src)\s*=\s*["']?\s*javascript:/i.test(tag)) problems.push(`javascript: URL: ${tag}`);
}

// An inline script: a <script> element with no src.
for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
  if (!/\bsrc\s*=/i.test(tag)) problems.push(`inline script: ${tag}`);
}

if (problems.length) {
  console.error(`verify:built-index — ${problems.length} problem(s) in ${indexPath}:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`verify:built-index — ok: ${externalScripts.length} external script(s), no inline handler or inline script`);
