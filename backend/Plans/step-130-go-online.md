# ACC-130 — going online: the code side, and the switch-over order

Plan written 9 Oct 2026 (CC-66), approved with every recommendation in CC-68.
Ahmad's decisions going in (9 Oct): go online now; Vercel Pro (trial); DNS moves
from GoDaddy to Vercel's nameservers, because the wildcard `*.accreditme.app`
certificate needs it (the zone file is exported as a backup); the bare
`accreditme.app` shows the existing "Open your organisation's address" note;
the API stays on Railway at `api.accreditme.app`, a direct CNAME with no proxy,
so `trust proxy` stays 2.

**Two measured findings change the plan as first asked**, both read-only:

1. **Railway's configuration file cannot register a custom domain.** With the
   SDK's own `domains:` option, `railway config plan` refuses outright:

   ```
   Custom-domain registration is not supported by Railway configuration.
   Add api.accreditme.app in the dashboard, then run railway config pull.
   ```

   Putting it in `serviceDomains` is silently ignored, and
   `networking.customDomains` is dropped by the SDK. So step 4 registers the
   domain with `railway domain`, not `railway config apply`.
2. **Railway holds six `AWS_*` variables that `railway.ts` does not declare**, so
   any `railway config apply` today would DELETE them. The PR declares them.

# Part 1 — the code PR

## a. The production API address

- `environment.prod.ts`: `apiUrl: 'https://api.accreditme.app/api/v1'`. All 28
  services build from `${environment.apiUrl}/…`, and the API's prefix is
  `api/v1` (`main.ts:62`). No frontend code assumes a relative `/api`.
- **Cookies.** `{slug}.accreditme.app` and `api.accreditme.app` share the site
  `accreditme.app`, so the `SameSite=Strict`, host-only cookies are sent on the
  interceptor's `withCredentials` calls (`auth.interceptor.ts:94`). Downloads
  are a top-level navigation (`files.service.ts:71`), also same-site.
- **CORS.** `isAllowedOrigin` (`cors.config.ts:117`) admits `FRONTEND_URL`
  exactly plus `https://{one label}.accreditme.app`. Railway today:
  `FRONTEND_URL=https://accreditme.app` (the apex, where the no-tenant page makes
  its session check), `APP_BASE_DOMAIN=accreditme.app`,
  `API_ORIGIN=https://accreditme2026-production.up.railway.app`. All three agree
  with the new `apiUrl`.

## b. Vercel configuration

**Where it lives:** `frontend/vercel.json` holds everything Vercel reads from a
file. Only three things are project settings: the Root Directory, the
Production Branch, and the Node version (pinned through `engines` in
`frontend/package.json`, which Vercel reads).

```jsonc
{
  "framework": "angular",
  "installCommand": "npm ci",
  "buildCommand": "npm run build",
  "outputDirectory": "dist/frontend/browser",
  "ignoreCommand": "[ \"$VERCEL_GIT_COMMIT_REF\" != \"dev\" ]",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }],
  "headers": [
    { "source": "/(.*)", "headers": [
      { "key": "Content-Security-Policy-Report-Only", "value": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://api.accreditme.app; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
      { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" },
      { "key": "X-Content-Type-Options", "value": "nosniff" },
      { "key": "X-Frame-Options", "value": "DENY" },
      { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
      { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" },
      { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
      { "key": "Cross-Origin-Resource-Policy", "value": "same-origin" } ] },
    { "source": "/(.*)\\.(js|css)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] },
    { "source": "/media/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] }
  ]
}
```

- **Deep links.** Vercel serves real files before rewrites, so `/tasks/123` gets
  `index.html` while hashed files and `/assets/i18n/*.json` are served as
  themselves.
- **No rewrite or proxy to the API**, so `trust proxy` stays 2.
- **Measured from the build:** output is `dist/frontend/browser`; no SSR, and
  `prerendered-routes.json` is empty. Every JS and CSS file and every font under
  `media/` is hashed, so the long caching above is safe; `index.html` and
  `assets/i18n` keep Vercel's revalidate default. The app needs no other host:
  fonts are self-hosted, and there are no sockets, iframes or `blob:` downloads.
