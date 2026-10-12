# ACC-130 part 2 — enforce the security policy, record the production addresses

Plan written 12 Oct 2026 (CC-80), before any change. Going online happened on
10 Oct (`step-130-go-online.md`, runbook steps 1–8, all verified, including the
first real sign-ins and SPF/DKIM/DMARC passing). This is runbook step 10, the
wrap-up. ACC-130 stays In Progress until this PR merges.

## 1. Enforce the CSP (`frontend/vercel.json`)

- Rename `Content-Security-Policy-Report-Only` to `Content-Security-Policy`.
- **The value does not change by one character.** It stays exactly what is on
  `dev`, including ACC-189's file-viewer sources: `script-src 'self'
  'wasm-unsafe-eval'`, `worker-src 'self' blob:`, `img-src … blob:`, and the
  Supabase storage host in `connect-src`.
- **`check:vercel-config`** (`frontend/scripts/check-vercel-config.mjs`) changes
  from "a CSP or a Report-Only one" to:
  - the ENFORCED header must be present;
  - a `Content-Security-Policy-Report-Only` header fails the scan, so report-only
    cannot quietly come back (on its own, or beside the enforced one);
  - every other rule is unchanged.
  - A mutation proves each half: drop the enforced header (red), add the
    Report-Only one back beside it (red).

### Proving nothing breaks, before the commit

The real proof is the shipped bundle behind the shipped header, against the
LOCAL API, never `api.accreditme.app`:

- **The build.** `ng build --configuration production` with its real optimiser
  settings, into a scratch folder outside the repo. One thing differs from what
  Vercel builds: `environment.prod.ts` is swapped, for that build only, to the
  local addresses (`apiUrl: '/api/v1'`, `baseDomain: 'localhost'`), and restored
  straight after (`git diff` must be empty). The shipped file calls the deployed
  API, which this proof must not touch.
- **The server.** A small Node server in the session scratchpad on port 4200,
  which is what the backend's `APP_LINK_ORIGIN` expects:
  - It serves the build with the SPA fallback and sends every header from
    `vercel.json`'s `/(.*)` rule, read from the file at start-up. So the CSP is
    the enforced value byte for byte, as a real response header, not a
    `<meta>` tag.
  - It forwards `/api` to the local backend on :3000, adding the page's Origin
    when the browser sent none (the same shim as `proxy.conf.js`, ACC-204).
- **The one source that differs, stated rather than hidden.** The API is
  reached same-origin, so `connect-src 'self'` covers it here, where production
  uses `https://api.accreditme.app`. That entry is the one `check:vercel-config`
  already pins against `environment.prod.ts`, and it was exercised for real by
  the sign-ins at runbook step 8 (under Report-Only). Every other directive,
  including the Supabase storage host the file viewer fetches from, is
  exercised as shipped.
- **The walk.** Each screen below, with the console watched for any
  `Refused to …` CSP message, and every response checked for the enforced
  header:
  - sign-in, in English and in Arabic;
  - Home and the shell;
  - the notification bell;
  - Tasks, and a task with evidence;
  - the file viewer with a PDF and with an image;
  - the profile page's MFA setup screen, up to the QR code, **without enabling
    MFA**;
  - the platform area, as the platform admin.
- **If anything is refused, stop and report it.** The policy is not widened in
  this PR.
- No cookie values, tokens or passwords are printed, and `seed:demo` is not run.

## 2. `.railway/railway.ts`: record the custom domain

- A short comment beside `serviceDomains`: `api.accreditme.app` is a custom
  domain registered with the Railway CLI (`railway domain`), which this file
  cannot declare (§15.15 trap 1). **Any `config apply` must first show a plan
  with no domain removed.**
- `railway config plan` is run (with `$env:_` pointed at the native binary,
  §15.15) and its summary reported. **`config apply` is never run.** No
  variable, domain or DNS record changes.

## 3. Docs: SYSTEM-REFERENCE.md and CLAUDE.md, where they describe hosting

- `api.accreditme.app` is the API address and `API_ORIGIN`.
- `accreditme2026-production.up.railway.app` is the fallback only, to be retired
  by ACC-209. It is NOT removed from code in this PR.
- DNS is on Vercel (`ns1.vercel-dns.com`, `ns2.vercel-dns.com`); the mail records
  are listed by name only.
- The CSP is enforced.
- Rollback order: `API_ORIGIN` first, then the nameservers, and the nameservers
  only for mail.
- §15.15's "written before the switch-over" note is restated as measured.
- **Old Plans files are history and are not edited.**

