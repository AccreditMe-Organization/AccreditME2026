#!/usr/bin/env node
// ACC-254 (ACC-255 PR 3, plan §10.1) — a workflow enum is shown in words,
// never as its stored code.
//
// The stages page printed {{ stage.approvalMode }} and {{ stage.assigneeStrategy }},
// the transition table tagged [value]="transition.triggerCondition", the template
// list [value]="template.objectType", and the action list
// [value]="action.actionType": SINGLE, ROLE_BASED, COMMITTEE_CHANGE_REQUEST on
// screen, in both languages. Each now goes through a label helper
// (workflow-labels.ts, or the configurator's actionTypeName()).
//
// So this fails a template that prints one of those five fields DIRECTLY:
//   - an interpolation whose whole expression ends in the field
//       {{ stage.approvalMode }}  {{ t?.triggerCondition }}
//   - a [value] / [label] / [text] binding whose whole expression ends in it
//       [value]="template.objectType"
// A field passed to a function or a pipe is not matched — that is the fix:
//       {{ approvalLabelKey(stage.approvalMode) | translate }}
//
// A PREDICATE, not a baseline (CLAUDE.md, ACC-120): what puts a template in
// scope is what makes it a defect, so a screen written tomorrow is covered.
// NON-VACUITY: the patterns are checked against known-bad and known-good
// samples before the app is scanned, and the scan must read a real number of
// files.
//
// Run: npm run check:workflow-enum-display   (CI discovers every check:*)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const appDir = join(root, 'src', 'app');

const FIELDS = 'approvalMode|assigneeStrategy|triggerCondition|objectType|actionType';
const INTERPOLATION = new RegExp(`\\{\\{\\s*[\\w$.?!]*\\.(?:${FIELDS})\\s*\\}\\}`, 'g');
const BINDING = new RegExp(`\\[(?:value|label|text)\\]\\s*=\\s*"\\s*[\\w$.?!]*\\.(?:${FIELDS})\\s*"`, 'g');

function findings(source) {
  return [...source.matchAll(INTERPOLATION), ...source.matchAll(BINDING)].map((m) => m[0]);
}

// ── Non-vacuity: the patterns catch what they must, and leave the fix alone ──
const MUST_FLAG = [
  '{{ stage.approvalMode }}',
  '{{stage.assigneeStrategy}}',
  '{{ t?.triggerCondition }}',
  '<p-tag [value]="template.objectType" />',
  '<p-tag [value]="action.actionType" severity="info" />',
  '[label]="row.approvalMode"',
];
const MUST_PASS = [
  '{{ approvalLabelKey(stage.approvalMode) | translate }}',
  '[value]="triggerLabelKey(transition.triggerCondition) | translate"',
  '[value]="actionTypeName(action.actionType)"',
  "{{ 'workflow.approvalMode' | translate }}",
  '@if (form.value.approvalMode === "PARALLEL") {',
];
const selftest = [];
for (const s of MUST_FLAG) if (findings(s).length !== 1) selftest.push(`should flag: ${s}`);
for (const s of MUST_PASS) if (findings(s).length !== 0) selftest.push(`should pass: ${s}`);
if (selftest.length) {
  console.error('FAIL: the scan itself is wrong (non-vacuity):\n' + selftest.map((s) => `  ${s}`).join('\n'));
  process.exit(1);
}

// ── The scan ──
function* sourceFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* sourceFiles(path);
    else if (/\.(ts|html)$/.test(entry) && !entry.endsWith('.spec.ts')) yield path;
  }
}

const lineOf = (source, index) => source.slice(0, index).split(/\r?\n/).length;
const hits = [];
let files = 0;
for (const file of sourceFiles(appDir)) {
  files++;
  const source = readFileSync(file, 'utf8');
  for (const re of [INTERPOLATION, BINDING]) {
    for (const m of source.matchAll(re)) hits.push(`${relative(root, file)}:${lineOf(source, m.index)}: ${m[0]}`);
  }
}

if (files < 200) {
  console.error(`FAIL: read only ${files} files — the scan is not reading the app (non-vacuity).`);
  process.exit(1);
}

console.log(`Workflow enum display (ACC-254): ${hits.length} raw enum value(s) on screen, in ${files} files.`);
if (hits.length > 0) {
  console.error(hits.map((h) => `  ${h}`).join('\n'));
  console.error('\nFAIL: show the value in words — workflowLabelKey() in foundation/workflow/workflow-labels.ts.');
  process.exit(1);
}