- **`angular.json`: `optimization.styles.inlineCritical: false`** in the
  production configuration. The built `index.html` carried
  `<link … media="print" onload="this.media='all'">` from critical-CSS inlining;
  a `script-src 'self'` policy blocks that inline handler, and the main
  stylesheet would never apply.
- **`style-src 'unsafe-inline'` is required**: PrimeNG and Angular's emulated
  encapsulation insert `<style>` elements at runtime, and a static host cannot
  hand out nonces.

**What Ahmad types in Vercel's import screen:**

| Field | Value |
|---|---|
| Repository | `AccreditMe-Organization/AccreditME2026` |
| Project name | `accreditme` |
| Framework preset | Angular |
| Root Directory | `frontend` |
| Build / Output / Install | leave them; `vercel.json` sets them (`npm run build`, `dist/frontend/browser`, `npm ci`) |
| Environment variables | none — the API address is compiled into `environment.prod.ts` |

Right after import, under Settings:

- **Git → Production Branch = `dev`.** The repository's default branch is
  `main`, but Railway deploys from `dev` (`railway.ts`, `branch: "dev"`). Left
  alone, the frontend would build from a different branch than the API.
- **Build → Node.js 22.x.** CI uses 22 (`ci.yml:49, 96, 168, 260`).

## c. Preview deployments

- **What one would show:** a `*.vercel.app` host is not under `accreditme.app`,
  so the app shows the "Open your organisation's address" note, and its session
  check is refused by CORS, as ACC-128 decided. A preview can never sign in.
- **Turned off**, with the `ignoreCommand` above: only `dev` builds. CI already
  builds the frontend on every PR, and each preview is a public copy of an
  unmerged branch.
- **Consequence:** the first deploy after import builds `main`, and the ignore
  rule skips it. Ahmad sets the Production Branch to `dev`, then deploys `dev`.

## d. `.railway/railway.ts`, measured

Four versions planned with `--file`, from a scratchpad copy:

| Version | `railway config plan --verbose` |
|---|---|
| The file as it is | `Plan: 0 to add, 1 to change, 6 to destroy` — **Delete variable `AWS_ACCESS_KEY_ID`, `AWS_REGION`, `AWS_S3_BUCKET`, `AWS_S3_ENDPOINT`, `AWS_S3_FORCE_PATH_STYLE`, `AWS_SECRET_ACCESS_KEY`**, plus the usual `restartPolicyType` |
| Plus the six `AWS_*: preserve()` | `0 to add, 1 to change, 0 to destroy` — only the `restartPolicyType` round-trip (§15.4) |
| Plus `api.accreditme.app` in `serviceDomains` | identical — **ignored without a word** |
| Plus `networking.customDomains` | dropped by the SDK (`normalizeNetworking` overwrites it) |
| Plus the SDK's `domains: [{ domain, port: 3000 }]` | **hard error**, quoted at the top |

So the PR adds the six `AWS_*` keys with `preserve()`, keeps
`accreditme2026-production.up.railway.app` in `serviceDomains`, and adds a
comment recording that a custom domain cannot be registered from this file. The
domain is registered with `railway domain api.accreditme.app --port 3000
--service AccreditME2026` (step 4); a plan afterwards shows whether the file
then needs to declare it.

**The fallback host can be removed** about 7 days after step 8 passes, once
nothing has used it: a `railway domain delete` and the `serviceDomains` edit in
the same change, under its own ticket.

**Running the plan on Windows.** `railway/iac` checks the CLI version by running
`process.env._ || "railway"`. Under Git Bash `_` is a path node cannot execute,
and in PowerShell `railway` is a `.ps1`/`.cmd` shim `execFileSync` cannot run,
so both fail with "requires Railway CLI 5.42.1 or newer" on CLI 5.59.0. Point
`_` at the native binary:
`$env:_ = "…\npm\node_modules\@railway\cli\bin\railway.exe"`, then run that
binary.

## e. The `.com` → `.app` sweep

