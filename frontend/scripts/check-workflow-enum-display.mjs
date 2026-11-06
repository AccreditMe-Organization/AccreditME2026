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
// ACC-271 PR 6b — the stage's approval mode and assignee strategy, and the
// move's trigger condition, are gone from the API, so they are not scanned.
//
// So this fails a template that prints one of the fields below DIRECTLY:
//   - an interpolation whose whole expression ends in the field
//       {{ stage.approvalMode }}  {{ t?.triggerCondition }}
//   - a [value] / [label] / [text] binding whose whole expression ends in it
//       [value]="template.objectType"
// A field passed to a function or a pipe is not matched — that is the fix:
//       {{ approvalLabelKey(stage.approvalMode) | translate }}
//
// ACC-271 PR 5a — widened to who works a stage: a who entry's kind
// (SPECIFIC_USER, POSITION_IN_UNIT …) and a stage's who mode (ANY_ONE, ALL,
// COMMITTEE_VOTE). Those field names are generic (a storage option has a
// `kind` too, bound as a radio's value), so they are matched only on the
// objects that carry them: `who.mode`, a draft's `mode()`, and the `kind` of
// an `entry`, a `saved` entry or a `whoEntry`.
//
// ACC-271 PR 5b — widened to the transitions list and panel: who moves the
// record (`mover`: PERSON, APP, AUTOMATIC) on any object, and a transition's
// kind (ADVANCE, RETURN, EXIT) on the objects that carry one: a `transition`,
// a `move`, a `tr`, or the page's `editingTransition()`.
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

const FIELDS = 'objectType|actionType|mover';
// ACC-271 PR 5a — the who fields, on the objects that carry them (see above).
const WHO = String.raw`(?:\bwho\??\.mode|\b(?:draft|whoDraft|d)(?:\(\))?\.mode\(\)|\b(?:entry|saved|whoEntry)\??\.kind)`;
// ACC-271 PR 5b — a transition's kind, on the objects that carry one (see above).
const MOVE = String.raw`(?:\b(?:transition|move|tr|editingTransition\(\))\??\.kind)`;
const EXPR = String.raw`[\w$.?!()]*?(?:\.(?:${FIELDS})|${WHO}|${MOVE})`;
const INTERPOLATION = new RegExp(String.raw`\{\{\s*${EXPR}\s*\}\}`, 'g');
const BINDING = new RegExp(String.raw`\[(?:value|label|text)\]\s*=\s*"\s*${EXPR}\s*"`, 'g');

function findings(source) {
  return [...source.matchAll(INTERPOLATION), ...source.matchAll(BINDING)].map((m) => m[0]);
}

// ── Non-vacuity: the patterns catch what they must, and leave the fix alone ──
const MUST_FLAG = [
  '<p-tag [value]="template.objectType" />',
  '{{template.objectType}}',
  '<p-tag [value]="action.actionType" severity="info" />',
  '[label]="row.actionType"',
  // ACC-271 PR 5a — a who entry's kind, and a stage's who mode.
  '{{ entry.kind }}',
  '{{ row().saved?.kind }}',
  '[value]="whoEntry.kind"',
  '{{ stage.who.mode }}',
  '{{ stage.who?.mode }}',
  '{{ d.mode() }}',
  '[label]="whoDraft.mode()"',
  // ACC-271 PR 5b — who moves the record, and a transition's kind.
  '{{ transition.mover }}',
  '[value]="t?.mover"',
  '{{ transition.kind }}',
  '{{ transition?.kind }}',
  '[label]="move.kind"',
  '{{ editingTransition()?.kind }}',
];
const MUST_PASS = [
  "{{ workflowLabelKey('objectType', template.objectType) | translate }}",
  '[value]="actionTypeName(action.actionType)"',
  "{{ 'workflow.objectType' | translate }}",
  '@if (template.objectType === "COMMITTEE") {',
  // ACC-271 PR 5a — in words, and a storage option's kind bound as a radio's value.
  "{{ workflowLabelKey('stageAssignee', entry.kind) | translate }}",
  '{{ modeLabel(d.mode()) }}',
  '[value]="o.kind"',
  '@if (entry.kind === "CREATOR") {',
  // ACC-271 PR 5b — in words, and a comparison.
  "{{ workflowLabelKey('mover', transition.mover) | translate }}",
  '{{ kindLabelKey(transition) | translate }}',
  "@if (transition.mover === 'APP') {",
  '[class]="\'am-tr-chip am-tr-chip--\' + kindOf(transition).toLowerCase()"',
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
