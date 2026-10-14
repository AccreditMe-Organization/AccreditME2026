# ACC-120 slice 5 — the permission matrix (`/roles/:id/permissions`)

Plan written 13 Oct 2026 (CC-90), approved with D1–D14 and amendments R1–R4
in CC-91, and R1c in CC-91a. Delivered as TWO PRs (D13):

- **PR A — backend: saving a role's permissions** (this plan's D4, D5, D6,
  D8, R1, R1c, R2). Branch `feature/ACC-120-role-permission-save`.
- **PR B — the matrix screen** (D1–D3, D7, D9–D11, D14, R3, R4). Branch
  `feature/ACC-120-permission-matrix`.

Sources, in order of authority: the code on dev; `AccreditMe Users and
Roles.dc.html` section 3 (the Arabic frozen column, the one-column Save
confirmation, the states drawn in 3c); `AccreditMe Templates.dc.html`
artboard 6a; ACC-120's "Slice 5, the permissions matrix" and "Matrix design
answered, 2026-09-30". The module-grouped "Review n changes" dialog with
amber rings is WITHDRAWN (Users and Roles L706) and is not built.

## Findings (CC-90)

- `GET roles/permissions` reads the `Permission` table (role.service.ts
  `listAllPermissions`), seeded from `permissions.ts`. Live and code agree:
  74 keys.
- `PATCH roles/:id/permissions` replaced the set in one transaction, with no
  check for a save made by someone else in between, refused an empty list
  (`ArrayNotEmpty`), audited only the after state, and accepted any catalogue
  key including `platform:*`.
- The matrix today lists `platform:*` to tenants and shows raw keys; no
  permission sentence exists anywhere.
- `activeHolderCount` (list only) counts ACTIVE holders, direct and
  head-position alike; `@@unique([userId, roleId])` means nobody is counted
  twice. `GET /roles/:id` did not return it.
- Escalation through `roles:manage` (adding keys one does not hold, editing a
  role one holds, assigning oneself Organization Administrator) is open — now
  ACC-221, not fixed here beyond R1.

## A. Rows and columns (PR B)

Rows: a module header row, then one row per permission, labelled with a
sentence. Six columns: View, Create, Edit, Delete, Approve, Audit. Each
permission row has its mark in exactly one column; the other cells are
hatched not-applicable (6a L2792).

Placement of every catalogue key:

| Module | View | Create | Edit | Delete | Approve | Audit | Whole-row grant |
|---|---|---|---|---|---|---|---|
| tenant | view | | update, manage_config | | | | bootstrap |
| org | view | | | | | | manage |
| users | view | invite | manage, transfer | deactivate | | | reactivate |
| roles | view | | | | | | manage |
| lookups | view | | | | | | manage |
| workflows | view | | | | | | manage |
| tasks | view | create | reassign | | | | manage |
| committees | view | create | edit_details, add_member, remove_member, change_member_role | | approve | | manage |
| notifications | view | | | | | | manage |
| meetings | view | | record_minutes | | approve_minutes | | manage |
| documents | view | create | submit, review, manage_templates, manage_numbering | | approve, publish | | |
| standards | view | | link_evidence | | | | manage |
| audits | view | create | execute, report | | close | | |
| incidents | view | report | investigate | | approve_plan, close | | |
| billing | view | | | | | | manage |
| reports | view | | | | | export | |
| positions | view | | | | | | manage |
| setup | view | | | | | | |
| kpi | view_own, view_department, view_all | | enter_data | | verify | | manage, manage_system |
| admin | | | | | | | access |
| platform | hidden from tenants (D2) | | | | | | admin, impersonate |

**D1 — keys that fit no column are whole-row grants**: the toggle sits in the
label column, in the checkbox slot every permission row already reserves
(Users and Roles L617–624), and all six cells are hatched. The column comes
from one function — an explicit override list, then action-name rules
(`view*` → View, `create*`/`invite` → Create, `approve*`/`publish`/`verify`/
`close` → Approve, `export*` → Audit), else a whole-row grant — so the task
rows the task-permission rework adds (`*:view_all_tasks`, `*:create_tasks`,
`*:manage_tasks`) land with no layout change.

**R3** — the whole-row toggle in the label column is a cell in the keyboard
grid, FIRST in reading order. Granted and not granted differ by glyph, never
by colour alone.

