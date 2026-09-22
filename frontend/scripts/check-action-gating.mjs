#!/usr/bin/env node
// ACC-123 — a WRITE control must sit behind a permission gate, not only a
// create action.
//
// ## Why this is a second scan rather than a wider check-create-gating
//
// They answer different questions and, more to the point, they look for
// different SHAPES. A create action is one control in one place: a `pi-plus`
// inside a page header's `pageActions` slot, which is why that scan can bound
// its search on `</app-page-header>` and stay precise. Write controls are
// scattered through table cells, expanded rows, record headers and member
// panels; there is no region to bound on. Folding the two together would mean
// one loose pattern doing both jobs worse.
//
// The defect both exist for is the same, and it is worth restating here so
// this file stands on its own: a control the server will refuse is not a
// security hole, it is a product that looks broken. Yasser Al-Amri
// (QUALITY_MANAGER) was shown Deactivate on a user, Edit on a colleague and
// Deactivate on a workflow template, and got a permission error from each.
//
// ## What counts as a write control
//
// A `<button>`, `<p-button>` or `<am-icon-button>` that BOTH
//   - binds a click — `(click)`, `(onClick)` or, for the shared icon button,
//     `(activated)` — so a static badge or a plain icon is not a control; and
//   - carries one of WRITE_ICONS, which is the vocabulary this app actually
//     uses for edit / delete / deactivate / reorder / set-default / remove.
//
// An icon list is a judgement, not a definition, and it will be wrong at the
// edges in both directions:
//   - `pi-times` is a remove on a committee member and a dismiss on a dialog.
//     Both are matched; the dismisses are on the allowlist, by name.
//   - an icon named by a CLASS BINDING (`[class.pi-arrow-up]`) is not counted:
//     that is how the sortable table headers draw their direction chevron, and
//     sorting a list changes nothing. Only a literal `icon="pi pi-x"` or
//     `class="… pi-x …"` counts.
//   - a write control drawn with an icon nobody has used yet is INVISIBLE to
//     this scan. That is the same blind spot check-create-gating states for
//     itself, and the same answer: widening the vocabulary to "any icon" would
//     flag every control in the app and the allowlist would become the real
//     rule.
//
// ## What counts as a gate
//
// An enclosing `@if` whose condition names a permission check. The scan builds
// the real block structure of the template rather than looking at nearby text,
// so a control gated by a condition two blocks up is recognised and a control
// merely NEAR a gated one is not.
//
// It proves a gate is PRESENT, not that it is the RIGHT one — the same split
// check-create-gating draws, and for the same reason: deciding whether
// `canEdit` checks the permission the endpoint enforces means reading the
// controller's decorator, which no template scan can see. Specs do that half.
//
// ## Blind spot, stated rather than discovered
//
// A control built as data — a `MenuItem[]` with a `command`, rendered by
// `p-menu` — has no icon in the template at all, so it is invisible here.
// user-list.component.ts and position-list.component.ts both do this, and both
// gate correctly in TypeScript. Those are covered by specs, not by this.
//
// A GATE, not a ratchet: the allowed count is zero, and anything that is not a
// real write control is named in ALLOWLIST below with its reason.
//
// Run: npm run check:action-gating     (CI: frontend job)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const appDir = join(root, 'src', 'app');

// The icons this app uses for actions that CHANGE something.
const WRITE_ICONS = [
  'pi-pencil',
  'pi-trash',
  'pi-ban',
  'pi-times',
  'pi-star',
  'pi-arrow-up',
  'pi-arrow-down',
  'pi-crown',
  'pi-power-off',
  'pi-replay',
  'pi-check-circle',
  'pi-eye',
  'pi-eye-slash',
  'pi-user-minus',
  'pi-user-plus',
];

// Any of these in an enclosing condition counts. Pages name their own
// computed (`canEdit`, `canRemoveMember`, …) and those read hasPermission;
// both spellings are recognised so a page that inlines the check still passes.
const GATE_PATTERN = /hasPermission|isPlatformAdmin|canWriteModule|\bcan[A-Z]\w*/;

