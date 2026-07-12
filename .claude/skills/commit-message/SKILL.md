---
name: commit-message
description: Commit message format and rules for AccreditMe. Invoke manually with /commit-message when writing or reviewing any git commit.
disable-model-invocation: true
allowed-tools: Bash(git status) Bash(git diff --staged) Bash(git log --oneline *) Bash(git branch) Read
---

# AccreditMe — Commit Message Rules

Read this skill before writing any git commit message.
Every commit in AccreditMe must follow this format exactly.
Consistent history makes releases traceable, bugs bisectable,
and every change linkable to its Linear ticket.

---

## The Format

```
{type}({scope}): {description} [{LINEAR-ID}]
```

All four parts are required on every commit.
No exceptions. No shortcuts.

---

## Before Writing the Commit Message

Run these two commands first:

```bash
# See exactly what is staged
git diff --staged

# Confirm you are on the right branch
git branch
```

Verify:

- You are NOT on main or dev
- The staged changes match exactly one concern
- The Linear ticket ID is known

If multiple unrelated concerns are staged — unstage and split into separate commits.

---

## Types

```
feat      New feature or capability added to the codebase
fix       Bug fix — something broken is now correct
chore     Tooling, config, dependencies, migrations, seed data
test      Adding or updating tests only — zero production code change
refactor  Code restructured with no behavior change for the user
docs      Documentation only — CLAUDE.md, skill files, README, comments
```

### Choosing the Right Type

| Situation                           | Type                             |
| ----------------------------------- | -------------------------------- |
| Added a new API endpoint            | feat                             |
| Fixed a wrong tenant scoping query  | fix                              |
| Added Prisma migration              | chore                            |
| Added Jest unit tests               | test                             |
| Extracted logic to a shared service | refactor                         |
| Updated CLAUDE.md                   | docs                             |
| Added translation keys              | feat (it is a new UI capability) |
| Updated npm packages                | chore                            |
| Added seed data                     | chore                            |

---

## Scopes

Use the most specific scope that applies.

### Backend Scopes

```
tenant              Tenant provisioning and configuration
org                 Organization units and hierarchy
calendar            Working calendar service
lookup              Lookup system
roles               Roles and permissions
workflow            Workflow engine and XState
notifications       Notification service
tasks               Task management
users               User management
committees          Committee management
meetings            Meeting management
documents           Quality documentation module
standards           Standards management module
quality-improvement Quality improvement module
audit               Audit management module
platform            Super admin portal
providers           Auth, storage, or AI provider implementations
prisma              Schema, migrations, seed scripts
security            Guards, headers, throttle config
ci                  GitHub Actions, CI pipeline config
config              Environment config, app configuration
```

### Frontend Scopes

```
ui                  Any Angular component, template, or service
ui-layout           App shell, sidebar, topbar
ui-foundation       Foundation module UI (org, users, roles, etc.)
ui-documents        Documents module UI
ui-standards        Standards module UI
ui-quality          Quality improvement module UI
ui-audit            Audit module UI
ui-platform         Super admin portal UI
i18n                Translation files (en.json, ar.json)
```

### When Scope Spans Multiple Areas

If a change genuinely spans two scopes — pick the primary one.
If truly equal — use the backend scope over the frontend scope.
Never use two scopes in one commit: `feat(tasks/ui)` is wrong.

---

## Description Rules

- Lowercase only — no capital letters
- Present tense — "add" not "added", "fix" not "fixed"
- No period at the end
- Maximum 72 characters for the entire first line
- Specific and descriptive — what changed, not why

---

## LINEAR-ID Rules

- Always the last element in brackets: `[ACC-XX]`
- Use the exact ticket ID from Linear
- No ticket = no commit — create the ticket first
- For infrastructure commits with no ticket: use `[INFRA]`
- For initial project setup commits only: use `[SETUP]`

---

## Good Examples

