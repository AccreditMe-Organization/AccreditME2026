---
name: pr-checklist
description: Pull request checklist for AccreditMe. Invoke manually with /pr-checklist before opening any PR to dev or main.
disable-model-invocation: true
allowed-tools: Bash(npx tsc --noEmit) Bash(npx jest *) Bash(git status) Bash(git diff *) Bash(git log --oneline *) Bash(git branch) Bash(git push *) Read Glob Grep
---

# AccreditMe — Pull Request Checklist

Run this skill completely before opening any PR.
Every item must pass. Fix failures before opening the PR.
A PR with known failures wastes review time and breaks the dev branch for others.

---

## Step 1 — Branch Verification

```bash
git branch
git status
git log --oneline -10
```

Verify:

- [ ] You are on a `feature/ACC-XX-*` or `fix/ACC-XX-*` branch
- [ ] You are NOT on main or dev
- [ ] No uncommitted changes exist — working tree is clean
- [ ] All commits follow the format: `{type}({scope}): {description} [ACC-XX]`
- [ ] Every commit references the correct Linear ticket ID
- [ ] No commit message contains "and" describing two concerns

If any commit message is wrong — it is already pushed so leave it.
Note the issue and avoid repeating it next PR.

---

## Step 2 — TypeScript Verification

```bash
cd backend && npx tsc --noEmit
```

```bash
cd frontend && npx tsc --noEmit
```

- [ ] Backend TypeScript errors: zero
- [ ] Frontend TypeScript errors: zero

If errors exist — fix them before proceeding.
Do not open a PR with TypeScript errors under any circumstances.

---

## Step 3 — Test Verification

```bash
cd backend && npx jest --passWithNoTests
```

- [ ] All unit tests pass
- [ ] Zero test failures
- [ ] Zero test errors (different from failures — errors mean the test could not run)

Then run tenant isolation tests specifically:

```bash
cd backend && npx jest --testNamePattern="should NOT return records belonging to a different tenant" --passWithNoTests
```

- [ ] All tenant isolation tests pass
- [ ] Count of isolation tests matches count of new findMany/findOne queries added

If any isolation test fails — this is a critical security issue.
Do NOT open the PR. Fix the tenant scoping immediately.

---

## Step 4 — Code Quality Verification

Read through every file changed in this PR:

```bash
git diff origin/dev...HEAD --name-only
```

For each changed file, verify:

### Backend files

- [ ] No business logic in any controller — only routing and validation
- [ ] No `any` type used without an inline comment explaining why
- [ ] No `console.log` statements left in production code
- [ ] No commented-out code blocks left in files
- [ ] No hardcoded strings that should be in constants or config
- [ ] No hardcoded secrets, API keys, tenant IDs, or environment values

### Multi-tenancy verification — check every new Prisma query

- [ ] Every `findMany` includes `where: { organizationId: tenantId }`
- [ ] Every `findFirst` includes `where: { organizationId: tenantId }`
- [ ] Every `findUnique` scoped through a `findFirst` with tenantId check
- [ ] `organizationId` always sourced from JWT via `@CurrentTenant()` decorator
- [ ] `organizationId` never accepted from request body in any DTO
- [ ] `TenantGuard` applied at class level on every new controller
- [ ] `PermissionGuard` applied at class level on every new controller
- [ ] `@Permissions()` decorator applied at method level on every endpoint

### Audit trail verification

- [ ] `AuditLogService.log()` called on every create operation
- [ ] `AuditLogService.log()` called on every update operation
- [ ] `AuditLogService.log()` called on every delete operation
- [ ] AuditLog table has no UPDATE or DELETE operations added

### Database verification

- [ ] If schema.prisma changed — migration file exists and was committed
- [ ] If schema.prisma changed — `npx prisma generate` was run
- [ ] Every new model with tenant data has `organizationId` field
- [ ] Every new model has `@@index([organizationId])` defined
- [ ] No migration files were edited manually after generation

### Security verification

- [ ] No direct S3 URLs returned to clients — signed URLs only
- [ ] File uploads validated for actual MIME type before storage
- [ ] No new endpoints exempt from rate limiting
- [ ] No sensitive data logged to console, Winston, or Sentry
- [ ] Helmet security headers not overridden or disabled
- [ ] CORS configuration not loosened

