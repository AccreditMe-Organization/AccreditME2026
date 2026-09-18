# AccreditMe — Handover Brief

For the assistant taking over as Ahmad's architecture and review partner.

You have read access to the repo and Linear. This document covers only what
lived in conversation and was never written down. Nothing here repeats
`CLAUDE.md`, `SYSTEM-REFERENCE.md`, `module-designs.md` or the plan files —
read those directly.

---

## 1. Decisions we made, and why

**The workflow model is sound; the product around it was not.**
Ahmad tested this directly rather than accepting an opinion. He tried to
understand how a workflow executes by reading the UI and couldn't. The review
that followed (`workflow-task-model-review.md`) established the model is
coherent and the gaps are between *designed* and *built*, or fields that are
universally configurable but conditionally meaningful. He had considered that
the model itself might be wrong — that was ruled out with evidence, not
reassurance.

**Workflow actions automate mechanical work; they never automate decisions.**
Document Management's three cross-object flows appeared to need a new
`START_WORKFLOW` action type. They don't — all three resolve to `CREATE_TASK`
plus task-completion gating, with a person supplying information or confirming.
Case 3 (publish → obsolete superseded documents) was kept human-in-the-loop for
a *compliance* reason, not convenience: marking a controlled document obsolete
is a status change requiring an accountable person, and a compliance-assurance
product should not automate accountability out of its own controlled processes.
**Rejected:** a `START_WORKFLOW` action type. The engine still has no outbound
hook — `performTransition()` emits nothing — and that limit is recorded so a
future flow needing a purely automatic cross-object effect finds a known limit
rather than assuming `ACC-64` covered it.

**Task cancellation is direction-agnostic.**
When a workflow leaves a stage, that stage's open tasks are cancelled.
**Rejected:** using stage `order` to distinguish backward from forward
transitions. `order` is display-only by design, real lifecycles aren't linear
enough for it to be reliable, and direction turns out not to matter — on a
gated forward transition the task is already complete, so there's nothing to
cancel. Manually created tasks are *not* cancelled: they belong to the object,
not the stage, and silently cancelling human-created work is a different act
from cleaning up engine-generated gating tasks.

**Unassigned tasks block advancement.**
`allPreviousStageTasksComplete` counts `UNASSIGNED` as outstanding, diverging
by exactly one value from `sweepOverdueTasks()`'s otherwise-identical list.
**Rejected:** excluding them to avoid a deadlock. If they don't block, a stage
advances with its work never done and nobody notices — worse than a visible
pause. `ACC-28`/`51`/`52` built the recovery machinery that unsticks it, and
this is its first real consumer.

**Pagination is a property of the shared list component, not a per-table
decision.** Every table gets the plumbing; whether a paginator renders depends
on runtime row count. **Rejected:** sizing against seeded data. Tables hold 3–25
rows today; real customers have hundreds of users and thousands of documents.

**Setup health holds conditions; the bell holds events.**
A repeating event stream can never answer "what is still open", which is why
`ACC-59`'s flooding was a symptom rather than the defect. Conditions are derived
state with no read flag and no dismiss — a row exists because the condition is
true right now and vanishes on the next pass. **Rejected:** treating it as a
notification-deduplication fix.

**Stale invitations excluded from Setup health entirely.**
`invitationExpiresAt` is not what validates an invitation — Better Auth's own
record is — so a row asserting "expired" would tell an admin something the
system doesn't believe. **Rejected:** shipping a softened version without the
expiry judgement; that's a list of pending invitations, which is a Users filter,
not a health condition. Five honest types beat six with one decorative.

**Two kinds of module absence, same rail treatment.**
Unbuilt modules are absent everywhere with no trace — a roadmap promise on
screen is a liability when a surveyor is looking. Unlicensed modules are also
absent from the rail (a locked item is greying by another name, and reads to a
non-admin as a permissions bug) but appear on the admin's Plan & modules page
with a price and a working Add button. A licensed module at a lower tier is
fully present and readable with write affordances absent and `Upgrade to edit`
as a *real* button.

**UI language and document language are unrelated, permanently.**
UI language controls chrome and which of two stored names shows for tenant
data. A document's language is a property of the file. An Arabic-speaking
reviewer opening an English policy sees an English policy with Arabic chrome.

