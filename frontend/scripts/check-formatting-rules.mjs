#!/usr/bin/env node
// ACC-94 — the build-time half of the formatting rule (CLAUDE.md, "Key
// Architecture Decisions (ACC-94)"). A Karma spec runs in a browser with no
// filesystem, so a rule about SOURCE — "nothing formats a date outside the
// layer" — can only be enforced here. The translation-file rules (plural
// categories, counted placeholders, Latin digits) are specs, in
// translation-keys.spec.ts.
//
// Fails the build when application code outside src/app/core/formatting/:
//   - formats a date or number itself (| date, DatePipe, formatDate(),
//     toLocale*String(), new Intl.*, | number / percent / currency and their pipes)
//   - names a plural key ('plural.…'), which only FormatService.count / amCount
//     may resolve — through | translate it finds nothing (plural-catalog.ts)
//   - sets a date picker's dateFormat, which would override the app-wide
//     "15 Sep 2026" display (date-picker-locale.ts)
//   - uses p-inputNumber or p-paginator without the directive that pins their
//     digits to Latin (latin-digits.ts)
//
// Spec files are not scanned: they may construct Intl formatters to state the
// platform facts a test depends on.
//
// Run: npm run check:formatting        (CI: frontend job, after the type check)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const appDir = join(root, 'src', 'app');
const layerDir = join(appDir, 'core', 'formatting') + sep;

const RULES = [
  { pattern: /\|\s*date\b/, message: 'formats a date with the Angular date pipe; use amDate / amDateTime' },
  { pattern: /\bDatePipe\b/, message: 'imports DatePipe; use the formatting layer' },
  { pattern: /\bformatDate\s*\(/, message: 'calls formatDate(); use FormatService' },
  { pattern: /\.toLocale(Date|Time)?String\s*\(/, message: 'calls toLocale*String(); use FormatService' },
  { pattern: /\bnew\s+Intl\./, message: 'constructs an Intl formatter; only core/formatting may' },
  { pattern: /\|\s*(number|percent|currency)\b/, message: 'formats a number with an Angular pipe; use amNumber' },
  { pattern: /\b(DecimalPipe|PercentPipe|CurrencyPipe)\b/, message: 'imports an Angular number pipe; use amNumber' },
  { pattern: /['"`]plural\./, message: "names a plural key; resolve counted strings with amCount / FormatService.count" },
  { pattern: /\[?dateFormat\]?\s*=/, message: 'overrides the date picker format; provideDatePickerLocale() sets it app-wide' },
];

// PrimeNG components that format digits with the BROWSER's locale unless told
// otherwise (core/formatting/latin-digits.ts). Checked per file, not per line:
// a tag can span lines, and the directive is imported once per component.
const FILE_RULES = [
  {
    uses: /<p-input-?number\b/i,
    requires: 'InputNumberLatinDigits',
    message: 'uses p-inputNumber without InputNumberLatinDigits; its digits would follow the browser locale',
  },
  {
    uses: /<p-paginator\b/,
    requires: 'PaginatorLatinDigits',
    message: 'uses p-paginator without PaginatorLatinDigits; its page numbers would follow the browser locale',
  },
];

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      yield* sourceFiles(path);
    } else if (/\.(ts|html)$/.test(entry) && !entry.endsWith('.spec.ts') && !path.startsWith(layerDir)) {
      yield path;
    }
  }
}

const violations = [];
for (const file of sourceFiles(appDir)) {
  const source = readFileSync(file, 'utf8');
  for (const { uses, requires, message } of FILE_RULES) {
    if (uses.test(source) && !source.includes(requires)) {
      violations.push(`${relative(root, file)}: ${message}`);
    }
  }
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const { pattern, message } of RULES) {
      if (pattern.test(line)) {
        violations.push(`${relative(root, file)}:${index + 1}: ${message}\n    ${line.trim()}`);
      }
    }
  });
}

if (violations.length > 0) {
  console.error(`Formatting rule (ACC-94): ${violations.length} violation(s)\n`);
  console.error(violations.join('\n'));
  console.error('\nDates, numbers and counted strings go through src/app/core/formatting (see CLAUDE.md, ACC-94).');
  process.exit(1);
}
console.log('Formatting rule (ACC-94): no violations.');
