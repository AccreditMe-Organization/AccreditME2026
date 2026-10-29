# ACC-120 slice 11: organisation structure, plan

**Status:** BUILT — merged as #196 (6e93a52), 20 Oct (PR A); #202 (6d315ce), 20 Oct (PR B); #203 (6a1d728), 21 Oct (PR C); #206 (954f1a3), 23 Oct (PR D); #208 (3336c6e), 24 Oct (PR E); #211 (c1a86ff), 24 Oct (PR F).

When written: plan only. No code, no commits, no database writes. Written 19 Oct 2026 against `origin/dev` at `5ca8065`.

## The surfaces

- `/organization`, the tree.
- `/organization?view=chart`, the chart: a new tab on the same page.
- The org unit record page, which is new.
- The Add / Edit unit dialog.

## Sources

- **The drawing:** `frontend/design-reference/AccreditMe Organization Structure.dc.html` (Rev 2, 27 Sep). It was read in full; references below are "OS L…".
- **Headship:** `AccreditMe Head Management.dc.html`, the ACC-133 design (references "HM L…"). ACC-133's Linear description carries the state matrix and the build gates.
- **The code:** read on `5ca8065`, with file:line given throughout.
- **Measurements:** taken on local dev as Hessa, in English and Arabic, at 1280 and 390 wide. Nothing was saved.

---

## 0. Things to know first

1. **ACC-133 is still in Backlog.** The six-state Headship panel, its Appoint head and Appoint successor dialogs, and its confirms are **not built**. Today's `org-unit-head-panel` is the older three-state panel:
   - handover in progress;
   - vacant, with an inline assign form;
   - held, with an inline handover form.

   The prompt says "reuse them, don't redraw them". There is no ACC-133 panel to reuse yet. That makes decision **D2** the biggest decision in this slice.

2. **ACC-135 has landed** (`Committee.orgUnitId` is required, `schema.prisma:1864`). So the parts of the drawing gated "until ACC-135" are now **in scope**:
   - the chart's "Show committees" switch;
   - the record page's Committees panel;
   - the `committees` field in the chart response.

3. **`OrgUnit.sortOrder` exists** (`schema.prisma:873`) and is already the first sort key (`organization.service.ts:36`, `:48`). ACC-138 is about how it gets written:
   - append on create;
   - a reorder endpoint.

   The drawing calls these B-ORD-1 and B-ORD-2. ACC-138's own description says slice 11 ships without them: Move up and Move down are absent, and the dialog doesn't promise "last".

4. **Lane B has nothing in flight here.**
   - `D:/Accredit-me-2` is clean on `fix/ACC-246-committee-type-placeholder`. Its 4 commits touch only committees, i18n and SYSTEM-REFERENCE.
   - No unmerged branch adds anything to `organization/`, `OrgUnit`, `OrgUnitHeadAssignment` or `OrgPosition` that isn't already on dev. Every org-touching branch is an already squash-merged source branch.
   - The one branch that hasn't landed, `feature/ACC-239-committee-change-request-backend`, touches no org files.
   - No plan file mentions ACC-131, ACC-133 or ACC-138.
   - ACC-246 is the Edit committee "Committee Type shows its placeholder" bug I reported in ACC-237.

5. **No migration is needed for this slice.** Every chart field computes from existing columns (§2). The one change that would need a migration is B-ORD-1 / B-ORD-2 (renumbering existing siblings), and that belongs to ACC-138, not this slice.

---

## 1. Inventory: drawing against code

### 1a. `/organization`, the tree

**Today:**
- `org-unit-tree.component.ts` (307 lines) is a PrimeNG `p-treeTable`, every node expanded (`:300-306`).
- **Columns:**
  - Name, 45%, shown as "nameEn (nameAr)";
  - Code;
  - Type: the **legacy free-text `type` key**, so it reads "organization", "department";
  - Status: a hard-coded English "Status" header and "Active"/"Inactive" chip (`:58`, `:75`);
  - four icon buttons: add child, edit, head, deactivate.
- The buttons carry only tooltips, no accessible names (`:85-123`).
- **Deactivate calls the API with no confirm**; a TODO sits at `:261`.
- No search, filter, keyboard support or breakpoint.
- **Measured at 1280:** the "Active" chip runs into the edit button, and the add-child button isn't visible.
- It has no record page link and no tabs.

| Drawing (OS) | Today | To build |
|---|---|---|
| **Header:** breadcrumb "Administration › Organization Structure", title, the count "21 units · 4 levels", Add unit, Tree / Chart tabs (L49-62) | title and Add unit only | the count, and the tabs with the tab kept in `?view=` |
| **Toolbar:** search (300px; ancestors kept and dimmed, matches tinted), multi-value Type filter including "(No type)", "Show deactivated", "N units match · shown with M ancestors", Expand all (L63-71, L530) | none | all of it, client side over the loaded tree |
| **Columns:** Unit (2.4fr) · Type (104px) · Head (1.4fr) · People (64px) · Attention (120px) · ⋯ (40px) (L74-75). Below **900px of content width**, Type and People are dropped (L45) | Name / Code / Type / Status / buttons | the new columns. **No code column**; Code moves to the record |
| **Unit cell:** a link to the record; the reader's language on top, the other language below it at 12.5 muted, `unicode-bidi: isolate` (L82-84, L533) | "nameEn (nameAr)" in one line, no link | the two-line bilingual name and the link |
| **Head cell:** a relation link plus a meta line ("Director", "Away · Dr. Huda covering", "+ incoming …", "Acting"); "No head" muted (L88, L537, L503) | absent | needs head data per unit (§2) |
| **Attention:** one severity chip from Setup health, empty on most rows (L535) | absent | needs open `SetupCondition` rows per unit (§2) |
| **Status:** Active shows no chip; deactivated units are hidden unless shown, then a grey dot and "Deactivated", with no edit link (L535) | always a chip | as drawn |
| **Order:** sortOrder, then name. **No column sort, no `aria-sort`** (L531) | sortOrder, then name | nothing. Note this deliberately departs from the "sort by header" rule for lists: a tree is ordered by its structure, and the drawing says so |
| **Paging:** none. Collapsed to level 2, expand state kept per user, no virtual scroll (L532) | fully expanded | level-2 default plus a per-user expand state (**D9**) |
| **Row ⋯:** `am-row-menu` "Actions for {unit}". Groups Unit / Headship / View / Deactivate: Open unit · Add sub-unit · Edit · [Move up/down: hidden until ACC-138] · Headship items for the state · Show on chart · Deactivate… (L99-104, L518-527, L536) | four icon buttons | the menu |
| **Headship items:** "ACC-133's six state-derived labels" (L507) | inline forms in the head panel dialog | see below; this is **D2** |
| **Deactivate confirm:** 420 wide, "Deactivate Outpatient Pharmacy?" / "It disappears from pickers, the chart and new assignments. Its history stays." / "This can't be undone here…" (L117-128) | no confirm | `AmConfirmService.ask` (destructive) |
| **Refused:** the same dialog lists blockers as 44px rows (count, sentence, link: "Show in tree" / "Show in Users") (L131-148) | 409 with English strings `blockers: string[]` (`organization.service.ts:564-615`) | **backend:** a structured refusal with codes and counts (§5, PR B) |
| **Keyboard** | PrimeNG defaults | **The drawing gives no keyboard spec for the tree.** `role=tree` is the **chart's** (L577). The tree's only keyboard note is that Move up/down is the keyboard path for reorder (L531). The plan keeps `p-treeTable`'s treegrid semantics, makes the row ⋯ reachable, and asserts it in a spec |

