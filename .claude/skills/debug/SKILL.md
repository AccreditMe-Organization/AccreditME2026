---
name: debug
description: Systematic troubleshooting process for AccreditMe. Invoke manually with /debug when something is broken and the cause is unclear.
disable-model-invocation: true
allowed-tools: Bash(git log --oneline *) Bash(git diff *) Bash(git show *) Bash(git status) Bash(git branch) Bash(git stash *) Bash(npx tsc --noEmit) Bash(npx jest *) Bash(npx prisma migrate status) Bash(npx prisma studio) Bash(npx prisma db pull) Read Glob Grep
---

# AccreditMe — Debug and Troubleshooting Process

Read this skill completely before attempting to fix anything.
Follow the steps in order. Do not jump to solutions before diagnosing the cause.
The fastest path to a fix is always an accurate diagnosis first.

---

## Step 1 — Identify the Layer

Before doing anything, determine where the problem is.
Open browser DevTools → Network tab → find the failing request.

```
Browser console error?              → Frontend issue — go to Section A
Network request failing (401)?      → Auth issue — go to Section B
Network request failing (403)?      → Permission issue — go to Section C
Network request failing (400)?      → DTO validation issue — go to Section D
Network request failing (404)?      → Resource not found — go to Section E
Network request failing (500)?      → Backend service error — go to Section F
Data looks wrong in UI?             → Check API response first in Network tab
Migration error in terminal?        → Go to Section G
Test failing?                       → Go to Section H
Build failing on Railway?           → Go to Section I
BullMQ job not running?             → Go to Section J
```

This single step eliminates half the possible causes before writing one line of code.

---

## Section A — Frontend Issues

### Component not rendering

1. Check browser console for errors
2. Check the component is registered in its route
3. Check the route is registered in the parent routing file
4. Check the lazy load import path is correct
5. Check `standalone: true` is on the component decorator

### Data not appearing in table

1. Network tab → is the API request being made at all?
2. If no request → is `ngOnInit` calling the service method?
3. If request made → check response status and body
4. If response has data → check Signal is being set: `this.items.set(data)`
5. If Signal set → check template binding: `[value]="items()"` (parentheses required for Signals)

### Form not submitting

```typescript
// Add temporarily to diagnose
onSubmit(): void {
  console.log('form valid:', this.form.valid);
  console.log('form errors:', this.form.errors);
  console.log('form value:', this.form.value);
}
```

1. Check which control is invalid
2. Check validators — is a required field empty or too long?
3. Check `markAllAsTouched()` is called to show all validation errors

### RTL layout broken in Arabic mode

1. Confirm `dir="rtl"` is set on the html element when Arabic is active
2. Check Tailwind classes — replace `pl-`/`pr-` with `ps-`/`pe-`
3. Check PrimeNG RTL mode is enabled in the PrimeNG config

### Translation key showing as raw key string

1. Confirm key exists in BOTH en.json and ar.json
2. Check for typos in the key path — keys are case-sensitive
3. Check ngx-translate is initialized in app.config.ts
4. Check the current language is correctly set in TranslateService

### PrimeNG component not rendering

1. Confirm the PrimeNG module is imported in the component's imports array
2. Confirm `standalone: true` on the component
3. Check PrimeNG version compatibility with Angular 21

---

## Section B — 401 Unauthorized

JWT is missing, expired, or invalid.

1. DevTools → Network → failing request → Request Headers
2. Confirm `Authorization: Bearer {token}` header is present
3. If header missing → check AuthInterceptor is in app.config.ts providers
4. If header present → JWT may be expired
5. Check AccreditMe's own refresh-token flow is working — this is
   custom-built (`AuthService.issueRefreshToken()`, the `RefreshToken`
   Prisma model, hash-based storage with rotation and revocation), not
   Better Auth's own session mechanism (`AuthSession`) — the two are
   separate; don't go looking in Better Auth's session code for this
6. Check `tokenVersion` — if role changed, user must re-login (note:
   role/permission changes alone do not currently revoke a live
   session — only account deactivation calls
   `invalidateUserSessions()` and bumps `tokenVersion`; see
   SYSTEM-REFERENCE.md Section 1.2/12.2 if this is the actual symptom)

Quick test:

```bash
# Decode the JWT payload (base64 middle part)
# Check exp field — is it in the past?
```

---

## Section C — 403 Forbidden

User is authenticated but lacks permission for this action.

1. Check `@Permissions()` decorator on the endpoint
2. Check user's role in database:

```bash
npx prisma studio
# Open Role table → find user's role → check permissions array
```

3. Check `PermissionGuard` is applied at controller class level
4. Check `TenantGuard` — user's tenant may not match the requested resource
5. Confirm `organizationId` in JWT matches the resource's `organizationId`

---

## Section D — 400 Bad Request

DTO validation failed.

1. Read the full error response body — class-validator returns field-level errors
2. Check the request body matches the DTO exactly
3. Check for missing required fields
4. Check for type mismatches — string sent where number expected
5. Check `@Transform` decorators — is data being transformed unexpectedly?
6. Confirm `ValidationPipe` is globally configured in `main.ts`

---

## Section E — 404 Not Found

Resource does not exist or belongs to a different tenant.