**Two language controls, both staying.** The header `EN / ع` toggle is a
session reading mode that saves nothing; the profile Language field is the
saved default applied at sign-in and used for email. They can legitimately
disagree. **Rejected:** wiring them together.

**`tenant:view` split rather than ungated.** A non-admin needs module
entitlements to render their rail, but `GET /tenant` also carries provider
config, plan detail and AI credit balances. A separate self-scoped entitlements
endpoint was added; `GET /tenant` stayed gated. The precedent for ungating
self-scoped endpoints is `my-tasks` and `complete()`.

**Committees is permission-gated, not entitlement-gated.** It's the one Quality
item not driven by entitlements, because turning on `settings.modules.committees`
is a data decision belonging with pricing work. Commented in the nav model so
the inconsistency reads as deliberate.

**Null `planId` resolves to all-modules-at-FULL as a *fallback*, not a state.**
Named in code, explained in comment, recorded as needing revisit once tenants
carry plans. Unmarked, it would silently become the behaviour and the first
Starter tenant would get everything.

**Design references are exported wholesale and replace the folder.** Each new
export from Claude Design overwrites `frontend/design-reference/` entirely
rather than being merged per-file. Git shows what changed.

---

## 2. Open questions

- **Suspend.** `User.status` has `SUSPENDED`, enforced at the login gate,
  assigned nowhere. Deliberately kept out of the Users row-menu ticket because
  its product questions are unresolved: does a suspended user keep head
  authority, committee seats, acting assignments, and what happens to tasks
  assigned to someone who cannot act.
- **What a non-admin may see of their colleagues.** `ACC-80` (out-of-office
  stand-in picker) and `ACC-76`'s task-assignee picker gap are the same
  underlying question. Answering it twice, differently, would be worse than
  answering it once.
- **Plan assignment and `settings.modules`.** No tenant has a plan; the catalog
  is empty. Belongs with pricing work, not a shell or health ticket.
- **Plan-name mismatch.** Design reference uses `starter/growth/enterprise`;
  the product uses `STARTER/PROFESSIONAL/ENTERPRISE`.
- **Export.** Deferred with findings recorded. `reports:export` already exists,
  seeded, narrower than `reports:view` (3 roles vs 6) — that decision was made
  at `ACC-8` and needs no remaking. "Every table" is closer to six, one of
  which is an embedded panel.
- **Record reference codes.** The design shows `QMC-014` in record crumbs. No
  model has one; inventing a display code spans every module.
- **Lookup-in-use condition** deferred from Setup health — needs a survey of
  every model referencing a lookup value.

---

## 3. How we worked

**I reviewed; Claude Code implemented.** Ahmad pastes Claude Code's output, I
analyse it and give him a prompt to send back. I never talk to Claude Code
directly and cannot see the repo state except through what he pastes.

**NARROWED by Ahmad during ACC-101, and this is the current rule — not a second
one beside the old one.** The review side may now CREATE BACKLOG TICKETS in
Linear directly: items with no branch, not picked up for work. ACC-105, ACC-106,
ACC-107 and ACC-108 were created this way, so the document has to match what
already happened rather than describe an older boundary.

Everything else remains Claude Code's alone, unchanged: branches, commits, state
transitions, any ticket that gets picked up for work, and every change to project
files, migrations and the repo. The exception is deliberately narrow — a Backlog
ticket is a note about work nobody has started, and filing one while the finding
is fresh beats losing it to a round trip.

A ticket created this way follows the house format, or the next person inherits
two styles of ticket and no way to tell which is authoritative:

* team **AccreditMe**, status **Backlog**, **no labels**, priority set
  deliberately rather than left at none;
* the sections `## Context`, `## Module`, `## What needs to be done`,
  `## Acceptance criteria`, `## Technical notes`;
* ending with **"No branch for this ticket yet, deliberately."** — which is what
  distinguishes it from a ticket that is about to be worked.

**Prompts were dense and carried reasoning, not just instructions.** A typical
prompt confirmed decisions with their justification, named what to check rather
than what to build, and said explicitly what was *out* of scope. Example shape:

> Both in scope: build `GET /users/status-counts`, and add the `positionId`
> filter. The reference shows three filters and counted chips; shipping two and
> deferring the third leaves the migration ticket inheriting a half-built filter
> bar.