**The six vs seven labels.** The Head Management matrix has **six states** and **seven action labels** (HM L693, L697-702; ACC-133 description):

| # | State | Actions |
|---|---|---|
| 1 | Vacant | **Appoint head** · Arrange cover |
| 2 | Vacant · covered | Appoint head · End cover |
| 3 | Held | **Appoint successor** · Arrange cover · Vacate |
| 4 | Held · covered | End cover · Appoint successor · Vacate |
| 5 | Held · successor | Start new head today · Withdraw appointment (no primary) |
| 6 | Held · covered · successor | Start new head today · Withdraw appointment · End cover |

The seven labels are: Appoint head, Appoint successor, Start new head today, Withdraw appointment, Vacate, Arrange cover, End cover. "Six" in OS L507 counts the states, not the labels. The menu shows at most three headship items. I read OS L536's "eleven in total" as 10 actions plus the group header.

### 1b. `/organization?view=chart`, the chart

**Nothing exists today.** The only trace is one i18n string, `en.json:1580` "unitUntyped".

**Toolbar:**
- "Showing from <root>" as breadcrumb links.
- "· 4 levels · shows the administrative reporting line only".
- A "Show committees" switch, now in scope because ACC-135 has landed.
- Zoom out, Fit, Zoom in, and Print… (L161-172).

**Layout:**
- `minmax(0,1fr) 280px` (L174).
- The chart area scrolls sideways.
- A **280px docked side panel** sits outside the scroll area (L218-233). It shows the selected unit: names, Head, "Positions · N people" with rows, and the buttons Open unit / Show chart from here / Find in tree.

**Boxes** (L569):
- **Levels 1–2:** 210 × 96.
- **Level 3:** 180 × 84.
- **Level 4:** 180 × 84, or 180 × 118 with the "N sub-units below · show from here" button (a 27px full-width button).
- **Arabic:** +4px per text line, and 190 wide.
- **Spacing:** connector stubs 1 × 14px, sibling gaps 20 / 14px.
- **Selected:** a 2px border.
- **No head:** a dashed avatar.
- **Colour** means attention only (L573).

**Behaviour:**
- **Depth:** 4 levels from the current root. Level-4 boxes with hidden children show the button, which re-roots the chart; its count is `childCount` (L570).
- **No menu on boxes:** the chart is an inner scroll container, so no overlay can open inside it (L571).
- **Keyboard:** `role=tree`, one tab stop; arrows move in visual direction, mirrored in RTL; Enter selects; Shift+Enter re-roots (L577).
- **Print:** A3 landscape (A4 at 24 boxes or fewer) with a provenance footer (L576).
- **Empty cases** are drawn in L574.

**Library:**
- Test `p-organizationChart` against behaviours **B1–B9** (L596-605): template, RTL connectors, subtree root, keyboard, selection, collapse, zoom, print, and about 150 boxes measured.
- The fallback is our own component (L300).
- This is **D3**.

### 1c. The org unit record page

**Nothing exists:** there's no `/organization/:id` route (`organization.routes.ts:3-11`) and no frontend `getById` (the backend has one, `organization.controller.ts:40`).

**Header (L312-332):**
- A breadcrumb of all ancestors.
- Name at 28px, the Arabic name at 17px.
- "Department · `PHARM` · active".
- Edit, Add sub-unit, and ⋯.
- A relation row: Parent unit · Head · Acting head, each with its state as text.

**Setup health strip (L334-338, L625):**
- The highest open condition, with its date and a Fix link.
- "+ N more" opens Setup health filtered to this unit.
- No strip when nothing is open.
- Admin only.

**Panels, a sibling of the Committee record** (L339, L627), in order:

| Panel | Rule |
|---|---|
| **Headship** | The ACC-133 panel "as designed". It isn't built; see **D2** |
| **Sub-units** | Direct children only, each with its type, head and count; "Show in tree" |
| **People** | Primary unit = this unit; grouped by position when there are more than 10 |
| **Positions in use** | Derived from People; absent when People is empty |
| **Committees** | Owned by this unit, with their stage |
| **History** | AuditLog and OrgUnitHeadEvent rows, newest first. ACC-133 says **not to reconstruct headship history** from the audit log, and puts the Headship history switch in ACC-131 (HM L582). This is **D8** |

Two more notes:
- **The drawing shows no capped panels and no "See all" (L611-620).** The record page should still follow ACC-230's rule that every capped record panel uses `am-capped-panel` (5 rows, fixed height, See all). A large unit (People 31) would otherwise grow the page. This is **D10**.
- **Deactivated units:** the header reads "Deactivated <date> by …", with no Edit, no Add sub-unit, and no headship actions. One line explains there's no reactivation (L628). There is **no reactivate endpoint** (`organization.controller.ts`).

### 1d. Add / Edit unit dialog

**Today:**
- `org-unit-form` sits inside the tree's `EditDialogComponent`, size `form`: 560px wide, body capped at 420.
- **Fields** (`form.ts:55-169`):
  - Name EN, Name AR, Code (required, auto-filled from the name), Parent (OverlaySelect, hierarchy mode, own subtree excluded), Type (lookup, retired types handled), Description;
  - **Sort Order** as a number input, with a hard-coded English label.
- **Not on the house pattern:** no `am-field`; Save and Cancel sit **inside the body**, not the footer; dirty state isn't passed to the dialog.
- **Two validation mismatches with the server:**
  - **Length:** the client allows a 20-character code (`form.ts:304`); the server refuses more than 10 (`create-org-unit.dto.ts:27`).
  - **Characters:** the client allows `_`; the server refuses it (`:28`).

**Measured body heights against the 420 cap.** The body scrolls every time, by 221–270px:

| | EN 1280 | AR 1280 | EN 390 | AR 390 |
|---|---|---|---|---|
| Add unit | 641 | 670 | 641 | 670 |
| Edit unit | 661 | 690 | 677 | 690 |

