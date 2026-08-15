# Step 29 — Shared Edit Dialog (ACC-29 fix design)

Planning document only when first written. Approved 2026-08-15 with
two resolutions — see the mechanism confirmation below, then the plan.

## 0. Resolutions (approved 2026-08-15)

1. **API shape**: ship the proven `@ViewChild`-based design in §2 now.
   The `@ContentChild(TemplateRef)` ergonomic alternative is deferred
   to its own later, separately-tested follow-up — not bundled into
   this fix.
2. **Migration scope**: Option B — all 8 screens, not just the 4
   confirmed-broken ones. Reasoning: the 4 "working" screens
   (`position-form`, `committee-form`, `committee-member-form`,
   `org-unit-form`) are not built on a proven-safe pattern — they are
   accidentally-correct instances of the *same* fragile
   `@if`-in-outer-template convention that just broke elsewhere
   (`org-unit-form` has the identical one-shot pre-fill read, saved
   only by its parent wrapping it in `@if` correctly — nothing in the
   form itself guarantees that). Leaving them unmigrated doesn't
   reduce risk, it defers the same class of accident to whenever
   someone next touches one of those 4 screens or its parent.

Build order (5 phases, checkpointed): EditDialogComponent + its own
tests → migrate the 4 confirmed-broken screens (proves the fix closes
the real bug) → migrate the 4 currently-correct screens (pure
consistency, regression-checked) → confirm the scroll affordance
behaves correctly on both long and short forms → update
`SYSTEM-REFERENCE.md` to point future modules at this component.

---

## 1. Mechanism Confirmation (empirical, not documentation-read)

