#!/usr/bin/env node
// ACC-213 — checks on the BUILT website (run after `astro build`; `npm run
// check` runs astro check, the build, then this). Each rule fails with its
// name; nothing passes vacuously — a missing dist, no pages or an empty list
// fails before any "none found" can mean anything.
//
//   pages      the 8 pages exist, and nothing else is a page
//   lang/dir   every page: lang="en" dir="ltr", or lang="ar" dir="rtl" under /ar/
//   inline     no inline <script>, no <style>, no style="", no on*="" handler,
//              no javascript: URL — the CSP is script-src 'self'; style-src 'self'
//   links      canonical and hreflang on www.accreditme.app; the language
//              switch goes to the same page in the other language
//   sections   the home pages carry the 12 sections, in the design's order,
//              each on its band
//   vercel     the enforced CSP (exactly CC-74's), noindex, the app's headers,
//              no Report-Only, the build settings, the ignore rule, caching
//   robots     Disallow: / ; the sitemap is on www and lists no 404
//   reserved   the generated list IS the backend's, it reached the browser
//              bundle, and the address rule behaves
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { loadBackendReserved } from './generate-reserved.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const SITE = 'https://www.accreditme.app';
const failures = [];
const passed = [];
const fail = (rule, msg) => failures.push(`${rule}: ${msg}`);
const done = (rule, msg) => passed.push(`${rule}: ${msg}`);

if (!existsSync(dist)) {
  console.error('verify-site — dist/ does not exist; run the build first');
  process.exit(1);
}

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const files = walk(dist);
const urlPath = (file) => '/' + relative(dist, file).split(sep).join('/');

// ── pages ───────────────────────────────────────────────────────────────
const EXPECTED = {
  '/index.html': { lang: 'en', path: '/', other: '/ar/' },
  '/privacy/index.html': { lang: 'en', path: '/privacy/', other: '/ar/privacy/' },
  '/terms/index.html': { lang: 'en', path: '/terms/', other: '/ar/terms/' },
  '/404.html': { lang: 'en', path: null, other: '/ar/404/' },
  '/ar/index.html': { lang: 'ar', path: '/ar/', other: '/' },
  '/ar/privacy/index.html': { lang: 'ar', path: '/ar/privacy/', other: '/privacy/' },
  '/ar/terms/index.html': { lang: 'ar', path: '/ar/terms/', other: '/terms/' },
  '/ar/404/index.html': { lang: 'ar', path: null, other: '/404.html' },
};
const html = files.filter((f) => f.endsWith('.html'));
const built = new Set(html.map(urlPath));
for (const p of Object.keys(EXPECTED)) if (!built.has(p)) fail('pages', `${p} was not built`);
for (const p of built) if (!(p in EXPECTED)) fail('pages', `${p} is a page nobody listed`);
if (html.length === 0) fail('pages', 'no HTML at all');
else done('pages', `${html.length} built, all expected (en + ar: home, privacy, terms, 404)`);