// Controls that match the shape above and are NOT write actions needing a
// permission. Each entry names the file, the control, and why. Keyed by
// `<path>#<icon>` — deliberately coarse: a second, genuinely ungated control
// using the same icon in the same file would be covered by an entry written
// for the first, so anything added to this list is also a note to check that
// file by hand.
const ALLOWLIST = new Map([
  [
    'shared/components/edit-dialog/edit-dialog.component.ts#pi-times',
    'The dialog\'s own ✕. Closing a dialog changes nothing; it is the one exit ' +
      'path that must always be available (ACC-96 — every close path asks the ' +
      'same question).',
  ],
  [
    'shared/components/overlay-select/overlay-select.component.ts#pi-times',
    'Clears the field, or removes one chip from a multi-select. Edits form ' +
      'state only — the permission belongs on the form\'s save, not on a picker.',
  ],
  [
    'foundation/tasks/components/task-form/task-form.component.ts#pi-times',
    'Clears the chosen due date inside the form. Form state, not a saved change.',
  ],
  [
    'layout/impersonation-banner/impersonation-banner.component.ts#pi-times',
    'Ends an impersonation session. Reachable only while impersonating, which ' +
      'PlatformGuard already established; there is no permission that could ' +
      'both allow starting one and forbid stopping it.',
  ],
]);

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* sourceFiles(path);
    else if (/\.(ts|html)$/.test(entry) && !entry.endsWith('.spec.ts')) yield path;
  }
}

const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');

/**
 * The template text of a file, with the offset it starts at so reported line
 * numbers point at the real line. An .html file is all template; a component
 * contributes whatever sits in its `template:` literal.
 */
function templatesOf(file, source) {
  if (file.endsWith('.html')) return [{ text: source, offset: 0 }];

  const out = [];
  const opener = /template:\s*`/g;
  let m;
  while ((m = opener.exec(source))) {
    const start = m.index + m[0].length;
    let i = start;
    while (i < source.length) {
      if (source[i] === '\\') i += 2;
      else if (source[i] === '`') break;
      else i += 1;
    }
    out.push({ text: source.slice(start, i), offset: start });
    opener.lastIndex = i;
  }
  return out;
}

/**
 * Every `@if` / `@else if` block in a template, as {condition, start, end}.
 *
 * Built by walking the text with a brace depth, because "is this control
 * inside that block" is a structural question and the nearest-text answer is
 * wrong in both directions. Quotes are honoured only INSIDE a tag: an
 * apostrophe in ordinary prose is not a string delimiter, and treating it as
 * one silently swallowed half a template while this was being written.
 */
function conditionalBlocks(text) {
  const blocks = [];
  const open = [];
  let depth = 0;
  let inTag = false;
  let quote = null;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (inTag && (ch === '"' || ch === "'")) {
      quote = ch;
      continue;
    }
    if (ch === '<') inTag = true;
    else if (ch === '>') inTag = false;

    // Interpolation braces are not block braces.
    if (ch === '{' && text[i + 1] === '{') {
      const close = text.indexOf('}}', i + 2);
      i = close === -1 ? text.length : close + 1;
      continue;
    }

    if (ch === '@' && !inTag) {
      const rest = text.slice(i, i + 12);
      const control = /^@(else\s+if|if|for|switch|case|default|else|defer|placeholder|loading|error|empty)\b/.exec(
        rest,
      );
      if (control) {
        const keyword = control[1];
        let j = i + control[0].length;
        let condition = '';
        while (j < text.length && /\s/.test(text[j])) j++;
        if (text[j] === '(') {
          let parens = 0;
          const from = j;
          for (; j < text.length; j++) {
            if (text[j] === '(') parens++;
            else if (text[j] === ')' && --parens === 0) {
              j++;
              break;
            }
          }
          condition = text.slice(from, j);
        }
        while (j < text.length && text[j] !== '{' && text[j] !== '\n') j++;
        if (text[j] === '{') {
          depth += 1;
          open.push({
            condition: keyword === 'if' || keyword === 'else if' ? condition : '',
            start: j,
            depth,
          });
          i = j;
          continue;
        }
      }
    }

    if (ch === '{') depth += 1;
    else if (ch === '}') {
      while (open.length > 0 && open[open.length - 1].depth > depth) {
        const frame = open.pop();
        blocks.push({ condition: frame.condition, start: frame.start, end: i });
      }
      depth -= 1;
      while (open.length > 0 && open[open.length - 1].depth > depth) {
        const frame = open.pop();
        blocks.push({ condition: frame.condition, start: frame.start, end: i });
      }
    }
  }
  for (const frame of open) {
    blocks.push({ condition: frame.condition, start: frame.start, end: text.length });
  }
  return blocks;
}

