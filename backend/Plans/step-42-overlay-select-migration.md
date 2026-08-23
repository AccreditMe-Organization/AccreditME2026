# Step 42 — Migrate Remaining p-select Fields to OverlaySelectComponent (ACC-42 plan)

Planning document only — no implementation yet. Written after a fresh,
live-verified field inventory (26 qualifying fields, corrected twice
during review — see §3's own revision notes) and two design questions
(hierarchy-support API shape, item-template projection) resolved
below. Report reviewed before any code changes begin.

---

## 0. Standards Established During Investigation (apply forward, don't re-litigate)

**Structural-shape standard**: a field qualifies for migration based
on what kind of list feeds it and how that list grows, not its option
count in today's specific demo tenant. A field fed by a
tenant-created, naturally-growing list — org units, committees, users,
roles, or any other catalog the tenant itself populates over time — is
in scope regardless of how sparse the demo data happens to be right
now. A field's *current* count only matters for genuinely bounded
enums (`approvalMode`'s 4 fixed values, `accessLevel`'s 3) where no
realistic amount of tenant usage adds a 5th option. This is why
`primaryOrgUnitId`/`actingOrgUnitId` (~4 options today) and
`committee-form`'s `parentCommitteeId`/`reportingToCommitteeId` (0
options today — demo tenant has no committees yet) are all in scope,
while `create-tenant.planId` (~3, platform-curated, not
tenant-grown) and `public-holiday-list`'s year filter (4, deliberately
fixed at ±2 years) are not.

**Flat vs. hierarchy mode standard**: a field only needs
`OverlaySelectComponent`'s hierarchy-support mode if the picker itself
*displays* nesting (a tree, or grouped/indented options). A
self-referential field that merely *picks from* a list belonging to a
hierarchical entity — without rendering that hierarchy in the picker —
stays in flat mode. This is why `committee-form.parentCommitteeId`/
`reportingToCommitteeId` are flat-mode migrations (today a plain
`p-select` over `CommitteeService`'s committee list, no nesting
rendered) while `org-unit-form.parentId` is a hierarchy-mode migration
(already renders real parent/child nesting via `p-cascadeSelect`'s
`optionGroupLabel`/`optionGroupChildren`).

---

## 1. Hierarchy-Support Design for OverlaySelectComponent

### 1.1 Why this has to be built and proven before any hierarchical field migrates