let inlineChecked = 0;
for (const file of html) {
  const p = urlPath(file);
  const src = readFileSync(file, 'utf8');
  const exp = EXPECTED[p];

  // ── lang/dir ──────────────────────────────────────────────────────────
  const htmlTag = /<html\b[^>]*>/i.exec(src)?.[0] ?? '';
  const lang = /\blang="([^"]+)"/.exec(htmlTag)?.[1];
  const dir = /\bdir="([^"]+)"/.exec(htmlTag)?.[1];
  const wantLang = p.startsWith('/ar/') ? 'ar' : 'en';
  const wantDir = wantLang === 'ar' ? 'rtl' : 'ltr';
  if (lang !== wantLang || dir !== wantDir) fail('lang/dir', `${p} has lang=${lang} dir=${dir}, want ${wantLang}/${wantDir}`);

  // ── inline ────────────────────────────────────────────────────────────
  for (const tag of src.match(/<script\b[^>]*>/gi) ?? []) {
    if (!/\bsrc="/i.test(tag)) fail('inline', `${p} has an inline script: ${tag}`);
  }
  if (/<style\b/i.test(src)) fail('inline', `${p} has a <style> tag`);
  if (/\sstyle\s*=/i.test(src)) fail('inline', `${p} has a style="" attribute`);
  const handler = /<[a-z][^>]*\son[a-z]+\s*=/i.exec(src);
  if (handler) fail('inline', `${p} has an inline event handler: ${handler[0].slice(0, 80)}`);
  if (/(href|src|action)\s*=\s*"\s*javascript:/i.test(src)) fail('inline', `${p} has a javascript: URL`);
  inlineChecked += 1;

  // ── links ─────────────────────────────────────────────────────────────
  if (exp) {
    const canonical = /<link rel="canonical" href="([^"]+)"/.exec(src)?.[1];
    const alt = (l) => new RegExp(`<link rel="alternate" hreflang="${l}" href="([^"]+)"`).exec(src)?.[1];
    if (exp.path) {
      if (canonical !== `${SITE}${exp.path}`) fail('links', `${p} canonical is ${canonical}`);
      const en = exp.lang === 'en' ? exp.path : exp.other;
      const ar = exp.lang === 'ar' ? exp.path : exp.other;
      if (alt('en') !== `${SITE}${en}`) fail('links', `${p} hreflang=en is ${alt('en')}`);
      if (alt('ar') !== `${SITE}${ar}`) fail('links', `${p} hreflang=ar is ${alt('ar')}`);
      if (alt('x-default') !== `${SITE}${en}`) fail('links', `${p} x-default is ${alt('x-default')}`);
    } else if (canonical) {
      fail('links', `${p} is a 404 and must not declare a canonical`);
    }
    const sw = /<a class="lang-switch" href="([^"]+)"[^>]*hreflang="([^"]+)"/.exec(src);
    const otherLang = exp.lang === 'en' ? 'ar' : 'en';
    if (!sw || sw[1] !== exp.other || sw[2] !== otherLang) {
      fail('links', `${p} language switch is ${sw ? `${sw[1]} (${sw[2]})` : 'missing'}, want ${exp.other} (${otherLang})`);
    }
  }
}
if (inlineChecked > 0) done('inline', `${inlineChecked} pages: no inline script, style tag, style attribute, handler or javascript: URL`);
done('lang/dir', `${html.length} pages: en/ltr at the root, ar/rtl under /ar/`);
done('links', 'canonical + hreflang on www.accreditme.app; each switch to the same page in the other language');

// ── sections ────────────────────────────────────────────────────────────
const ORDER = [
  ['header', 'white'],
  ['hero', 'hero'],
  ['problem', 'tint-grey'],
  ['what-it-does', 'white'],
  ['how-it-works', 'white'],
  ['ai', 'white'],
  ['security', 'white'],
  ['who', 'tint-sky'],
  ['pricing', 'charcoal'],
  ['faq', 'white'],
  ['demo', 'charcoal'],
  ['footer', 'charcoal'],
];
for (const home of ['/index.html', '/ar/index.html']) {
  const file = html.find((f) => urlPath(f) === home);
  if (!file) continue;
  const src = readFileSync(file, 'utf8');
  const found = [...src.matchAll(/<(header|footer|section)\b[^>]*\bid="([a-z-]+)"[^>]*>/g)].map((m) => m[2]);
  const want = ORDER.map(([id]) => id);
  if (found.join(',') !== want.join(',')) fail('sections', `${home} sections are ${found.join(', ')}; want ${want.join(', ')}`);
  for (const [id, band] of ORDER) {
    if (id === 'header' || id === 'footer') continue;
    // A section draws its own band, or sits bare inside a band that does.
    const own = new RegExp(`<section\\b[^>]*\\bid="${id}"[^>]*\\bdata-band="${band}"`).test(src);
    const inPair = new RegExp(`data-band="${band}"[^>]*>\\s*<div class="container band__pair">[\\s\\S]*?<section\\b[^>]*\\bid="${id}"`).test(src);
    if (!own && !inPair) fail('sections', `${home} section "${id}" is not on the ${band} band`);
  }
  if (!/class="site-footer"/.test(src) || !/accreditme-logo-reversed\.png/.test(src)) fail('sections', `${home} footer is not the charcoal band with the reversed logo`);
  const drafts = (src.match(/class="draft"/g) ?? []).length;
  if (drafts < 10) fail('sections', `${home} has ${drafts} DRAFT markers, want one per section`);
}
done('sections', '12 sections in the design\'s order, each on its band, in both languages');