**R4** — sentences are written for IN-USE keys only (R2's list says which);
`check:permission-sentences` enforces those in both languages, and Ahmad
reviews the Arabic in PR B.

D2 — the matrix hides `platform:*` from tenants. D3 — modules in a fixed
product order, new modules appended.

## B. Saving (PR A)

- **D4 — a stale save is refused.** The request carries
  `expectedPermissionKeys` (the set the page loaded). Inside the transaction
  the Role row is locked (`SELECT … FOR UPDATE`, scoped by id AND
  organisation, as `lockTaskRow`), the current set is read and compared as a
  SET; a difference is **409 `ROLE_PERMISSIONS_CHANGED`**. Optional in PR A
  (an already-open page keeps saving through the deploy), required in PR B.
  No migration: `Role.updatedAt` is not touched by a permission write, and a
  timestamp would make a rename block a permission save.
- **D5 — the audit records before, after, added and removed.**
- **D6 — an empty list is allowed.** A role that grants nothing is
  legitimate; the root role is frozen regardless.
- **D8 — `GET /roles/:id` returns `activeHolderCount` and
  `headPositionHolderCount`** (ACTIVE holders only, as the list).

### R1 — platform scope closed (PR A)

- A tenant role may not GAIN a `platform:*` key: 400
  `PLATFORM_PERMISSION_NOT_ALLOWED`.
- `POST users/:userId/roles` refuses the Platform Administrator role inside a
  tenant: 400 `PLATFORM_ROLE_NOT_ASSIGNABLE`.
- **R1c** — any permission save on the Platform Administrator role is
  refused with 409 `PLATFORM_ROLE_NOT_EDITABLE`, the same way the root role
  is. **In EVERY organisation, the platform organisation included** (CC-93):
  there the role is what PlatformGuard reads, and a save that dropped
  `platform:admin` would leave nobody able to reach the platform screens — no
  holder invariant covers the platform organisation. Inside a tenant the role
  is inert, so freezing it costs nothing there either.

**The seeded Platform Administrator role keeps its two platform keys in every
tenant — by design, for now** (CC-91a). The R1 SELECT (13 Oct) found exactly
those rows: 4, from `SYSTEM_ROLE_SEED` seeding Platform Administrator into
every tenant with `platform:admin` and `platform:impersonate`; 0 tenant users
hold the role. They are inert (PlatformGuard also requires a platform
organisation). Removing them is tracked on **ACC-221**.

### R2 — keys not in use yet (PR A)

- One exported list in `permissions.ts`, `PERMISSIONS_NOT_YET_CHECKED`, names
  the keys no code checks yet. `GET roles/permissions` returns
  `inUse: boolean` on every key. A spec proves the list plus the in-use keys
  equal the catalogue exactly, and that the list matches the code: a listed
  key referenced by code fails, as does an in-use key nothing references.
- **"In use" means some code decides with it today**: a backend check, a
  frontend gate, or a `requiredPermission` on a seeded workflow transition of
  a record type that exists (Committee). Measured 13 Oct: **38 keys** are not
  in use — 25 referenced nowhere, and 13 referenced only by seeded
  transitions of record types that do not exist yet (Meeting, Document,
  Audit, Incident). The card's figure was 40; 38 is the count against this
  definition, recorded rather than adjusted to match.
- On save, the server KEEPS the role's existing platform and not-in-use keys
  whatever the request sends. A not-in-use key the role does not already hold
  is refused with 400 `PERMISSION_NOT_IN_USE`. The 409 comparison uses the
  full set.
- **F2 (CC-92) — in the platform organisation, platform keys are ordinary
  keys**: ticked is granted, unticked is removed. Kept-if-held and
  refused-if-gained applies to platform keys INSIDE A TENANT only. Not-in-use
  keys follow R2 everywhere — which includes `platform:impersonate`, itself on
  the list, so even the platform organisation keeps it as held and cannot give
  it newly. F2 applies to every platform-org role EXCEPT Platform
  Administrator, which R1c freezes everywhere (CC-93).
- The rule lives in ONE file, `foundation/roles/permission-grantability.ts`,
  read by the role save, `createRole()` and the transition writes (F1).

### F1 — a transition may not require a key no role can be given (PR A, CC-92)

- `POST workflow-templates/transitions`, and `PATCH …/transitions/:id` when
  `requiredPermission` CHANGES, refuse: an unknown key (400
  `PERMISSION_UNKNOWN`), a platform key inside a tenant (400
  `PLATFORM_PERMISSION_NOT_ALLOWED`), a key nothing checks yet (400
  `PERMISSION_NOT_IN_USE`). Null or blank is always allowed.
- A transition that already holds such a key keeps it through any other edit,
  and when the editor sends the same key back. The ACC-55 warning still
  reports on such keys. **This reverses ACC-55's "report, never reject" for a
  key a person picks**; `seedTemplates()` writes directly and still writes the
  seed's forward references.
- **The F1 SELECT (13 Oct, read only, no data changed):** in each of
  al-manara and al-nakheel, 38 transitions require a not-in-use key, and none
  requires a platform key. By workflow, identical in both: Document Request 2
  (`documents:approve` 2), Document Lifecycle 10 (`documents:review` 4,
  `documents:approve` 2, `documents:publish` 2, `documents:submit` 1,
  `documents:manage_templates` 1), Change Request 2 (`documents:approve` 2),
  Incident 4 (`incidents:investigate` 2, `incidents:close` 2), Audit 12
  (`audits:execute` 6, `audits:report` 3, `audits:close` 2, `audits:create`
  1), Meeting 8 (`meetings:manage` 7, `meetings:approve_minutes` 1). Committee
  0. Separately, 15 per tenant require a key the catalogue does not have at
  all: Corrective Action 13 (`capa:investigate` 7, `capa:approve` 5,
  `capa:close` 1) and Incident 2 (`incidents:manage`). The platform
  organisation has no workflow templates. Each tenant has 67 transitions, 65
  with a key.
- **PR B:** the transition editor's permission picker
  (`workflow-transition-editor.component.ts`, around :893–903) offers every
  key from `GET roles/permissions`. PR B filters it to `inUse` keys, and to
  non-platform keys inside a tenant, while still showing a transition's
  current key when it is not one of them, so an unrelated edit does not
  blank it.

### Tests (PR A), each with one mutation that goes red

Tenant isolation (another tenant's role: 404, nothing written, no audit row;
the lock query carries the organisation); concurrency (two saves from one
loaded set — the second gets 409); R1 and R1c refusals; R2 preservation and
refusal; empty list; audit before/after/added/removed; holder counts; the
not-in-use list against the catalogue and the code. CC-92: F1's three
refusals on create and on a changed key, the unchanged key kept (absent and
sent back), clearing allowed; F2 granting and removing a platform key in the
platform organisation, and R2 there.

## C–I (PR B, summarised from CC-90)

- **C / D7** — Organization Administrator shows the drawn read-only state
  (glyphs, no save bar) with the frozen-set sentence.
- **D** — the header says "held by N users"; the confirmation: "Applies to N
  users as soon as it's saved", plus "M of them hold this role through a head
  position" when M > 0. It never claims N people LOSE access.
- **F** — one shared frozen-cell declaration (width 300, border-box, padding,
  border, shadow, z-index) for the header corner, module rows and permission
  rows; the shadow's x-offset flips with direction (`6px` LTR, `-6px` RTL);
  rows `min-height: 44px` on the ROW, the whole cell is the control;
  `position: sticky; inset-inline-start: 0`, not `pFrozenColumn` (it writes a
  physical left); never read or write `scrollLeft`; columns never reordered;
  arrows follow the eye; a real tri-state module checkbox; Space toggles,
  Shift+Space toggles the row (D9). Heights: header 35, module row 56,
  permission row 44; width 300 + 6 × 150 = 1200, so it scrolls at 1130.
- **G** — the six outcomes and the 3c states (read-only, saving, failed, 403,
  409 "Reload role"); route `admin:access` + `roles:view`, edit
  `roles:manage`; a leave-page guard (D11). Personas: Hessa edits, Noura
  reads, a Viewer is refused by the route.
- **H** — Manage roles still lacks the drawn 403 sentence, uses three tokens
  that do not exist (literal colours), and its states were never checked live
  in Arabic: a separate small PR.
- **D10** — deferred: Keys column, "Copy from an existing role", the
  read-only list below 900px.
- **D12** — escalation filed as ACC-221.

## PR B build (14 Oct, CC-104)

Branch `feature/ACC-120-permission-matrix`, from dev at e9c7b3b.

### Files

- `backend/src/foundation/roles/dto/assign-permissions.dto.ts`:
  `expectedPermissionKeys` is REQUIRED (a missing value is 400).
- `backend/src/foundation/roles/role.service.ts`: the 409 comparison runs on
  every save. A request reaching the service without the loaded set is refused
  409 `ROLE_PERMISSIONS_CHANGED`, so it fails closed.
- `role.service.spec.ts`, `assign-permissions.dto.spec.ts`,
  `role.controller.spec.ts` and `role-permission-save.db-spec.ts`: every save
  sends the set it loaded, and a missing set fails.
- `frontend/src/app/foundation/roles/permission-matrix/`, new:
  - `permission-columns.ts`: the ONE placement function (D1), with its
    override list, its action-name rules and the fixed module order (D3).
  - `permission-matrix.model.ts`: the rows, aggregates and change counts, as
    pure functions the component reads.
- `role-permission-matrix.component.ts`, rebuilt, with its spec, plus new
  specs for the columns and the model.
- `roles.routes.ts`: a leave-page guard (D11), the app's first `canDeactivate`.
- `role.service.ts` (frontend): `assignPermissions()` sends
  `expectedPermissionKeys`, and the DTOs gain `inUse` and the two holder counts.
- `core/services/navigation-access.service.ts`: a read-only `isPlatformOrg`
  signal. D2 needs to know whether the screen is inside a tenant, and the
  service only exposed it combined with `platform:admin`.
- `styles/design-tokens.scss`: the frozen column's shadow, both directions, as
  tokens. A component carries no literal colour.
- `assets/i18n/en.json` and `ar.json`: a sentence for each of the 36 in-use
  keys, a name and description for each of their 13 modules, the column names,
  and the screen's own strings.
- `frontend/scripts/check-permission-sentences.mjs`, new, with a
  `check:permission-sentences` script in package.json. It reads the in-use keys
  from the backend catalogue and fails on any key or module that lacks either
  language.

### Where the code on dev forces a departure (none changes a D or R decision)

- **The save confirmation lists the changes.** C–I summarises it as "Applies
  to N users as soon as it's saved" plus the head-position line. Users and
  Roles 3b, the authority for this dialog, also lists "Adding n" and
  "Removing n" as "Module · sentence": at most four lines per heading, then
  "+ n more · each is ringed in the matrix". The button reads "Save n changes"
  once a list is cut off. Built as drawn, with D's two lines as the subtitle.
- **Module rows carry per-column cells.** 6a and 3a draw each module row with
  one aggregate cell per column, all, some or none of that module's keys in
  that column, hatched where it has none. A click toggles them all. Built,
  beside the module's tri-state checkbox.
- **The module row has a description line**: 6a's "Who may see, run and sign
  off committees". It is what makes the row 56 high (8 + 22 + 18 + 8). So each
  in-use module gets a name and a description in both languages, and the
  sentence scan checks those too.
- **Collapsing modules is not built.** 6a's specification mentions it, but
  neither drawing shows it, and neither does this plan. Recorded with D10's
  deferrals.
- **The Platform Administrator role is shown read-only.** Today the screen
  redirects it to `/roles`. C / D7 and R1c call for the drawn read-only state,
  with a frozen-set sentence of its own.
- **The transition editor's picker (F1's PR B item) came second (CC-105).**
  CC-104 step 0 stopped on the remote branch `feature/ACC-120-field-reveal`,
  which changes `workflow-transition-editor.component.ts`. It is a leftover:
  its one change to the file is already on dev from PR #123 (1a6103f), and the
  branch is left as it is.
  - The picker now offers only in-use keys, and no platform key inside a
    tenant.
  - Edit also shows the transition's OWN current key when it is not one of
    those, in a last group: "Can't be granted yet" (in the catalogue) or "Not
    a defined permission" (not in it). An unrelated edit sends it back
    unchanged.
  - This replaced ACC-55's rule of offering every transition's unknown value
    in both dialogs. Under F1 that would let a person pick another
    transition's ungrantable key and be refused.
  - Add offers no such key at all.
- **Module order (D3)** is this plan's table order: tenant, org, users, roles,
  lookups, workflows, tasks, committees, notifications, meetings, documents,
  standards, audits, incidents, billing, reports, positions, setup, kpi, admin,
  platform. Unknown modules come after, in catalogue order.
