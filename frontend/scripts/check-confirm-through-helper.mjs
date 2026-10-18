#!/usr/bin/env node
// ACC-120 slice 10 — every confirmation goes through AmConfirmService.ask().
//
// ## Why
//
// There were 23 ConfirmationService.confirm() calls, each choosing its own
// header, labels, icon and button classes. They drifted: 13 said only
// "Confirm", 14 showed Yes / No, the destructive ones used PrimeNG's own red
// (below AA), and only one pushed a layer, so an Escape over an edit dialog
// closed the confirm AND the dialog under it. ask() decides all of that from
// one `tone`, so a call cannot get it wrong — but only if every call goes
// through it. This scan is what makes "every" true.
//
// ## What it checks
//
// Outside the helper, a file fails for either of two shapes:
// - `.confirm({` on anything: ConfirmationService.confirm() always takes one
//   object, so this catches the service under any name or none;
// - `.confirm(` on a name the file binds to ConfirmationService
//   (`x = inject(ConfirmationService)`, or a parameter typed so).
// A bare `.confirm(` is not enough on its own: UserStatusActionsService has a
// confirm(action, user, result) method of its own, and it is not one of these.
// Comments are ignored, because they name the old call to explain it.
//
// ## The floors
//
// The helper itself must still contain exactly one `.confirm(`: if it moved or
// was renamed, this scan would otherwise read every file as clean while
// checking nothing. And at least one `.ask(` call must exist, for the same
// reason from the other side.
//
// Run: npm run check:confirm-through-helper        (CI: frontend job)
// Its mutation test: npm run check:confirm-through-helper:selftest
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src/app';
const HELPER = 'shared/components/confirm/am-confirm.service.ts';

const files = globSync('**/*.ts', { cwd: ROOT })
  .map((f) => f.replace(/\\/g, '/'))
  .filter((f) => !f.endsWith('.spec.ts'));

/**
 * The source with its comments blanked out (same length, so line numbers
 * hold). Comments explain the old call by name — "ConfirmationService.confirm("
 * — and must not count as one. Strings and template literals are skipped
 * whole, so a URL's "//" is not taken for a comment.
 */
function code(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        out += ' ';
        i++;
      }
    } else if (ch === '/' && next === '*') {
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      out += '  ';
      i += 2;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      out += ch;
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') {
          out += source[i] + (source[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += source[i];
        i++;
      }
      out += source[i] ?? '';
      i++;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

const CONFIRM_OBJECT_CALL = /\.confirm\s*\(\s*\{/g;
const ASK_CALL = /\.ask\s*\(\s*\{/g;

/** The names this file binds to ConfirmationService. */
function serviceNames(source) {
  const names = new Set();
  for (const m of source.matchAll(/(\w+)\s*=\s*inject\(\s*ConfirmationService\s*\)/g)) names.add(m[1]);
  for (const m of source.matchAll(/(\w+)\s*:\s*ConfirmationService\b/g)) names.add(m[1]);
  return names;
}

/** Every direct ConfirmationService call in this source, by its index. */
function directCalls(source) {
  const hits = new Map();
  for (const m of source.matchAll(CONFIRM_OBJECT_CALL)) hits.set(m.index, 'calls .confirm({ … }) directly');
  for (const name of serviceNames(source)) {
    for (const m of source.matchAll(new RegExp(`\\b${name}\\s*\\.confirm\\s*\\(`, 'g'))) {
      hits.set(m.index + m[0].indexOf('.confirm'), `calls ${name}.confirm( on ConfirmationService`);
    }
  }
  return [...hits].sort((a, b) => a[0] - b[0]);
}

const findings = [];
let helperCalls = 0;
let askCalls = 0;

for (const file of files) {
  const source = code(readFileSync(join(ROOT, file), 'utf8'));
  const calls = directCalls(source);
  if (file === HELPER) {
    helperCalls = calls.length;
    continue;
  }
  askCalls += [...source.matchAll(ASK_CALL)].length;
  for (const [index, what] of calls) {
    const line = source.slice(0, index).split('\n').length;
    findings.push(`${ROOT}/${file}:${line} — ${what}`);
  }
}

console.log(
  `Confirm through helper (ACC-120 slice 10): ${askCalls} ask() call(s), ` +
    `${findings.length} direct .confirm( call(s) outside ${HELPER}.`,
);

if (helperCalls !== 1) {
  console.error(
    `\nFAIL: ${ROOT}/${HELPER} should hold the app's one .confirm( call and holds ${helperCalls}. ` +
      'If the helper moved or was renamed, update HELPER in this scan — otherwise it checks nothing.',
  );
  process.exit(1);
}

if (askCalls === 0) {
  console.error(
    '\nFAIL: found no ask() calls at all. This scan has stopped seeing the confirms — ' +
      'the app has many, so it should never legitimately reach zero.',
  );
  process.exit(1);
}

if (findings.length > 0) {
  console.error(`\n${findings.map((f) => `  ${f}`).join('\n')}`);
  console.error(
    '\nFAIL: ask for a confirmation with AmConfirmService.ask({ tone, header, message, acceptLabel, accept }), ' +
      'never ConfirmationService.confirm(). tone decides the buttons, the focus and the layer; ' +
      'a direct call gets none of them.',
  );
  process.exit(1);
}

console.log('\nEvery confirmation goes through AmConfirmService.ask().');
