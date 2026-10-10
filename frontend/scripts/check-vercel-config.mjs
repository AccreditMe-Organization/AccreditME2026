#!/usr/bin/env node
// ACC-130 — frontend/vercel.json must keep the properties going online relied
// on. Each rule below is a decision recorded in backend/Plans/step-130-go-online.md;
// this fails CI the moment the file stops honouring one, and names it.
//
//   1. Deep links load the app: a rewrite of every path to /index.html.
//      Vercel serves real files before rewrites, so assets are unaffected.
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
//   4. The security headers are present on every path.
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

// 1. The SPA fallback.
if (!rewrites.some((r) => r.source === '/(.*)' && r.destination === '/index.html')) {
  fail('1 deep links', 'no rewrite of "/(.*)" to "/index.html"');
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
const csp = headers.get('content-security-policy') ?? headers.get('content-security-policy-report-only');
if (!csp) {
  fail('3 csp', 'no Content-Security-Policy (or -Report-Only) header');
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
