#!/usr/bin/env node
// ACC-130 — frontend/vercel.json must keep the properties going online relied
// on. Each rule below is a decision recorded in backend/Plans/step-130-go-online.md;
// this fails CI the moment the file stops honouring one, and names it.
//
//   1. Deep links load the app: every ROUTE rewrites to /index.html — and no
//      ASSET request does (ACC-223). Vercel serves real files before rewrites,
//      so an asset that exists was never affected; the trouble was one that no
//      longer exists. A tab opened before a release asks for the old lazy
//      chunk, and a rewrite of every path answered it with the HTML page,
//      status 200, which the .js cache rule then marked immutable for a year.
//      The import failed and the link did nothing. So the rewrite must not
//      answer an asset path: its source is tested against sample asset paths
//      (which it must NOT match) and sample routes (which it must). This does
//      NOT make a missing asset a 404 on Vercel: the static builder appends
//      Angular's own "/(.*)" → /index.html after it (see rule 8), so a missing
//      file still gets the page, 200 — accepted (ACC-226). The protection is
//      the router's reload handler (core/navigation/stale-chunk-reload.ts).
//   8. Build settings are explicit (ACC-226): "framework" is exactly null, so
//      the install command, build command and output directory are the ones
//      stated in vercel.json (rule 6 pins the last) and the dashboard's
//      Angular preset stays out. It does NOT make a missing asset a 404:
//      @vercel/static-build re-detects Angular from package.json (getFramework()
//      falls back to the framework list by dependency, @angular/cli) and
//      appends Angular's default routes, ending "/(.*)" → /index.html, after
//      everything in vercel.json. backend/Plans/step-226-framework-null.md,
//      "Outcome", has the options and the decision.
//   7. The page itself revalidates (ACC-223): a Cache-Control rule on the same
//      source as the rewrite, with max-age=0 — and no long-lived cache rule may
//      match a path the rewrite matches, or the page would be cached under it.
//   2. No rewrite or redirect leaves for another host. The API is reached
//      directly at api.accreditme.app, never proxied through Vercel — a proxy
//      would add a hop to Railway's trust-proxy count (ACC-129) and put Vercel
//      in the authentication path.
//   3. The CSP's connect-src names the API origin environment.prod.ts calls,
//      so changing one without the other is caught here rather than by a
//      blocked request in a browser. script-src is 'self' plus exactly one
//      addition, 'wasm-unsafe-eval' (ACC-189: pdf.js's image decoders are
//      wasm; it compiles WebAssembly and allows NO JavaScript eval and NO
//      inline script). Anything else fails — verify:built-index checks the
//      built page has no inline script for the same reason.
//   4. The security headers are present on every path, and the CSP is
//      ENFORCED (ACC-130 part 2): the Content-Security-Policy header must be
//      there, and a Content-Security-Policy-Report-Only header fails — on its
//      own it would silently switch enforcement off, and beside the enforced
//      one it is a second policy nobody reads.
//   5. Only dev builds (previews are off): ignoreCommand skips any other branch.
//   6. The output directory is where angular.json builds to, and the Node
//      version Vercel uses (package.json engines) is the one CI uses.
//
// NON-VACUITY: a file that is missing, does not parse, or has no headers or
// rewrites fails — an empty object would otherwise satisfy every "no X" rule.
//
// Run: npm run check:vercel-config

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const repoRoot = join(frontendRoot, '..');
const read = (...parts) => readFileSync(join(...parts), 'utf8');

const failures = [];
const fail = (rule, message) => failures.push(`${rule}: ${message}`);

const vercelPath = join(frontendRoot, 'vercel.json');
if (!existsSync(vercelPath)) {
  console.error(`check:vercel-config — ${vercelPath} does not exist`);
  process.exit(1);
}
let vercel;
try {
  vercel = JSON.parse(read(vercelPath));
} catch (err) {
  console.error(`check:vercel-config — vercel.json does not parse: ${err.message}`);
  process.exit(1);
}
const rewrites = Array.isArray(vercel.rewrites) ? vercel.rewrites : [];
const redirects = Array.isArray(vercel.redirects) ? vercel.redirects : [];
const headerRules = Array.isArray(vercel.headers) ? vercel.headers : [];
if (rewrites.length === 0 || headerRules.length === 0) {
  fail('non-vacuity', 'vercel.json has no rewrites or no headers — nothing here to check');
}

