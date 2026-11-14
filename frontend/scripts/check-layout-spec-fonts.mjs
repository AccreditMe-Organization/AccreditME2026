#!/usr/bin/env node
// ACC-305 — a spec that measures layout measures in the REAL font.
//
// The app's text is IBM Plex Sans Arabic, self-hosted. Until its files arrive,
// text is laid out in the fallback (`system-ui`): Segoe UI on Windows, a wider
// face on a Linux CI runner. A spec that measured before the font loaded passed
// on Windows and failed on CI (set-acting-head, 494 vs 488).
//
// `useLayoutFonts()` (src/testing/layout-fonts.ts) loads every weight the app
// uses before the describe's tests run, waits for it, and CHECKS it, so a
// too-early measurement fails on any machine with the weight named. This scan
// makes every measuring spec call it:
//
//   a *.spec.ts file that, in CODE (comments stripped), reads layout —
//   getBoundingClientRect, offsetWidth/Height, scrollWidth/Height,
//   clientWidth/Height — must also call useLayoutFonts(.
//
// The predicate keys off the file's own content, so a spec written tomorrow is
// covered the moment it measures, and there is no list to maintain. No
// allowlist: when this was added it matched exactly the 54 measuring specs, all
// of which call the helper.
//
// Run: npm run check:layout-spec-fonts      (CI discovers every check:*)

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const src = join(root, 'src');

const MEASURES = /\b(getBoundingClientRect|offsetWidth|offsetHeight|scrollWidth|scrollHeight|clientWidth|clientHeight)\b/;
const CALLS_HELPER = /\buseLayoutFonts\s*\(/;

/** The file without its comments, so a measurement named in prose does not count. */
function code(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // A line comment, but not the `//` inside a URL string ('https://…').
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function specs(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) specs(path, out);
    else if (entry.name.endsWith('.spec.ts')) out.push(path);
  }
  return out;
}

const all = specs(src);
const measuring = all.filter((file) => MEASURES.test(code(readFileSync(file, 'utf8'))));
const missing = measuring.filter((file) => !CALLS_HELPER.test(code(readFileSync(file, 'utf8'))));

if (!measuring.length) {
  // A scan that finds nothing to check has stopped checking.
  console.error('check:layout-spec-fonts: no spec measures layout — the predicate is broken');
  process.exit(1);
}
if (missing.length) {
  for (const file of missing) {
    console.error(
      `check:layout-spec-fonts: ${relative(root, file).replace(/\\/g, '/')} measures layout but does not call ` +
        `useLayoutFonts() — add it at the top of the describe that measures ` +
        `(src/testing/layout-fonts.ts), or it may measure in a fallback font`,
    );
  }
  process.exit(1);
}
console.log(
  `check:layout-spec-fonts: ${measuring.length} of ${all.length} specs measure layout, and every one calls useLayoutFonts().`,
);
