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
//
// ## ACC-83 — IT ALSO CHECKS FOR AN ABSENCE NOW, AND THAT IS THE HARDER HALF
//
// This scan looked for a WRONG VALUE and could not see a MISSING ONE. An
// omitted `acceptLabel` is not a raw literal, so it passed — and PrimeNG then
// rendered its own English defaults (`accept: 'Yes'`, `reject: 'No'` in
// primeng-config.mjs) inside a fully Arabic RTL dialog. Measured when this was
// found: 19 of 22 confirm() calls passed no labels, so nineteen dialogs did it.
//
// Same shape as am-field's optional [control] and as an assertion that passes
// when the thing it measures is absent: the check asked whether a value was
// right, never whether it was there.
//
// THE FIX IS NOT "REQUIRE A LABEL AT EVERY CALL SITE." That would mean 22
// identical labels, and the twenty-third dialog would still forget. PrimeNG
// resolves each button as
//
//     option('acceptLabel') || getAcceptButtonProps()?.label
//       || config.getTranslation(ACCEPT)
//
// so the LAST term governs every call that passes nothing. LanguageService sets
// it from the translation files, in the same effect that sets the document
// direction.
//
// So this scan now asserts THE MECHANISM: that the global default is wired and
// translated. It keys off the one thing that makes an omitted label safe, which
// is what lets a new confirmation be written with no labels and still be right.
// A per-call-site rule could not do that for the dialogs that already exist,
// and would not have covered the next one either.
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

/**
 * ACC-83 — the global default for the labels PrimeNG renders itself.
 *
 * Asserted here rather than left to a unit test alone, because this is the
 * clause that makes every label-less confirm() call safe: if it goes, 22
 * dialogs silently revert to English "Yes" / "No" and nothing else in the
 * repository would say so.
 *
 * It checks that LanguageService calls setTranslation with BOTH keys and that
 * each is fed from the translation files rather than a literal — the same
 * standard the per-call properties below are held to.
 */
function checkGlobalButtonDefaults() {
  const file = 'src/app/core/services/language.service.ts';
  let source;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    problems.push(
      `${file} — not found. This scan asserts the global PrimeNG confirm-button ` +
        `defaults live here; if the file moved, update the scan with it.`,
    );
    return;
  }

  const call = /setTranslation\s*\(\s*\{([\s\S]*?)\}\s*\)/.exec(source);
  if (!call) {
    problems.push(
      `${file} — no PrimeNG setTranslation({ … }) call. Without it every ` +
        `confirm() that passes no acceptLabel/rejectLabel renders PrimeNG's own ` +
        `English "Yes"/"No", in any language.`,
    );
    return;
  }

  for (const key of ['accept', 'reject']) {
    const value = propertyValue(call[1], key);
    if (value === null) {
      problems.push(
        `${file} — setTranslation() does not set '${key}'. PrimeNG falls back to ` +
          `its own English string for it.`,
      );
      continue;
    }
    checked++;
    if (/^['"`]/.test(value)) {
      problems.push(
        `${file} — setTranslation({ ${key} }) is a raw string: ${value.slice(0, 40)}. ` +
          `It must come from the translation files.`,
      );
    }
  }
}

checkGlobalButtonDefaults();

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

console.log(
  `check:confirm-translated — ${checked} string(s) checked, all translated: ` +
    `every confirm() property that is set, plus the global accept/reject ` +
    `defaults that cover every call which sets none.`,
);
