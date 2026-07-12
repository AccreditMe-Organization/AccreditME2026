---
name: new-module
description: End-to-end orchestration for creating a complete new NestJS module in AccreditMe from scratch. Invoke manually with /new-module when starting any new module in the build sequence. Coordinates prisma-change, module-scaffold, angular-component, and commit-message skills in the correct order.
disable-model-invocation: true
allowed-tools: Bash(git checkout *) Bash(git pull *) Bash(git branch) Bash(git status) Bash(git add *) Bash(git commit *) Bash(git push *) Bash(npx tsc --noEmit) Bash(npx jest *) Bash(npx prisma migrate *) Bash(npx prisma generate) Bash(npx prisma studio) Read Glob Grep Write Edit
---

# AccreditMe — New Module Orchestration

This skill orchestrates the complete creation of a new NestJS module from scratch.
It coordinates other skills in the correct order and produces a full summary at the end.

Use this skill when:

- Starting any step in the Phase 1 foundation build sequence (Steps 1–15)
- Starting any step in the Phase 2 functional module build sequence (Steps 16–19)
- Creating any entirely new domain module that does not yet exist in the codebase

Do NOT use this skill for:

- Adding features to an existing module → use /new-feature instead
- Fixing bugs in existing code → use /new-feature instead
- Small enhancements to existing modules → use /new-feature instead

---

## Pre-Flight — Run Before Anything Else

### 1. Confirm the Linear ticket

Ask the user: what is the Linear ticket ID for this module?
Format must be: ACC-XX

If no ticket exists — STOP.
Instruct the user to create one in Linear first with:

- Title: name of the module
- Description: purpose and key entities
- Acceptance criteria: what done looks like

Do not proceed without a confirmed ticket ID.

### 2. Confirm the module is next in build sequence

Read CLAUDE.md and verify this module is the correct next step.
The build sequence is non-negotiable — never skip ahead.

```
Phase 1 — Foundation (build in this order):
  Step 1:  tenant
  Step 2:  org
  Step 3:  calendar
  Step 4:  lookup
  Step 5:  roles
  Step 6:  workflow
  Step 7:  notifications
  Step 8:  tasks
  Step 9:  users
  Step 10: committees
  Step 11: meetings
  Step 12: platform (super admin)
  Step 13: billing
  Step 14: onboarding
  Step 15: offboarding

Phase 2 — Functional Modules:
  Step 16: standards
  Step 17: documents
  Step 18: quality-improvement
  Step 19: audit
```

If the requested module is not the next step — STOP.
Tell the user which module should be built first and why.

### 3. Confirm correct branch

```bash
git branch
git status
```

Must be on a feature branch — NOT main or dev.

If on main or dev:

```bash
git checkout dev
git pull origin dev
git checkout -b feature/ACC-XX-{module-name}
```

Confirm branch was created before proceeding.

### 4. Confirm no uncommitted changes

```bash
git status
```

Working tree must be clean.
If uncommitted changes exist — STOP.
Instruct user to commit or stash them before starting.

---

## Phase A — Database Schema

Read and follow @.claude/skills/prisma-change/SKILL.md completely for this phase.

### A1. Design the schema

Before touching schema.prisma, define:

- What models does this module need?
- Which models hold tenant data? → mandatory `organizationId`
- What relationships exist between models?
- What indexes are needed?

### A2. Update schema.prisma

Every tenant-scoped model must have:

```prisma
organizationId  String
organization    Organization @relation(fields: [organizationId], references: [id])
createdBy       String
createdAt       DateTime @default(now())
updatedAt       DateTime @updatedAt

@@index([organizationId])
@@index([organizationId, createdAt])
```

### A3. Run migration

```bash
cd backend
npx prisma migrate dev --name "add-{module-name}-tables"
npx prisma generate
```

### A4. Verify in Prisma Studio

```bash
npx prisma studio
```

Wait for user to confirm the new tables look correct before continuing.
Do not proceed until user explicitly confirms.