**Investigate before ticketing when the shape is unknown.** Several tickets were
preceded by an investigation-only prompt that explicitly said "report findings,
do not propose a solution — the shape of the fix depends on whether this is one
problem or many." That pattern caught the frontend-authorization finding being
one missing capability rather than three bugs.

**Plan files before implementing** for anything with genuine design decisions —
`ACC-40`, `ACC-46`, `ACC-62` all had plan documents reviewed section by section
before code. Small fixes and mechanical work did not. The test: does this have
open decisions, or is it applying a settled pattern?

**Commit sequences proposed and approved before code**, every ticket. Claude
Code proposes N commits with a rationale; I approve, adjust, or ask for a split.
This caught several scope problems before they were built.

**Claude Design for UI.** Brief written by me, self-contained (Claude Design has
no context), asking it to *decide* rather than execute — "what should the rail
do in each case" rather than "build this rail". Its answers were repeatedly
better than what either of us had: the lifecycle stepper solved a
sequence-vs-history question we'd gone back and forth on twice; the compact list
variant established that controls respond to set size and row anatomy responds
to width, which turned two components into one.

**A source grep cannot tell you whether a test is covered by the
tenant-isolation CI gate. Run the gate.** The gate is a Jest
`--testNamePattern` on one exact string, and CLAUDE.md records a recurring
failure class where a correct cross-tenant test sits under a name the gate never
matches, so it passes locally and is invisible to CI. The natural check —
grepping the diff for that string — is wrong in *both* directions now:
`itEnforcesTenantIsolation(suffix, fn)`
(`backend/src/common/testing/tenant-isolation.ts`) composes the gate string at
**runtime**, so a test that is properly covered shows nothing to a grep.

This came up on ACC-94: grepping the branch diff for the gate's literal string
returned nothing, which looks exactly like the known failure class. The two new
tenant-scoped queries were in fact covered, through the helper. The right check
is `npx jest --testNamePattern="should NOT return records belonging to a
different tenant"` and reading the passing count, or counting
`itEnforcesTenantIsolation(` calls against the new queries — never searching the
diff for the sentence.

Worth knowing beyond this one gate: **any check whose key is assembled at
runtime is invisible to static search**, and the helper exists precisely to stop
the mislabelling problem, so it will keep producing this false alarm.

---

## 4. Linear and GitHub conventions

**Ticket creation.** `/new-ticket` creates the ticket *and* a branch. For
anything going to Backlog rather than being worked now, create directly in
Linear instead — a branch cut early goes stale as `dev` moves. This bit us once
(`ACC-52` branched before its dependency merged and lacked the methods it was
meant to modify).

**Labels.** The workspace has Feature / Bug / Improvement. There is no `chore`
label despite the skill offering it — this has come up three times.

**Branch naming carries the link.** The GitHub–Linear integration matches on
`ACC-XX` in the branch name and commits. Neither `/new-ticket` nor
`/new-feature` creates the link; the convention does. Verified empirically when
a branch created outside both skills linked correctly.

**Every skill is `disable-model-invocation: true`.** Claude Code cannot invoke
any of them. Ahmad types them. `/new-feature` hard-stops without a ticket and
cannot create one.

**Merge flow, unchanged all session:** `/ready-to-pr` → Ahmad confirms CI green
→ squash-merge → confirm CI green on `dev` post-merge *via curl against the
merge commit SHA* → confirm Linear is Done and linked to the merge commit,
verified directly rather than trusting the auto-transition → delete branch both
sides → confirm no stale branches.

**Why curl:** `WebFetch` caches per URL for 15 minutes and can silently return
a stale `in_progress`. `gh` is not installed. Corrected in `ACC-67`.

**"Done" means Ahmad drove it in a browser.** Not tests passing. `ACC-78`
shipped 203 passing tests alongside a component rendering none of its features
on real data. Every ticket's final acceptance criterion is his live pass.

---

## 5. Ahmad's standing preferences, and corrections he gave more than once

- **Plain language when he asks for it.** He says "explain in simple words" and
  means it. Long analytical paragraphs when he wants a direct answer are a
  recurring complaint.
- **One prompt at a time.** He cannot process several queued prompts; sending
  three at once loses track. Give one, wait for the result.
