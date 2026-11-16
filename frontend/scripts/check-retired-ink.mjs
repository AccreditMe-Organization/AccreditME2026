#!/usr/bin/env node
// ACC-311 — the retired secondary ink stays out of the shared components.
//
// `--am-text-secondary` is #718096: 4.02:1 on white and 3.73:1 on the surface,
// below AA for small text, and RETIRED by the design reference (ACC-111). Its
// replacement is `--am-ink-500` (#5A6779). ACC-311 moved every use under
// src/app/shared and src/app/layout to the new token. Those two folders draw
// every page, so one use there reaches every screen; this scan keeps it out.
//
// Screens under foundation/ and platform/ still carry the old token and are
// not in scope here: they move screen by screen, and this scan's folders are
// the ones a new screen inherits from.
//
// Fails, naming each file and line, when `--am-text-secondary` appears in a
// .ts, .html, .scss or .css file under those two folders. Fails as well if the
// walk read too few files, so a moved folder cannot make it pass by scanning
// nothing.
//
// Run: npm run check:retired-ink      (CI discovers every check:*)
// Its mutation test: npm run check:retired-ink:selftest

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const FOLDERS = ['src/app/shared', 'src/app/layout'];
const EXTENSIONS = /\.(ts|html|scss|css)$/;
const RETIRED = '--am-text-secondary';
// The two folders held 134 source files when this was written; far fewer means
// the walk is not reading what it should.
const MIN_FILES = 50;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (EXTENSIONS.test(name)) out.push(path);
  }
  return out;
}

const files = [];
for (const folder of FOLDERS) {
  const dir = join(root, folder);
  if (!existsSync(dir)) {
    console.error(`check:retired-ink — ${folder} does not exist. Did it move? Update FOLDERS in this script.`);
    process.exit(1);
  }
  walk(dir, files);
}

if (files.length < MIN_FILES) {
  console.error(`check:retired-ink — read only ${files.length} files under ${FOLDERS.join(' and ')} (expected at least ${MIN_FILES}).`);
  process.exit(1);
}

const hits = [];
for (const file of files) {
  readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .forEach((line, i) => {
      if (line.includes(RETIRED)) hits.push(`${relative(root, file).replace(/\\/g, '/')}:${i + 1}: ${line.trim()}`);
    });
}

if (hits.length > 0) {
  console.error(
    `check:retired-ink — ${RETIRED} (#718096, below AA) is retired; use --am-ink-500 (#5A6779).\n` +
      `Found ${hits.length} use${hits.length === 1 ? '' : 's'} under ${FOLDERS.join(' and ')}:\n  ${hits.join('\n  ')}`,
  );
  process.exit(1);
}

console.log(`check:retired-ink — ${files.length} files under ${FOLDERS.join(' and ')}, no ${RETIRED}.`);