/**
 * Every button-shaped element in a template, with its full extent.
 *
 * `am-icon-button` is included because it is this app's REQUIRED shape for an
 * icon-only action (ACC-111, artboard 9) — most of the row actions in
 * Administration are one, and a scan that only knew about `p-button` would
 * have reported the app almost clean while missing them.
 */
function controls(text) {
  const found = [];
  const tagStart = /<(p-button|am-icon-button|button)\b/g;
  let m;
  while ((m = tagStart.exec(text))) {
    const tag = m[1];
    let i = m.index;
    let quote = null;
    for (; i < text.length; i++) {
      if (quote) {
        if (text[i] === quote) quote = null;
      } else if (text[i] === '"' || text[i] === "'") quote = text[i];
      else if (text[i] === '>') break;
    }
    const openTagEnd = i;
    const selfClosing = text[openTagEnd - 1] === '/';
    let end = openTagEnd;
    if (!selfClosing) {
      const close = text.indexOf(`</${tag}`, openTagEnd);
      end = close === -1 ? openTagEnd : close;
    }
    found.push({ start: m.index, extent: text.slice(m.index, end + 1) });
  }
  return found;
}

const lineOf = (s, i) => s.slice(0, i).split(/\r?\n/).length;

const findings = [];
const allowed = [];
let gatedCount = 0;

for (const file of sourceFiles(appDir)) {
  const raw = readFileSync(file, 'utf8');
  if (!WRITE_ICONS.some((icon) => raw.includes(icon))) continue;

  const source = stripComments(raw);
  const rel = relative(join(root, 'src', 'app'), file).replace(/\\/g, '/');

  for (const { text, offset } of templatesOf(file, source)) {
    const blocks = conditionalBlocks(text);

    for (const control of controls(text)) {
      if (!/\((click|onClick|activated)\)/.test(control.extent)) continue;
      const icon = WRITE_ICONS.find((candidate) =>
        // A literal icon or class value only — never a `[class.pi-x]` binding,
        // which is how a sortable header draws its direction chevron.
        new RegExp(`(icon|class)="[^"]*\\b${candidate}\\b`).test(control.extent),
      );
      if (!icon) continue;

      const key = `${rel}#${icon}`;
      if (ALLOWLIST.has(key)) {
        allowed.push(key);
        continue;
      }

      const gated = blocks.some(
        (b) =>
          b.start <= control.start &&
          control.start <= b.end &&
          GATE_PATTERN.test(b.condition),
      );
      if (gated) {
        gatedCount += 1;
        continue;
      }
      findings.push(
        `${relative(root, file)}:${lineOf(source, offset + control.start)}: ` +
          `${icon} write control with no permission gate`,
      );
    }
  }
}

console.log(
  `Write-action gating (ACC-123): ${gatedCount} gated, ${findings.length} ungated, ` +
    `${new Set(allowed).size} allowlisted.`,
);

// Zero gated means the detection broke, not that the app is clean. Same
// reasoning as check-create-gating.mjs's own floor: several pages carry one,
// so this should never legitimately reach zero.
if (gatedCount === 0) {
  console.error(
    '\nFAIL: found no gated write controls at all. This scan has stopped working —' +
      ' many pages carry one, so it should never legitimately reach zero.',
  );
  process.exit(1);
}

if (findings.length > 0) {
  console.error(`\n${findings.map((f) => `  ${f}`).join('\n')}`);
  console.error(
    '\nFAIL: a write control offered to a caller who cannot use it is refused by the' +
      ' API and reads as a broken screen. Wrap it: @if (canEdit()) { ... }, with the' +
      " gate reading the permission that endpoint's @Permissions() enforces." +
      '\n\nIf it is not a write action, add it to ALLOWLIST in' +
      ' scripts/check-action-gating.mjs with the reason.',
  );
  process.exit(1);
}

console.log('\nEvery write control is behind a gate.');
