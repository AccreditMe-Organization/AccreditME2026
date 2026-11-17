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
//   - writes a time unit onto a number by hand (ACC-265): `n + 'h'`, `${n}h`,
//     `{{ n }}h`. "40h" read the same in both languages; a quantity is a
//     counted string (amCount / FormatService.count) or a duration (amDuration).
//     Matched: h, hr(s), hour(s), d, day(s), min(s), minute(s), w, week(s).
//     Not matched: a bare 's' or 'm' after ${…} (CSS seconds and margins look
//     the same), and '%', a symbol written the same in both languages, with
//     the digits already Latin through amNumber.
//   - wraps a formatted date (amDate / amDateTime / amRelative / amDuration)
//     in an element carrying dir="ltr" (ACC-313): an Arabic date then reads
//     out of order. dir="ltr" around an email, a URL or a code is untouched.
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
  // ACC-265 — a time unit written onto a number by hand, in its three shapes.
  {
    pattern: /\+\s*(['"`])\s*(?:h|hrs?|hours?|d|days?|mins?|minutes?|w|wks?|weeks?)\s*\1/,
    message: "writes a time unit onto a number ('h', 'days'…); use amCount / FormatService.count or amDuration",
  },
  {
    pattern: /\$\{[^}]*\}\s*(?:h|hrs?|hours?|d|days?|mins?|minutes?|w|wks?|weeks?)\b/,
    message: 'writes a time unit onto a number in a template string; use FormatService.count or duration',
  },
  {
    pattern: /\}\}\s*(?:h|hrs?|hours?|days?|mins?|minutes?|weeks?)\b/,
    message: 'writes a time unit after an interpolated number; use amCount or amDuration',
  },
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

// ACC-313 (CC-323) — a formatted date wrapped in dir="ltr". A date from the
// layer is words and digits in the reader's language; forced left to right,
// an Arabic date that starts with its day shows the day LAST («نوفمبر 2026، 12:00 17»).
// Keyed on the content, not on a list of files: an element whose opening tag
// carries dir="ltr", in any attribute order and across lines, and whose content
// (to its own closing tag, children included: they inherit the direction)
// holds an amDate / amDateTime / amRelative / amDuration pipe. A date written
// by FormatService in code is not seen here; that is a spec's to pin.
const LTR_DATE = {
  openTag: /<([a-zA-Z][\w-]*)((?:\s+[^\s=>/"']+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/g,
  ltr: /(?:^|\s)dir\s*=\s*(["'])ltr\1/,
  datePipe: /\|\s*am(?:Date|DateTime|Relative|Duration)\b/,
  message: 'wraps a formatted date in dir="ltr"; an Arabic date then reads out of order. Let it take the page\'s direction',
};

/** The content of the element opened at `from` (after its `>`), to its own closing tag. */
function elementContent(source, tag, from) {
  const tags = new RegExp(`<(/?)${tag}(?=[\\s>/])`, 'g');
  tags.lastIndex = from;
  let depth = 1;
  for (let m = tags.exec(source); m; m = tags.exec(source)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return source.slice(from, m.index);
  }
  return source.slice(from);
}

function ltrDateViolations(source) {
  const found = [];
  LTR_DATE.openTag.lastIndex = 0;
  for (let m = LTR_DATE.openTag.exec(source); m; m = LTR_DATE.openTag.exec(source)) {
    const [whole, tag, attrs, selfClosing] = m;
    if (selfClosing || !LTR_DATE.ltr.test(attrs)) continue;
    if (LTR_DATE.datePipe.test(elementContent(source, tag, m.index + whole.length))) {
      const line = source.slice(0, m.index + whole.indexOf('dir')).split(/\r?\n/).length;
      found.push({ line, text: whole.replace(/\s+/g, ' ') });
    }
  }
  return found;
}

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
  for (const { line, text } of ltrDateViolations(source)) {
    violations.push(`${relative(root, file)}:${line}: ${LTR_DATE.message}\n    ${text}`);
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
