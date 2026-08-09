# Backend-vs-Frontend Coverage Audit — Investigation Plan

Flagged in CLAUDE.md's Open/Deferred Items. This is a planning
document for an **investigation**, not a build — no Linear ticket,
no branch, no code changes from this plan itself. Structured like
ACC-17's audit was actually run (a systematic, one-time pass across
every module checking one specific class of gap), not like a
step-XX build plan — there is no saved plan file for ACC-17 itself
to copy verbatim (confirmed via `git log --all --grep="ACC-17"`: it
was investigated and fixed directly, no separate doc), so this
document's structure is inferred from that precedent, not copied
from a file.

---

## 1. Purpose

For every backend endpoint/permission across every module built so
far, does an actual frontend UI path exist to reach it, does it
work, and does it correctly hide/block for a user who shouldn't have
access? This class of gap has been found repeatedly **by accident**
this project (Org Positions unreachable pre-ACC-16, workflow
transitions had zero UI callers until ACC-22's extension,
user-role-assignment had a payload bug found only via manual
testing, and the Dashboard/Home gap found this session). Worth one
deliberate pass instead of continuing to discover these ad hoc.

---

## 2. Scope — Verified Against `backend/src/`, Not Assumed

The proposed module list was checked against the actual 16
controllers in `backend/src/foundation/` and `backend/src/platform/`
(via `find`/`Glob`, not trusted from memory). **Two corrections
found:**

- **Workflow module was missing from the proposed list entirely.**
  `foundation/workflow` has two controllers
  (`workflow.controller.ts`, `workflow-template.controller.ts`),
  its own permissions (`workflows:view`, `workflows:manage`), and a
  substantial frontend builder UI already built (stage list,
  transition editor, action configurator, template list, plus the
  reusable `WorkflowTransitionActionsComponent`) — several of these
  files were touched directly during ACC-26's sweep. Must be in
  scope.
- **"Tenant" and "Tenant Admin Settings hub" are the same backend
  surface, not two.** `tenant.controller.ts`
  (`tenant:view/update/manage_config/bootstrap`) maps 1:1 to the
  frontend's `admin-settings` folder. Kept as one audit item below,
  but the settings-hub **navigation/discovery layer itself**
  (does the hub gracefully show/hide cards per permission — this is
  what ACC-16 called "settings-hub permission filtering") is called
  out as its own check within that item, since it's testing
  something different (route/card visibility) than the CRUD
  endpoints underneath it.

### Modules in scope (12 tenant-scoped + Super Admin Portal)

| # | Module | Backend controller(s) | Permissions | Frontend folder |
|---|---|---|---|---|
| 1 | Tenant / Admin Settings | `tenant.controller.ts` | `tenant:*` | `foundation/admin-settings` |
| 2 | Organization | `organization.controller.ts` | `org:*` | `foundation/organization` |
| 3 | Working Calendar | `working-calendar.controller.ts` | (none found yet — verify in Phase 1) | `foundation/working-calendar` |
| 4 | Lookup | `lookup.controller.ts` | `lookups:*` | `foundation/lookup` |
| 5 | Roles | `role.controller.ts` | `roles:*` | `foundation/roles` |
| 6 | **Workflow** (added) | `workflow.controller.ts`, `workflow-template.controller.ts` | `workflows:*` | `foundation/workflow` |
| 7 | Notification | `notification.controller.ts` | **none — see note below** | `foundation/notification` |
| 8 | Task | `task.controller.ts` | `tasks:*` | `foundation/tasks` |
| 9 | Org Position | `org-position.controller.ts` | `positions:*` | `foundation/org-position` |
| 10 | User | `user.controller.ts` | `users:*`, `roles:*` (role-assignment sub-routes) | `foundation/user` |
| 11 | Committee | `committees.controller.ts` | `committees:*` | `foundation/committees` |
| 12 | Super Admin Portal | `plan.controller.ts`, `platform-settings.controller.ts`, `platform-tenant.controller.ts` | `platform:*` | `platform/components/*` |

**Notification special case**: `NotificationController` has **no
`@Permissions()` on any endpoint and no `PermissionGuard`** — it's
deliberately self-scoped (every query filters by the caller's own
`userId`), confirmed via reading the controller directly. There is
nothing to "correctly block" here — the coverage question for this
one module is purely functional (does the bell/inbox work for every
persona), not access-control. Flagged so it isn't audited with the
same checklist as the other 11.

### Explicitly out of scope

- **Auth** (`foundation/auth` — login, accept-invitation,
  forgot-password, MFA). Already directly exercised and fixed this
  session (ACC-24, ACC-25). Not permission-gated content in the same
  sense — it's the pre-authentication/self-service flow, a different
  question than "does role X see feature Y."
- **Every not-yet-built functional module** (Documents, Standards,
  Incidents, CAPA, Gap, Audit, KPI, Meetings) — their permission
  constants already exist in `permissions.ts` (seeded into roles
  ahead of the modules themselves, e.g. `QUALITY_OFFICER`'s permission
  set below), but there is no controller and no frontend for any of
  them yet. Nothing to audit.
- **Super Admin Portal's Billing overview and Platform Health** —
  both explicitly deferred to Phase 2 per CLAUDE.md, no backend or
  frontend exists for either.

---

## 3. Personas

- **Platform Admin** — existing seeded account
  (`admin@accreditme.com`, org `platform`). Working, used already
  this session.
