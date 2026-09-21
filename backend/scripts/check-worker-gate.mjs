#!/usr/bin/env node
// ACC-92 — every @Processor() must be registered behind the RUN_WORKERS gate.
//
// ## Why this exists, and why the grep that preceded it was not enough
//
// The gate itself is proved by specs and by mutation: remove it and tests go
// red. But every one of those specs names its processor explicitly, so they
// only ever assert the property for the four that existed when they were
// written. A FIFTH processor added next month would consume the shared queues
// exactly as before and every existing test would still pass.
//
// That is the green-either-way shape this repo keeps meeting — and the
// worked example is already in CLAUDE.md: EditDialogComponent's "8 screens"
// was a point-in-time count that went stale as soon as new screens landed,
// which ACC-39 then had to clean up. A one-time enumeration answers "is it
// complete today", never "is it still complete".
//
// So the inventory is derived here, on every run, from the source itself.
//
// ## A GATE, not a ratchet
//
// check-icon-labels.mjs and check-dialog-overlays.mjs are ratchets because
// they carry a legacy backlog to work down. There is no backlog here: all
// four processors are gated, so the allowed count of ungated ones is ZERO.
// check-icon-labels says it plainly — at 0 a ratchet is just a gate — so
// this is written as one from the start.
//
// ## What it checks
//
//   1. Every class carrying @Processor() is registered in some @Module().
//      An unregistered one is either dead code or a file the scan cannot
//      reason about; both deserve a failure rather than a silent pass.
//   2. Every such registration sits inside a `workersEnabled() ? [...] : []`
//      expression, not in the plain part of the providers array.
//
// Comments are stripped first. Without that this reports itself: three of the
// module files carry comments NAMING their processors while explaining the
// gate, and workflow.module.ts mentions SlaMonitorProcessor four times in
// prose about DI edges.
//
// Run: npm run check:worker-gate     (CI: backend job)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const srcDir = join(root, 'src');

const GATE = 'workersEnabled()';

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      yield* sourceFiles(path);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      yield path;
    }
  }
}

const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Returns the body of the first balanced `providers: [ ... ]` array. */
function providersBlock(source) {
  const start = source.indexOf('providers:');
  if (start === -1) return null;
  const open = source.indexOf('[', start);
  if (open === -1) return null;

  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '[') depth += 1;
    else if (source[i] === ']') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

/** Names inside every `workersEnabled() ? [ ... ] : []` in a providers block. */
function gatedNames(block) {
  const names = new Set();
  const pattern = new RegExp(`${GATE.replace(/[()]/g, '\\$&')}\\s*\\?\\s*\\[([^\\]]*)\\]`, 'g');
  for (const match of block.matchAll(pattern)) {
    for (const name of match[1].split(',')) {
      const trimmed = name.trim();
      if (trimmed) names.add(trimmed);
    }
  }
  return names;
}

const files = [...sourceFiles(srcDir)];
const cleaned = new Map(files.map((f) => [f, stripComments(readFileSync(f, 'utf8'))]));

// 1. The inventory, derived rather than listed.
const processors = [];
for (const [file, source] of cleaned) {
  if (!/@Processor\s*\(/.test(source)) continue;
  for (const match of source.matchAll(/export\s+class\s+(\w+)/g)) {
    processors.push({ name: match[1], file });
  }
}

// 2. Where each is registered, and whether that registration is gated.
const findings = [];
for (const { name, file } of processors) {
  let registeredSomewhere = false;

  for (const [moduleFile, source] of cleaned) {
    if (!moduleFile.endsWith('.module.ts')) continue;
    const block = providersBlock(source);
    if (!block) continue;
    if (!new RegExp(`\\b${name}\\b`).test(block)) continue;

    registeredSomewhere = true;
    if (!gatedNames(block).has(name)) {
      findings.push(
        `${relative(root, moduleFile)}: ${name} is a provider but NOT behind ${GATE}`,
      );
    }
  }

  if (!registeredSomewhere) {
    findings.push(
      `${relative(root, file)}: ${name} carries @Processor() but is registered in no module`,
    );
  }
}

console.log(
  `Worker gate (ACC-92): ${processors.length} @Processor class(es) found; ` +
    `${findings.length} not behind ${GATE}.`,
);
for (const { name, file } of processors) {
  console.log(`  ${relative(root, file)}: ${name}`);
}

// Nothing found means the detection broke, not that the codebase is clean.
// Four processors exist; a scan reporting zero has stopped reading the source.
if (processors.length === 0) {
  console.error(
    '\nFAIL: no @Processor classes found at all. This scan has stopped working —' +
      ' it should never legitimately reach zero while the queues exist.',
  );
  process.exit(1);
}

if (findings.length > 0) {
  console.error(`\n${findings.map((f) => `  ${f}`).join('\n')}`);
  console.error(
    `\nFAIL: a processor registered without the gate rejoins the SHARED queues from any` +
      ` machine that boots the app. Wrap it: ...(${GATE} ? [TheProcessor] : []).`,
  );
  process.exit(1);
}

console.log('\nAll processors are behind the gate.');