// 1. The SPA fallback: routes rewrite, assets do not (ACC-223).
//
// A vercel.json `source` with no ":name" segment is a regular expression
// already; anchored, it is what Vercel matches (verified against
// path-to-regexp v6, the library Vercel routes with, when this was written).
// A source that uses a named segment cannot be read that way, so it fails
// rather than being checked wrongly.
// ("(?:" is a non-capturing group, not a named segment, hence the lookbehind.)
const sourceRegex = (source) => (/(?<!\?):[A-Za-z_]/.test(source) ? null : new RegExp(`^${source}$`, 'i'));
const ROUTE_SAMPLES = ['/', '/home', '/login', '/users', '/users/cmtra1opx00nz', '/roles/abc/permissions', '/platform/tenants', '/objs'];
const ASSET_SAMPLES = [
  '/chunk-CLEGIXN6.js',
  '/main-ABCDEFGH.js',
  '/styles-ABCDEFGH.css',
  '/main.js.map',
  '/assets/i18n/en.json',
  '/assets/pdfjs/pdf.worker.min.mjs',
  '/assets/pdfjs/cmaps/78-H.bcmap',
  '/media/ibm-plex-sans-arabic.woff2',
  // No extension: only the folder rule keeps these out.
  '/assets/anything',
  '/media/anything',
  '/favicon.ico',
  '/logo.png',
  '/logo.svg',
  '/pdf.wasm',
];
const spa = rewrites.filter((r) => r.destination === '/index.html');
let spaRegex = null;
if (spa.length !== 1) {
  fail('1 deep links', `expected exactly one rewrite to "/index.html", found ${spa.length}`);
} else {
  spaRegex = sourceRegex(spa[0].source);
  if (!spaRegex) {
    fail('1 deep links', `the rewrite source "${spa[0].source}" uses a named segment and cannot be checked`);
  } else {
    for (const route of ROUTE_SAMPLES) {
      if (!spaRegex.test(route)) fail('1 deep links', `the route ${route} is not rewritten to /index.html`);
    }
    for (const asset of ASSET_SAMPLES) {
      if (spaRegex.test(asset)) {
        fail('1 deep links', `the asset path ${asset} is rewritten to /index.html — a missing asset must be a 404`);
      }
    }
  }
}
// Every other rewrite must leave assets alone too.
for (const r of rewrites) {
  if (r.destination === '/index.html') continue;
  const re = sourceRegex(r.source);
  if (re && ASSET_SAMPLES.some((asset) => re.test(asset))) {
    fail('1 deep links', `the rewrite ${r.source} → ${r.destination} matches an asset path`);
  }
}

// 7. The page revalidates, and no long cache reaches a rewritten path (ACC-223).
const maxAgeOf = (rule) => {
  const value = (rule.headers ?? []).find((h) => String(h.key).toLowerCase() === 'cache-control')?.value;
  const m = /max-age=(\d+)/.exec(String(value ?? ''));
  return value === undefined ? null : m ? Number(m[1]) : NaN;
};
if (spa.length === 1) {
  const pageRule = headerRules.find((h) => h.source === spa[0].source);
  const pageMaxAge = pageRule ? maxAgeOf(pageRule) : null;
  if (pageMaxAge === null) {
    fail('7 page cache', 'no Cache-Control rule on the rewrite\'s own source — the page must revalidate');
  } else if (pageMaxAge !== 0) {
    fail('7 page cache', `the page's Cache-Control max-age is ${pageMaxAge}, not 0`);
  }
}
for (const rule of headerRules) {
  const age = maxAgeOf(rule);
  if (age === null || age === 0) continue;
  const re = sourceRegex(rule.source);
  const hit = re && spaRegex ? ROUTE_SAMPLES.find((route) => re.test(route)) : null;
  if (!re) fail('7 page cache', `the cached source "${rule.source}" uses a named segment and cannot be checked`);
  else if (hit) fail('7 page cache', `"${rule.source}" caches the page at ${hit} for ${age}s`);
}

// 2. Nothing leaves for another host.
for (const r of [...rewrites, ...redirects]) {
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(String(r.destination ?? ''))) {
    fail('2 no proxy', `${r.source} → ${r.destination} goes to another host`);
  }
}

// The headers that apply to every path.
const everyPath = headerRules.find((h) => h.source === '/(.*)');
const headers = new Map((everyPath?.headers ?? []).map((h) => [String(h.key).toLowerCase(), String(h.value)]));
if (!everyPath) fail('4 headers', 'no header rule for "/(.*)"');

