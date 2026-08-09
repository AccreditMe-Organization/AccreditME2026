---
name: new-ticket
description: Creates a properly structured Linear ticket for AccreditMe and sets up the corresponding git branch. Invoke manually with /new-ticket before starting any feature or fix work that does not have a ticket yet.
disable-model-invocation: true
allowed-tools: Bash(git checkout *) Bash(git pull origin dev) Bash(git branch) Bash(git status) mcp__linear-server__createIssue mcp__linear-server__getTeams mcp__linear-server__getProjects mcp__linear-server__listIssueStatuses mcp__linear-server__listIssuePriorities Read
---

# AccreditMe — New Ticket Process

This skill creates a properly structured Linear ticket and the corresponding
git feature branch in one coordinated flow.

Use this skill when:

- Starting any new feature, module, fix, or improvement
- A piece of work needs to be tracked before development begins
- You need a Linear ticket ID before invoking /new-module or /new-feature

Do NOT use this skill when:

- A Linear ticket already exists for this work → go directly to /new-module or /new-feature
- Creating a ticket for infrastructure or tooling with no code change → create manually in Linear

---

## Step 1 — Gather Information From the User

Before creating anything, ask the user for these details.
Ask all questions at once — not one at a time.

```
1. What is this ticket for?
   (brief description of the feature, module, or fix)

2. Which module does it belong to?
   (tenant / org / calendar / lookup / roles / workflow /
    notifications / tasks / users / committees / meetings /
    standards / documents / quality-improvement / audit /
    platform / infrastructure)

3. What type of work is this?
   (feature / bug / chore / improvement / refactor)

4. What is the priority?
   (urgent / high / medium / low)

5. What does "done" look like?
   (acceptance criteria — what must be true for this ticket to be closed?)
```

Do not proceed until all five questions are answered.

---

## Step 2 — Verify We Are on dev Branch

```bash
git branch
git status
```

Must be on `dev` before creating a branch.
If not on dev:

```bash
git checkout dev
git pull origin dev
```

Confirm dev is up to date before proceeding.

---

## Step 2b — Check SYSTEM-REFERENCE.md for Foundational/Cross-Cutting Proposals

If this ticket proposes a new foundational or cross-cutting mechanism
(auth, permissions, workflow engine, tasks, notifications, org
position, lookups, org structure, multi-tenancy, i18n, frontend
patterns, user management) — read `SYSTEM-REFERENCE.md` first and
check whether existing machinery already solves part of the problem
before the ticket is written. This exists because of a direct incident
(ACC-28) where a new authorization system was drafted without this
check, when existing assignee-resolution logic already covered most of
it — see `SYSTEM-REFERENCE.md`'s own Purpose section.

Note in the ticket's Technical Notes section (Step 3 below) that this
check was done, and what it found — even if the finding was "nothing
relevant exists yet."

---

## Step 3 — Create the Linear Ticket

Using the Linear MCP, create the ticket with this structure:

### Title Format

```
{module}: {brief description}
```

Examples:

```
calendar: add working days and public holiday configuration
documents: implement DOCX template generation
audit: create audit plan CRUD with scope definition
```

### Description Template

```markdown
## Context

{1-2 sentences explaining why this work is needed and what problem it solves}

## Module

{module name} — {layer: foundation | functional | platform}

## What Needs to Be Done

{clear description of the work — what to build, not how}

## Acceptance Criteria

- [ ] {criterion 1}
- [ ] {criterion 2}
- [ ] {criterion 3}
- [ ] Backend TypeScript: zero errors
- [ ] All tests passing including tenant isolation
- [ ] Frontend TypeScript: zero errors
- [ ] Translation keys added in en.json and ar.json
- [ ] PR merged to dev with green CI

## Technical Notes

{any relevant technical context from CLAUDE.md — data models,
services to use, integrations required}

## Skills to Use

{list which skills are relevant: /new-module or /new-feature,
/prisma-change if DB change needed, /angular-component for UI}
```

### Ticket Fields to Set

```
Team:        AccreditMe
Project:     AccreditMe (if project exists in Linear)
Status:      Todo
Priority:    {from user input}
Label:       {feature | bug | chore | improvement}
```

### After Creation

Capture the ticket ID from Linear's response.
Format will be: ACC-XX
This ID is used in every commit message and branch name for this work.

---

## Step 4 — Create the Git Branch

Using the ticket ID and description from Step 3:

### Branch Name Format

```
{prefix}/ACC-XX-{short-description}
```

**Only two branch prefixes exist in this project — CLAUDE.md's
Branching Strategy defines exactly `feature/xxx` and `fix/xxx`, nothing
else.** `chore`/`refactor`/etc. are commit-message *types*
(see `/commit-message`), not branch prefixes — do not invent a
`chore/` or any other branch prefix. Ticket-type-to-branch-prefix
mapping:

```
bug         → fix/
feature     → feature/
chore       → feature/
improvement → feature/
refactor    → feature/
```

Examples:

```
feature/ACC-42-working-calendar-configuration
fix/ACC-51-sla-skipping-gcc-weekends
feature/ACC-18-meetings-module-scaffold
feature/ACC-03-add-encryption-key-to-env
```

Short description rules:

- Lowercase only
- Hyphens between words — no underscores
- 3-5 words maximum
- Describes the work, not the ticket

### Create the Branch

```bash
git checkout dev
git pull origin dev
git checkout -b {branch-name}
```

Confirm the branch was created:

```bash
git branch
```

The new branch should show with `*` indicating it is the active branch.

---

## Step 5 — Confirm and Report

After both the ticket and branch are created, report to the user:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ TICKET AND BRANCH CREATED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Linear ticket:  ACC-XX
Title:          {ticket title}
Priority:       {priority}
Status:         Todo
URL:            https://linear.app/accreditme/issue/ACC-XX

Git branch:     {branch-name}
Based on:       dev
Current branch: {branch-name} ← you are here

NEXT STEP
{If this is a new module from scratch}
  → Run /new-module to scaffold the complete module
  → Reference: ACC-XX in every commit message

{If this is a feature on an existing module}
  → Run /new-feature to follow the feature development process
  → Reference: ACC-XX in every commit message

Commit message format for this ticket:
  feat({module}): {description} [ACC-XX]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## What This Skill Must Never Do

- Create a ticket without all five required inputs from the user
- Create a branch from main — always from dev
- Skip pulling latest dev before branching
- Create a branch without a corresponding Linear ticket
- Use a branch name that does not include the ACC-XX ticket ID
- Proceed with development — ticket and branch creation only
- Create duplicate tickets — always check if a ticket already exists first
