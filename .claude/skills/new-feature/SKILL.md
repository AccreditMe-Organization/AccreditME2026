---
name: new-feature
description: Baby-step process for implementing any new feature in AccreditMe. Invoke manually with /new-feature before starting any feature work.
disable-model-invocation: true
allowed-tools: Bash(git checkout *) Bash(git pull *) Bash(git branch *) Bash(git status *) Bash(git add *) Bash(git commit *) Bash(git push *) Read Glob Grep
---

# AccreditMe — New Feature Process

Read this skill completely before writing any code.
Follow every step in order. Do not skip steps. Do not combine steps into one commit.
One concern per commit. One layer per step.

---

## Step 0 — Check for Plan File

Search: `ls backend/Plans/ | grep {module-name}`

If found — read it for context and business rules.
If not found — proceed normally.

---

## Step 1 — Confirm Linear Ticket Exists

Before touching any code:
- Ask: what is the Linear ticket ID for this feature?
- Format must be: ACC-XX
- If no ticket exists — STOP. Instruct user to create one in Linear first.
- Do not proceed without a confirmed ticket ID.

---

## Step 2 — Confirm Correct Branch

Run: `git branch`

Rules:
- Must NOT be on main or dev
- Must be on a feature or fix branch

If on main or dev — STOP. Run these commands:
```bash
git checkout dev
git pull origin dev
git checkout -b feature/ACC-XX-short-description
```

Replace ACC-XX with the actual ticket ID and short-description with 2-3 words describing the feature.

Do not start coding until the correct branch is confirmed.

---

## Step 3 — Schema First (Only If DB Change Needed)

If this feature requires any database change — read and follow @.claude/skills/prisma-change/SKILL.md first.
Do not mix schema changes with feature code in the same commit.

If no DB change needed — skip this step entirely.

---

## Step 4 — Backend Implementation

Build in this exact order. One commit per layer.

### 4a — Interfaces and DTOs
Create interfaces/ and dto/ files inside the module.
```bash
git add src/
git commit -m "feat({module}): add DTOs and interfaces for {feature} [ACC-XX]"
```

### 4b — Service Logic
Implement the service method(s).
Rules:
- Every DB query MUST include `{ organizationId: tenantId }` in where clause
- All business logic goes in the service — nothing in the controller
- Use WorkingCalendarService for any date or SLA calculation
- Call AuditLogService on every create/update/delete
- Call WorkflowService if this feature has workflow integration
- Call NotificationService if this feature sends notifications

```bash
git commit -m "feat({module}): add {feature} service logic [ACC-XX]"
```

### 4c — Controller and Routes
Add controller endpoint(s).
Rules:
- Controllers handle routing and validation ONLY
- Must include @UseGuards(TenantGuard, PermissionGuard) at class level
- Must include @Permissions('{module}:{action}') at method level

```bash
git commit -m "feat({module}): add {feature} endpoints [ACC-XX]"
```

### 4d — Unit Tests
Write Jest unit tests for new service methods.
Mandatory for every findAll/findMany:
```typescript
it('should NOT return records belonging to a different tenant')
```

Run tests before committing:
```bash
cd backend && npx jest --testPathPattern={module}
```

```bash
git commit -m "test({module}): add unit and tenant isolation tests for {feature} [ACC-XX]"
```

Do not touch the frontend until all backend steps are committed and tests pass.

---

## Step 5 — Frontend Implementation

Build in this exact order. One commit per layer.

### 5a — API Service
Add Angular service method that calls the new backend endpoint.
```bash
git commit -m "feat(ui): add {feature} API service [ACC-XX]"
```

### 5b — Component Logic
Add component TypeScript logic, state using Signals, and event handlers.
```bash
git commit -m "feat(ui): add {feature} component logic [ACC-XX]"
```

### 5c — Template and UI
Add Angular template.
Rules:
- PrimeNG components only — no custom reimplementing existing PrimeNG behavior
- Design tokens from tokens.scss — never hardcode colors
- Tailwind for layout — never Bootstrap
- RTL-safe: use ps-, pe-, ms-, me- instead of pl-, pr-, ml-, mr-
- All visible strings through ngx-translate — never hardcoded English

```bash
git commit -m "feat(ui): add {feature} template [ACC-XX]"
```

### 5d — Translations
Add translation keys to BOTH files.
```bash
git commit -m "feat(i18n): add {feature} translation keys (en + ar) [ACC-XX]"
```

---

## Step 6 — Integration Check

Run before opening a PR:

```bash
# Backend
cd backend
npx tsc --noEmit
npx jest

# Frontend
cd ../frontend
npx tsc --noEmit
```

Fix any failures. Do not open a PR with failing checks.

---

## Step 7 — Open Pull Request

```bash
git push origin feature/ACC-XX-short-description
```

Then open a PR on GitHub:
- Base branch: dev (never main)
- Title: "feat: {feature description} [ACC-XX]"
- Run /ready-to-pr skill to complete the PR checklist and description

---

## Commit Message Reference

Format: `{type}({scope}): {description} [ACC-XX]`

Types: feat / fix / chore / test / refactor / docs
Scopes: tenant / org / calendar / lookup / roles / workflow / notifications /
        tasks / users / committees / meetings / documents / standards /
        quality-improvement / audit / platform / providers / prisma / ci /
        ui / ui-layout / i18n / config / security

Rules:
- Always include Linear ticket ID in brackets
- Lowercase, present tense, under 72 characters
- Never commit multiple unrelated changes together
- Never commit directly to main or dev

---

## What Must Never Happen During a Feature

- Business logic in a controller
- Skipping schema migration commit when DB changed
- Combining multiple unrelated changes in one commit
- Committing directly to dev or main
- Opening a PR without running tests first
- Using `any` type without flagging it
- Writing a DB query without `organizationId` scoping
- Hardcoding colors, secrets, or tenant IDs
- Starting frontend before backend tests pass