// ── vercel ──────────────────────────────────────────────────────────────
const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
const app = JSON.parse(readFileSync(join(root, '..', 'frontend', 'vercel.json'), 'utf8'));
const headersOf = (cfg, source) =>
  new Map((cfg.headers ?? []).find((h) => h.source === source)?.headers.map((h) => [h.key.toLowerCase(), h.value]) ?? []);
const every = headersOf(vercel, '/(.*)');
const appEvery = headersOf(app, '/(.*)');
if (every.size === 0) fail('vercel', 'no header rule for "/(.*)"');
const WANT_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'self'; object-src 'none'";
const directives = (v) => (v ?? '').split(';').map((d) => d.trim().replace(/\s+/g, ' ')).filter(Boolean).sort();
if (!every.has('content-security-policy')) fail('vercel', 'no ENFORCED Content-Security-Policy');
else if (directives(every.get('content-security-policy')).join('|') !== directives(WANT_CSP).join('|')) {
  fail('vercel', `the CSP is not CC-74's: ${every.get('content-security-policy')}`);
}
if (every.has('content-security-policy-report-only')) fail('vercel', 'a Report-Only CSP is present');
if (!/\bnoindex\b/.test(every.get('x-robots-tag') ?? '') || !/\bnofollow\b/.test(every.get('x-robots-tag') ?? '')) {
  fail('vercel', `X-Robots-Tag is "${every.get('x-robots-tag')}", want noindex, nofollow`);
}
for (const k of ['strict-transport-security', 'referrer-policy', 'permissions-policy']) {
  if (!every.get(k) || every.get(k) !== appEvery.get(k)) fail('vercel', `${k} is "${every.get(k)}", the app's is "${appEvery.get(k)}"`);
}
const exact = { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'cross-origin-opener-policy': 'same-origin' };
for (const [k, v] of Object.entries(exact)) if (every.get(k) !== v) fail('vercel', `${k} is "${every.get(k)}", want ${v}`);
const build = { framework: 'astro', installCommand: 'npm ci', buildCommand: 'npm run build', outputDirectory: 'dist' };
for (const [k, v] of Object.entries(build)) if (vercel[k] !== v) fail('vercel', `${k} is "${vercel[k]}", want "${v}"`);
const ignore = String(vercel.ignoreCommand ?? '');
if (!/\$VERCEL_GIT_COMMIT_REF"?\s*!=\s*"?dev"?/.test(ignore) || !/git diff --quiet HEAD\^ HEAD -- \./.test(ignore)) {
  fail('vercel', `ignoreCommand "${ignore}" does not skip non-dev branches and unchanged website commits`);
}
if (!ignore.includes('../backend/src/common/tenant/reserved-slugs.ts')) {
  fail('vercel', 'ignoreCommand does not rebuild when the reserved list (read at build time) changes');
}
if (!/immutable/.test(headersOf(vercel, '/_astro/(.*)').get('cache-control') ?? '')) fail('vercel', 'hashed /_astro/ assets are not cached immutable');
if (!files.some((f) => urlPath(f).startsWith('/_astro/'))) fail('vercel', 'no hashed /_astro/ assets were built — the cache rule matches nothing');
done('vercel', 'enforced CSP (CC-74 exactly), noindex/nofollow, the app\'s HSTS/Referrer/Permissions, nosniff, DENY, COOP; build, ignore and cache rules');

// ── robots ──────────────────────────────────────────────────────────────
const robots = existsSync(join(dist, 'robots.txt')) ? readFileSync(join(dist, 'robots.txt'), 'utf8') : '';
if (!/^User-agent:\s*\*\s*$/m.test(robots) || !/^Disallow:\s*\/\s*$/m.test(robots)) fail('robots', `robots.txt is not "Disallow: /": ${JSON.stringify(robots)}`);
const sitemaps = files.filter((f) => /\/sitemap-\d+\.xml$/.test(urlPath(f)));
const locs = sitemaps.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
if (!existsSync(join(dist, 'sitemap-index.xml')) || locs.length === 0) fail('robots', 'no sitemap, or an empty one');
for (const l of locs) {
  if (!l.startsWith(`${SITE}/`)) fail('robots', `sitemap lists ${l}, not on ${SITE}`);
  if (/404/.test(l)) fail('robots', `sitemap lists a 404: ${l}`);
}
done('robots', `robots.txt Disallow: / ; sitemap of ${locs.length} pages on ${SITE}, no 404`);

