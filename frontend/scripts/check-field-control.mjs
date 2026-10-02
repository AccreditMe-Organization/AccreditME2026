#!/usr/bin/env node
// ACC-120 — an <am-field> whose content is form-bound must be GIVEN that control.
//
// ## The defect, and why it is silent
//
// `am-field`'s showError bails on a missing control BEFORE forceShowErrors is
// consulted:
//
//     const c = this.control();
//     if (!c || this.readonly() || c.disabled) return false;
//
// So a field wrapped without [control] is not "missing a flag" — it is
// STRUCTURALLY INCAPABLE of showing a validation error, with or without one.
// Two such fields shipped in the Override label dialog and passed through a
// migration looking migrated; two more were in the lookup value form's dynamic
// attribute fields, where the control existed and was validated the whole time.
//
// ## Why this is a scan and not input.required()
//
// A required input was the first instinct and it is wrong: there are LEGITIMATE
// controlless usages, and they are not the obvious one. `readonly` display is
// what you would guess — it is used ZERO times in the application. The real
// ones are:
//
//   - invite-user substitutes an EXPLANATION for a control when there are no
//     org units, keeping the field's label and layout. message="none", content
//     is a <div>.
//   - set-acting-head-dialog wraps a SIGNAL-DRIVEN <input> with [value] and
//     (input). No AbstractControl exists to pass.
//
// Making control required would break both.
//
// ## The predicate, which is why this does not rot
//
// It keys off the USAGE'S OWN CONTENT, never a list of files or components:
//
//     an <am-field> whose projected content binds formControlName or
//     [formControl] MUST also bind [control]
//
// A new field written tomorrow is covered the moment it is written, because the
// thing that makes it in scope is the thing that makes it a defect. A field
// holding a note or a signal-driven input is out of scope by construction, and
// nobody has to add it to an allowlist.
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src/app';

/** Every .ts under src/app, since templates are inline in this codebase. */
function sourceFiles() {
  return globSync('**/*.component.ts', { cwd: ROOT }).map((f) => join(ROOT, f));
}

/**
 * Splits a source into <am-field …> … </am-field> blocks.
 *
 * Deliberately simple: these are inline templates with no nested am-field
 * anywhere in the app (asserted below), so a non-greedy match to the next
 * closing tag is exact rather than approximate. If nesting ever appears, the
 * assertion fails loudly rather than the scan quietly mis-pairing blocks.
 */
function fieldBlocks(source) {
  const blocks = [];
  const re = /<am-field\b([^>]*)>([\s\S]*?)<\/am-field>/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    blocks.push({ attrs: m[1], content: m[2], index: m.index });
  }
  return blocks;
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

const problems = [];
let scanned = 0;
let inScope = 0;

for (const file of sourceFiles()) {
  const source = readFileSync(file, 'utf8');
  if (!source.includes('<am-field')) continue;

  for (const block of fieldBlocks(source)) {
    scanned++;

    if (block.content.includes('<am-field')) {
      problems.push(
        `${file}:${lineOf(source, block.index)} — nested <am-field>. This scan pairs ` +
          `tags non-greedily and cannot read nesting correctly; split the block or ` +
          `teach the scan to parse properly.`,
      );
      continue;
    }

    const formBound = /\bformControlName\b|\[formControl\]/.test(block.content);
    if (!formBound) continue;
    inScope++;

    if (!/\[control\]/.test(block.attrs)) {
      const label =
        (block.attrs.match(/\[label\]="'([^']+)'/) ?? block.attrs.match(/label="([^"]+)"/))?.[1] ??
        '(unlabelled)';
      problems.push(
        `${file}:${lineOf(source, block.index)} — <am-field> for "${label}" wraps a ` +
          `form-bound control but is not given [control], so it can never show a ` +
          `validation error.`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error(`\ncheck:field-control — ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    `\nPass the control: [control]="form.controls.<name>" (or ` +
      `attributeGroup.get('<key>') for a dynamic one).\n`,
  );
  process.exit(1);
}

console.log(
  `check:field-control — ${scanned} <am-field> usage(s), ${inScope} form-bound, all given [control].`,
);
