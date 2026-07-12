# AccreditMe — Skills Index

This folder contains instruction files (skills) that Claude Code reads
to maintain consistent, disciplined development across every session.

Place this entire `skills/` folder in the root of the AccreditMe project.
Reference skill files in Claude Code prompts using @skills/{filename}.

---

## How to Use Skills in Claude Code

```
@skills/new-feature.md        — before starting any new feature
@skills/prisma-change.md      — before any database schema change
@skills/module-scaffold.md    — before creating a new NestJS module
@skills/angular-component.md  — before creating a new Angular component
@skills/commit-message.md     — when writing commit messages
@skills/pr-checklist.md       — before opening any pull request
@skills/debug.md              — when diagnosing a bug or issue
```

Example prompt to Claude Code:
```
@skills/new-feature.md
@skills/module-scaffold.md

I need to implement the working calendar feature (ACC-12).
This requires a new NestJS module with CRUD for working days,
hours, and public holidays, with tenant scoping.
```

---

## Skill Files

### new-feature.md
The master baby-step process for implementing any feature.
Covers branching, schema-first, backend-first, frontend-last, and PR.
Read this before every single feature — no exceptions.

### prisma-change.md
Mandatory process for any change to schema.prisma.
Covers migration generation, verification, audit log rules, and rollback.
Read this before touching the schema.

### module-scaffold.md
NestJS module structure, controller rules, service rules, DTO rules,
interface rules, and unit test requirements.
Read this before creating any new backend module.

### angular-component.md
Angular component structure, template rules, styling rules (tokens + Tailwind),
RTL safety, reactive forms, translation requirements, and API service template.
Read this before creating any new frontend component.

### commit-message.md
Commit message format, types, scopes, examples, and anti-patterns.
Every commit in AccreditMe must follow this format.
Read this when writing or reviewing commit messages.

### pr-checklist.md
Complete checklist covering code quality, multi-tenancy, database, security,
testing, AI integration, background jobs, and frontend.
Run through this before opening any pull request.

### debug.md
Systematic troubleshooting process organized by error type and layer.
Covers backend errors, database issues, tenant isolation, workflow,
tasks, SLA, frontend, and background jobs.
Read this when something is broken.

---

## Keeping Skills Updated

Skills are living documents. When an architectural decision changes:
1. Update the relevant skill file immediately
2. Update CLAUDE.md if it is a major decision
3. Commit both changes: `docs(skills): update {skill} - {what changed} [ACC-XX]`

Skills that are outdated are worse than no skills — they give wrong instructions.
Keep them accurate.