### A5. Commit schema changes — isolated commit

```bash
git add backend/prisma/schema.prisma
git add backend/prisma/migrations/
git commit -m "chore(prisma): migrate - add {module-name} tables [ACC-XX]"
```

---

## Phase B — Backend Module

Read and follow @.claude/skills/module-scaffold/SKILL.md completely for this phase.

### B1. Generate all module files

Create the complete file structure:

```
backend/src/{layer}/{module-name}/
├── {module-name}.module.ts
├── {module-name}.controller.ts
├── {module-name}.controller.spec.ts
├── {module-name}.service.ts
├── {module-name}.service.spec.ts
├── dto/
│   ├── create-{module-name}.dto.ts
│   ├── update-{module-name}.dto.ts
│   └── {module-name}-response.dto.ts
└── interfaces/
    └── {module-name}.interface.ts
```

Follow the exact templates in module-scaffold/SKILL.md.
Every file must follow those templates without deviation.

### B2. Register the module

Add to parent module imports array:

- Foundation modules → AppModule
- Functional modules → their feature module

### B3. Add permission strings

Add to `backend/src/common/constants/permissions.ts`:

```typescript
export const {MODULE_NAME}_PERMISSIONS = {
  VIEW:   '{module-name}:view',
  CREATE: '{module-name}:create',
  UPDATE: '{module-name}:update',
  DELETE: '{module-name}:delete',
  // Add module-specific actions as needed
} as const;
```

### B4. Run backend verification

```bash
cd backend && npx tsc --noEmit
```

Must be zero errors before committing.

```bash
cd backend && npx jest --testPathPattern={module-name}
```

All tests must pass including tenant isolation test.
If tenant isolation test is missing — add it before committing.

### B5. Commit backend in layers — follow commit-message/SKILL.md

```bash
# DTOs and interfaces
git add backend/src/
git commit -m "feat({module-name}): add DTOs and interfaces [ACC-XX]"

# Service
git commit -m "feat({module-name}): add service with tenant-scoped queries [ACC-XX]"

# Controller
git commit -m "feat({module-name}): add controller endpoints [ACC-XX]"

# Tests
git commit -m "test({module-name}): add unit and tenant isolation tests [ACC-XX]"

# Permissions
git commit -m "feat(roles): add {module-name} permission strings [ACC-XX]"
```

---

## Phase C — Frontend Module

Read and follow @.claude/skills/angular-component/SKILL.md completely for this phase.

### C1. Generate all frontend files

Create the complete structure:

```
frontend/src/app/{layer}/{module-name}/
├── {module-name}.routes.ts
├── {module-name}.service.ts
├── {module-name}-list/
│   ├── {module-name}-list.component.ts
│   └── {module-name}-list.component.html
├── {module-name}-detail/
│   ├── {module-name}-detail.component.ts
│   └── {module-name}-detail.component.html
├── {module-name}-form/
│   ├── {module-name}-form.component.ts
│   └── {module-name}-form.component.html
└── interfaces/
    └── {module-name}.interface.ts
```

Follow the exact templates in angular-component/SKILL.md.
Every file must follow those templates without deviation.

### C2. Register routes

Add lazy-loaded route to parent routing file.

### C3. Add translation keys

Add to BOTH files — never add to one without the other:

```
frontend/src/assets/i18n/en.json
frontend/src/assets/i18n/ar.json
```

Minimum keys required:

```json
"{module-name}": {
  "pageTitle": "",
  "columns": {
    "name": "",
    "status": "",
    "createdAt": ""
  },
  "actions": {
    "create": "",
    "edit": "",
    "delete": "",
    "view": ""
  },
  "labels": {
    "name": "",
    "description": ""
  },
  "placeholders": {
    "name": "",
    "description": ""
  },
  "messages": {
    "empty": "",
    "createSuccess": "",
    "updateSuccess": "",
    "deleteConfirm": ""
  }
}
```