**The drawing** (L377-394, L631-638):
- **Fields:**
  - a two-column Name · English / Name · Arabic row, swapped in Arabic;
  - a two-column row of Code (monospace, auto-uppercased, max 10 with a counter, helper text) and Type;
  - Parent unit (hierarchy, with the cycle reason in the option's accessible name);
  - Description, optional (1000, counter turning amber from 900).
- **No sortOrder field.**
- **Footer** actions.
- **Titles:** "Add unit", "Add sub-unit to {unit}" (parent prefilled), "Edit {unit}". Changing the parent in Edit shows "Moves {unit} and its N sub-units".
- **Drawn arithmetic:** 382 EN / 402 AR, so it fits **without steps**.
- **`isCodeLocked` is never set anywhere,** so the locked state isn't shipped as a tested state.

**Proposal:**
- Build to the drawing; **no steps**.
- Prove it with a layout spec in both languages at 1280 and 390.
- The fit gate is body ≤ 420 with at least 10px spare in Arabic, following ACC-120's "too close isn't a pass" rule.
- If the Arabic or 390 measurement misses, step on the drawing's own seam: what the unit is (names, code, type), then where it sits (parent, description). At 390 the two-column rows are 2 × ~163px; measure before deciding.

---

## 2. The chart endpoint

**Contract (OS L280-287, L580-594):** `GET /organization/units/chart?rootId=&depth=4`, returning `{ root: { id, path[] }, nodes[], asOf }`.

**Each node carries:**
- `id`, `parentId`, `depth` (0–3, relative to the root);
- `nameEn`, `nameAr`, `code`;
- `type`;
- `sortOrder`;
- `childCount`;
- `heads[]` and `acting`;
- `headcount`;
- `positions[]`;
- `committees`;
- `attention`.

### Field by field

| Field | Schema support | How it's computed |
|---|---|---|
| `root.path` | `OrgUnit.parentId` (`:834`); no path or closure table | Load the tenant's units once (`orgUnit.findMany({ where:{organizationId} })`, the query `getTree` already runs at `organization.service.ts:34-37`). Walk `parentId` up from `rootId` in memory, **with a visited-set guard**: `update()` only refuses a unit being its own parent (`:471-473`), so a cycle is reachable today. A `rootId` in another tenant gives the identical 404 |
| `depth` | none stored | BFS from the root over a parent→children map, stopping at `depth`; capped at 4 |
| `type` `{valueId,label,isRetired}` | `typeValueId` FK (`:869`); "retired" is computed, not stored | Reuse `buildTypeResolver` (`organization.service.ts:282-324`, 2 queries), moved to a shared helper. The **label is resolved for the reader's language**, so the endpoint needs the request's language, or returns both labels and the client picks (simpler and cache-friendly; recommended) |
| `sortOrder` | `:873` | As stored; siblings ordered by sortOrder, then nameEn, as getTree does |
| `childCount` | none stored | From the in-memory map: **active** direct children, including those below the cut-off (the drawing's rule; matches deactivate's blocker at `:567`) |
| `heads[]` `{userId, names, position names, role: substantive \| incoming, countedHere}` | the holder rule: `positionId` → `isUnitHeadPosition` + `primaryOrgUnitId` + ACTIVE; `OrgUnit.pendingHeadUserId` (`:881`) | One batched `user.findMany({ organizationId, status:'ACTIVE', primaryOrgUnitId:{in:ids}, position:{ isUnitHeadPosition:true, isActive:true } })`. The same filter is in `sla-monitor.processor.ts:287-297` and `resolveActingHeadForOrgUnit` (`organization.service.ts:102`). `role='incoming'` when `id === pendingHeadUserId`. **`countedHere` is always true for substantive heads**, because the holder rule requires `primaryOrgUnitId = unit`. The drawing's "from OrgUnitHeadAssignment" (L586) doesn't match the code: substantive headship is still derived from the position (`schema.prisma:1001-1006`; `SUBSTANTIVE` rows aren't written) |
| `acting` `{userId, names, reason, validTo}` | `OrgUnitHeadAssignment` (`:995-1069`), `kind=ACTING` | One batched `orgUnitHeadAssignment.findMany({ organizationId, orgUnitId:{in:ids}, kind:'ACTING', endedAt:null, validFrom:{lte:now}, OR:[{validTo:null},{validTo:{gt:now}}] })` with the user, the same window as `task-authority.service.ts:190-198`. **Never `OrgUnit.actingHeadUserId`** (the cache, `:897-910`). `countedHere` for an acting head is `user.primaryOrgUnitId === unit`. Acting is the case the flag exists for: `assignActingHead` accepts anyone active in the tenant (`org-unit-head.service.ts:617-622`) |
| `headcount` | `User.primaryOrgUnitId` (`:553`), indexed (`:635`) | `user.groupBy({ by:['primaryOrgUnitId'], where:{ organizationId, status:'ACTIVE', primaryOrgUnitId:{in:ids} } })`, the same semantics as deactivate's blocker (`:575`) |
| `positions[]` `{positionId, names, count, isUnitHeadPosition}` | `OrgPosition` has **no unit FK** (`:1147-1174`) | "Positions in a unit" can only mean positions held by its people: `user.groupBy({ by:['primaryOrgUnitId','positionId'], … positionId:{not:null} })` plus one `orgPosition.findMany` for names. Precedent: `task-assignment.service.ts:109-122`. "Sorted by grade then count": grade is on OrgPosition. **Lazy**, per the drawing: only the side panel reads it. See the split below |
| `committees` `{count, items[{id, names, stage}]}` | `Committee.orgUnitId` required (`:1864`), indexed (`:1895`) | `committee.groupBy({ by:['orgUnitId'], where:{ organizationId, isActive:true, orgUnitId:{in:ids} } })` for counts. Items are lazy, with the stage from the workflow instance as `listCommittees` reads it. A separate permission applies (see "Access inside the response") |
| `attention` `{code, severity, flagDate?}` | `SetupCondition` (`objectId`, `type`, `severity`, `clearedAt`, `schema.prisma:1789-1809`); unit types are `ORG_UNIT_WITHOUT_HEAD`, `ORG_UNIT_WITHOUT_TYPE`, `ACTING_HEAD_OPEN_ENDED` (`setup-health.service.ts:28-54`) | One `setupCondition.findMany({ organizationId, clearedAt:null, objectId:{in:ids}, type:{in:[…unit types]} })`, keeping the highest severity per unit. **Returned only to callers with `setup:view`**, because it's the admin's fix list (OS L448) |
| `asOf` | n/a | Server time |

### Cost

About **8–10 queries per load**, none per node, all independent once the unit list is loaded (run with `Promise.all`):
- **Units:** 1, tenant-wide, as getTree already does; at 300 units that's cheap.
- **Types:** 2.
- **Heads:** 1.
- **Acting:** 1.
- **Headcount:** 1.
- **Positions:** 1 groupBy + 1 names.
- **Committees:** 1.
- **Setup conditions:** 1.

### The split

1. **`GET /organization/units/chart?rootId=&depth=`** returns the window with everything except `positions[]` and committee items.
2. **`GET /organization/units/:id/summary`** returns, for one unit:
   - `positions[]`;
   - committee items;
   - the people list for the record page;
   - the record header data.

   That's the side panel's and the record's lazy half, again with no per-node queries.

### The tree uses the same read model

The tree also needs heads, headcount, attention, the resolved type and childCount. The plan is to serve it from the **same service**: `GET /organization/units/structure`.
- It returns all units: active, and inactive for "Show deactivated" only when `org:manage`.
- It uses the same node shape, without `depth`.

So "who is head" is computed in one place for the tree, the chart and the record.

### Where it lives

A **new `org-structure.service.ts`** (a read model) next to `organization.service.ts`:
- `organization.service.ts` is about 700 lines of write logic: create, update, deactivate, vacancy.
- The read model's batched queries and in-memory tree are a different job.
- It would import the type resolver; `buildTypeResolver` moves to a small shared file both use.
- **Controller order matters:** `@Get('chart')`, `@Get('structure')` and `@Get(':id/summary')` must sit **above** `@Get(':id')` (`organization.controller.ts:40`).

### Tenant-isolation tests

Each named exactly `should NOT return records belonging to a different tenant`, one per query:
1. **Units:** a unit and a `rootId` from org B are invisible, with the identical 404 for a foreign `rootId`.
2. **Type values:** B's tenant-own `org_unit_type` values aren't resolved for A.
3. **Head holders:** B's users with a head position aren't heads in A.
4. **Acting:** B's `OrgUnitHeadAssignment` rows are ignored.
5. **Headcount:** B's users don't count.
6. **Positions:** B's positions and holders are excluded.
7. **Committees:** B's committees aren't counted.
8. **Setup conditions:** B's conditions aren't attention.
9. **`:id/summary`:** a unit id from B gives the identical 404.
10. **History endpoint**, if D8 builds it: B's AuditLog and OrgUnitHeadEvent rows are excluded.

**Also:**
- A real-database spec (`npm run test:db`, the ACC-194 harness, which refuses non-local databases) for the BFS, the depth cut-off and the cycle guard.
- **Mutation-checked:** remove `organizationId` from each `where`, and the matching test goes red.

### Access inside the response

The endpoints read with `org:view`, but the response would reveal data other permissions guard today:
- **Names of heads and acting heads:** person names are `users:view` data (`user.controller.ts:30`).
- **Headcount and positions:** `positions:view`.
- **Committee names:** `committees:view` (`committees.controller.ts:39`).

There's a precedent for showing a qualifier only to a viewer entitled to the record it names: `delegation-label.service.ts:68-69` (ACC-101). This is **D7**.

---

## 3. Access

**Today:**
- The nav item `organization` (`nav-items.ts:203-209`) needs `org:view`, inside the Administration group, which needs `admin:access` (`:162-169`).
- So the route needs `['admin:access','org:view']` (`:417-439`; `permission.guard.ts:70`).
- **QUALITY_MANAGER, VIEWER and READ_ONLY_ADMIN hold `org:view`** (`role.seed.ts:88`, `:176-177`, `:235-238`).
  - The quality manager is redirected to /home. `org:view` gives no surface (OS L505).
  - READ_ONLY_ADMIN also holds `admin:access`, so it sees the page read-only.
- **The endpoints already accept `org:view`** (`organization.controller.ts:29-41`; `org-unit-head.controller.ts:30`).

### Options

**A. Keep it admin-only.**
- Changes nothing in the route guard, nav item or endpoints.
- The chart stays an admin screen.
- This contradicts the drawing's settled decision (L671).

**B. The drawing's decision: one page, two permission shapes.**
- Admins keep `/organization` under Administration.
- `org:view` holders without `admin:access` get a **read-only** page outside Administration, with its own nav entry. Every write and every Setup health prompt is absent, not disabled (§6 of the drawing, L409-451).
- **Route guard:** `/organization` must stop requiring `admin:access`. The nav model derives route permissions from the item and its group (ACC-79's one source), so two items can't share one path. Choose one:
  - **(B1)** a separate path for the read-only entry, e.g. `/org`, with the same component and a `readOnly` mode from route data;
  - **(B2)** let one route accept either shape: a nav-model change, so a path can be reached from either group.
- **Nav:** a second item, "Organization", in a non-admin group (Quality management), shown only when the user lacks `admin:access`.
- **Endpoints:** unchanged for reads. The new chart / structure / summary endpoints are `org:view`, with the D7 rules inside. Writes stay `org:manage`.

**C. Move the single item out of Administration** for everyone, gated only on `org:view`.
- Write affordances show by permission.
- **Route guard:** `org:view` only.
- **Nav:** one item moves group.
- **Endpoints:** unchanged.
- Simplest, but admins lose it from Administration, and the breadcrumb changes for them.

### Recommendation

**B with B1:**
- It's the drawing's settled shape.
- The separate path keeps ACC-79's "the nav model is the single source" intact, without teaching the model that one path has two parents.
- One component reads a route flag, and the write affordances are gated by permission anyway (ACC-123's "every write is gated").

**This is decision D1, for Ahmad.**

---

## 4. Depth: testing the "N sub-units below · show from here" button

Both tenants are 4 deep, so the button never renders on dev data (OS L506 asks for a depth-5 seed before shipping). **Without seeding the shared database:**

1. **Backend unit spec (mocked Prisma):** a 7-level fixture. It asserts:
   - depth stops at 4;
   - `childCount` on a level-4 node counts children below the cut;
   - re-rooting from that node returns the right `root.path`;
   - inactive children aren't counted;
   - a cycle doesn't loop.
2. **Real-database spec** (`npm run test:db`, local and CI Postgres only, refuses anything else): the same 7-level tree is created in the ephemeral test database and torn down. It proves the queries, not just the mapping.
3. **Frontend component spec** with a depth-6 fixture. It asserts:
   - the level-4 box is 118px with the button and 84px without;
   - its row takes the tallest height;
   - the button re-roots and the "Showing from" path becomes links;
   - Shift+Enter does the same from the keyboard.
4. **Browser check without any data:** Playwright intercepts `GET /organization/units/chart` locally and returns a depth-6 response built from the real tree, then measures and clicks the button. Nothing is written anywhere.

**Not recommended: a local throwaway branch with seeded units.** The local backend writes to the **shared** Supabase database, so a branch isolates code, not data. It would put units into al-nakheel or al-manara that the deployed app also reads.

**Recommendation:** 1 + 2 + 3 + 4. If Ahmad wants a real depth-5 branch on dev data for demos, that's a lane B data script, run once and recorded. That's **D11**.

---

## 5. The PRs

Each is titled "… — part of ACC-120", and each merges on its own. **The order:** A first, B next, then C, D and E. C, D and E depend only on B and are otherwise independent.

### PR A: "Organisation: the Add / Edit unit dialog — part of ACC-120"

**Frontend:**
- `org-unit-form.component.ts`, rebuilt to the drawing:
  - `am-field` on every field;
  - the two-column rows;
  - actions in the `EditDialogComponent` footer;
  - `[dirty]`;
  - the three titles;
  - code max 10, the pattern without `_`, and the counter;
  - Description counter, amber from 900;
  - the parent picker greying this unit and its descendants, with the reason in the accessible name;
  - "Moves X and its N sub-units" when the parent changes.
- `org-unit-tree.component.ts`: only the dialog wiring.
- `en.json`, `ar.json`: the new keys.
- **Removes:** the Sort Order field and its hard-coded label.

**Backend** (no migration):
- `organization.service.ts` `update()`: **refuse a parent that is one of the unit's own descendants**, with a code (`ORG_UNIT_PARENT_CYCLE`).
- `create()` / `deactivate()`: return the resolved `typeValue`. Today they return null (`:427`, `:562`, `:635`).
- `sortOrder` stays on the DTO, unchanged, for ACC-138 to decide.

**Tests:**
- form spec, updated;
- a new `org-unit-form.layout.spec.ts`: body ≤ 420 with at least 10px spare, in EN and AR, at 1280 and 390, for Add, Add sub-unit and Edit;
- a service spec for the cycle refusal, plus a tenant-isolation test on the new descendant read;
- mutation checks.

**Browser:** Add / Add sub-unit / Edit, opened and cancelled, in EN and AR at 1280 and 390, with body heights measured and nothing saved. One create and one edit on a **throwaway unit**, then deactivated. That needs Ahmad's OK, because units can't be deleted or reactivated (**D12**).

### PR B: "Organisation: one read model for the tree, the chart and the record — part of ACC-120"

**Backend:**
- **New `org-structure.service.ts`:** the structure, chart and summary reads (§2).
- `organization.controller.ts`: three GETs above `:id`.
- **A shared type-resolver file.**
- **Deactivate's refusal becomes structured:**
  - `{ code:'ORG_UNIT_HAS_DEPENDENCIES', blockers:[{ code:'ACTIVE_CHILDREN'|'ACTIVE_USERS'|'ACTIVE_COMMITTEES', count }] }`;
  - `message` is kept for old clients.
- **Optional,** if Ahmad agrees (**D13**): fix `getHeadStatus`'s holder query to filter `position.isActive` as every other resolver does (`org-unit-head.service.ts:64-72` vs `organization.service.ts:102`).

**Frontend:** `org-unit.service.ts`: the new methods and DTOs. No screen change.

**Tests:**
- the 10 tenant-isolation tests in §2;
- the depth, childCount, cycle and countedHere specs;
- a real-database spec;
- D7's visibility rules per permission;
- mutation checks.

**Browser:** none. It's API only; the responses are checked through local GETs signed in as Hessa and as a quality manager.

### PR C: "Organisation: the tree — part of ACC-120"

**Frontend:**
- `org-unit-tree.component.ts`, rebuilt:
  - the restyled `p-treeTable` and its six columns;
  - the 900px rule (from the content width, not the viewport);
  - toolbar search with ancestors kept, the Type filter with "(No type)", Show deactivated, the match count, Expand all;
  - collapsed to level 2, with the expand state per user (D9);
  - the bilingual two-line name, linking to the record (the link lands with PR D; until then the name opens the record's route if it exists, otherwise plain text);
  - the Head cell meta lines;
  - the Attention chip, admin only;
  - the page count "N units · N levels";
  - Tree / Chart tabs in `?view=` (the Chart tab appears with PR E);
  - `am-row-menu` with the Unit / Headship / View / Deactivate groups;
  - the Deactivate confirm, plus the blockers dialog reading PR B's codes.
- **Headship items:** per **D2**.
- Removes the four icon buttons, taking `check:icon-labels` down by 4.

**Backend:** none; it reads PR B.

**Tests:**
- tree spec: search, filter, show deactivated, expand state, and headship items per state (all six);
- `org-unit-tree.layout.spec.ts`:
  - 1280 and 390, EN and AR;
  - Type and People drop below 900px of content;
  - no sideways scroll;
  - the row ⋯ inside the row's track;
  - names wrap rather than truncate;
- the deactivate refusal dialog under the 420 cap at five blockers;
- mutation checks.

**Browser:**
- in EN and AR at 1280 and 390, as Hessa;
- search "pharm", the Type filter, Show deactivated, Expand all;
- each row-menu state, opened and cancelled;
- Deactivate: the confirm cancelled, and the refused path on a unit with children (refused, so nothing changes);
- measure the 900px switch.

### PR D: "Organisation: the org unit record — part of ACC-120"

**Frontend:**
- **New `org-unit-record.component.ts`** at `/organization/units/:id`. The nav model gets the child item so the breadcrumb is ancestry (ACC-79).
- **Header:** names, type and code, the relation row (`am-relation`, as on the committee record), and Edit / Add sub-unit / ⋯.
- **Setup health strip,** admin only.
- **Panels:**
  - Headship, per **D2**;
  - Sub-units;
  - People;
  - Positions in use;
  - Committees;
  - History, per **D8**.
- The panels use `am-capped-panel` (D10).
- The deactivated state.
- **Setup health links:** the `?unit=` Fix link (`setup-health-page.component.ts:69-81`, deferred to "slice 11") now points at the record.

**Backend:**
- `:id/summary` from PR B.
- **If D8 is yes:** a `GET /organization/units/:id/history` (AuditLog and OrgUnitHeadEvent for the unit, newest first, ACC-101-style visibility), with a tenant-isolation test.

**Tests:**
- record spec: each panel's empty state and the deactivated state;
- `org-unit-record.layout.spec.ts`:
  - 1280 and 390, EN and AR;
  - panel heights fixed;
  - the strip only when a condition is open;
- the Setup health link test;
- mutation checks.

**Browser:**
- Pharmacy, a unit with no head, a leaf, and the root, in EN and AR at both widths;
- open each See all;
- follow a Fix link from Setup health.

### PR E: "Organisation: the chart — part of ACC-120"

**Step 0, a spike, reported before any build:** `p-organizationChart` against B1–B9 (L596-605).
- Use real tenant data and a 150-box fixture through the interception path.
- Measure first render and re-root.
- The result picks PrimeNG or our own component (**D3**).

**Frontend:**
- the Chart tab;
- the toolbar with "Showing from" breadcrumbs;
- boxes at the drawn sizes, plus the Arabic +4 and 190 wide;
- logical connectors;
- the 280px side panel, outside the scroll area;
- Zoom / Fit as a CSS scale;
- the keyboard tree;
- the depth-4 button and re-root;
- the "Show committees" switch;
- the empty cases;
- Print, if **D14** is yes.

**Backend:** none; it reads PR B.

**Tests:**
- chart spec: the keyboard in LTR and RTL, select, re-root, the depth-6 fixture (§4);
- `org-unit-chart.layout.spec.ts`:
  - box sizes per level and language;
  - rows level;
  - the panel at 280;
  - 1280 and 390 (at 390 the panel drops below the chart; the drawing doesn't say, so this is **D15**);
- mutation checks.

**Browser:**
- in EN and AR at 1280 and 390;
- select a box, re-root through the intercepted depth-6 response, Fit, zoom;
- keyboard through 10 boxes;
- Print preview, if built.

### PR F, only if D1 is B: "Organisation: read-only for org:view — part of ACC-120"

- The B1 route, the second nav item, and the read-only mode (every write and Setup health prompt absent).
- **Tests:**
  - guard spec: a quality manager reaches it, and a user without `org:view` doesn't;
  - an affordance-absence spec;
  - a browser check as the seeded quality manager.

---

## 6. Open decisions for Ahmad

1. **D1, access.**
   - **A:** admin-only.
   - **B:** read-only for `org:view` outside Administration, as the drawing settled.
   - **C:** one item for everyone.
   - **Recommended:** B, with a separate read-only path (B1).

2. **D2, the Headship panel and menu.** ACC-133 isn't built. Options:
   - **(a)** Build ACC-133 inside this slice, as its own PR before C and D.
   - **(b)** Embed today's three-state panel in the record and the tree's dialog, and keep the row menu to items with no dialog (End cover, Vacate, Withdraw appointment, Start new head today) plus "Manage headship…".
   - **(c)** Ship the menu and panel slots empty of headship until ACC-133.
   - **Recommended:** (a), as PR A2 between A and C. The drawing and the record both depend on it, and ACC-133 is fully specified.

3. **D3, the chart component.** `p-organizationChart` or our own? **Recommended:** decide from the B1–B9 spike in PR E's step 0, reported before building.

4. **D4, the read model.** One new `org-structure.service.ts` serving the structure, chart and summary? **Recommended:** yes.

5. **D5, labels for the reader's language.** Should the endpoint resolve labels for the request's language, or return both and let the client pick? **Recommended:** return both (EN and AR), as every other DTO does.

6. **D6, inactive units in the chart.** **Recommended:** never shown. `childCount` counts active children only.

7. **D7, names and counts to `org:view` viewers.**
   - **(a)** Show head names, headcount and positions to every `org:view` holder.
   - **(b)** Show names only to viewers with `users:view` and committees only with `committees:view`; everyone else sees "Head assigned" and counts.
   - **Recommended:** (b), following ACC-101's qualifier rule.

8. **D8, the History panel.**
   - **(a)** Build `GET /:id/history` now, with AuditLog and OrgUnitHeadEvent rows as stored.
   - **(b)** Leave it out until ACC-131.
   - **Recommended:** (a), but **without** reconstructing headship from the audit log: show the rows as recorded, with ACC-133's "No head recorded" wording.

9. **D9, where the expand state is kept.** **Recommended:** the browser's local storage, keyed by user. It's a per-viewer convenience.

10. **D10, capped panels on the record.** The drawing has none. **Recommended:** use `am-capped-panel` (5 and See all) as every record does since ACC-230.

11. **D11, depth testing.** **Recommended:** spec fixtures, the real-database spec and browser interception (§4), with no seeding. Or does Ahmad also want a depth-5 demo branch seeded by lane B?

12. **D12, live writes in the browser check.** Units can be neither deleted nor reactivated, so a live create leaves a deactivated unit behind for good. **Recommended:** no live creates; cancel only, and prove the save path with specs.

13. **D13, the head-status holder query.** It lacks `position.isActive`, so a deactivated Head position's holder still shows as head in the panel. Fix it in PR B or ticket it? **Recommended:** fix it in PR B, with a test.

14. **D14, Print.** Build A3 / A4 print with a provenance footer now, or later? **Recommended:** later, as its own ticket. The provenance rules belong with the export rules.

15. **D15, the chart at 390.** The drawing doesn't draw it. **Recommended:** the side panel drops below the chart as a full-width sheet, and the chart keeps scrolling sideways inside its own area.

16. **D16, the drawing's count mismatches.** Confirm the readings:
    - "six state-derived labels" = **six states, seven action labels**;
    - "eleven in total" = 10 actions plus 1 header;
    - "Type is a 5-option select" = **6 seeded types**, "organization" reserved for the root.

17. **D17, the code limit.** The dialog follows the server's 10 characters and no underscore. Any existing 11–20-character or `_` code is unreachable, since the server never allowed it. Confirm.

---

## Review answers (20 Oct 2026)

- **D3:** decide from the B1–B9 spike in PR E.
- **D4:** yes, a new `org-structure.service.ts`.
- **D5:** return both labels (EN and AR).
- **D6:** inactive units are never on the chart; `childCount` counts active children only.
- **D8:** build the History panel from stored AuditLog and OrgUnitHeadEvent rows only, never reconstructing headship, with ACC-133's "No head recorded" wording.
- **D9:** local storage, keyed by user.
- **D10:** `am-capped-panel`.
- **D11:** fixtures, the `test:db` spec and browser interception; no seeding.
- **D12:** no live creates or edits in any browser check; cancel only, with the save path proven by specs.
- **D13:** fix it in PR B, with a test.
- **D14:** print later, as its own ticket.
- **D15:** as recommended (the side panel drops below the chart at 390).
- **D16:** the readings are confirmed.
- **D17:** confirmed.
- **D1:** `org:view` holders without `admin:access` get a read-only page outside Administration (option B with B1, a separate path). It is built as PR F, after C, D and E.
- **D2:** build ACC-133 now, as its own PR titled "[ACC-133] …", after PR A and before C and D.
- **D7:** head names show only to viewers with `users:view`, and committee names only with `committees:view`; anyone else sees "Head assigned" and counts. Position titles show to every `org:view` holder.

### PR A, phone width (CC-125a)

- At the shell's phone breakpoint (`SHELL_PHONE_BELOW_PX`, 768, `app-shell.component.ts`), the Code helper is visually hidden (`sr-only`) and stays in `aria-describedby`; the counter stays. Beside its counter the helper wrapped in the half-width column and took the Arabic body to 425 at 390. Splitting the dialog into steps was not needed.
- The Code input no longer carries a native `maxlength`, which dropped an 11th character silently. A refused character (an underscore, an 11th character) goes in and the rule shows as the error at once, at every width.
- **Compact density**, declared on the shell: `check:dialog-density` counts six field blocks, past artboard 13's five. The drawing's "four blocks, standard density" (OS L636) counted rows. Bodies: 380 English, 394 Arabic, at 1280 and at 390. Drawing the helper at 390 still fails the 410 gate in Arabic at compact, so the phone rule stays.
- Found in the browser check: Edit opened before the units list arrived (seconds, from Frankfurt) showed the parent's placeholder and an empty picker. The parent field now shows `am-field`'s spinner until the list arrives.
- Found in the full suite: `task-authority.service.spec.ts` (decisionRecipients) read the real clock against a cover window ending 20 Oct 2026, and failed from that day. Its clock is pinned to the fixture's `NOW`; nothing else in it changed.

### PR B as built (CC-129, 20 Oct)

Branch `feature/ACC-120-11b-org-read-model`, from `dev` at `f351e74`.

**Changed since this plan was written:**
- **D13 shipped in ACC-133.** `getHeadStatus` already counts only active head positions, so PR B leaves it alone.
- **ACC-133 created `unit-headship.ts`** (`findCurrentHeadHolders`, `findRunningActingCover`), and lane B's ACC-244 builds on it. Both signatures stay as they are.

**What PR B adds to `unit-headship.ts`:**
- `headHolderWhere()` and `runningActingCoverWhere(now)`: the two filters, so every reader builds from them.
- `findCurrentHeadHoldersForUnits()` and `findRunningActingCoversForUnits()`: one query each, grouped by unit.
- The two single-unit functions now call the batched ones and return exactly what they did. With one id, the batched functions send an equality rather than `in`, so a single-unit read's `where` is unchanged.

**The read model:** `org-structure.service.ts`, with three `org:view` GETs above `:id`:
- `units/structure`
- `units/chart`
- `units/:id/summary`

`buildTypeResolver` moves to `org-unit-type-resolver.ts`, shared with `organization.service.ts`.

**Visibility (D7):**
- Person names only with `users:view`.
- Committee items only with `committees:view`; counts for everyone.
- `attention` only with `setup:view`, and absent otherwise.
- Position titles and headcount for every `org:view` holder.

**Deactivate:** refuses with `ORG_UNIT_HAS_DEPENDENCIES` and coded blockers. `message` is kept for old clients.

**No migration. No screen change.**

**Built differently from §2, and why:**
- **`countedHere` for a head is always true**, as §2 said. The holder rule requires the unit to be their primary unit, so there's nothing else to compute. Covers carry the real comparison, through the cover's own `primaryOrgUnitId`.
- **The query count is 10, not 8–10 as costed.** Prisma loads the holder's position and the cover's user as separate queries (one each, not per unit). Per call: `TenantGuard` 6, the read model 10.
- **`attention` is `{ code, severity, since, openCount }`.** §2 drew `{ code, severity, flagDate? }`. `since` is the condition's `openedAt`. `openCount` is there for the record page's "+ N more".
- **`summary` returns an inactive unit**, marked inactive, as `GET …/:id` already does, so the record page can show its deactivated state.
- **Committee items are ACTIVE committees**, the same set the count and deactivate's blocker use.
- **Spec changes the batching forced, mechanism only:**
  - two exact-`select` pins gained `primaryOrgUnitId`;
  - the cover tests mock `findMany`, not `findFirst`;
  - one isolation test now loops over the cover's `findMany` call and asserts the call exists, where it had looped over `findFirst` calls, of which there are now none.

  No assertion about results changed.

**Measured (step 8), locally against al-nakheel (21 units), read-only:**
- 16 queries per call (15 without `setup:view`); the summary 19 (18).
- `structure` 13.1 KB, `chart` from the top 13.5 KB (21 nodes), re-rooted at Microbiology Unit 1.2 KB, Pharmacy Section's summary 1.7 KB.
- 1.2–2.1 s each, from a Gulf client to Frankfurt (ACC-60).

**Every seeded `org:view` persona also holds `users:view`:** Hessa, Yasser (quality manager), Noura (read-only admin) and Nasser (viewer). So names-withheld isn't visible live; the specs prove it. `attention` was absent for Yasser and Nasser, who lack `setup:view`.

### PR C as built (CC-131, 20 Oct)

Branch `feature/ACC-120-11c-org-tree`, from `dev` at `6d315ce` (PR B merged). Frontend only.

**The tree reads `GET /organization/units/structure`** (PR B), once, with `includeInactive=true` for `org:manage` so Show deactivated is a client-side switch.

**The headship items need the unit's real status.** `deriveHeadshipState()` takes the panel's `GET …/:id/head` response, and the structure node lacks two facts it reads: a scheduled cover, and the cached `actingHeadUserId`. Derived from the node, the menu could offer Arrange cover or End cover where the server refuses. So opening a row's ⋯ reads that unit's head status (the panel's own read), and the Headship group shows once it arrives.

**One copy of the dialogs and confirms:**
- The panel's action machinery moves, unchanged, into `am-headship-actions`: the three dialogs, the four confirms, people and positions.
- The panel and the tree both host it.

**`am-row-menu` gains two opt-in options:** `groupLabels` and `openedChange`.

**Deviations from the drawing, and why:**
- **The read-only §6 has no ⋯ column,** because its name opens the record. That arrives with PR D, so a read-only viewer gets a ⋯ holding only Headship details, which replaces the crown.
- **Attention follows the response:** it shows only when the response carries it (`setup:view`). §6 drops it for every read-only viewer.
- **The Type filter** draws one chip per type, each removable (`OverlaySelectComponent` multiple, ACC-96). The drawing has a single "Type: … ✕" chip.
- **The Tree tab is a one-tab tablist.** `am-tab-strip` renders nothing below two tabs; PR E adds Chart.
- **Left out:** Open unit (PR D), Show on chart (PR E), Move up/down (ACC-138). The blockers' links are plain text until their targets exist.

**Built and measured (PR C):**
- **Layout spec (`org-unit-tree.layout.spec.ts`), EN and AR:**
  - 988 / 900px of content: all six columns.
  - 899 / 358 / 328px: Type and People dropped. At 358 and 328 the Attention column folds under the name.
  - No sideways scroll at any width, every ⋯ inside its row, and names wrapped. At 328 the longest name is 168px tall in English and 144px in Arabic.
  - The blockers dialog at five blockers: 249px English, 257px Arabic, of 420.
- **Browser, local, as Hessa (EN and AR, at 1280, 390 and 360):**
  - No sideways overflow at any width.
  - Type and People drop at 898px of content (viewport 1190).
  - The six states, intercepted, each offered exactly its actions, and every dialog and confirm was opened and cancelled.
  - The refused Deactivate was intercepted.
  - As Noura (read-only): Headship details only, and the panel showed no actions.
  - Writes that reached the server: 0.
- **Found while measuring, and fixed:**
  - the ⋯ overflowed its 40px column by 2px;
  - the 900px rule measured the bordered card, not the component;
  - a 120px Attention column left Unit a few characters wide on a phone, so below 600px it moves under the name.
- **Not changed (ACC-133's copy):** Arabic Arrange cover reads "ترتيب تغطية" in the menu and the panel, and "ترتيب تكليف" in its dialog title.

### PR D as built (CC-134, 21 Oct)

Branch `feature/ACC-120-11d-org-unit-record`, from `dev` at `6a1d728` (PR C merged).

**What the code had, and what that changed:**
- **There is no `am-relation` component.** The Design System draws the relation field (artboard 4), but nothing builds it, and the committee record renders its relations as a plain fact strip. PR D builds `am-relation` in `shared/components/relation/`, with the record-header context (C) only: a type glyph, the name (a link when the viewer may open the target), and its state as text. The tree and the chart do not adopt it in this PR.
- **The summary has no list of children.** PR B returns `childCount` only. `GET …/:id/summary` gains `children`: the unit's direct ACTIVE children, decorated by the same batched queries as the unit itself, so the query count doesn't grow per child.
- **Setup health has no per-unit filter.** "+ N more" opens `/setup-health?object=<unitId>`, which shows only that object's open conditions, with "Show all" beside the filter. `openCount` counts exactly those rows.
- **The breadcrumb took one parent record (ACC-228).** `BreadcrumbParentService` gains a trail of ancestors, so the record's breadcrumb is Administration › Organization Structure › each ancestor. Per ACC-79 it stops at the parent; the drawing's trail ends with the unit itself, and that crumb isn't built.

**History (D8):** `GET /organization/units/:id/history?skip=&take=`, `org:view`.
- **Headship rows come from `OrgUnitHeadEvent` only.** Every headship operation writes a ledger row and an audit row together (`org-unit-head.service.ts`), and the audit row holds only `metadata`. So the AuditLog rows read are the ones holding a copy of the unit (`after` set): created, details changed, moved, deactivated. Each headship change shows once, from the ledger, and the audit log is never read for headship.
- **What changed is named, never shown.** `before` / `after` are read on the server to name the fields that changed and the new parent; neither is returned.
- **Names (D7):** actor and subject names only with `users:view`; anyone else gets the person's position where there is one, and "Name hidden".
- **The deactivated header** reads its date and actor from the latest audit row that moved `isActive` from true to false. A unit deactivated with no such row says "Deactivated" and no date.

**Built and measured (PR D):**
- **Layout spec (`org-unit-record.layout.spec.ts`), EN and AR** at 988, 358 and 328px of content (the shell at 1280, 390 and 360):
  - Every capped panel is **338px in English and 376px in Arabic**, with five rows and the footer or with none.
  - Nothing is wider than the frame.
  - A 53-character unit name wraps: 108px tall in English and 120px in Arabic at phone widths, 36 / 80 at 988.
  - Three columns of panels at 988, one at 358 and 328.
- **Browser, local, as Hessa** (EN and AR, at 1280, 390 and 360): Pharmacy Section, Adult ICU (shown with no head), Microbiology Unit (a leaf), the root, and the deactivated test unit.
  - No sideways scroll anywhere.
  - The capped panels are 338 / 376 at every width.
  - The Headship panel fills its cell at 1280 and is 120–214px on a phone.
  - Every empty state says what is true.
  - The deactivated unit reads "Deactivated 29 Sep 2026 by Dr. Hessa Al-Dosari".
- **Every See all opened** (Pharmacy Section with its lists enlarged by answering its GETs). All five popups opened with focus in the search box. History loaded 20, then 23 with Load more.
- **Links:**
  - "+ 1 more" lands on `/setup-health?object=…`, which reads "Showing one unit only · Show all".
  - Setup health's Set type Fix opens the record with its Edit dialog, which was cancelled.
  - The tree's name links to the record, and Show in tree marks the row.
- **Every headship action** on Pharmacy Section and the root was opened and cancelled in both languages, as were Edit, Add sub-unit and Deactivate.
- **As Noura (read-only admin):** no Edit, no Add sub-unit, no ⋯, no headship action and no Fix, on any unit.
- **Writes that reached the server: 0.**

**Found while checking, and fixed:**
- **A Latin name in an Arabic sentence broke at its hyphen** and put the hyphen at the wrong end of the line ("…by Dr. Hessa Al-Dosari"). Names in history sentences are now isolated (FSI … PDI), as elsewhere in the app.
- **Setup health dropped `ACTING_HEAD_OPEN_ENDED` rows** (no group, no label), although the API had reported them since slice 2. They are listed now.
- **The history spec didn't type-check** under `tsc`; Jest alone had passed it.
- **A db-spec mutation survived:** dropping the deactivation lookup's "was active" half. A later edit of a deactivated unit is now in the fixture, and the mutation fails.

**Mutation checks:** 14 on the backend unit specs, 2 on the db-spec, and 26 on the frontend, each red. One frontend mutation first failed to compile and was redone with one that compiles.

**Not built as drawn, and why:**
- **The breadcrumb ends at the parent,** not the unit (ACC-79: the H1 names the page).
- **The other-language name is 16px** (`text-heading`), not 17. No 17px token exists in English.
- **The Head relation's state is the position only.** The drawing's "· away" has no field in the summary.
- **People above ten are grouped by ORDER, not headings,** so "Showing 5 of 14" counts people.
- **`am-relation` is header-only.** The tree and the committee record don't adopt it in this PR.
- **The Headship panel isn't capped.** It isn't a list.

### PR E as built (CC-137, 22 Oct)

Branch `feature/ACC-120-11e-org-chart`. #206's commits came in through a
merge (`c2c1ca6`) before it reached `dev`, then `dev` was merged in after it
did.

**D3, decided: our own component**, from the CC-136 test against B1–B9, with
real tenant data and a 150-box fixture:
- **B2, connectors:** `p-organizationChart` draws nested tables, and its
  stubs sit at column boundaries, measured up to 15px from a box's centre.
  Ours meet the centre by construction: worst 0px.
- **B4, keyboard:** its `pt` reaches only the root table, leaving 149 tables
  and 777 row and cell nodes inside the role=tree, and its toggler adds tab
  stops. Ours is one tree of treeitems with one tab stop.
- PrimeNG's timings, for the record: first render 405ms, re-root 99 / 322ms.

**Built:** everything in PR E's list above except Print (D14 is no). The
phone panel is D15: at 390 it drops below the chart as a full-width sheet.
Full mechanism: SYSTEM-REFERENCE §7.12.

**Layout spec (`org-unit-chart.layout.spec.ts`)**, EN and AR at 988, 358 and
328px of content (the shell at 1280, 390 and 360):

| | English | Arabic |
|---|---|---|
| Levels 1–2 | 210 × 96 | 210 × 112 |
| Levels 3–4 | 180 × 84 | 190 × 96 |
| A level with the "below" button | 180 × 118 | 190 × 134 |

- Every box on a level sits at the same top, within 1px.
- **Connectors, worst offset 0px everywhere:** 19 on the uneven fixture in
  each language and layout, and 179 on the 150-box chart. Each stub is read
  from its own computed position.
- The panel is 280px beside the chart, outside the sideways-scroll area. On a
  phone it is the chart area's full width (356 / 326), below the chart.
- The chart scrolls inside its own area; the page never scrolls sideways.
- **150 boxes:** first render 88ms, re-root 81ms.

**Browser, local, as Hessa and as Noura**, in EN and AR at 1280 and 390:
- **Select a box:** it stays selected; the panel lists its positions.
- **Keyboard:** 10 boxes walked across levels 2 to 4; Home returns to the
  root; one tab stop.
- **Fit and zoom:** Fit lands on the 30% minimum, because the real tree is
  that wide; at 30% it spans the area. The root stays in view after every
  zoom, in Arabic too.
- **Depth-6, intercepted:**
  - level 4 is 118 / 134 on every box in the row;
  - the button, a path link and Shift+Enter all re-root.
- **Round trips:** Open unit, Find in tree (the row marked and its name
  focused) and Show on chart from the tree.
- The real data has no open unit condition, so the attention chip appears in
  the specs only.
- **Non-GET requests:**
  - sign-in and refresh: 2 per persona;
  - everything else: 0.

**Mutation checks:** 19, each red on a failing test, none on a compile error:
keyboard 5, re-root and rows 5, connectors 4, D7 5.

**Found in the pre-PR review, and fixed:** the "Showing from" path separated its links with `›`, which points back at the ancestors in Arabic. It is a slash now, as in the shell's breadcrumb, and a spec pins it (a mutation back to the chevron fails).

**Built differently from the drawing:**
- **No positions count on the box.** The chart node has none, and this PR
  changes no backend; the panel shows the positions.
- **The Arabic box with the "below" button is 134, not 130:** the button's
  line takes the Arabic +4 too.
- **No "away" on a head:** the API has no field for it.
- **No "+ head from <unit>" note** on the box.
- **No Print** (D14).

### PR F as built (CC-140, 24 Oct)

Branch `feature/ACC-120-11f-org-read-only`, from `dev` at `3336c6e` (PR E merged).
D1 is B with B1. No backend change.

**The path is `/org`.** It isn't a reserved slug (`check:reserved-slugs`
passes; that list is subdomain labels). It clashes with no route: `org-positions`
is a different segment, and both the rail and the breadcrumb match
`route + '/'`, so `/org-positions` is never read as under `/org`.

**Built:**
- **Route:** `/org` loads the same routes with `orgReadOnly: true`, guarded by
  `orgReadOnlyRedirectGuard` then `permissionGuard` (`org:view`).
- **Redirect:** an `admin:access` holder is sent to the same URL under
  `/organization`, path and query kept.
- **Nav:** "Organization" in Quality management, `hiddenWithPermission:
  admin:access`.
- **Mode:** `injectOrgPages()` gives each page `readOnly` and its link base.
- Full mechanism: SYSTEM-REFERENCE §7.13.

**Found while building, and fixed:** the Headship panel linked a person to
`/users/:id` on `users:view` alone. A user's record needs `admin:access` too
(ACC-123), so on `/org` a quality manager would have had a link that bounces.
It needs both now, as every other person link on these pages does. No
administrator loses a link.

**Tests:**
- the guard spec through the real routes (6);
- nav (5 new, 1 updated: Yasser's org:view now shows the Quality item);
- the affordance-absence spec (7). Each write control is first proven PRESENT
  at `/organization` for an administrator, then ABSENT at `/org` for a viewer
  holding every permission but `admin:access`, `org:manage` included.

**Mutation checks:** 14, each red on a failing test:
- record: Edit and Add sub-unit, the strip, headship actions, Show in tree;
- tree: Add unit, Attention, the menu's Headship details, a name link;
- chart: chips, add-first, Open unit;
- the nav exclusion;
- the redirect;
- the panel's person link.

**Browser, local, as Yasser (QUALITY_MANAGER)**, in EN and AR at 1280 and 390:
- **Rail:** the rail holds one organisation item, "Organization", under Quality
  management; it opens `/org`; typing `/organization` lands on /home.
- **Tree:** H1 "Organization", breadcrumb "{tenant} › Quality management".
- **Row menu:** Open unit and Show on chart only. Show on chart, the chart's
  Find in tree, a name link and a sub-unit link all stay in `/org`.
- **Chart panel:** Open unit, Show chart from here and Find in tree.
- **Record:** the breadcrumb ends "… › Quality management › Organization ›
  {ancestors}", and the Headship panel shows its state row.
- **Everywhere:** no write control; no link to `/organization`, `/users` or
  `/setup-health`; no sideways scroll.
- **As Hessa:** `/org`, `/org?view=chart&root=&sel=` and `/org/units/:id` land
  on the same `/organization` URLs, and her rail has one organisation item.
- **Non-GET requests:**
  - sign-in and refresh: 2 per persona;
  - everything else: 0.

**Built differently from the drawing:**
- **The ⋯ column stays, with Open unit and Show on chart** (CC-140's rule); the
  drawing has no ⋯ column on the read-only tree.
- **The breadcrumb** is "{tenant} › Quality management", the shell's group
  trail (ACC-79), rather than the drawn "Organization".
- **No Print:** the drawing keeps it for the read-only viewer, but Print isn't
  built at all (D14).