```bash
# Feature commits
feat(workflow): add stage transition validation service [ACC-23]
feat(tasks): add SLA breach escalation with working calendar [ACC-31]
feat(documents): add DOCX template generation via docxtemplater [ACC-44]
feat(ui-documents): add document review screen with reviewer cards [ACC-44]
feat(standards): add measurable element CRUD endpoints [ACC-52]
feat(notifications): add in-app WebSocket real-time delivery [ACC-61]
feat(i18n): add documents module translation keys in en and ar [ACC-44]
feat(lookup): add tenant-configurable attribute schema support [ACC-15]

# Fix commits
fix(tasks): correct SLA skipping GCC Friday-Saturday weekends [ACC-31]
fix(workflow): prevent duplicate task on document resubmission [ACC-23]
fix(ui-layout): fix sidebar RTL collapse in Arabic mode [ACC-77]
fix(documents): return 404 when document belongs to different tenant [ACC-44]

# Chore commits
chore(prisma): migrate - add meetings and agenda-items tables [ACC-18]
chore(prisma): migrate - add organization-id to committees [ACC-19]
chore(prisma): seed - add default meeting type lookup values [ACC-18]
chore(ci): add tenant isolation test to GitHub Actions pipeline [ACC-05]
chore(config): add ENCRYPTION-KEY to env example file [ACC-03]
chore(prisma): migrate - add workflow stage sla-days field [ACC-23]

# Test commits
test(documents): add tenant isolation test for document queries [ACC-44]
test(workflow): add unit tests for stage transition guard [ACC-23]
test(tasks): add SLA calculation tests for all GCC timezone cases [ACC-31]
test(standards): add cross-tenant isolation tests for evidence links [ACC-52]

# Refactor commits
refactor(lookup): extract attribute schema validation to shared util [ACC-52]
refactor(providers): move storage interface to common/interfaces [ACC-09]
refactor(workflow): simplify stage assignment logic in WorkflowService [ACC-23]

# Docs commits
docs(claude): update build order — swap steps 16 and 17 [ACC-01]
docs(skills): add angular-component skill with RTL rules [ACC-01]
docs(readme): add local development setup instructions [SETUP]
```

---

## Bad Examples — Never Do These

```bash
# Too vague
fix: bug fix [ACC-23]
feat: updates [ACC-44]

# Missing ticket ID
feat(workflow): add stage transitions

# Wrong tense — use present not past
feat(tasks): added SLA calculation [ACC-31]
fix(documents): fixed wrong tenant query [ACC-44]

# Capital letters
Feat(Documents): Add Document Numbering [ACC-44]
Fix(Workflow): Fixed Stage Transition [ACC-23]

# Multiple unrelated changes — split these
feat(workflow): add transitions and fix document bug and update tests [ACC-23]

# Missing scope
feat: add document numbering system [ACC-44]

# Scope too broad
feat(backend): add workflow engine [ACC-23]

# Period at the end
feat(tasks): add SLA calculation. [ACC-31]
```

---

## Multi-Line Commit Body (When Needed)

For significant changes, add a body after a blank line.
The body explains WHY, not WHAT — the diff shows what changed.

```bash
feat(workflow): add configurable stage SLA with escalation [ACC-23]

Adds SLA duration in days to WorkflowStage model.
WorkingCalendarService used for all due date calculations — accounts
for GCC weekend (Friday-Saturday) and tenant public holidays.
BullMQ job checks for SLA breaches every 15 minutes.
Escalation notifies stage assignee manager via NotificationService.
Tenant isolation verified — escalations only fire within tenant scope.
```

Body rules:

- Blank line between subject and body — mandatory
- Wrap body lines at 72 characters
- Use present tense in body too
- Focus on why and what side effects exist

---

## Amending Mistakes

Only amend commits that have NOT been pushed yet:

```bash
# Fix the last commit message before pushing
git commit --amend -m "feat(tasks): add SLA calculation for working days [ACC-31]"

# View recent commits to check format
git log --oneline -10
```

Never amend commits that are already on GitHub.
If a pushed commit has a wrong message — leave it and move on.
The history is not worth a force push that breaks the branch.

---

## Commit Frequency Rules

- One concern per commit — always
- Never batch multiple features into one commit
- Schema migration = its own commit (always)
- DTOs = their own commit
- Service logic = its own commit
- Controller = its own commit
- Tests = their own commit
- Frontend service = its own commit
- Frontend component = its own commit
- Translation keys = their own commit

If a commit message needs "and" to describe what changed — split it.