## 4. Checks

- **Frontend:** typecheck (app and specs), the full Karma suite, `ng build`,
  `verify:built-index`, every discovered `check:*` scan. There is no frontend
  lint to run (no ESLint config exists; recorded in `ci.yml`).
- **Backend:** `.railway/railway.ts` is outside `backend/`, so the backend suite
  is run only if a backend file changes.

## 5. PR

A draft PR to `dev`: "ACC-130: enforce the security policy and record the
production addresses (going online, part 2)". Not merged.

## Files

| File | Change |
|---|---|
| `frontend/vercel.json` | Report-Only → enforced |
| `frontend/scripts/check-vercel-config.mjs` | requires the enforced header, refuses Report-Only |
| `.railway/railway.ts` | the custom-domain comment |
| `SYSTEM-REFERENCE.md` | §15.15 as measured, §15.1 if it names the address |
| `CLAUDE.md` | Infrastructure, Security Headers, and wherever hosting is described |

## Results (12 Oct 2026)

### The CSP walk — enforced header, scratch production build, local API

Served by a scratchpad server on :4200 that sent `vercel.json`'s every-path
headers, read from the file, as real response headers. Every document load
carried `Content-Security-Policy` and none carried the Report-Only one.
Violations were watched in two ways: the console (`Refused to …`) and
`securitypolicyviolation` events.

| Screen | Persona | CSP violations | Result |
|---|---|---|---|
| Sign-in, English | — | 0 | form shown, `dir=ltr` |
| Sign-in, Arabic | — | 0 | `dir=rtl`, `lang=ar` |
| Sign-in submitted | Yasser (al-nakheel) | 0 | 200, landed on `/home` |
| Home and the shell | Yasser | 0 | rail rendered |
| Notification bell | Yasser | 0 | popover opened |
| Tasks (My tasks) | Yasser | 0 | 3 rows |
| A task with evidence | Yasser | 0 | "Test Task" evidence dialog, 1 file |
| File viewer, PDF | Yasser | 0 | rendered (see note 1) |
| Profile, MFA setup to the QR code | Yasser | 0 | QR shown (`data:` image); NOT verified (see note 3) |
| File viewer, image | Adel (al-manara) | 0 | JPEG shown as a `blob:` image, 1272px wide |
| Sign-in | platform admin | 0 | 200, landed on `/platform/tenants` |
| Platform: tenants, plans, AI credit packs, AI feature costs, settings | platform admin | 0 | each loaded |

The only other console errors were the expected 401s from the signed-out
session check on each sign-in page.

1. **The PDF, and what was simulated.** The local backend has no S3
   credentials (they exist only on Railway, and were not copied), so its link
   request was refused with "File storage isn't set up yet" — a setup gap, not
   a CSP refusal. The walk was repeated with the link request answered at the
   network layer by a URL on the Supabase storage host, and that host answered
   with a one-page PDF. **Interception sits below the browser's CSP check**, so
   the fetch to the storage host still passed `connect-src` for real. pdf.js's
   worker started from `'self'`, and the canvas (822×1163) was painted. Nothing
   left the machine.
2. **The image** is SharePoint evidence, streamed through the API (same origin
   here), so it exercises `img-src blob:`. The storage-host fetch is the PDF's.
3. **MFA setup** stores an unverified TOTP secret for Yasser (Better Auth's
   `enableTwoFactor`). `verified` and `twoFactorEnabled` stay false, so MFA is
   NOT on and his sign-in is unchanged. The row is left as it is: Better Auth's
   tables are not written directly.

### `railway config plan` (apply NOT run)

`Plan: 0 to add, 1 to change, 0 to destroy` — the change is §15.4's
`restartPolicyType` round-trip. No domain is removed.

### Checks, each gated on its own exit status

- **Backend:** `tsc` and the build pass; 128 suites, 2,913 tests; tenant
  isolation 173 passed; `check:worker-gate` passes.
- **Frontend:** `tsc` (app and specs), `ng build` and `verify:built-index`
  pass; Karma 1,371 of 1,371; i18n parity 18 of 18.
- **Frontend `check:*`, all exit 0:** formatting, contrast, icon-labels,
  dialog-overlays, dialog-density, create-gating, action-gating,
  action-gating:selftest, field-control, confirm-translated, reserved-slugs,
  vercel-config.
- **The scan's new rule, mutated:** back to Report-Only → red; Report-Only
  beside the enforced header → red; the enforced header removed → red; restored
  → green.
- There is no frontend lint: no ESLint config exists (recorded in `ci.yml`).