| Where | Today | Change |
|---|---|---|
| CLAUDE.md:710 | `From: noreply@accreditme.com` | the sender is `RESEND_FROM_EMAIL` (`noreply@accreditme.app`), with no fallback |
| CLAUDE.md:3316 | "Resend domain `accreditme.com` is not verified" | resolved: `accreditme.app` carries Resend's DKIM and the from-address matches; confirmed in Resend at step 6 |
| CLAUDE.md:4151 | `APP_BASE_DOMAIN=accreditme.com` | `accreditme.app` |
| `backend/.env.example:48` | `RESEND_FROM_EMAIL=noreply@accreditme.com` | `noreply@accreditme.app` |
| `backend/.env.example:97` | `PLATFORM_ADMIN_EMAIL=admin@accreditme.com` | blank, "a mailbox you own" |
| `notification-email.processor.ts:46` | falls back to `noreply@accreditme.com` | `resolvePlatformSender()` (`common/config/email-sender.config.ts`) returns the trimmed value or null. With null the job fails with a named error, nothing is sent and `sentAt` stays null, so BullMQ's failure is visible. ACC-181 reuses it for its D7. |
| `demo-seed.ts:69-70` | falls back to `admin@accreditme.com` | **throws.** A fallback creates a platform-administrator account on a mailbox anyone can buy, and ACC-99's support password reset would mail it. Extracted as `resolvePlatformAdminEmail()` so it can be tested. |
| SYSTEM-REFERENCE:7887 | "moves … as a dashboard change" | done — Railway holds `accreditme.app` |
| `auth.controller.spec.ts:135`, `app.config.spec.ts:58` | `@accreditme.com` fixtures | `@example.test`, so `git grep accreditme.com` matches only history |
| Ahmad's local `backend/.env` | `RESEND_FROM_EMAIL=noreply@accreditme.com` | `noreply@accreditme.app` (approved in CC-68) |

`accreditme.com` is not ours: its nameservers are
`ns1.domain-is-4-sale-at-domainmarket.com` (CC-63).

## f. Docs

- **SYSTEM-REFERENCE §15.15, "Online: where each address is served"**: the
  apex (Vercel, the note), `*.accreditme.app` (Vercel, the app), `www` (308 to
  the apex), `api.accreditme.app` (Railway, direct CNAME, no proxy — trust proxy
  2), `accreditme2026-production.up.railway.app` (the fallback, until removed);
  DNS on Vercel's nameservers with GoDaddy as registrar only, and the mail
  records; the `.app` HSTS note — the whole TLD is on the browser preload list,
  so HTTPS is always forced (even GoDaddy's page sends
  `max-age=63072000; includeSubDomains; preload`); the headers and their reasons
  (CSP, `inlineCritical`, `unsafe-inline` styles); what a preview shows; and the
  two Railway traps measured.
- **CLAUDE.md**: the sweep rows above. The Infrastructure lines ("Frontend
  hosting: NOWHERE") change only after step 8, in a small docs PR, so the file
  never describes something before it is true.
- **ACC-130's description, out of date in these places** (edited after the
  merge, step 1):
  - §1 is wrong: it says to put the domain in the file, which Railway refuses.
  - §9's table: `APP_BASE_DOMAIN` is read (ACC-139, ACC-158) and holds `.app`;
    Railway's `RESEND_FROM_EMAIL` is `.app`; Railway's `PLATFORM_ADMIN_EMAIL` is
    a gmail.com address; the CLAUDE.md lines are now 710, 3316 and 4151;
    Subdomain Routing already says `.app`.
  - Done already: §8 (ACC-139), §4 (ACC-158), the typed-slug login (ACC-139),
    the apex (decided: the note), the Resend domain check (`.app` both sides).
    ACC-128 is Done, so "Blocked by" is stale.
  - The preview decision is in §15.10, not §15.9.
  - Missing: the 9 Oct decisions; the prerequisites ACC-186 and ACC-148 (done,
    with `API_ORIGIN` moving at cutover); the six `AWS_*` variables;
    `accreditme.com` being for sale; the new-IP email (step 8).

## g. Tests — each with a mutation that must go red

| Test | Mutation |
|---|---|
| `environment.prod.spec.ts`: `apiUrl` is `https://api.accreditme.app/api/v1` | back to `/api/v1` |
| …and its host is `api.` + `baseDomain` (the same-site rule the cookies rest on) | `baseDomain: 'accreditme.com'` |
| `check:vercel-config`: the index.html fallback exists | remove the rewrite |
| …no rewrite or redirect points at an outside host | add `/api/(.*)` → `https://api…` |
| …CSP `connect-src` contains the origin of `environment.prod.ts`'s `apiUrl` | change either alone |
| …the security headers are present | drop `X-Content-Type-Options` |
| …only `dev` builds | remove `ignoreCommand` |
| CI step after `ng build`: the built `index.html` has no inline event handler or inline script — the build output, not `angular.json` | `inlineCritical` back on |
| `resolvePlatformSender()`: trims; null when unset or blank; never a `.com` | `?? 'noreply@accreditme.com'` |
| The processor with no sender: named error, `send` never called, `sentAt` null | restore the fallback |
| `resolvePlatformAdminEmail()`: throws naming the variable when unset or blank | restore the fallback |

