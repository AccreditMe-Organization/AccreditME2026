#!/usr/bin/env node
// ACC-194 — every AI call goes through the gateway (foundation/ai/ai.service.ts).
//
// ## Why this exists
//
// AiService.run() is what prices a feature, checks the organisation's switch
// and the feature's restriction, reserves credits, refunds a failed call and
// logs. A feature that injected the provider directly would skip all of it —
// a free, unlogged, unswitched model call. The provider used to be exported
// from TenantModule to every module that imported it; ACC-194 moved the
// binding into AiModule and stopped exporting it, and this scan keeps it that
// way when someone reaches for the provider next year.
//
// ## What it checks
//
// Any reference to the injection token or a provider class —
// `AI_PROVIDER` or `AnthropicAiProvider`, as whole words, comments stripped —
// in a file OUTSIDE src/foundation/ai/ and src/providers/ai/ fails the build.
// It keys off the symbols themselves, not a list of files (ACC-120: a
// predicate, not an allowlist), so a file written tomorrow is covered.
// `AI_PROVIDER_UNAVAILABLE` and friends are refusal codes, not the token, and
// do not match: the word boundary stops at the underscore.
//
// ## Non-vacuity
//
// The scan also requires that it FOUND the binding (`provide: AI_PROVIDER`)
// inside the allowed folders. If it finds none, the scan is looking at the
// wrong tree or the wiring moved, and a green result would mean nothing.
//
// Run: npm run check:ai-gateway     (CI: backend job, discovered)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const srcDir = join(root, 'src');
const ALLOWED = [join(srcDir, 'foundation', 'ai') + sep, join(srcDir, 'providers', 'ai') + sep];
const SYMBOL = /\b(AI_PROVIDER|AnthropicAiProvider)\b/;

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* sourceFiles(path);
    else if (entry.endsWith('.ts')) yield path;
  }
}

const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const findings = [];
let files = 0;
let bindingFound = false;

for (const file of sourceFiles(srcDir)) {
  files += 1;
  const source = stripComments(readFileSync(file, 'utf8'));
  const allowed = ALLOWED.some((dir) => file.startsWith(dir));
  if (allowed) {
    if (/provide:\s*AI_PROVIDER\b/.test(source)) bindingFound = true;
    continue;
  }
  source.split('\n').forEach((line, i) => {
    const match = line.match(SYMBOL);
    if (match) findings.push(`${relative(root, file)}:${i + 1}: references ${match[1]} outside the AI gateway`);
  });
}

console.log(`AI gateway (ACC-194): ${files} file(s) scanned; ${findings.length} direct provider reference(s) outside foundation/ai and providers/ai.`);

if (files === 0 || !bindingFound) {
  console.error('FAIL: the AI_PROVIDER binding was not found in foundation/ai or providers/ai — the scan is not looking at the real wiring.');
  process.exit(1);
}
if (findings.length > 0) {
  for (const f of findings) console.error(`  ${f}`);
  console.error('FAIL: call AiService.run() (foundation/ai/ai.service.ts) instead — it prices, switches, meters and logs every call.');
  process.exit(1);
}
console.log('OK: every AI call goes through AiService.');