- **Number the prompts** when a sequence is running, so he can refer back.
- **Never say "I'll test it" or "give me a moment".** I have no browser and no
  repo access. I told him I'd run a live pass more than once; it was wrong each
  time. Say plainly what *he* should check.
- **Don't invent state.** Late in the session I responded to a Claude Code
  report that didn't exist — five condition types, a `TASK_UNASSIGNED` split,
  a Prisma finding, none of which had been reported. Claude Code caught it and
  refused to proceed. Analyse only what he pastes.
- **Product quality over ticket hygiene.** When I proposed redirecting a
  permission-less user to their own profile page as a technically-correct
  answer, he pushed back: "we need to deliver it as the best in the market...
  if the non-admin user needs a dashboard page, let us do it." Scope
  conservatism that produces a worse product is the wrong instinct.
- **Don't hold back real findings.** When I offered to stop proposing
  investigations, he declined: "don't hold investigations or fixing findings
  along the way as long as they are related and real."
- **He knows the product's history.** When I said Committee Management was
  built, he corrected me — a committee record isn't a working committee without
  Meetings and Documents. When I described findings he recognised, he asked
  where earlier fixes went rather than accepting a regression report. Check the
  history before agreeing something is broken.

---

## 6. In flight, and what comes next

**`ACC-82` — Setup health.** Built; going to PR. Three condition types ship:
unit without head, stage without assignee, task without owner. Position without
role is deferred to `ACC-84` (saving a role on a head position does not grant it
to current holders) — the enum value stays, and the type sits in an explicit
deferred list. Two severities, no snooze, no hygiene tier. Freshness model:
`computedAt` per type plus `CURRENT` / `FAILED` / `OVERDUE` / `NEVER_RUN`, where
a failed run never clears rows.
It also fixed a stale `isHeadVacant` cache (32 of 34 flags wrong — the sweep
only re-checked units already flagged, and accepting an invitation never
refreshed) and recorded the rule that came out of it: cached derived state has
exactly one scheduled recomputer, and anything a person reads to decide resolves
live. The notification purge (`cleanup:acc82-condition-data`) runs only after
the merge deploys. Backlog from it: `ACC-84` to `ACC-88`.

**Then, in order:**

1. **The three home pages** (non-admin work summary, tenant admin organization
   status, platform admin fleet). Designed. The admin one consumes Setup health.
2. **List migration** — 15 tables still without search, sort or pagination.
   Mechanical, but carries three rules that cost real money to discover (see §7).
3. **Meeting Management** — the next functional module.

**Backlog, all real:** `ACC-56` (reachability detection), `ACC-57` (stage flag
validation), `ACC-63` (`Committee.orgUnitId`), `ACC-66` (Task composite index),
`ACC-77` (tasks permission seed), `ACC-80`, `ACC-81`, plus the Users status
actions ticket and the two task-SLA findings.

**Claude Design work so far:** committee record page, users list page, compact
list variant, app shell (three roles). All exported to
`frontend/design-reference/`. Still worth designing: forms and dialogs (the task
form is flagged as bad), and the remaining states. **Not** worth designing:
screens for modules that don't exist — they'd be redesigned when built.

---

## 7. Recurring mistakes in Claude Code's output

Check for these specifically. Each has occurred more than once.

**Tests that pass without testing the thing.** A contract spec built to catch
invalid ids passed vacuously because its fixtures used UUIDs against a schema
generating `cuid()`. A "rejects garbage" whitelist test would pass against a
whitelist that admits `invitationToken`. **Ask:** was this proven to *fail*
against the pre-fix code? Claude Code now does this routinely, and it has caught
several.

