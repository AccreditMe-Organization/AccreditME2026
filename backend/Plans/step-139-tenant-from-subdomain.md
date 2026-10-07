# Step 139 — The organisation comes from the subdomain (ACC-139)

Plan written 6 October 2026 (CC-54, the ACC-139 half), approved with the review
answers below in CC-57. No migrations and no database writes.

## Goal

Sign-in and password reset stop asking for the organisation. The organisation
is the one label in front of the base domain in the address the person opened:
`al-nakheel.accreditme.app` in production, `al-nakheel.localhost:4200` locally.
A host with no such label (bare `localhost`, the apex, `www`) shows a note
instead of a form.

## 1. Every place `organizationSlug` is sent today

| Where | What changes |
| -- | -- |
| `login.component.ts` — the field, its control, the submit | field and control removed; the slug comes from `TenantHostService` |
| `forgot-password.component.ts` — the same three | the same |
| frontend `auth.service.ts` `login()` and `forgotPassword()` | become `login(email, password)` and `forgotPassword(email)`; the service reads the slug from `TenantHostService` |
| backend DTOs, `auth.service.ts` login and forgot-password | **unchanged** — the body still carries `organizationSlug`; only its source moves. The `login.dto.ts` comment that says it is typed by the user is corrected |

## 2. The tenant host — `core/tenant/tenant-host.ts`

- Reads `location.hostname` once.
- The slug is the hostname minus `.{environment.baseDomain}`, and must be
  EXACTLY ONE label: `baseDomain` is `localhost` in development and
  `accreditme.app` in production.
- The label must be a valid DNS label (`[a-z0-9]`, inner hyphens, at most 63,
  no `xn--`) and not an infrastructure label (see 3). Uppercase is lower-cased
  (browsers already do; the check does not rely on it).
- Anything else — bare `localhost`, the apex, `www`, `api`, `a.b.localhost`, an
  invalid label — gives `null`.
- `platform` IS accepted: it is the platform organisation's sign-in host.
- Needs `angular.json` production `fileReplacements`, so `environment.prod.ts`
  becomes live. Its `apiUrl` stays a clearly marked placeholder for ACC-130 /
  ACC-148 (where the API lives in production is not decided here).

## 3. Reserved slugs

- ONE backend file, `INFRASTRUCTURE_LABELS`: www, api, app, admin, mail,
  webmail, smtp, email, static, assets, cdn, files, media, img, images, status,
  docs, help, support, blog, billing, auth, login, signin, account, accounts,
  dashboard, portal, console, internal, root, system, dev, staging, test, demo,
  sandbox, localhost, ns1, ns2, ftp, accreditme.
- Plus `platform`, in its own list: NOT creatable as a tenant, but a VALID sign-in
  host (`platform.localhost:4200`, `platform.accreditme.app`).
- A frontend copy of the infrastructure labels, and a new `check:reserved-slugs`
  scan that fails when the two copies differ.
- `create-tenant.dto.ts` validates against both lists and tightens the slug
  pattern to a DNS label: no leading or trailing hyphen, no `xn--`.
- The existing slugs `al-manara`, `al-nakheel` and `platform` are unaffected
  (`platform` already exists and is not re-created).

## 4. Local development

- `environment.ts` `apiUrl` becomes `/api/v1`, served through a dev proxy:
  `proxy.conf.js` targets `API_PROXY_TARGET ?? 'http://localhost:3000'`, wired in
  `angular.json` serve.
- WHY A PROXY: the session cookies are `SameSite=Strict`, and
  `al-nakheel.localhost` and `localhost` are different sites (verified by probe),
  so a page on a tenant subdomain calling `localhost:3000` directly would never
  send them. Through the proxy every call is same-origin.
- Cookies become host-only per tenant subdomain; the refresh cookie's path
  `/api/v1/auth/refresh` still matches, because the path is unchanged.
- `allowedHosts: ['.localhost']` only if the dev server refuses the subdomain
  without it.

## 5. Lane B (the second checkout), after merge

- `git update-index --no-skip-worktree frontend/src/environments/environment.ts`,
  then `git checkout -- frontend/src/environments/environment.ts`.
- Start with `$env:API_PROXY_TARGET='http://localhost:3001'; npx ng serve --port 4201`.
- Open `http://al-manara.localhost:4201/login`.
- Their backend `.env` `APP_LINK_ORIGIN=http://localhost:4201` keeps working
  under the new rule.

## 6. `APP_LINK_ORIGIN`

- Links become `http://{slug}.localhost:{port}{path}` — the tenant's own local
  host, so an emailed link opens the right organisation.
- The value must be `http(s)://localhost[:port]`. `127.0.0.1` and `[::1]` are
  refused at boot: `{slug}.127.0.0.1` is not a host.
- The old "Why not `http://{slug}.localhost:4200`" note in `app-url.config.ts`
  is removed; its premise (single-origin CORS) no longer holds.

## 7. CORS

- `buildCorsOptions(frontendOrigin, baseDomain)` with a FUNCTION origin.
- Reflect only exactly `https://{label}.{baseDomain}` — https, one label, no
  port — or the exact `FRONTEND_URL`.
- Anything else → `callback(null, false)`: 200 with no
  `Access-Control-Allow-Origin` (§15.10 records why the 403 version was
  reverted; that still holds).
- The boot check on `FRONTEND_URL` is kept.
- Tests — reflected: `https://acme.accreditme.app`, `FRONTEND_URL`. Not
  reflected: `https://acme.accreditme.evil`, `https://accreditme.app.evil.com`,
  `http://acme.accreditme.app`, the apex `https://accreditme.app`,
  `https://a.b.accreditme.app`, `https://acme.accreditme.app:8443`.
- §15.10 amended.

## 8. Screens

- **No slug** (bare host): the auth layout with the note and no form. Note text,
  en + ar: "Open your organisation's address to sign in, for example
  yourorg.accreditme.app."
- **Unknown slug**: the normal form, then the neutral `INVALID_CREDENTIALS`.
  There is no lookup, so an unknown organisation is indistinguishable from a
  wrong password.

## 9. Tests

- tenant-host spec: `al-nakheel.localhost` → `al-nakheel`; uppercase lower-cased;
  bare `localhost`, the apex, `www`, `api`, a two-level host and an invalid label
  → null; `platform` accepted.
- Login and Forgot specs (no field; the slug sent is the host's; no-slug note).
- The link-rule spec; the tenant-creation validation spec; the scan; the CORS
  cases above.

**Mutations, each must go red:** bring back the typed field; accept a two-level
host; reflect without the https check; drop reserved-name validation.

## 10. Docs

CLAUDE.md "Subdomain Routing" (`.com` → `.app`, reserved names, the platform
host, local `{slug}.localhost:4200`); SYSTEM-REFERENCE §15.10 plus a host
section; the `app-url.config.ts` header; the `login.dto.ts` comment.

## Review answers (CC-57)

- **After sign-in, nothing compares the host's slug with the session's
  organisation.** The host slug is used only by Login and Forgot. A platform
  admin signed in at `platform.localhost:4200` must still be able to start and
  end impersonation — checked.
- **Unknown slug:** the normal form, then the neutral `INVALID_CREDENTIALS`.
  No lookup.
- **Lane B's after-merge steps** (section 5) go in the PR description under
  "Second checkout".
- **Linear after merge:** ACC-139 stays In Progress, marked blocked by ACC-130,
  with a comment. It is not In Review.
- **No migrations and no database writes.**

## Found, not in scope

`NODE_ENV=development` on Railway means the cookies are not `Secure`. To be
ticketed separately.