The plan's "0 to destroy" is a runbook `[check]` (step 0), not a spec, because
it needs Railway.

# Part 2 — the switch-over runbook

Nobody runs this until it is reached step by step, each with its own approval.

**0. [coder] Before merging.** `railway config plan --verbose` against the PR's
`railway.ts`. *Proof:* `0 to destroy`.

**1. Merge the code PR.** The backend changed, so Railway deploys. *Proof:*
`/api/v1/health` on the fallback host reports the merge commit.

**2. [Ahmad] Import in Vercel** with the Part 1b values; set Production Branch
`dev` and Node 22.x; deploy `dev`. *Proof, on the `*.vercel.app` address:* the
note page renders; `/tasks/123` returns the app, not a 404; the headers are
present; the console shows no CSP report.

**3. [Ahmad] Domains and records in Vercel.** Add `accreditme.app`,
`*.accreditme.app`, and `www.accreditme.app` as a 308 redirect to the apex
(misconfigured until step 5 — expected). Then add, in Vercel DNS, exactly as the
public lookup shows them on 9 Oct:

| Type | Name | Value | TTL |
|---|---|---|---|
| MX | `@` | `inbound-smtp.eu-west-1.amazonaws.com`, priority 0 | 3600 |
| CNAME | `send` | `send.forge.rmta.net` | 3600 |
| TXT | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDb97OcMIyhFusuy9uecULItT/BKztk5G6A9itRiAuExCtGTgk7lf3+reIp++5kwKkVXl5N/4xpQPdp1Bc5hTy82ZmCwWUZ5PNQCAu5Bx67rrSp0+YrHJn9jDuVayzNybJ+KtwRJKZIr6kgBLBuh8XtRXVl9yeD3F8OzVWj+OyUfwIDAQAB` | 3600 |
| TXT | `_dmarc` | `v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;` | 3600 |

- **Not copied:** the apex A records `13.248.243.5` and `76.223.105.230` (the
  GoDaddy Website Builder page); `www` CNAME (Vercel's redirect replaces it);
  `_domainconnect` (GoDaddy-only); NS and SOA.
- **Nothing else exists to copy:** no apex TXT, no CAA; `api`, `mail`,
  `al-nakheel`, `platform` and a random label are NXDOMAIN.
- **[Ahmad] diffs this list against the zone export** — only queried names are
  visible from outside.
- *Proof [coder]:* query each record directly at Vercel's nameservers (e.g.
  `nslookup -type=MX accreditme.app ns1.vercel-dns.com`) before the switch; the
  answers match the table.

**4. [coder, with its own approval] Register the API domain.**
`railway domain api.accreditme.app --port 3000 --service AccreditME2026 --json`
(the CLI or the dashboard — not `config apply`), and report the CNAME target plus
any verification TXT. **[Ahmad]** adds that `api` CNAME (and the TXT, if given) in
Vercel DNS **and at GoDaddy**, so the API resolves, and Railway can issue its
certificate, before the switch, whichever nameservers a resolver sees.
*Proof:* `railway domain status api.accreditme.app` shows the certificate
issued; `https://api.accreditme.app/api/v1/health` reports the commit — already
before step 5. Then `railway config plan --verbose` shows whether the domain now
counts as drift; if it does, a small PR declares it, proved by a clean plan,
before anyone ever applies.

**5. [Ahmad] Switch the nameservers at GoDaddy** to the ones Vercel shows. Leave
GoDaddy's zone in place: it is the rollback.

**6. [check] Propagation.**

- `nslookup -type=NS accreditme.app` at 8.8.8.8 and 1.1.1.1 answers `vercel-dns`.
- Vercel shows `*.accreditme.app` valid with its certificate;
  `curl -v https://al-nakheel.accreditme.app/` shows Vercel serving a
  certificate covering `*.accreditme.app`.
