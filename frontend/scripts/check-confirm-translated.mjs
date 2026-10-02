#!/usr/bin/env node
// ACC-120 — a confirmation dialog's words must be translated.
//
// ## Why nothing else catches this
//
// They are STRING LITERALS IN TYPESCRIPT, passed to a service:
//
//     this.confirmationService.confirm({
//       header: 'Confirm',
//       message: `Deactivate position "${position.nameEn}"?`,
//       ...
//     })
//
// No template scan reads a service call, and no translation-key test can see a
// sentence that was never given a key. Org Positions shipped exactly the above:
// an Arabic session got an English modal asking to deactivate something.
//
// ## Why a NARROW lint rather than a general string-literal scan
//
// Flagging every literal in the app would be noise, and a noisy scan gets
// disabled. This works only because the call SHAPE is fixed: ConfirmationService
// takes one object, and exactly three of its properties are read by a human.
// Those three are checked and nothing else is.
//
// ## What counts as translated
//
// A `translate.instant(...)` call, or a value built from one. A template literal
// is REFUSED even when it interpolates a translated piece, because
// `${t('x')} "${name}"` is a sentence whose structure is English — word order
// and punctuation are part of a translation, not decoration around it.
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src/app';
const HUMAN_PROPS = ['header', 'message', 'acceptLabel', 'rejectLabel'];

function sourceFiles() {
  return globSync('**/*.ts', { cwd: ROOT })
    .filter((f) => !f.endsWith('.spec.ts'))
    .map((f) => join(ROOT, f));
}

/**
 * The argument object of each `.confirm({ … })`, matched by brace balance so a
 * nested object or a callback body cannot end the match early.
 */
function confirmCalls(source) {
  const calls = [];
  const re = /\.confirm\s*\(\s*\{/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      i++;
    }
    calls.push({ body: source.slice(re.lastIndex, i - 1), index: m.index });
  }
  return calls;
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

/** The value expression for a top-level property of the call object. */
function propertyValue(body, prop) {
  const re = new RegExp(`(^|[,{\\s])${prop}\\s*:`, 'm');
  const m = re.exec(body);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 0;
  let out = '';
  for (; i < body.length; i++) {
    const ch = body[i];
    if ('({['.includes(ch)) depth++;
    else if (')}]'.includes(ch)) {
      if (depth === 0) break;
      depth--;
    } else if (ch === ',' && depth === 0) break;
    out += ch;
  }
  return out.trim();
}

const problems = [];
let checked = 0;

for (const file of sourceFiles()) {
  const source = readFileSync(file, 'utf8');
  if (!source.includes('.confirm(')) continue;

  for (const call of confirmCalls(source)) {
    for (const prop of HUMAN_PROPS) {
      const value = propertyValue(call.body, prop);
      if (value === null) continue;
      checked++;

      const translated = /\btranslate\b[\s\S]*\.instant\s*\(|\binstant\s*\(/.test(value);
      if (translated && !value.startsWith('`')) continue;

      const quoted = /^['"`]/.test(value);
      if (!quoted) continue; // a signal, a computed, a variable — not our business

      problems.push(
        `${file}:${lineOf(source, call.index)} — confirm({ ${prop} }) is a raw string: ` +
          `${value.slice(0, 60)}${value.length > 60 ? '…' : ''}`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error(`\ncheck:confirm-translated — ${problems.length} untranslated confirmation(s):\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    `\nUse translate.instant('key', { … }). A template literal is refused even ` +
      `when it interpolates a translated piece: word order and punctuation belong ` +
      `to the translation.\n`,
  );
  process.exit(1);
}

console.log(`check:confirm-translated — ${checked} confirmation string(s), all translated.`);