// 3. The CSP and the API origin.
const envProd = read(frontendRoot, 'src', 'environments', 'environment.prod.ts');
const apiUrl = /apiUrl:\s*'([^']+)'/.exec(envProd)?.[1];
let apiOrigin = null;
try {
  apiOrigin = new URL(apiUrl).origin;
} catch {
  fail('3 csp', `environment.prod.ts apiUrl "${apiUrl}" is not an absolute URL`);
}
if (headers.has('content-security-policy-report-only')) {
  fail('4 headers', 'Content-Security-Policy-Report-Only is present — the policy is enforced, so it must be Content-Security-Policy');
}
const csp = headers.get('content-security-policy');
if (!csp) {
  fail('4 headers', 'no enforced Content-Security-Policy header');
} else {
  const directive = (name) =>
    csp.split(';').map((d) => d.trim().split(/\s+/)).find((parts) => parts[0] === name)?.slice(1) ?? null;
  const connect = directive('connect-src');
  if (!connect) fail('3 csp', 'no connect-src directive');
  else if (apiOrigin && !connect.includes(apiOrigin)) {
    fail('3 csp', `connect-src (${connect.join(' ')}) does not include the API origin ${apiOrigin}`);
  }
  const script = directive('script-src');
  if (!script || script.join(' ') !== "'self' 'wasm-unsafe-eval'") {
    fail('3 csp', `script-src must be exactly 'self' 'wasm-unsafe-eval', found ${script ? script.join(' ') : 'nothing'}`);
  }
}

// 4. The security headers.
const required = {
  'strict-transport-security': /max-age=\d+/,
  'x-content-type-options': /^nosniff$/,
  'x-frame-options': /^DENY$/,
  'referrer-policy': /^strict-origin-when-cross-origin$/,
  'cross-origin-opener-policy': /^same-origin$/,
};
for (const [key, pattern] of Object.entries(required)) {
  const value = headers.get(key);
  if (value === undefined) fail('4 headers', `${key} is missing`);
  else if (!pattern.test(value)) fail('4 headers', `${key} is "${value}"`);
}

// 5. Only dev builds.
const ignore = String(vercel.ignoreCommand ?? '');
if (!/\$VERCEL_GIT_COMMIT_REF"?\s*!=\s*"?dev"?/.test(ignore)) {
  fail('5 only dev', `ignoreCommand "${ignore}" does not skip every branch but dev`);
}

// 8. Build settings are explicit (ACC-226). `null` exactly: a missing key lets
// Vercel detect Angular for the project and apply its preset. Null does not
// stop the static builder's own re-detection (see the header).
if (vercel.framework !== null) {
  const found = 'framework' in vercel ? JSON.stringify(vercel.framework) : 'not set (Vercel would detect one)';
  fail(
    '8 no preset',
    `"framework" must be exactly null, found ${found} — null keeps the build settings the explicit ones in vercel.json and the dashboard's framework preset out (it does not make a missing asset a 404: the static builder re-detects Angular from package.json)`,
  );
}

// 6. Output directory and Node version.
const angular = JSON.parse(read(frontendRoot, 'angular.json'));
const outputPath = Object.values(angular.projects)[0]?.architect?.build?.options?.outputPath;
if (vercel.outputDirectory !== `${outputPath}/browser`) {
  fail('6 build', `outputDirectory "${vercel.outputDirectory}" is not angular.json's "${outputPath}/browser"`);
}
const engines = JSON.parse(read(frontendRoot, 'package.json')).engines?.node ?? '';
const ciNodes = [...read(repoRoot, '.github', 'workflows', 'ci.yml').matchAll(/node-version:\s*'(\d+)'/g)].map((m) => m[1]);
if (ciNodes.length === 0) fail('6 build', 'no node-version found in ci.yml');
for (const v of new Set(ciNodes)) {
  if (!engines.startsWith(`${v}.`) && engines !== v) {
    fail('6 build', `package.json engines.node "${engines}" is not CI's Node ${v}`);
  }
}

if (failures.length) {
  console.error(`check:vercel-config — ${failures.length} problem(s) in frontend/vercel.json:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`check:vercel-config — ok: API origin ${apiOrigin}, ${headers.size} headers on every path, only dev builds`);