- **Tenant Admin** — existing seeded account
  (`admin@demo.accreditme.com`, org `demo-org`). Working, used
  already this session.
- **Low-permission persona — propose reusing an account that
  already exists, not creating a new one.** "Debug Test User"
  (`debug-test-user@demo.accreditme.com`) was created during ACC-26
  testing via the **real invitation flow** (not a synthetic
  DB-inserted row) and already has exactly one narrow role,
  `QUALITY_OFFICER`, assigned through the real
  `POST /users/:userId/roles` endpoint. Confirmed via
  `role.seed.ts` that `QUALITY_OFFICER`'s permission set is entirely
  for **not-yet-built** modules (`documents:*`, `standards:view`,
  `standards:link_evidence`, `audits:view/execute`,
  `incidents:view/report/investigate`, `meetings:view/record_minutes`,
  `kpi:view_department/enter_data`) plus `tasks:view/manage` and
  `reports:view` — meaning against every **currently built** module
  in scope above, this user has **zero** permissions except Tasks.
  That's exactly the realistic low-permission persona this audit
  needs, and it's already real, not synthetic.
  - **Caveat**: this account was only role-assigned during ACC-26
    testing, never logged into — status is presumably still
    `INVITED`, no password set. First step of execution: complete
    its `accept-invitation` flow (which is itself a free re-check of
    that flow with a real pending invitation, at no extra cost).

---

## 4. Methodology — Two Phases (same approach already proven this session)

**Phase 1 — Static enumeration.** For each module: read its
controller file(s), list every endpoint and the exact
`@Permissions()` string it requires (or confirm it's permission-gated
by `TenantGuard` alone, like Notification). Produces a checklist
per module before touching a browser.

**Phase 2 — Live verification via Playwright MCP.** Drive the actual
browser as each of the 3 personas (where relevant — Platform Admin
only makes sense for module 12; the low-permission persona is the
interesting case for modules 1–11). For each module, observe:
- Is there a reachable UI path (nav entry, route) to this capability
  at all?
- Does the core capability work end-to-end without console/network
  errors?
- For the low-permission persona specifically: is access correctly
  hidden or gracefully blocked (no broken empty-table-plus-red-error
  state like the confirmed `/organization` bug), or does it silently
  break?

Cross-reference Phase 1's endpoint list against what Phase 2 could
actually exercise — any endpoint with zero discoverable UI path is a
finding regardless of which persona it's tested as.

---

## 5. Triage Framework — Proposed Thresholds

- **(a) Trivial — fix inline during the audit itself.** Single file,
  a few lines, no schema/API contract change, no cross-module
  ripple, obviously safe (missing i18n key, missing button label, a
  component missing a PrimeNG module import). Same spirit as ACC-18's
  small UI-gap batch.
- **(b) Small — bundle into one follow-up ticket per module or
  theme.** Touches 2+ files or needs a small new component, but no
  new backend endpoint/permission and no real design decision.
  Mirrors ACC-16/ACC-18's own pattern of bundling several small fixes
  under one ticket.
- **(c) Significant — own dedicated ticket, possibly its own plan.**
  An entire module found to have no UI at all, a missing backend
  endpoint, a permission-model gap (the Dashboard/Home finding is
  exactly this shape), or anything needing a Pending-Discussions-style
  decision before implementing.

See Pending Discussion #3 below — whether category (a) should
actually happen *during* the audit, or whether the audit should stay
a pure, zero-code-touched findings pass with even trivial fixes
queued afterward.

---

## 6. Pending Discussions — Resolve Before Executing

1. **Depth per module**: every field/button, or "can I reach and
   successfully use the core capability"? Proposal: the latter
   (matches this session's own testing depth throughout — e.g.
   ACC-22's committee verification didn't test every form field).
   Confirm or override.
2. **English-only vs. bilingual/RTL scope for this pass.** Proposal:
   English only — the full RTL visual audit is already a separate,
   explicitly deferred item (positioned before the demo milestone).
   Running both simultaneously risks conflating two different classes
   of finding. Confirm or override.
3. **Inline-fix-during-audit vs. zero-code-touched audit.** Category
   (a) above assumes small fixes happen inline mid-audit. Alternative:
   the audit produces a pure findings report with **zero code
   changes**, and even trivial fixes get queued as the smallest
   possible follow-up tickets — cleaner separation (investigation vs.
   implementation), at the cost of ticket overhead for genuinely
   one-line fixes. Needs a decision, not a default.
4. **Single low-permission persona vs. multiple.** Proposal above
   reuses one all-or-nothing low-permission user (Quality Officer).
   Alternative: also create one or two personas with a *partial*
   permission slice (e.g. `org:view` only, nothing else) to test
   partial-visibility states, not just all-or-nothing. Adds real
   setup cost (more invitation flows, more roles) — worth it or not?
5. **Confirm Super Admin Portal's in-scope boundary** is exactly
   Tenant management + Impersonation + Announcements + Plan/AI-credit
   config (the parts ACC-13 actually shipped), explicitly excluding
   Billing overview and Platform Health (unbuilt) — stated above as
   "explicitly out of scope," flagging here so it isn't silently
   assumed.

---

## 7. Deliverable

A findings report (module-by-module: reachable / not reachable /
broken / correctly blocked) plus a triaged list of follow-up work
sorted into the three categories above — not a set of tickets opened
automatically. Ticket creation for (b)/(c) items happens after this
report is reviewed, via `/new-ticket` as normal, same as every other
piece of work this project.
