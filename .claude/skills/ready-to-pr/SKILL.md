---
name: ready-to-pr
description: Final verification and pull request creation for AccreditMe. Invoke manually with /ready-to-pr when all feature work is complete and committed, before opening a PR to dev.
disable-model-invocation: true
allowed-tools: Bash(git status) Bash(git branch) Bash(git log --oneline *) Bash(git diff *) Bash(git push *) Bash(npx tsc --noEmit) Bash(npx jest *) Bash(git stash list) Read Glob Grep mcp__github__createPullRequest mcp__github__listPullRequests mcp__linear-server__updateIssue mcp__linear-server__getIssue
---

# AccreditMe — Ready to PR

This skill runs final verification, generates the PR description,
pushes the branch, and opens the Pull Request to dev via GitHub MCP.

Use this skill when:

- All feature work is complete and committed on a feature or fix branch
- You want to open a PR to dev
- After /new-module or /new-feature work is fully done

Do NOT use this skill:

- Mid-feature when work is still in progress
- To open a PR to main — PRs always go to dev first
- Before all tests pass

---

## Step 1 — Branch and Cleanliness Check

```bash
git branch
git status
git stash list
```

Verify:

- [ ] On a `feature/ACC-XX-*` or `fix/ACC-XX-*` branch
- [ ] NOT on main or dev
- [ ] Working tree is clean — no uncommitted changes
- [ ] No stashed changes left behind

If uncommitted changes exist — STOP.
Instruct user to commit or discard them before proceeding.

If on main or dev — STOP.
This skill only opens PRs from feature or fix branches.

---

## Step 2 — Commit History Review

```bash
git log --oneline origin/dev..HEAD
```

Review every commit on this branch:

- [ ] Every commit references the correct ACC-XX ticket ID
- [ ] Every commit follows format: `{type}({scope}): {description} [ACC-XX]`
- [ ] No commit message contains "and" describing two concerns
- [ ] Commits are in the correct baby-step order:
      prisma → DTOs → service → controller → tests → ui service →
      ui component → ui template → translations

If commit messages have issues — they are already pushed so note them.
Do not force-push to fix commit messages on a shared branch.

---

## Step 3 — TypeScript Verification

```bash
cd backend && npx tsc --noEmit
```

```bash
cd frontend && npx tsc --noEmit
```

- [ ] Backend TypeScript errors: zero
- [ ] Frontend TypeScript errors: zero

If any errors exist — STOP.
Fix all TypeScript errors and commit the fix before proceeding.
Never open a PR with TypeScript errors.

---

## Step 4 — Full Test Run

```bash
cd backend && npx jest --passWithNoTests
```

- [ ] All unit tests pass
- [ ] Zero test failures
- [ ] Zero test errors

```bash
cd backend && npx jest --testNamePattern="should NOT return records belonging to a different tenant" --passWithNoTests
```

- [ ] All tenant isolation tests pass
- [ ] Count of isolation tests matches count of new Prisma queries added

If any tenant isolation test fails — STOP.
This is a critical security issue. Fix the tenant scoping before proceeding.
Do not open the PR with a failing isolation test under any circumstances.

---

## Step 5 — Code Quality Spot Check

Read the diff of all changes on this branch:

```bash
git diff origin/dev..HEAD
```

Check for:

- [ ] No `console.log` left in production code
- [ ] No commented-out code blocks
- [ ] No `any` type without inline justification comment
- [ ] No hardcoded colors — design tokens only
- [ ] No hardcoded secrets or API keys
- [ ] No direct S3 URLs — signed URLs only
- [ ] No business logic in controllers
- [ ] `organizationId` sourced from JWT in every new query
- [ ] `AuditLogService.log()` called on every create/update/delete
- [ ] Translation keys present in BOTH en.json and ar.json

If any item fails — fix it, commit the fix, then continue.

---

## Step 6 — Push the Branch

```bash
git push origin {current-branch-name}
```