1. Confirm the ID in the request URL is correct
2. Open Prisma Studio and verify:

```bash
cd backend && npx prisma studio
```

- Does the record exist?
- Does it have the expected `organizationId`?
- Is it the same `organizationId` as the requesting user's tenant?

Most common cause: fetching a record created under Tenant A while
authenticated as Tenant B. The query returns null → 404.
This is correct security behavior, not a bug.

---

## Section F — 500 Internal Server Error

Unhandled exception in a NestJS service.

1. Check Railway deployment logs immediately (for production)
2. Check local NestJS terminal output (for development):

```bash
cd backend && npm run start:dev
```

3. Read the FULL stack trace — not just the first line
4. Check Sentry for the error with full context
5. Common causes:
   - Null/undefined access: `Cannot read property 'x' of undefined`
   - Prisma error: wrong field name, missing required field, constraint violation
   - Missing environment variable: service trying to read undefined config
   - BullMQ job throwing and not being caught

Fix the root cause — never catch and swallow the error to make it disappear.

---

## Section G — Prisma Migration Issues

### Migration stuck or failed

```bash
cd backend && npx prisma migrate status
```

Read the output carefully:

- `Database schema is up to date` → no issue, migration already applied
- `Following migration have not yet been applied` → run `npx prisma migrate deploy`
- `Following migration failed` → see below

### Failed migration on local dev

```bash
# Only use on local dev with no data you care about
cd backend && npx prisma migrate reset
```

### Failed migration on staging or production

Never run `migrate reset` — it destroys data.

1. Identify which migration failed from `migrate status`
2. Open the failed migration SQL file and read it
3. Manually fix the database state to match what the migration expected
4. Mark the migration as applied: `npx prisma migrate resolve --applied "migration_name"`
5. Or write a new migration that corrects the state

### Prisma client out of sync with schema

```bash
cd backend && npx prisma generate
# Then restart TypeScript server in VS Code: Ctrl+Shift+P → Restart TS Server
```

### Schema drift — database does not match schema.prisma

```bash
cd backend && npx prisma db pull
# This updates schema.prisma to match the actual DB state
# Use only to diagnose — never commit a db pull result as the schema source of truth
```

---

## Section H — Test Failures

### Specific test failing

```bash
# Run only the failing test file
cd backend && npx jest --testPathPattern={failing-file}

# Run only tests matching a name pattern
cd backend && npx jest --testNamePattern="should return records"
```

Read the full error output. Common causes:

- Mock not set up correctly — the service under test calls something not mocked
- Wrong assertion — expected value does not match actual
- Async not awaited — missing `await` on an async call
- Test data setup wrong — creating test data for wrong tenant

### Tenant isolation test failing

This is the most critical failure. Do not dismiss it.

```bash
cd backend && npx jest --testNamePattern="should NOT return records belonging to a different tenant"
```

If this fails:

1. Open the failing service method
2. Find the Prisma query
3. Confirm `where: { organizationId: tenantId }` is present
4. If present — check tenantId is actually the correct value (not undefined)
5. Fix the scoping and rerun the test

Do not open a PR until this test passes.

### All tests failing at once

Usually means a setup problem, not a logic problem:

1. Check `jest.config.ts` is correct
2. Check test database connection if using a real DB in tests
3. Check for a syntax error in a shared test utility file
4. Run a single simple test to isolate the problem

---

## Section I — Railway Build Failure

1. Go to Railway dashboard → your service → Deployments tab
2. Click the failed deployment → read the build log from the beginning
3. Common causes:

```
Cannot find module 'xxx'
→ npm install was not run or package.json is missing the dependency
→ Check backend/package.json has the package listed

Dockerfile not found
→ Confirm backend/Dockerfile exists and path in Railway settings is correct

TypeScript compilation error
→ Run locally: cd backend && npx tsc --noEmit
→ Fix errors and push

Environment variable missing
→ Check Railway Variables tab has all required variables
→ Compare with .env.example — any missing entries?

Prisma generate failed
→ DATABASE_URL environment variable is missing or wrong in Railway
→ Check Railway Variables tab
```

---

## Section J — BullMQ Job Not Running

1. Check Redis is running and connected:

```
Railway dashboard → Redis service → is it active?
```

2. Check the job was actually queued:

```typescript
// Add temporarily in the service that queues the job
console.log("Job queued:", job.id);
```

3. Check the worker is registered and started in the NestJS module
4. Check the job processor function for unhandled errors
5. Check BullMQ queue name matches between the producer and the consumer
6. Check Sentry for job failure errors — failed jobs are logged there

---

## The Bisect Strategy — When You Cannot Find the Cause

If you have followed the relevant section and still cannot find the cause:

```bash
# 1. What changed recently?
git log --oneline -20

# 2. What did the last commit change?
git show HEAD

# 3. Does the bug exist before the last commit?
git stash
# Test the feature — is the bug gone?

# If bug is gone — the last commit introduced it
git stash pop
git show HEAD --stat
# Read every changed file carefully
```

If the bug existed before the last commit — keep going back:

```bash
git log --oneline -20
git show {commit-hash} --stat
```

Stop when you find the commit that introduced the bug.
Reading that diff will show you exactly what caused it.

Never spend more than 30 minutes guessing.
Bisect the problem systematically — it is always faster.