// ── reserved ────────────────────────────────────────────────────────────
const backend = await loadBackendReserved();
const generatedSrc = readFileSync(join(root, 'src', 'generated', 'reserved.ts'), 'utf8');
const generated = JSON.parse(/RESERVED_LABELS: readonly string\[\] = (\[[^\]]*\])/.exec(generatedSrc)?.[1] ?? '[]');
if (backend.labels.length < 10 || !backend.labels.includes('www')) fail('reserved', `the backend list looks wrong: ${backend.labels.length} labels`);
if (JSON.stringify(generated) !== JSON.stringify(backend.labels)) fail('reserved', 'the generated list differs from the backend file');
if (!generatedSrc.includes(JSON.stringify(backend.pattern.source))) fail('reserved', 'the generated DNS label pattern differs from the backend');
if (generated.includes('platform')) fail('reserved', '"platform" is a real sign-in address and must not be refused');
const bundle = files.filter((f) => /\/_astro\/SignInBox[^/]*\.js$/.test(urlPath(f))).map((f) => readFileSync(f, 'utf8')).join('\n');
if (!bundle) fail('reserved', 'no Sign in script was built');
// The minifier may rewrite the array (it emitted a dot-joined string split at
// run time), so look for each label as a whole token rather than a quoted string.
const missing = backend.labels.filter((l) => !new RegExp(`(?<![a-z0-9-])${l}(?![a-z0-9-])`).test(bundle));
if (missing.length) fail('reserved', `the Sign in bundle lacks ${missing.length} reserved labels, e.g. ${missing.slice(0, 3).join(', ')}`);

// The rule itself, on the generated list: transpile the two modules and run cases.
const tmp = mkdtempSync(join(tmpdir(), 'accreditme-website-'));
try {
  const tx = (file) =>
    ts.transpileModule(readFileSync(join(root, 'src', file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
  writeFileSync(join(tmp, 'reserved.mjs'), tx('generated/reserved.ts'));
  writeFileSync(join(tmp, 'address.mjs'), tx('lib/organisation-address.ts').replace("'../generated/reserved'", "'./reserved.mjs'"));
  const { readAddress, signInUrl } = await import(pathToFileURL(join(tmp, 'address.mjs')).href);
  const cases = [
    ['al-nakheel', 'al-nakheel'],
    ['  Al-Nakheel ', 'al-nakheel'],
    ['al-nakheel.accreditme.app', 'al-nakheel'],
    ['https://al-nakheel.accreditme.app/login', 'al-nakheel'],
    ['a', 'a'],
    ['a'.repeat(63), 'a'.repeat(63)],
    ['platform', 'platform'],
    ['', 'empty'],
    ['   ', 'empty'],
    ['-abc', 'format'],
    ['abc-', 'format'],
    ['a_b', 'format'],
    ['a.b', 'format'],
    ['xn--abc', 'format'],
    ['a'.repeat(64), 'format'],
    ['مؤسسة', 'format'],
    ['www', 'reserved'],
    ['WWW', 'reserved'],
    ['api', 'reserved'],
    ['accreditme', 'reserved'],
  ];
  for (const [input, want] of cases) {
    const r = readAddress(input);
    const got = r.ok ? r.slug : r.problem;
    if (got !== want) fail('reserved', `readAddress(${JSON.stringify(input)}) is ${got}, want ${want}`);
  }
  if (signInUrl('al-nakheel') !== 'https://al-nakheel.accreditme.app/login') fail('reserved', `signInUrl gives ${signInUrl('al-nakheel')}`);
  done('reserved', `${backend.labels.length} labels identical to the backend, all in the browser bundle; ${cases.length} address cases pass`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`verify-site — ${failures.length} problem(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
for (const p of passed) console.log(`verify-site — ok  ${p}`);
