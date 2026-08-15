# Step 29 — Shared Edit Dialog (ACC-29 fix design)

Planning document only. No component code written yet — see the
mechanism confirmation below, then the plan. Nothing in this doc has
been implemented; migration scope (§4) is explicitly left as an open
decision for the user.

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

**Ergonomic alternative, not yet tested:** capturing the `<ng-template>`
as projected content and pulling it out via `@ContentChild(TemplateRef)`
inside `EditDialogComponent`, instead of a caller-side `@ViewChild`.
This would read more naturally alongside the codebase's existing
`<ng-template pTemplate="...">` conventions (e.g. `p-table`'s row
templates) and drop the boilerplate `@ViewChild` line from every call
site. It rests on the identical mechanism validated in Experiment 2 —
freshness comes from the outlet's host element being inside the
wrapper's own `@if`, not from how the `TemplateRef` reference was
obtained — so it should behave the same, but this specific variant
was not itself run through a throwaway test. Worth a five-minute
confirmatory rerun before committing to it over the `@ViewChild` form,
since it's a different API shape than what was empirically proven
above and this whole exercise exists because "should behave the same"
was exactly the earlier assumption that turned out wrong for content
projection.

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

## 4. Migration Scope — Open Decision

Two options, both technically straightforward once `EditDialogComponent`
exists. Flagging the tradeoff rather than picking one:

**Option A — migrate only the 4 confirmed-broken screens**
(`workflow-stage-form`, `lookup-value-form`, `public-holiday-form`,
`role-form`, each via their respective `*-list.component.ts`).

- Smaller, lower-risk diff — touches exactly the code that's actually
  broken today.
- Leaves two different dialog patterns coexisting in the codebase
  going forward (old per-screen `@if`-in-outer-template wiring on
  `position-form`/`committee-form`/`committee-member-form`/`org-unit-form`,
  new `EditDialogComponent` on the 4 fixed screens) — a real
  inconsistency a future reader (or Meeting Management's author) has
  to understand isn't a mistake.

**Option B — migrate all 8 screens** (the 4 broken ones plus the 4
already-correct ones: `position-form`, `committee-form`,
`committee-member-form`, `org-unit-form`) for full consistency.

- One dialog pattern everywhere, matching §5's plan to make this the
  required pattern for all future modules — no "old way / new way"
  split to explain later.
- Touches four screens that work correctly today purely for
  consistency, not because they're broken — real risk of a regression
  in code that has no current bug, for zero user-facing benefit beyond
  uniformity. Each of those 4 would need to be re-verified live
  (not just re-tested) since their current `@if`-in-outer-template
  wiring would be removed and replaced.

No recommendation baked into this plan — flagging per your instruction
that this is your call once you've seen the reasoning above.

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