`org-unit-form.parentId` is the only field in this app already doing
real hierarchical display today (`p-cascadeSelect`,
`optionGroupLabel="label"` `optionGroupChildren="items"`, fed by
`buildCascadeOptions()`'s recursive tree-build over `OrgUnitService.getFlat()`).
It is also — confirmed directly against `primeng-overlay.mjs` during
the ACC-42 inventory — running the exact same `ConnectedOverlayScrollHandler`
PrimeNG's shared `Overlay` component uses internally, the identical
mechanism ACC-41 fixed for `p-select`. Migrating it is real,
in-scope work, not a bonus. But it's also the highest-*design*-risk
item in this whole ticket — the only field requiring new component
capability, not just a tag swap — so it gets built and proven with its
own dedicated phase and committed tests before any other hierarchical
field (`invite-user.primaryOrgUnitId`, `user-profile.primaryOrgUnitId`,
`user-profile.actingOrgUnitId`) is migrated to depend on it. Those
three currently render *flat*, not nested — migrating them to
hierarchy mode is itself a UX upgrade, and should not launch on an
unproven mechanism.

### 1.2 API shape — mirrors `p-cascadeSelect`'s own naming exactly

Two new optional inputs on `OverlaySelectComponent`, matching
PrimeNG's own established names so `org-unit-form`'s existing
`cascadeOptions()`/`buildCascadeOptions()` tree-building logic needs
**zero changes** — only the template tag and matching input names
change:

```typescript
readonly optionGroupLabel = input<string | undefined>(undefined);
readonly optionGroupChildren = input<string | undefined>(undefined);
```

Hierarchical mode is inferred automatically from whether
`optionGroupChildren` is set — no separate boolean flag needed. Flat
mode (every existing consumer, including the two new flat-mode
migrations from §0) is completely unaffected; these inputs default to
`undefined` and change nothing when unset.

`org-unit-form`'s migration, under this design, is:

```html
<!-- before -->
<p-cascadeSelect
  formControlName="parentId"
  [options]="cascadeOptions()"
  optionLabel="label"
  optionValue="value"
  optionGroupLabel="label"
  optionGroupChildren="items"
  [placeholder]="'organization.parentUnit' | translate"
/>

<!-- after -->
<app-overlay-select
  formControlName="parentId"
  [options]="cascadeOptions()"
  optionLabel="label"
  optionValue="value"
  optionGroupLabel="label"
  optionGroupChildren="items"
  [placeholder]="'organization.parentUnit' | translate"
/>
```

`buildCascadeOptions()` itself — the recursive
`{label, value, items?}[]` builder — is not touched at all.

### 1.3 UX decision: indented flat list, NOT PrimeNG's cascading flyout panels

PrimeNG's `p-cascadeSelect` UX is a multi-panel cascade — hovering a
parent option opens a *separate flyout panel* showing its children,
each panel its own connected overlay. Replicating that literally would
mean each flyout panel needs its own `Overlay` +
`RepositionScrollStrategy` + `ScrollDispatcher` registration — N
separate instances of the exact mechanism ACC-41 built, one per
nesting level open at once. That multiplies the surface area for this
whole bug class instead of eliminating it, for a UX PrimeNG chose but
nothing in this app's actual requirement depends on.

`OverlaySelectComponent`'s hierarchy mode instead renders a **single
indented flat list inside the same one `CdkListbox`/`Overlay`**
already proven in ACC-41 — the nested tree is flattened internally
into an ordered `{ node, depth }[]` list, each row indented by
`depth * 1rem` (or similar), with no additional overlay panels
involved anywhere. This keeps `RepositionScrollStrategy`,
`ScrollDispatcher` registration, `CdkListbox`/`CdkOption`'s
`ActiveDescendantKeyManager` keyboard nav, and the Escape/backdrop
handling **completely unchanged** from the flat-mode implementation —
hierarchy mode is a rendering-and-flattening layer on top of the
already-proven mechanism, not a parallel one.

Every node — branch or leaf — stays individually selectable
(`org-unit-form`'s own use case is "pick any unit at any level as this
unit's parent," not "drill down to only a leaf"), matching
`p-cascadeSelect`'s current actual behavior for this field.

### 1.4 Implementation sketch

```typescript
interface FlattenedOption {
  node: unknown;
  depth: number;
}

function flattenHierarchy(
  options: unknown[],
  childrenField: string,
  depth = 0,
): FlattenedOption[] {
  return options.flatMap((node) => {
    const children = (node as Record<string, unknown>)[childrenField] as unknown[] | undefined;
    return [
      { node, depth },
      ...(children?.length ? flattenHierarchy(children, childrenField, depth + 1) : []),
    ];
  });
}
```

- `@for` in the listbox template iterates `flattenedOptions()` (a
  computed signal, recomputed when `options()`/`optionGroupChildren()`
  change) instead of the raw `options()` array when
  `optionGroupChildren()` is set.
- Each `[cdkOption]` row gets `[style.paddingInlineStart.rem]="0.75 + flat.depth * 1"`
  (logical property — RTL-safe, per the pr-checklist's own rule) in
  addition to its existing label rendering.
- `selectedLabel()`'s current implementation only searches the
  top-level `options()` array via `.find()` — **a real bug for
  hierarchy mode**, since a selected node's own value could be nested
  several `items` levels deep and would never be found. Fixed to
  search `flattenedOptions()` instead of `options()` when hierarchical,
  so the closed trigger correctly shows the selected node's label
  regardless of its depth.
- `getOptionValue`/`getOptionLabel` need no changes — hierarchy-mode
  nodes are always objects (never the primitive-array fallback), same
  property-lookup path already in place.

### 1.5 Phase 1 exit criteria (must pass before any hierarchical field migrates)

- Committed unit tests: flattening produces the correct depth-ordered
  list for a 3-level-deep fixture tree; `selectedLabel()` correctly
  resolves a value nested at depth 2; keyboard nav (arrows/Home/End)
  moves through the flattened list in the same visual order rendered;
  Enter selects a non-top-level node correctly; scroll-chaining and
  the OverlayRef-reuse regression test both still pass unmodified
  (proving hierarchy mode didn't disturb the flat-mode mechanism).
- A throwaway host fixture exercising a realistic 3-level tree (not
  just 2), since `org-unit-form`'s real org-unit trees can nest
  further than the demo tenant's current ~4-unit, 2-level data shows.
- `tsc` clean, existing 12 flat-mode tests still passing unmodified.

---

## 2. Item-Template Projection Support

### 2.1 Investigation — is a computed-label function sufficient? (No — verified, not assumed)

Four fields (`invite-user.managerId`, `committee-member-form.userId`,
`user-profile.managerId`, `user-profile.actingUserId`) currently
render a custom two-line "name + org unit" row per option via
PrimeNG's `<ng-template #item let-x>` projection. Before committing to
building full template-projection support, checked whether extending
`optionLabel` to accept a formatting function (one computed
disambiguating string, e.g. `"Ahmad Al-Najjar — IT Department"`) would
genuinely preserve what these 4 fields need — against the real
requirement, not an assumption either way.

**The real requirement, read directly from ACC-37's own ticket text**
(not just its terser commit message): *"all 4 pickers show only a bare
name with no disambiguating info, which is a real usability problem
whenever two users share a name — org unit should show alongside each
name **as a second visible value**, the same way `user-list.component.ts`
... already resolves and displays it today."* The ticket's own wording
distinguishes "the name" from "a second visible value" — two
structurally distinct pieces of information, not one string.

**The actual shipped markup** (`user-profile.component.ts`'s
`managerId` picker, representative of all 4):

```html
<ng-template #item let-otherUser>
  <div class="flex flex-col">
    <span>{{ otherUser.name }}</span>
    <span class="text-xs text-[var(--am-text-secondary)]">{{ orgUnitName(otherUser.primaryOrgUnitId) }}</span>
  </div>
</ng-template>
```

A genuine two-tier typographic hierarchy — normal-weight name, then a
visually subordinate smaller/muted org-unit line — not just
informational text appended to a name.

**Conclusion: a computed single-string label is NOT sufficient**, for
a real, specific reason rather than a vague preference: collapsing
this into one string ("Ahmad Al-Najjar — IT Department") flattens the
exact visual hierarchy ACC-37 was written to add, in precisely the
long, name-heavy lists (managers, OOO delegates, committee members)
where fast scanning is the entire point of showing org unit at all. A
single-line label would quietly regress an already-shipped, deliberate
decision, not merely render it slightly differently.

### 2.2 Investigation — does CdkOption support custom content? (Yes — verified against source)

Checked `@angular/cdk/fesm2022/listbox.mjs` directly for any
content-projection mechanism on `CdkOption`/`CdkListbox`
(`ContentChild`, `ng-content`, a `TemplateRef` input) — none exist.
This isn't a limitation, though: `CdkOption` is a plain *directive*
(`[cdkOption]`), not a component with its own template. It attaches
ARIA state and keyboard/click behavior to whatever host element it's
placed on and has no opinion at all about that element's inner
content — which is already fully under `OverlaySelectComponent`'s own
control inside its `@for` loop today.

One real detail this surfaced, source-verified rather than assumed:
`CdkOption.getLabel()` (used internally for typeahead matching) falls
back to `this.element.textContent?.trim()` when no explicit
`typeaheadLabel` is set. If an option's content becomes a custom
two-line template, `textContent` would concatenate *all* text nodes
inside it with no separator (`"AhmadIT Department"`), corrupting
typeahead matching. `CdkOption` already has a purpose-built escape
hatch for exactly this — its own `[cdkOptionTypeaheadLabel]` input —
so the fix is to bind that explicitly to the plain computed name
string, keeping typeahead matching against just the name regardless of
what the custom template renders visually.

### 2.3 API design

```typescript
readonly itemTemplate = input<TemplateRef<{ $implicit: unknown }> | undefined>(undefined);
```

```html
@for (opt of renderList(); track getOptionValue(opt)) {
  <div
    cdkOption
    [cdkOption]="getOptionValue(opt)"
    [cdkOptionTypeaheadLabel]="getOptionLabel(opt)"
    class="am-overlay-select-option"
  >
    @if (itemTemplate(); as tpl) {
      <ng-container *ngTemplateOutlet="tpl; context: { $implicit: opt }" />
    } @else {
      {{ getOptionLabel(opt) }}
    }
  </div>
}
```

Consumer side reuses this codebase's own established `TemplateRef` +
`@ViewChild` capture pattern (the same one `EditDialogComponent`
already requires of every caller, ACC-29) rather than inventing a new
convention:

```html
<app-overlay-select
  [options]="otherUsers()"
  optionLabel="name"
  optionValue="id"
  [itemTemplate]="managerItemTpl"
  formControlName="managerId"
/>
<ng-template #managerItemTpl let-otherUser>
  <div class="flex flex-col">
    <span>{{ otherUser.name }}</span>
    <span class="text-xs text-[var(--am-text-secondary)]">{{ orgUnitName(otherUser.primaryOrgUnitId) }}</span>
  </div>
</ng-template>
```

Fully independent of hierarchy mode — a field can be flat + custom
item template (all 4 affected fields), hierarchy + plain label
(`org-unit-form.parentId`), or any other combination; `itemTemplate`
and `optionGroupChildren` don't interact.

### 2.4 Phase 2 exit criteria (must pass before any of the 4 affected fields migrate)

- Committed unit tests: a custom `itemTemplate` renders its own markup
  instead of the plain label; the rendered option's `textContent`
  reflects the custom template's real output (proving projection
  genuinely works, not just accepts the input); selection via click
  and via Enter both still resolve to the correct `optionValue()`, not
  something derived from the custom template's own DOM.
- **Named typeahead test per affected field, not folded into a generic
  "keyboard nav" line** — direct proof `cdkOptionTypeaheadLabel`
  actually works, not just that it compiles. For each of the 4 fields
  (`invite-user.managerId`, `committee-member-form.userId`,
  `user-profile.managerId`, `user-profile.actingUserId`): typing a
  letter that appears in the rendered *name* correctly jumps to the
  matching option; typing a letter that appears only in the rendered
  *org-unit* subtitle (not in any name) does **not** incorrectly
  match anything — confirming typeahead reads the plain
  `cdkOptionTypeaheadLabel` string, not the two-line custom content's
  concatenated `textContent`. Four explicit test cases, one per field,
  not one generic case asserted to cover all four.
- **Regression exit criterion — the two ACC-41 fields, unmodified**:
  `task-form.sourceType` and `position-form.roleId` (plain-label,
  no `itemTemplate`) still pass their existing committed tests
  unmodified, *and* get a fresh hands-on hardware check by Ahmad
  after item-template support is added — scroll-chaining, keyboard
  nav, and select-and-save, same as their original ACC-41
  verification. This is the same standard hierarchy mode's own exit
  criteria (§1.5) already applies to the flat-mode regression suite —
  adding a second rendering path (`itemTemplate()` set vs. unset)
  must not disturb the simple-label case that's already proven in
  production, confirmed by hand, not inferred from the code branch
  being conditional.
- `tsc` clean, all prior tests (12 flat-mode + Phase 1's hierarchy
  tests) still passing unmodified.
- Ahmad's own hands-on hardware pass specifically on a throwaway or
  first-real-consumer instance using a custom `itemTemplate` — same
  standard as every other capability in this plan, not folded silently
  into whichever phase happens to touch `committee-member-form.userId`
  or the other 3 affected fields first.

### 2.5 Related investigation — filter-search capability (deliberately NOT built)

Found while migrating `committee-member-form.userId` in Phase 3:
its current `p-select` carries `[filter]="true" filterBy="name,email"`
— a visible search box narrowing the option list by substring match,
a genuinely different and more powerful mechanism than the typeahead
capability CDK's `ActiveDescendantKeyManager` already provides
(prefix-only match, single bound field, no visual narrowing).

**Confirmed one-field scope, not a pattern**: a full grep of
`[filter]="true"`/`filterBy=` across the entire frontend found exactly
one other match — `unassigned-tasks.component.ts`'s Reassign picker —
and that one is a `p-listbox`, not `p-select`, already confirmed
structurally immune to scroll-chaining since ACC-36 (no
connected-overlay mechanism at all) and never in this migration's
scope. `committee-member-form.userId` is the only field in the full
26-field inventory needing this.

**Confirmed significantly harder than item-template, not just "more
work"** — verified directly against PrimeNG's own filter
implementation (`primeng-select.mjs`): `autofocusFilter` defaults to
`true` (real DOM focus goes to the filter `<input>` on open, not the
listbox), and PrimeNG does not reuse any listbox-style keyboard
navigation while that input has focus — it re-implements a fully
separate keyboard handler (`onFilterKeyDown()`) for
Arrow/Home/End/Enter/Escape while focus never leaves the input. The
reason: `CdkListbox`/`ActiveDescendantKeyManager` fundamentally
assumes real DOM focus stays on the listbox or one of its options —
even its own `useActiveDescendant` mode only keeps focus on the
listbox host itself, not on an external sibling input. Faithfully
matching PrimeNG's actual UX (type in the filter box, arrow keys move
the highlight, focus never leaves the input) would mean
reimplementing navigation independent of `ActiveDescendantKeyManager`,
not composing it — the first capability in this whole component that
would have to work *around* CDK's own listbox machinery rather than
*with* it, unlike scroll-chaining, hierarchy mode, and item-template,
all of which reuse it directly.

**Decision**: migrate `committee-member-form.userId` without filter
support. Typeahead alone (already built, Phase 2) is accepted as
sufficient for this one field given its bounded list size
(`pickableUsers()` — active users minus current committee members,
not an unbounded org-wide list). A lower-fidelity alternative was
considered (ArrowDown in a filter input handing real focus off to the
listbox) but rejected as a genuine UX downgrade from PrimeNG's current
behavior, not a faithful replacement worth building for one field.
Tracked as a deliberate, documented trade-off — CLAUDE.md's Open/
Deferred Items — not a silently dropped capability, in case a future
field genuinely needs real filter support and this decision needs
revisiting with fresh eyes rather than repeating this same
investigation from scratch.

---

## 3. Full Field Inventory — 26 fields, grouped by DOM context and phase

(Restated from the corrected, live-verified inventory — see prior
investigation turns for full per-field option-count sourcing.)

### Group A — raw `p-dialog` (7 fields) — Phase 4

| File | Field | Mode | Item template? |
|---|---|---|---|
| `invite-user.component.ts` | `positionId` | flat | |
| `invite-user.component.ts` | `primaryOrgUnitId` | **hierarchy — Phase 6** | |
| `invite-user.component.ts` | `managerId` | flat | **yes — needs §2** |
| `workflow-action-configurator.component.ts` | `actionType` | flat | |
| `workflow-transition-editor.component.ts` | `toStageId` | flat | |
| `workflow-transition-editor.component.ts` | `triggerCondition` (2 template instances — Add + Edit dialogs) | flat | |
| `workflow-transition-editor.component.ts` | `triggerRoleId` | flat | |

### Group B — `EditDialogComponent` (11 fields) — Phase 3

| File | Field | Mode | Item template? |
|---|---|---|---|
| `workflow-stage-form.component.ts` | `assigneeStrategy` | flat | |
| `workflow-stage-form.component.ts` | `assigneeRoleId` | flat | |
| `workflow-stage-form.component.ts` | `assigneeCommitteeRoleValueId` | flat | |
| `committee-member-form.component.ts` | `userId` | flat | **yes — needs §2** |
| `committee-member-form.component.ts` | `roleValueId` | flat | |
| `committee-form.component.ts` | `typeValueId` | flat | |
| `committee-form.component.ts` | `meetingFrequency` | flat | |
| `committee-form.component.ts` | `reportingToRoleId` | flat | |
| `committee-form.component.ts` | `parentCommitteeId` | flat (§0 standard — structurally unbounded, not tree-displayed) | |
| `committee-form.component.ts` | `reportingToCommitteeId` | flat (same reasoning) | |
| `org-unit-form.component.ts` | `parentId` | **hierarchy — Phase 6, gated on Phase 1** | |

**Group B contains one of the four item-template-blocked fields
(`committee-member-form.userId`)** — this is the concrete reason
Phase 2 (item-template support) is sequenced before Phase 3, not
merely a general precaution: without it, Phase 3 cannot fully close
per §5.2's per-field hands-on requirement, since one of its 11 fields
would still be blocked.

### Group C — routed page under `AppShellComponent`'s `<main>` (8 fields) — Phase 5

| File | Field | Mode | Item template? |
|---|---|---|---|
| `user-profile.component.ts` | `positionId` | flat | |
| `user-profile.component.ts` | `primaryOrgUnitId` | **hierarchy — Phase 6** | |
| `user-profile.component.ts` | `managerId` | flat | **yes — needs §2** |
| `user-profile.component.ts` | `actingOrgUnitId` | **hierarchy — Phase 6** | **Re-verification target #1 — see §6** |
| `user-profile.component.ts` | `actingUserId` | flat | **yes — needs §2** |
| `user-role-assignment.component.ts` | role picker | flat | |
| `calendar-config.component.ts` | `timezone` | flat | **Re-verification target #2 — see §6** |
| `email-provider-settings.component.ts` | `emailProvider` | flat | |

**Mode totals**: 21 flat-mode migrations, 4 hierarchy-mode migrations
(`org-unit-form.parentId`, `invite-user.primaryOrgUnitId`,
`user-profile.primaryOrgUnitId`, `user-profile.actingOrgUnitId`) — 25.
Plus `workflow-transition-editor.triggerCondition`'s 2 template
instances counted as one field-row above — **26 fields / 27 template
instances**, matching the confirmed corrected total exactly. Of these,
4 fields also require §2's item-template support before their own
phase can close.

---

## 4. Phase Ordering Justification

### 4.1 Group B → Group A → Group C (revised — the original reasoning did not hold up)

The first draft of this plan claimed Group A (raw `p-dialog`) was
"lowest risk" and should go first. Rechecked directly rather than
left standing: that claim doesn't survive verification.

- **PrimeNG's `overlayAppendTo` defaults to `'self'`**, confirmed
  directly against `primeng-config.mjs` (`overlayAppendTo =
  signal('self', ...)`) and this app's own `app.config.ts`'s
  `providePrimeNG()` call, which never overrides it. `p-dialog`
  therefore stays a genuine DOM descendant wherever it's declared —
  it does **not** portal to `<body>`. That means Group A's raw
  `p-dialog` fields sit in the *same* ancestor chain up through
  `<main>` as Group C's routed pages. ACC-41's own `task-form`
  migration (Group A) already exercised that exact chain — Group A
  was never untested ground the way the original reasoning implied.
- **Group A also contains the one genuinely nested case in the whole
  inventory**: `workflow-action-configurator`'s own `p-dialog` sits
  inside `workflow-transition-editor`'s "Configure Actions"
  `p-dialog`. That's objectively more DOM complexity than Group B's
  single-level `EditDialogComponent` wrapping, which ACC-41 already
  proved via `position-form`. Calling Group A "lowest risk" while it
  contains this can't be justified.

What *does* hold up: Groups A and B each already have one real,
ACC-41-proven consumer in their exact top-level DOM shape
(`task-form`, `position-form`). Group C has zero. That's the real
basis for an ordering — not "A is simpler."

**Order: Group B → Group A → Group C.** Group B first — matches
`position-form`, ACC-41's original and most heavily-verified consumer,
no nested-dialog wrinkle. Group A second — same top-level DOM shape as
Group B, sequenced after more swap-pattern practice specifically
because it's where the nested-dialog case lives. Group C last — the
only context with zero prior validation, tackled once the pattern is
well-practiced on two already-proven shapes.

### 4.2 Where the two capability phases sit, and why

Phase 1 (hierarchy support, §1) and Phase 2 (item-template support,
§2) both sit *before* any DOM-context group, because both are gating
dependencies discovered to block specific fields inside those groups
— not general-purpose "build infrastructure first" sequencing.
Phase 2 specifically must precede Phase 3 (Group B) because Group B
already contains a blocked field (`committee-member-form.userId`) —
see the note under §3's Group B table. Phase 1 must precede Phase 6
(all hierarchy-mode fields) for the reason given in §1.1.

Phase 1 and Phase 2 are independent of each other (hierarchy display
and item-template projection touch different, non-overlapping parts of
`OverlaySelectComponent` — one changes what's iterated over, the other
changes how each iterated row renders) and could in principle run in
either order or in parallel. Sequenced Phase 1 then Phase 2 here only
because that matches the order they were investigated in this
document, not because of a real dependency between them.

---

## 5. Phases

```
Phase 1  Hierarchy-support build (§1) + committed tests
         BLOCKS: Phase 6. Does not touch any real consumer yet.

Phase 2  Item-template projection support (§2) + committed tests
         BLOCKS: Phase 3 (Group B contains a blocked field), and any
         of the other 3 affected fields in Groups A/C. Does not touch
         any real consumer yet.

Phase 3  Group B — 11 flat-mode fields, EditDialogComponent context
         Matches ACC-41's original, most-verified consumer shape
         (position-form). org-unit-form.parentId is EXCLUDED from
         this phase (hierarchy-mode, deferred to Phase 6).

Phase 4  Group A — 7 flat-mode fields, raw p-dialog context
         Same top-level DOM shape as Phase 3, sequenced second
         specifically because this is where the one nested-dialog
         case (workflow-action-configurator inside
         workflow-transition-editor) lives — tackled with the
         swap pattern already practiced once, not first.

Phase 5  Group C — 8 flat-mode fields, routed-page-under-<main> context
         The only DOM context with zero prior ACC-41 validation —
         sequenced last among the three groups, after two proven
         shapes. Includes both re-verification targets (§6) — full
         hands-on retest by Ahmad specifically for those two, not
         carried over from ACC-38's now-disproven-mechanism pass.

Phase 6  Hierarchy-mode fields (4) — GATED on Phase 1's exit criteria
         org-unit-form.parentId first (the field the design was built
         from, plus its own real-data checkpoint — see §5.4), then the
         3 currently-flat OrgUnit fields once the mechanism is proven
         on a real consumer.

Phase 7  Docs closeout
         SYSTEM-REFERENCE.md Section 10.7's "Deliberately NOT
         migrated" note removed, consumer list updated to all 28
         total consumers (2 from ACC-41 + 26 here). CLAUDE.md's
         p-cascadeSelect Open/Deferred Items note resolved — no
         longer "inconsistency," now "migrated to
         OverlaySelectComponent's hierarchy mode, see Section 10.7."
```

### 5.1 (reference) Ordering justification

See §4 above for the full reasoning behind Phase 2's placement ahead
of Phase 3, and Group B → Group A → Group C's order.

### 5.2 Phase-gate requirement — hard requirement, not a sample

Every phase's checkpoint gate is: `tsc` clean (backend + frontend),
full test suite passing, then hands-on verification by Ahmad on real
hardware.

**That hands-on verification is per-field, not per-phase.** Every
individual field migrated within a phase — scroll-chaining (mouse
wheel, including past where the old mechanism failed), full keyboard
nav (arrows/Home/End/Enter), and an actual select-and-save round trip
confirming the value persists correctly — must be individually tested
by Ahmad before that phase is considered closed. A representative
sample across a phase's fields does not close the phase, even when
every field in it shares the same component and swap pattern —
per the standing rule this bug class has followed since ACC-36,
passing on one field is not evidence for an untested one, no matter
how similar the two look on paper. Fields using a custom `itemTemplate`
(§2) additionally get that template's own rendering and typeahead
behavior checked by hand, not just scroll/keyboard/select.

### 5.3 Phase 1 and Phase 2's own exit criteria

See §1.5 and §2.4 respectively — both include their own committed
tests and their own explicit hands-on verification round, same
standard as every DOM-context phase, not folded silently into
whichever later phase happens to touch an affected field first.

### 5.4 Phase 6 checkpoint — real org-unit data, separate from Phase 1's fixture tests

Phase 1's exit criteria (§1.5) prove the flattening/`selectedLabel()`/
keyboard-nav mechanism against a synthetic, throwaway 3-level fixture
tree — necessary, but not sufficient, since a hand-built fixture can't
surface shape mismatches against what `buildCascadeOptions()` actually
produces from real data (inactive-unit filtering, the
self-exclusion-when-editing behavior, actual depth/branching in this
tenant's real org-unit tree).

Before `p-cascadeSelect` is removed from `org-unit-form.component.ts`,
as its own explicit, separate checkpoint within Phase 6:

1. Swap `org-unit-form.parentId` to `OverlaySelectComponent` with
   `buildCascadeOptions()`'s **real, live output** — no fixture, no
   mock — against the actual current tenant's org-unit data (whatever
   depth/branching genuinely exists at the time, not assumed
   beforehand).
2. Confirm the rendered indentation matches the real tree's actual
   structure (including the current tenant's inactive-unit filtering
   and self/descendant exclusion when editing an existing unit —
   `buildCascadeOptions()`'s own `excludeId` parameter).
3. Confirm `selectedLabel()` correctly resolves the currently-selected
   `parentId` value against the real tree when opening the edit form
   for a unit that already has a parent set — not just the synthetic
   depth-2 case Phase 1 already covered.
4. Only once 1–3 pass does `p-cascadeSelect`'s import and markup get
   removed from this file — until then both remain, so this checkpoint
   fails safe (reverting the swap) rather than shipping a partially-
   verified hierarchy field on the one screen already vulnerable
   today.

This checkpoint is in addition to, not a replacement for, Phase 6's
own per-field hands-on hardware pass under §5.2's hard requirement.

---

## 6. Re-verification Steps — explicit, not carried over

Both fields were marked "PASS" during ACC-38's hands-on testing, but
that testing verified `EditDialogComponent`/`AppShellComponent`'s
`onWheel()` boundary-guard mechanism — since confirmed by ACC-41 to be
structurally incapable of catching this bug class at all (a
short-enough list's `scrollTop`/`atBottom` state trivially satisfies
the boundary check on every tick, providing zero real protection).
That earlier PASS is not evidence the fields are safe; it's evidence
the mechanism being tested doesn't work, tested on fields that
happened not to expose it at the time.

- **`user-profile.actingOrgUnitId`** (Phase 6, hierarchy mode) —
  re-tested by Ahmad on real hardware only after migrating to
  `OverlaySelectComponent`. Scroll-chaining check (mouse-wheel while
  open, including past where the old mechanism failed on
  `position-form`'s Mapped Role) plus the new hierarchy-mode
  indentation/keyboard-nav behavior specifically, since this field is
  also gaining real tree display for the first time.
- **`calendar-config.timezone`** (Phase 5, flat mode) — re-tested by
  Ahmad on real hardware after migrating. Same scroll-chaining check;
  no hierarchy behavior involved (flat mode, 14 static options).

Neither is marked done until Ahmad's own hands-on pass under the
*new* component specifically — this section stays open until both are
individually re-confirmed, not closed by inference from other fields
passing.

---

## 7. What This Plan Does Not Cover

- No code has been written yet — this is a planning document only.
- Translation keys, exact Arabic copy, and any per-field template
  cleanup (removing commented-out original `p-select` markup, per
  ACC-41's own finalization discipline) are execution details for
  each phase, not re-derived here.
- `my-tasks.component.ts`'s `p-selectButton` and
  `plan-form.component.ts`'s `accessLevel` remain explicitly out of
  scope (not vulnerable / below threshold, per the inventory).