Confirm push succeeded before proceeding to PR creation.

---

## Step 7 — Fetch Linear Ticket Details

Using Linear MCP fetch the ticket details for the ACC-XX ID on this branch:

```
mcp__linear-server__getIssue
```

Extract:

- Ticket title
- Ticket description
- Acceptance criteria

These populate the PR description automatically.

---

## Step 8 — Generate and Create PR via GitHub MCP

Using the verified information from all previous steps,
create the PR via GitHub MCP:

```
mcp__github__createPullRequest
```

### PR Title Format

```
{type}: {description} [ACC-XX]
```

Same type as the primary commits on this branch.
Examples:

```
feat: add working calendar configuration [ACC-12]
fix: correct SLA calculation for GCC weekends [ACC-31]
chore: add encryption key to environment config [ACC-03]
```

### PR Description Template

```markdown
## Linear Ticket

[ACC-XX](https://linear.app/accreditme/issue/ACC-XX) — {ticket title}

## What Changed

{1-3 sentences describing what this PR adds or fixes.
Written from the reviewer's perspective — what will they see differently?}

## Why

{1-2 sentences on the motivation.
What problem does this solve or what requirement does it fulfill?}

## How to Test

1. {First step — what to navigate to or run}
2. {Second step — what action to take}
3. {What to verify — expected result}
4. Confirm tenant isolation: log in as a different tenant and verify
   the data from this tenant is not visible

## Database Changes

{List each Prisma migration included:

- Migration name: add-{module}-tables
- Effect: {what tables were created or modified}}
  OR: No database changes in this PR.

## Commits ({N} total)

{paste output of: git log --oneline origin/dev..HEAD}

## Checklist

- [x] TypeScript errors: zero (backend + frontend)
- [x] All tests passing
- [x] Tenant isolation tests passing
- [x] No business logic in controllers
- [x] Every new Prisma query scoped by organizationId
- [x] AuditLogService called on all create/update/delete
- [x] Translation keys in en.json and ar.json
- [x] No hardcoded secrets or direct S3 URLs
- [x] PR targets dev branch (not main)
```

### PR Settings

```
Base branch:  dev (never main)
Head branch:  {current feature branch}
Draft:        false (only open when fully ready)
```

---

## Step 9 — Update Linear Ticket Status

Using Linear MCP, update the ticket status:

```
mcp__linear-server__updateIssue
Status: In Review
```

This signals to anyone watching Linear that the work is submitted
and waiting for CI and review.

---

## Step 10 — Final Report

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ PULL REQUEST OPENED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Linear ticket:  ACC-XX → status updated to In Review
Branch:         {branch-name} → dev
PR title:       {pr title}
PR URL:         {url from GitHub MCP response}

VERIFICATION SUMMARY
  ✅ Branch clean — no uncommitted changes
  ✅ Backend TypeScript: zero errors
  ✅ Frontend TypeScript: zero errors
  ✅ All unit tests: passing
  ✅ Tenant isolation tests: passing
  ✅ Code quality check: passed
  ✅ Branch pushed to GitHub
  ✅ PR created targeting dev

WHAT HAPPENS NEXT
  1. GitHub Actions CI will run automatically
     Watch for the green checkmark on the PR
  2. If CI fails — read the failure, fix it, push a new commit
     CI re-runs automatically on every push
  3. When CI passes — merge the PR using Squash merge
  4. After merge — delete the feature branch from GitHub
  5. Update Linear ticket to Done
  6. Run /new-ticket or /new-module for the next piece of work
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## What This Skill Must Never Do

- Open a PR with failing TypeScript errors
- Open a PR with failing tests
- Open a PR with a failing tenant isolation test
- Open a PR to main — always to dev
- Open a PR with uncommitted changes on the branch
- Skip the code quality spot check in Step 5
- Create the PR without updating the Linear ticket status
- Force-push to fix commit messages on an already-pushed branch
- Merge the PR — that is the developer's explicit action after CI passes