- The apex returns 200; `www` returns 308 to the apex.
- API health reports the commit.
- The mail records answer exactly as in step 3's table.
- **[Ahmad]** Resend still shows `accreditme.app` Verified.
- The delivered test email is step 8b's.

**7. [coder, with approval] Move `API_ORIGIN`:**
`railway variable set API_ORIGIN=https://api.accreditme.app`, which redeploys
the same commit. *Proof:* the deployment succeeds; health answers on both hosts;
the boot log has no base-URL warning. **`FRONTEND_URL` does not change** (already
`https://accreditme.app`), nor does `APP_BASE_DOMAIN`.

**8. [check] First sign-ins on the real hostnames.**

- **[coder], curl:** a preflight from `Origin: https://al-nakheel.accreditme.app`
  is allowed with credentials; one from `https://evil.example` gets no
  allow-origin header; `GET /health` returns CORP `same-origin` and COOP
  `same-origin`.
- **[Ahmad], Chrome:**
  - **a. `al-nakheel.accreditme.app`, as `yasser.alamri@alnakheel-hospital.test`**
    (Director of Quality — not Hessa), with the seed password from
    `apply-people.ts`. There are no `@example.test` personas; the seeds use the
    reserved `.test` names `alnakheel-hospital.test` and `almanara-univ.test`, so
    no real inbox exists. The first sign-in WILL send a new-IP email (`isNewIp`
    treats a null last address as new, `login-attempt.service.ts:145`); it goes
    to a `.test` address and fails at Resend, and nobody receives it.
    *Proves:* Set-Cookie `access_token` and `refresh_token` with Secure,
    HttpOnly, SameSite=Strict, host-only on `api.accreditme.app`; a reload stays
    signed in; a renewal works; sign-out clears them; no CORS, CORP or
    CSP-report errors in the console; Arabic renders.
  - **b. `platform.accreditme.app`, as the platform admin** (Ahmad's own gmail).
    The new-IP email delivered there is the test email; "Show original" must
    show SPF, DKIM and DMARC passing.
- Then ACC-139 can be verified and closed.

**9. Rollback, if mail or sign-in breaks after step 5.**

- **Mail breaks:** fix forward first — compare Vercel DNS with the zone export,
  then re-verify in Resend. If that fails, put GoDaddy's default nameservers
  back; the untouched zone returns within hours.
- **Sign-in breaks, mail works:** no DNS rollback (there was no frontend online
  before). If step 7 preceded it, set `API_ORIGIN` back to the Railway host
  (redeploys). Diagnose from the console. **Do not reach for `SameSite=None`**
  without a decision.
- **Order:** `API_ORIGIN` first, then the nameservers (only for mail). The
  Vercel and Railway domains can stay.

**10. [coder] Afterwards:** a docs PR (CLAUDE.md Infrastructure, the measured
§15.15, ACC-130's acceptance list); the CSP moved from Report-Only to enforced;
a ticket to remove the fallback host after 7 days.

Side notes: the new-IP email says "reset your password immediately", which
nobody can do until ACC-188 ships (its wording now belongs to ACC-188). The
Vercel Pro trial ends after 14 days, and Hobby does not allow commercial use.

# Review answers (CC-68, 9 Oct 2026)

All eleven decisions approved as recommended:

1. The API domain is registered with `railway domain …` from the CLI (by the
   coder, with its own approval at step 4), not through `railway config apply`.
2. The six `AWS_*` variables are declared with `preserve()` in this PR.
3. Vercel's Production Branch is `dev`, matching Railway.
4. Previews are off, with `ignoreCommand`.
5. The CSP ships as Report-Only first, and is enforced after step 8 shows no
   reports.
6. `inlineCritical` is turned off.
7. With no `RESEND_FROM_EMAIL`, the email job fails with a named error; the API
   does not refuse to boot.
8. `demo-seed` throws without `PLATFORM_ADMIN_EMAIL`.
9. The `api` CNAME is added at GoDaddy as well as Vercel before the switch.
10. The fallback host is removed 7 days after step 8, under its own ticket.
11. Ahmad's local `.env` `RESEND_FROM_EMAIL` becomes `noreply@accreditme.app`,
    and the two spec fixtures become `@example.test`.
