---
name: ready-to-pr
description: Final verification and pull request creation for AccreditMe. Invoke manually with /ready-to-pr when all feature work is complete and committed, before opening a PR to dev.
disable-model-invocation: true
allowed-tools: Bash(git status *) Bash(git branch) Bash(git log --oneline *) Bash(git diff *) Bash(git push *) Bash(git ls-files *) Bash(npx tsc --noEmit) Bash(npx jest *) Bash(npx ng *) Bash(npm run *) Bash(node -e *) Bash(ls *) Bash(git stash list) Bash(rm -rf .playwright-mcp/*) Read Glob Grep mcp__github__createPullRequest mcp__github__listPullRequests mcp__linear-server__updateIssue mcp__linear-server__getIssue
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
git rev-parse --abbrev-ref HEAD
git status --porcelain        # EMPTY means clean. Untracked files appear as ??
git stash list
ls *.png *.jpg *.jpeg *.gif *.webp 2>/dev/null   # root-level images — see below
```

Verify:

- [ ] On a `feature/ACC-XX-*` or `fix/ACC-XX-*` branch
- [ ] NOT on main or dev
- [ ] `git status --porcelain` prints NOTHING — modified *and* untracked both count
- [ ] No stashed changes left behind
- [ ] No image files at the repository root

**`--porcelain`, not bare `git status`.** Bare `git status` is prose a reader
skims; porcelain is empty or it is not. Untracked files (`??`) make the tree
UNCLEAN — they are the half most easily waved through, because the summary
still says "nothing to commit" about tracked files.

**WHY ROOT IMAGES GET THEIR OWN CHECK, even though `.gitignore` covers them
(ACC-119).** This looks redundant and is not. `/ *.png` and friends are
gitignored, which is exactly why `git status --porcelain` no longer shows
them — so adding that ignore rule REMOVED the only signal that they exist.
Without this separate `ls`, the ignore rule would have quietly defeated the
check it was added alongside.

The ignore rule stops them being committed by accident. This check tells you
they are there, so anything worth keeping goes to the session scratchpad
before it is deleted.

If `git status --porcelain` is non-empty — STOP.
Instruct the user to commit or discard, and say whether the entries are
modified (` M`) or untracked (`??`), because the remedy differs.

If on main or dev — STOP.
This skill only opens PRs from feature or fix branches.

---

## Step 1b — Clear the Browser-Pass Artifacts, From BOTH Places

A browser pass writes to **two** locations, and knowing why is what stops
this step being half-done (ACC-119):

| Written where | Which files | Why |
| -- | -- | -- |
| `.playwright-mcp/` | page snapshots, console logs, **auto-named** screenshots | what `--output-dir` governs |
| **repository root** | screenshots given an **explicit filename** | Playwright resolves an explicit name against the workspace root, by design |

**The second is not configurable.** `--output-dir`'s own help says it is for
"automatically named output files... Files with an explicit name are resolved
against the workspace root." A verification screenshot naturally gets a
meaningful name, so it naturally lands at the root. This was not a
misconfiguration on ACC-118 and cannot be fixed by setting a flag.

```bash
ls .playwright-mcp 2>/dev/null | wc -l
rm -rf .playwright-mcp/*
ls *.png *.jpg *.jpeg *.gif *.webp 2>/dev/null   # then move or delete these
```

- [ ] `.playwright-mcp/` is empty (the folder itself may stay)
- [ ] No image files at the repository root

**The two differ in severity, so treat them differently.** `.playwright-mcp/`
is disk clutter — one ticket left **1436 files, 16 MB** — and it is gitignored,
so nothing there can reach the repo. Root screenshots are gitignored too
(ACC-119), so they cannot be committed by accident either; but they are
pictures of whatever was on screen. Against seeded dev data that is harmless.
The same habit against a real tenant would put real records in a file someone
later moves somewhere less careful.

Anything worth KEEPING — a screenshot cited in a report, a saved failure trace
— belongs in the session scratchpad. Copy it there BEFORE clearing, not after.

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

## Step 3 — TypeScript and Template Verification

```bash
cd backend && npx tsc --noEmit
```

```bash
cd frontend && npx tsc --noEmit
```

```bash
cd frontend && npx ng build
```

**`ng build` is not redundant with `tsc --noEmit`** — `tsc` does not
invoke the Angular compiler, so it never type-checks templates, even
though `strictTemplates` is enabled. A binding against a field that
does not exist passes `tsc` and fails only here (ACC-72).

- [ ] Backend TypeScript errors: zero
- [ ] Frontend TypeScript errors: zero
- [ ] Frontend build: succeeds

If any errors exist — STOP.
Fix all TypeScript errors and commit the fix before proceeding.
Never open a PR with TypeScript or template errors.

---

## Step 4 — Full Test Run — BOTH SUITES, EVERY TIME

**RUN BOTH REGARDLESS OF WHAT THE DIFF TOUCHES.** Not diff-aware, and that is
deliberate (ACC-119): a step that decides which suite to run can decide wrong,
and then reports a clean verification of code it never executed. Running both
costs a couple of minutes and cannot be wrong.

This step used to name only the backend. ACC-118 was a frontend-only diff, so
following it literally tested what had not changed and skipped what had.

### Backend

```bash
cd backend && npx jest --passWithNoTests
```

- [ ] Backend suite passes — gated on ITS OWN exit status

### Frontend

```bash
cd frontend && npx ng test --watch=false --browsers=ChromeHeadless
```

- [ ] Frontend suite passes — gated on ITS OWN exit status

### Tenant isolation

```bash
cd backend && npx jest --testNamePattern="should NOT return records belonging to a different tenant" --passWithNoTests
```

- [ ] All tenant isolation tests pass
- [ ] Count of isolation tests matches count of new Prisma queries added

If any tenant isolation test fails — STOP.
This is a critical security issue. Fix the tenant scoping before proceeding.
Do not open the PR with a failing isolation test under any circumstances.

---

## Step 4b — Every `check:*` Script, DISCOVERED Not Listed

**Do not name the scans here.** Read them out of each `package.json` and run
what you find. A scan added next month then runs without anyone editing this
file — which is the whole point, because `check:create-gating` was added the
same day this gap was found, and a hand-written list would already have been
missing it. Same drift ACC-39 had to clean up in `EditDialogComponent`'s
hand-maintained consumer count.

```bash
for pkg in backend frontend; do
  node -e "const s=require('./$pkg/package.json').scripts||{};
           Object.keys(s).filter(k=>k.startsWith('check:')).forEach(k=>console.log(k))" \
  | while read -r script; do
      (cd "$pkg" && npm run "$script" >/dev/null 2>&1)
      printf '%-14s %-24s exit=%s\n' "$pkg" "$script" "$?"
    done
done
```

- [ ] Every discovered `check:*` script ran, and is reported BY NAME with its
      exit status
- [ ] Every exit status is 0

**Report the names, not just a count.** "All scans passed" is unfalsifiable if
discovery silently found none; a list a reader can compare against the repo is
not. If the loop prints nothing at all, discovery is broken — treat that as a
failure, not as "no scans to run".

---

## Step 5 — Code Quality Spot Check

Read the diff of all changes on this branch:

```bash
git diff origin/dev..HEAD
```

Read and follow @.claude/skills/pr-checklist/SKILL.md completely for
the full code-quality checklist.

If any item fails — fix it, commit the fix, then continue.

---

## Step 5b — Update Progress Tracker

If a plan file exists for this step: `backend/Plans/step-{NN}-{module-name}.md`

Mark all completed items as `[x]` and commit:

```bash
git add backend/Plans/
git commit -m "chore(docs): complete progress tracker before PR [ACC-XX]"
```

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
  ✅ Branch clean — nothing modified, nothing untracked,
     no images at the repository root
  ✅ Backend TypeScript: zero errors
  ✅ Frontend TypeScript: zero errors
  ✅ Frontend ng build: succeeds
  ✅ Backend suite: {N} suites, {N} tests
  ✅ Frontend suite: {N} tests
  ✅ Tenant isolation tests: {N} passing
  ✅ Scans ({N} discovered): {list each by name}
  ✅ Code quality check: passed
  ✅ Branch pushed to GitHub
  ✅ PR created targeting dev
```

**Report the numbers and the scan NAMES, not adjectives.** "All unit tests:
passing" is what the old summary said on a run that never executed the
frontend suite — it was true of what ran and wrong about what it implied. A
count is checkable; "passing" is not. Likewise a named scan list can be
compared against the repo, so a discovery step that silently found nothing
cannot read as success.

```

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