Two throwaway Angular TestBed specs were written, run via
`ng test --include`, and deleted immediately after (never committed).
Each built a minimal wrapper + child pair, toggled the wrapper's own
internal `@if` closed→open with a *different* input value on reopen
(simulating "edit a different record"), and compared the child
component instance identity plus an `ngOnInit()`-populated field
(simulating the broken forms' one-shot pre-fill).

### Experiment 1 — `<ng-content>` wrapped in the WRAPPER's own `@if`

```ts
// wrapper
@Component({ template: `@if (visible()) { <ng-content /> }` })
class Wrapper { visible = input(false); }

// caller
@Component({
  template: `
    <scratch-wrapper [visible]="visible">
      <scratch-child [value]="value" />
    </scratch-wrapper>
  `,
})
class Host { visible = false; value = 'first'; }
```

Result (actual console output from the run):

```
sameInstance= true   id1= 1  id2= 1
initValue1= 'first'  initValue2= 'first'   ← did NOT update to 'second'
```

**Confirmed: content projection does NOT create a fresh instance of
the projected child when only the wrapper's own `@if` toggles.** The
child component's view was instantiated by the *caller's* template
(the outer context that wrote `<scratch-child>` between the wrapper's
tags) at the point the caller's own change detection first processed
it, and content projection only moves those already-instantiated DOM
nodes in and out of the `<ng-content>` slot. The wrapper's internal
`@if` controls whether the slot is rendered, not whether the
projected component exists. This is exactly ACC-29's bug, reproduced
in isolation — a shared dialog component built as `<ng-content>` +
internal `@if` would NOT fix anything; it would just relocate the
existing bug into a new shared component.

### Experiment 2 — `ngTemplateOutlet` re-attached inside the wrapper's own `@if`

```ts
// wrapper
@Component({
  imports: [NgTemplateOutlet],
  template: `@if (visible()) { <ng-container *ngTemplateOutlet="content()" /> }`,
})
class WrapperOutlet {
  visible = input(false);
  content = input.required<TemplateRef<unknown>>();
}

// caller
@Component({
  template: `
    <ng-template #tpl><scratch-child [value]="value" /></ng-template>
    <scratch-wrapper-outlet [visible]="visible" [content]="tplRef" />
  `,
})
class HostOutlet {
  visible = false;
  value = 'first';
  @ViewChild('tpl', { read: TemplateRef, static: true }) tplRef!: TemplateRef<unknown>;
}
```

Result:

```
sameInstance= false   id1= 2  id2= 3
initValue1= 'first'   initValue2= 'second'   ← correctly updated
```

**Confirmed: this creates a genuinely fresh embedded view — and a
genuinely fresh child component instance — every time the wrapper's
own `@if` goes from closed to open.** This holds even though the
`TemplateRef` itself was declared once in the caller's template and
never changes identity; what matters is that `*ngTemplateOutlet`'s
host element is destroyed and recreated by the surrounding `@if`
block, and `NgTemplateOutlet` calls `viewContainerRef.createEmbeddedView()`
fresh each time it (re)initializes.

### Why this matters architecturally

This means a shared dialog component **cannot** take the form as
literal projected content (`<app-shared-dialog><app-some-form /></app-shared-dialog>`)
and expect an internal `@if` to keep it safe — that reproduces
ACC-29's exact bug at the wrapper level, for every screen that adopts
it. It **must** take the form as a `TemplateRef`, captured by the
caller and passed in, then re-attached via `ngTemplateOutlet` inside
the wrapper's own `@if`. §2 below designs the API on this confirmed
mechanism.

One useful side effect: because the wrapper itself now guarantees a
fresh instance on every open, individual form components no longer
*need* the `effect()`-reactive pre-fill pattern (`position-form`,
`committee-form`) to be safe — a plain `ngOnInit()` read of an `@Input()`
becomes safe too, since `ngOnInit()` will always fire fresh. The
reactive pattern remains better practice (protects against a future
regression if someone re-adds content-projection-style usage), but
adopting the shared dialog does not force every form to be rewritten
to use `effect()` — only to route through the new wrapper.

---

## 2. Component Public API

```ts
@Component({ selector: 'app-edit-dialog', standalone: true, ... })
export class EditDialogComponent {
  // Inputs
  readonly visible = input.required<boolean>();
  readonly header = input<string>('');
  readonly content = input.required<TemplateRef<unknown>>();
  readonly width = input<string>('560px');   // matches today's per-screen [style] widths

  // Outputs
  readonly visibleChange = output<boolean>();   // drives [(visible)] two-way binding, same as p-dialog today
}
```

Usage at a call site (illustrative — not written yet):

```html
<ng-template #formTpl>
  <app-workflow-stage-form
    [stage]="editingStage()"
    [templateId]="templateId()"
    [nextOrder]="nextOrderForNewStage()"
    (saved)="onStageSaved()"
    (cancelled)="showFormDialog.set(false)"
  />
</ng-template>

<app-edit-dialog
  [visible]="showFormDialog()"
  (visibleChange)="showFormDialog.set($event)"
  [header]="(editingStage() ? 'workflow.editStage' : 'workflow.addStage') | translate"
  [content]="formTpl"
/>
```

with `@ViewChild('formTpl', { read: TemplateRef, static: true }) formTpl!: TemplateRef<unknown>;`
on the list component (mirrors Experiment 2's proven shape exactly).

**Ergonomic alternative, deferred (per §0.1):** capturing the
`<ng-template>` as projected content and pulling it out via
`@ContentChild(TemplateRef)` inside `EditDialogComponent`, instead of
a caller-side `@ViewChild`. This would read more naturally alongside
the codebase's existing `<ng-template pTemplate="...">` conventions
(e.g. `p-table`'s row templates) and drop the boilerplate `@ViewChild`
line from every call site. It rests on the identical mechanism
validated in Experiment 2 — freshness comes from the outlet's host
element being inside the wrapper's own `@if`, not from how the
`TemplateRef` reference was obtained — so it should behave the same,
but this specific variant was not itself run through a throwaway
test, and this whole exercise exists because "should behave the same"
was exactly the earlier assumption that turned out wrong for content
projection. Revisit as its own small, separately-tested follow-up —
not bundled into this fix.

Internal template (sketch, not final):

```html
<p-dialog
  [visible]="visible()"
  (visibleChange)="visibleChange.emit($event)"
  [header]="header()"
  [modal]="true"
  [style]="{ width: width() }"
>
  @if (visible()) {
    <ng-container *ngTemplateOutlet="content()" />
  }
</p-dialog>
```

---

## 3. Scroll-Discoverability Fix (built in once)

ACC-29's live investigation concluded the underlying scroll mechanism
already works (`.p-dialog-content` has `overflow-y: auto` as PrimeNG's
own default) — the real problem is that a scrollable-but-not-obviously-
scrollable dialog gives no visual cue that a dropdown or field is
sitting below the fold. Centralizing this fix once, inside
`EditDialogComponent`, benefits every current and future caller
automatically instead of requiring each form to remember it.

Proposed mechanism (CSS/DOM technique, not an open Angular-mechanics
question like §1 — doesn't need its own throwaway test):

- A `(scroll)` listener (or a small `ResizeObserver` + scroll-position
  check) on the dialog's content wrapper toggles a `can-scroll-more`
  class when `scrollHeight > clientHeight` and the user isn't already
  scrolled to the bottom.
- That class drives a persistent bottom-edge affordance — either a
  subtle fade/gradient overlay or a small "more fields below" chevron
  — that disappears once the user reaches the bottom, and never
  appears at all on short forms that never actually need to scroll.
- Implemented once inside `EditDialogComponent`'s own template/styles;
  no per-form changes required, so it's inherited automatically by
  migrated screens and free for any brand-new form built against this
  component going forward.

---

## 4. Migration Scope — Resolved: Option B, All 8 Screens

**Decision (§0.2): migrate all 8 screens** — the 4 confirmed-broken
(`workflow-stage-form`, `lookup-value-form`, `public-holiday-form`,
`role-form`) plus the 4 currently-correct-by-accident
(`position-form`, `committee-form`, `committee-member-form`,
`org-unit-form`).

Reasoning: the 4 "working" screens were never built on a proven-safe
pattern. They are accidentally-correct instances of the *same*
fragile `@if`-in-outer-template convention that just broke on 4 other
screens — `org-unit-form` in particular has the identical one-shot
`ngOnInit()`/`@Input()` pre-fill read as the broken screens, saved
only because its parent (`org-unit-tree.component.ts`) happens to
wrap it in `@if` correctly. Nothing in the form itself guarantees
that; a future edit to the parent that drops the `@if` (exactly the
kind of change `role-list.component.ts` apparently made at some past
point) reintroduces the bug with no warning. Leaving these 4
unmigrated doesn't reduce risk today, it defers the same class of
accident to whenever someone next touches one of these screens or its
parent — which is precisely how ACC-29 was discovered in the first
place.

Consequence accepted knowingly: this migrates 4 screens that have no
current user-facing bug, purely for consistency and to remove the
accidental-safety dependency on parent wiring. Phase 3 (see the
top-level build order in §0) live-verifies each of these 4
specifically for regression, not just for the absence of a new bug.

---

## 5. Meeting Management and Beyond

Once `EditDialogComponent` exists (regardless of which migration scope
is chosen above), it becomes the **required pattern** for Meeting
Management's own upcoming add/edit forms, and for every functional
module after it (Document, Standards, Incident, CAPA, Gap, Audit,
KPI). This closes the duplication risk `SYSTEM-REFERENCE.md` Section
10.5 already flagged (the per-screen `@if`-wrapped p-dialog convention
being duplicated across `lookup-value-list`, `task-list`, `role-list`,
`position-list`, `committee-list`, and now `workflow-stage-list`) —
new modules get pre-fill correctness and the scroll affordance for
free instead of re-deriving both from scratch, which is how ACC-29 and
ACC-30 happened in the first place.

`SYSTEM-REFERENCE.md` should be updated once this ships (it documents
foundational/cross-cutting frontend patterns per its own scope) to
point future module authors at `EditDialogComponent` instead of the
raw `p-dialog` + manual `@if` convention.
