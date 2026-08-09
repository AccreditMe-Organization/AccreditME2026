---
name: health-check
description: Full project health check for AccreditMe. Invoke manually with /health-check at the start of any development session or when you want a snapshot of the overall project state.
disable-model-invocation: true
allowed-tools: Bash(git status) Bash(git branch) Bash(git log --oneline *) Bash(git stash list) Bash(git diff *) Bash(npx tsc --noEmit) Bash(npx jest *) Bash(npx prisma migrate status) Bash(npx prisma validate) Read Glob Grep
---

# AccreditMe — Health Check

This skill runs a complete health check across the entire AccreditMe project
and produces a clear report of what is healthy, what needs attention,
and what is broken.

Use this skill:

- At the start of every development session
- After pulling changes from dev or main
- When something feels wrong but you cannot identify what
- Before starting a new ticket to confirm the baseline is clean
- After a long break from the codebase

Do NOT use this skill to fix issues — it diagnoses only.
Use the relevant skill to fix what it finds:

- TypeScript errors → fix and use /commit-message
- Test failures → fix and use /commit-message
- Migration issues → use /prisma-change
- Broken features → use /debug

---

## Check 1 — Git State

```bash
git branch
git status
git stash list
git log --oneline -10
```

Report:

- Current branch name
- Is the working tree clean?
- Are there stashed changes that were forgotten?
- What are the last 10 commits — does history look correct?

Flag as WARNING if:

- Uncommitted changes exist on a feature branch (work in progress — normal)
- Stashed changes are more than 1 day old (likely forgotten)

Flag as ERROR if:

- Currently on main or dev with uncommitted changes
- Stashed changes are more than 3 days old

---

## Check 2 — Branch Status vs dev

```bash
git log --oneline origin/dev..HEAD
git log --oneline HEAD..origin/dev
```

Report:

- How many commits ahead of dev is the current branch?
- How many commits behind dev is the current branch?

Flag as WARNING if:

- Current branch is more than 20 commits behind dev
  (risk of complex merge conflict when PR is opened)

Flag as INFO if:

- Currently on dev with no pending commits
  (clean state, ready to start new ticket)

---

## Check 3 — Backend TypeScript

```bash
cd backend && npx tsc --noEmit 2>&1
```

Report:

- Total error count
- List each error with file, line, and error message

Flag as ERROR if:

- Any TypeScript errors exist
- Errors in tenant guards, permission guards, or audit log interceptor
  are especially critical — flag these separately

Flag as PASS if:

- Zero errors

---

## Check 4 — Frontend TypeScript

```bash
cd frontend && npx tsc --noEmit 2>&1
```

Report:

- Total error count
- List each error with file, line, and error message

Flag as ERROR if:

- Any TypeScript errors exist

Flag as PASS if:

- Zero errors

---

## Check 5 — Full Test Suite

```bash
cd backend && npx jest --passWithNoTests 2>&1
```

Report:

- Total tests run
- Passed count
- Failed count
- Skipped count
- Test suites status

Flag as ERROR if:

- Any test failures
- Any test errors (different from failures — means test could not run)

Flag as PASS if:

- All tests pass

---

## Check 6 — Tenant Isolation Tests

```bash
cd backend && npx jest --testNamePattern="should NOT return records belonging to a different tenant" --passWithNoTests 2>&1
```

Report:

- How many tenant isolation tests exist?
- All passing?

Flag as CRITICAL ERROR if:

- Any tenant isolation test is failing
- This is the most serious failure the health check can find
- A failing isolation test means cross-tenant data leakage is possible

Flag as WARNING if:

- Zero tenant isolation tests exist but modules with Prisma queries are present
  (isolation tests should exist for every findMany/findOne)

Flag as PASS if:

- All isolation tests pass

---

## Check 7 — Prisma Migration Status

```bash
cd backend && npx prisma migrate status 2>&1
```

Report:

- Are all migrations applied to the database?
- Are there pending migrations not yet applied?
- Are there failed migrations?

Flag as ERROR if:

- Any migration is in a failed state
- Database schema does not match schema.prisma

Flag as WARNING if:

- Pending migrations exist that have not been applied
  (may need `npx prisma migrate deploy`)

Flag as PASS if:

- Database schema is up to date

---

## Check 8 — Prisma Schema Validation

```bash
cd backend && npx prisma validate 2>&1
```

Report:

- Is schema.prisma valid?
- Any syntax or relationship errors?

Flag as ERROR if:

- Schema validation fails

Flag as PASS if:

- Schema is valid

---

## Check 9 — Environment Variables

Read `.env` file and verify all required variables are present and non-empty.

Required variables to check:

```
DATABASE_URL          → must be present and start with postgresql://
DIRECT_URL            → must be present and start with postgresql://
BETTER_AUTH_SECRET    → must be present, minimum 32 characters
JWT_SECRET            → must be present, minimum 32 characters
ENCRYPTION_KEY        → must be present, minimum 32 characters
ANTHROPIC_API_KEY     → must be present and start with sk-ant-
RESEND_API_KEY        → must be present and start with re_
SENTRY_DSN            → must be present and start with https://
NODE_ENV              → must be development or production
PORT                  → must be present
APP_BASE_DOMAIN       → must be present
PLATFORM_ADMIN_EMAIL  → must be present and contain @
```

Do NOT display the actual values — only report present/missing/invalid format.

Flag as ERROR if:

- Any required variable is missing
- Any variable has an obviously wrong format

Flag as WARNING if:

- STRIPE_SECRET_KEY is missing (deferred but expected eventually)
- REDIS_URL is empty (Railway injects this — empty locally is acceptable)

Flag as PASS if:

- All required variables present with correct format

---

## Check 10 — Critical File Presence

Verify these files exist and are not empty:

```
CLAUDE.md
SYSTEM-REFERENCE.md
.gitignore
.env.example
.mcp.json
backend/prisma/schema.prisma
backend/src/main.ts
frontend/src/assets/i18n/en.json
frontend/src/assets/i18n/ar.json
.claude/skills/new-feature/SKILL.md
.claude/skills/prisma-change/SKILL.md
.claude/skills/module-scaffold/SKILL.md
.claude/skills/angular-component/SKILL.md
.claude/skills/commit-message/SKILL.md
.claude/skills/pr-checklist/SKILL.md
.claude/skills/debug/SKILL.md
.claude/skills/new-module/SKILL.md
.claude/skills/new-ticket/SKILL.md
.claude/skills/ready-to-pr/SKILL.md
.claude/skills/health-check/SKILL.md
```

Flag as WARNING if:

- Any skill file is missing — the development workflow is incomplete

Flag as ERROR if:

- CLAUDE.md is missing — Claude Code has no project instructions
- schema.prisma is missing — Prisma cannot function
- .gitignore is missing — secrets may be at risk of being committed

---

## Check 11 — Security Spot Check

```bash
git log --all --full-history -- .env
git log --all --full-history -- .mcp.json
```

Report whether these sensitive files were ever committed to git history.

Flag as CRITICAL ERROR if:

- `.env` appears in git history — secrets may have been exposed
- `.mcp.json` appears in git history — MCP tokens may have been exposed

Provide recovery instructions if either is found:

```
1. Immediately revoke all tokens in the exposed file
2. Generate new tokens
3. Update the file locally with new tokens
4. Use git filter-branch or BFG Repo Cleaner to purge the file from history
5. Force-push the cleaned history (coordinate with any collaborators first)
```

Flag as PASS if:

- Neither file appears in git history

---

## Health Check Report

After all 11 checks, produce this consolidated report:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AccreditMe Health Check
{current date and time}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CRITICAL ERRORS (fix immediately — do not start new work)
  {list any CRITICAL items or "None ✅"}

ERRORS (fix before opening any PR)
  {list any ERROR items or "None ✅"}

WARNINGS (address soon — not blocking)
  {list any WARNING items or "None ✅"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DETAILED RESULTS

Check 1  Git State                {PASS | WARNING | ERROR}
Check 2  Branch vs dev            {PASS | INFO | WARNING}
Check 3  Backend TypeScript       {PASS | ERROR — N errors}
Check 4  Frontend TypeScript      {PASS | ERROR — N errors}
Check 5  Test Suite               {PASS | ERROR — N failures}
Check 6  Tenant Isolation         {PASS | WARNING | CRITICAL ERROR}
Check 7  Migration Status         {PASS | WARNING | ERROR}
Check 8  Schema Validation        {PASS | ERROR}
Check 9  Environment Variables    {PASS | WARNING | ERROR}
Check 10 Critical Files           {PASS | WARNING | ERROR}
Check 11 Security                 {PASS | CRITICAL ERROR}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OVERALL STATUS

  🟢 HEALTHY     — all checks pass, ready to develop
  🟡 NEEDS WORK  — warnings present, development can continue
  🔴 BLOCKED     — errors present, fix before starting new work
  🚨 CRITICAL    — critical errors present, stop everything and fix now

Current status: {one of the above}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RECOMMENDED NEXT ACTION
  {specific instruction based on findings}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## What This Skill Must Never Do

- Fix any issue it finds — diagnosis only
- Display actual secret values from .env
- Modify any file
- Stage or commit anything
- Push to any branch
- Run `prisma migrate reset` or any destructive command
- Skip any check — all 11 must run every time
- Report PASS on a check without actually running it