Arabic values must be real Arabic — not English placeholders.
If Arabic translation is uncertain — mark with TODO comment.

### C4. Run frontend verification

```bash
cd frontend && npx tsc --noEmit
```

Must be zero errors before committing.

### C5. Commit frontend in layers — follow commit-message/SKILL.md

```bash
# API service
git commit -m "feat(ui-{module-name}): add API service [ACC-XX]"

# List component
git commit -m "feat(ui-{module-name}): add list component [ACC-XX]"

# Detail component
git commit -m "feat(ui-{module-name}): add detail component [ACC-XX]"

# Form component
git commit -m "feat(ui-{module-name}): add form component [ACC-XX]"

# Routes
git commit -m "feat(ui-{module-name}): add routes configuration [ACC-XX]"

# Translations
git commit -m "feat(i18n): add {module-name} translation keys en and ar [ACC-XX]"
```

---

## Phase D — AI Integration (If Applicable)

Check CLAUDE.md → AI Integration Points section.
If this module has defined AI touchpoints:

### D1. Add AI service method to the module service

- AI calls MUST go through the tenant's configured `AIProvider` interface
- Never call Anthropic/Azure/OpenAI directly
- AI output always returned to user for review — never auto-saved
- Every AI interaction logged: actor, model, prompt summary, timestamp

### D2. Commit AI integration

```bash
git commit -m "feat({module-name}): add AI-assisted {feature} via AIProvider [ACC-XX]"
```

---

## Phase E — Final Verification

### E1. Full test run

```bash
cd backend && npx jest --passWithNoTests
```

All tests must pass — zero failures.

### E2. Tenant isolation check

```bash
cd backend && npx jest --testNamePattern="should NOT return records belonging to a different tenant" --passWithNoTests
```

Must pass. If missing for any new query — add it now.

### E3. Full TypeScript check

```bash
cd backend && npx tsc --noEmit
cd frontend && npx tsc --noEmit
```

Both must be zero errors.

### E4. Push the branch

```bash
git push origin feature/ACC-XX-{module-name}
```

---

## Phase F — Summary Report

After all phases complete, generate this summary for the user:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ MODULE COMPLETE: {module-name}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Linear ticket:  ACC-XX
Branch:         feature/ACC-XX-{module-name}
Layer:          {foundation | modules | platform}
Build step:     Step X of 19

DATABASE
  ✅ Migration: add-{module-name}-tables
  ✅ Models: {list model names}
  ✅ Prisma client regenerated

BACKEND
  ✅ Module registered in {parent module}
  ✅ Controller: {N} endpoints
  ✅ Service: {N} methods
  ✅ DTOs: create, update, response
  ✅ Interface defined
  ✅ Unit tests: {N} passing
  ✅ Tenant isolation tests: {N} passing
  ✅ Permissions registered: {list permissions}

FRONTEND
  ✅ API service
  ✅ List component
  ✅ Detail component
  ✅ Form component
  ✅ Routes configured
  ✅ Translation keys: en.json + ar.json

AI INTEGRATION
  ✅ {list AI touchpoints} | ⏭ Not applicable for this module

VERIFICATION
  ✅ Backend TypeScript: zero errors
  ✅ Frontend TypeScript: zero errors
  ✅ All tests passing
  ✅ Tenant isolation: passing
  ✅ Branch pushed to GitHub

COMMITS ({N} total)
  Listed in chronological order from git log

NEXT STEP
  Run /pr-checklist to open the Pull Request to dev.
  After merge — next module in build sequence: {next module name}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## What This Skill Must Never Do

- Skip any phase — all phases are mandatory
- Proceed past Phase A without user confirming Prisma Studio looks correct
- Merge backend and frontend commits together
- Combine multiple layers into one commit
- Skip the tenant isolation test
- Open the PR — that is /pr-checklist's responsibility
- Start a module that is not next in the build sequence
- Write business logic in a controller
- Accept organizationId from request body
- Hardcode colors, secrets, or tenant IDs
- Use `any` type without explicit justification
