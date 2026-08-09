---
name: pr-checklist
description: Code-quality reference checklist for AccreditMe. Read by ready-to-pr and pr-reviewer as their canonical check content — not invoked standalone, and has no PR-creation capability of its own.
disable-model-invocation: true
allowed-tools: Read Glob Grep
---

# AccreditMe — Code Quality Checklist

This is a reference checklist, not a standalone process. It has no
branch verification, test running, or PR-creation steps of its own —
`ready-to-pr` owns and executes those (branch checks, TypeScript,
tests, pushing, PR creation via GitHub MCP), and `pr-reviewer` owns the
critical-review framing and output format. Both skills/agents read this
file for the actual check content below, so the two can't drift apart
from each other.

Every item must pass. Fix failures before opening the PR.

---

## Code Quality Verification

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

### Foundational / cross-cutting mechanism check

- [ ] If this diff introduces or modifies a foundational/cross-cutting
      mechanism (auth, permissions, workflow engine, tasks,
      notifications, org position, lookups, org structure,
      multi-tenancy, i18n, frontend patterns, user management) —
      `SYSTEM-REFERENCE.md` was updated in the same diff

---

## AI Integration Verification (If This PR Includes AI Features)

- [ ] AI calls go through tenant's configured `AIProvider` interface
- [ ] AI API key sourced from tenant config — never from environment directly
- [ ] AI output always presented to user for review before saving
- [ ] Every AI interaction logged: actor, model, prompt summary, timestamp
- [ ] Non-streaming AI calls run as BullMQ background jobs
- [ ] Streaming AI calls use NestJS SSE or WebSocket correctly