### Background jobs verification

- [ ] Long-running operations run as BullMQ jobs — not blocking API requests
- [ ] PDF generation = BullMQ job ✓
- [ ] AI API calls = BullMQ job (unless streaming) ✓
- [ ] Email sending = BullMQ job ✓
- [ ] File virus scanning = BullMQ job ✓

### Frontend files

- [ ] All components are standalone — no NgModule declared
- [ ] Only imports PrimeNG modules the component actually uses
- [ ] State managed with Signals — no direct property mutation
- [ ] No hardcoded colors — design tokens from tokens.scss only
- [ ] No Bootstrap classes — Tailwind only for layout
- [ ] No inline styles — Tailwind or tokens only
- [ ] RTL layout uses logical Tailwind properties (ps-, pe-, ms-, me-)
- [ ] All visible strings use `| translate` pipe — no hardcoded text
- [ ] Translation keys added to BOTH en.json AND ar.json
- [ ] Arabic translations are real Arabic — not English placeholders
- [ ] Forms use Angular Reactive Forms — not template-driven
- [ ] Loading state shown during all API calls
- [ ] Error state handled and displayed — no silent failures
- [ ] Empty state shown when no data in tables or lists
- [ ] Tables use `scrollable scrollHeight="flex"` — no page scroll

---

## Step 5 — AI Integration Verification (If This PR Includes AI Features)

- [ ] AI calls go through tenant's configured `AIProvider` interface
- [ ] AI API key sourced from tenant config — never from environment directly
- [ ] AI output always presented to user for review before saving
- [ ] Every AI interaction logged: actor, model, prompt summary, timestamp
- [ ] Non-streaming AI calls run as BullMQ background jobs
- [ ] Streaming AI calls use NestJS SSE or WebSocket correctly

---

## Step 6 — Push the Branch

```bash
git push origin feature/ACC-XX-description
```

Confirm the push succeeded and the branch appears on GitHub.

---

## Step 7 — Generate PR Description

Using the information gathered above, generate the GitHub PR description
using this exact template:

```markdown
## Linear Ticket

[ACC-XX](https://linear.app/accreditme/issue/ACC-XX) — {ticket title}

## What Changed

{1-3 sentences describing what this PR adds or fixes}

## Why

{1-2 sentences on the motivation — what problem does this solve}

## How to Test

1. {First step to verify the feature works}
2. {Second step}
3. {Edge case to check — especially tenant isolation}

## Database Changes

{List any Prisma migrations included and their effect}
OR: No database changes in this PR.

## Checklist

- [x] TypeScript errors: zero (backend + frontend)
- [x] All tests passing including tenant isolation
- [x] No business logic in controllers
- [x] Every new Prisma query scoped by organizationId
- [x] AuditLog called on all mutations
- [x] Translation keys added in en.json and ar.json
- [x] No hardcoded secrets or direct S3 URLs
```

---

## Step 8 — Open the PR on GitHub

PR settings:

- Base branch: **dev** — never main
- Title: `{type}: {description} [ACC-XX]`
- Description: paste the generated description from Step 7
- Labels: add the appropriate label (feature / bug / chore / docs)
- Assignee: assign to yourself

Do not merge the PR yourself until:

- CI pipeline passes (GitHub Actions green)
- All checklist items in the PR description are checked

---

## If CI Fails After Opening the PR

Read the CI failure carefully:

```bash
# Pull latest and check what is failing
git pull origin feature/ACC-XX-description
```

Common CI failures and fixes:

- TypeScript error → fix the type issue, commit, push
- Test failure → fix the failing test, commit, push
- Tenant isolation failure → fix the query scoping, commit, push
- Prisma migration missing → run migrate dev, commit, push

Every fix goes in a new commit — do not amend pushed commits.
CI will re-run automatically on every push to the PR branch.

---

## After the PR Is Merged

- [ ] Delete the feature branch from GitHub (do this from the PR page)
- [ ] Mark the Linear ticket as Done
- [ ] Confirm CI pipeline is green on dev branch after merge
- [ ] If this PR changed any architectural decision — update CLAUDE.md
- [ ] If this PR changed any development rule — update the relevant skill file