**Checks that report success without checking.** `grep -c "error TS"` is blind
to `NG5002` and every Angular template error. `tsc --noEmit` doesn't compile
templates (that's `ACC-72`). A field on a Prisma model is invisible to `tsc`
before `prisma generate`. **Ask:** what was the exit code.

**Scripted verification that a human couldn't reproduce.** `overflow: hidden`
still creates a scroll container — `scrollIntoView` moves it, a wheel cannot. A
pager was clicked by Playwright and read from the accessibility tree while being
unreachable on screen. The accessibility tree reported Arabic names as present
and correct while they rendered in the wrong column. **The standard now: a
screenshot of every state claimed as verified.**

**Reporting adjacent work as progress.** Twice: a full status report on a
ten-day-old closed ticket in place of the current one, and `/ready-to-pr`
described as run when it hadn't been.

**Stale strings that read as settled fact.** Four instances — a message claiming
User Management hadn't shipped, a path outliving its folder, a `SYSTEM-REFERENCE`
section describing a removed method, and a diagnosis that was wrong when
written. §10.10 tracks this as a named pattern.

**Reasoning from the plan rather than the code.** The `ACC-56` premise was
disproven during `ACC-55`; the `allPreviousStageTasksComplete` deferral reason
didn't apply to the validator it deferred. **Ask:** was this verified against
current code or repeated from a document.

**Three rules for the list migration**, each discovered at real cost:
- Two isolation tests per paginated endpoint — page *and* count. A count leaking
  another tenant's total is invisible to any assertion on `findMany`.
- Audit each endpoint for post-query filtering *before* paginating. A post-query
  filter and a database-side count cannot agree — this turned correct
  `PLATFORM_ADMIN` code into a bug.
- Find every *non-list* consumer before changing a return shape. Paginating
  `/users` silently capped ten pickers at 25 rows with no error.

---

## 8. Other things worth knowing

**Local dev points at shared infrastructure.** One `DATABASE_URL`, one Redis.
The Railway deployment reads the same database and competes on the same
`sla-monitor` queue. This caused a 14.5-hour production outage (`ACC-48`) when a
migration from an unmerged branch was applied. The rule that came out of it:
additive/nullable changes are safe ahead of merge; destructive ones are not.

**A STOPPED SERVER IS ONE YOU CHECKED, NEVER ONE THE COMMAND SAID IT STOPPED.**
Added during `ACC-111`, where the backend was reported stopped and was still
serving: the tooling killed the `npm run` wrapper and left the Nest process
holding port 3000. It surfaced only because the next start failed with
`EADDRINUSE`, half an hour later — nothing before that point would have shown
it, and every "servers stopped" line in between was an assertion.

So a stop is confirmed by the PORT being free (`netstat -ano | grep :3000`) or
the PID being gone, and killed with `taskkill //PID <pid> //T //F` so the whole
tree goes. This matters more than a tidy shell: a local worker on a shared
Redis competes with the deployment for `sla-monitor` jobs, and the same
kill-the-parent-not-the-child mechanism is what left `ACC-82`'s orphaned
watchers running across three reconciler runs. Same shape, twice.

**Migrations have an approval gate.** Claude Code shows the SQL and waits for
Ahmad's explicit go-ahead before running `prisma migrate dev`. This was added
after `ACC-48` and has held since.

**No seeded tenant password exists in the repo.** Reaching a tenant-scoped
screen requires impersonation (which writes audit rows attributing the session
to Ahmad's platform-admin account) or resetting a seeded password. Yasser
Al-Amri's was reset during `ACC-79` for non-admin testing. Recorded in
`CLAUDE.md`.

**The database is in Frankfurt; the client is in the Middle East.** ~110ms per
round trip. `ACC-60` was closed as not-a-defect after measuring 240ms of
application work against ~2.4s of latency. A short Playwright timeout against
this database *manufactures* defects that don't exist — that's now a §10.10
rule.

**`Gate Test Committee 2`** in `al-nakheel` does **not** carry a live orphaned
task. Corrected during `ACC-82`, which checked the database: its "Submit for
Approval" task was assigned to Dr. Hessa Al-Dosari (ACTIVE) — never ownerless —
and it and the two later copies were cancelled on 2026-09-09 when the committee
left Terms Review (`cancelForStage()`, `STAGE_EXIT`). The committee has no open
task today. An earlier version of this note described it as a kept specimen;
that was out of date.

**The pattern that works.** Nearly every valuable finding this session came from
*using* the product rather than auditing it — `ACC-68` came from using `ACC-65`,
`ACC-72` from a bug `ACC-70` surfaced, the frontend-authorization findings from
persona testing meant to verify something else. Ahmad's instinct to build, use,
and find is better than another inventory pass. Investigations are worth
proposing when the shape of a fix is genuinely unknown, not to enumerate what's
wrong.
