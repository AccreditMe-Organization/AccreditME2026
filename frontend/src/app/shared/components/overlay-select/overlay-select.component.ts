import {
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  TemplateRef,
  ViewChild,
  ViewContainerRef,
  computed,
  forwardRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { NG_VALUE_ACCESSOR, ControlValueAccessor } from '@angular/forms';
import { Overlay, OverlayRef, ScrollStrategy } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import { CdkListbox, CdkOption, ListboxValueChangeEvent } from '@angular/cdk/listbox';
import { CdkScrollable, ScrollDispatcher } from '@angular/cdk/scrolling';
import { TranslatePipe } from '@ngx-translate/core';
import { Subject } from 'rxjs';

// Minimal object satisfying ScrollDispatcher.register()/deregister()'s real
// RUNTIME contract — verified directly against
// @angular/cdk/fesm2022/scrolling.mjs: register()/deregister() only ever
// call scrollable.elementScrolled(), keyed by object identity in a Map, so
// a lightweight object works exactly as well as a real CdkScrollable
// directive instance here. TypeScript's own .d.ts types register()'s
// parameter as the concrete CdkScrollable class rather than a structural
// interface, so `asScrollable()` below casts through it at the two call
// sites — justified by the verified-minimal runtime contract above, not a
// blind `any` escape hatch.
interface ManualScrollable {
  elementScrolled(): Subject<Event>;
}

function asScrollable(manual: ManualScrollable): CdkScrollable {
  return manual as unknown as CdkScrollable;
}

// ACC-42 Phase 1 — hierarchy mode. A flattened, depth-annotated row list
// rendered inside the SAME single CdkListbox/Overlay already proven in
// ACC-41 — deliberately not PrimeNG's cascading flyout-panel UX, which
// would need one Overlay+ScrollDispatcher registration per open panel
// (multiplying the exact bug class this component exists to eliminate).
// Every node, branch or leaf, is individually selectable and gets its own
// row — see backend/Plans/step-42-overlay-select-migration.md §1.3.
interface FlattenedOption {
  node: unknown;
  depth: number;
  isGroup: boolean;
}

function flattenHierarchy(
  options: unknown[],
  childrenField: string,
  depth = 0,
): FlattenedOption[] {
  return options.flatMap((node) => {
    const children = (node as Record<string, unknown>)[childrenField] as unknown[] | undefined;
    const isGroup = !!children?.length;
    return [
      { node, depth, isGroup },
      ...(isGroup ? flattenHierarchy(children!, childrenField, depth + 1) : []),
    ];
  });
}

const SCROLLABLE_OVERFLOW = /(auto|scroll)/;

// Mirrors PrimeNG's own DomHandler.getScrollableParents() (primeng-dom.mjs)
// exactly — same computed-style overflow/overflow-x/overflow-y check,
// walking every ancestor. PrimeNG uses this list to bind its own
// close-on-scroll listeners; here it's used to tell CDK's ScrollDispatcher
// which real ancestors exist at all, since nothing does that automatically
// (see the registration note on OverlaySelectComponent below).
function findScrollableAncestors(element: HTMLElement): HTMLElement[] {
  const ancestors: HTMLElement[] = [];
  let parent = element.parentElement;
  while (parent) {
    const style = window.getComputedStyle(parent);
    if (
      SCROLLABLE_OVERFLOW.test(style.overflow) ||
      SCROLLABLE_OVERFLOW.test(style.overflowX) ||
      SCROLLABLE_OVERFLOW.test(style.overflowY)
    ) {
      ancestors.push(parent);
    }
    parent = parent.parentElement;
  }
  return ancestors;
}

function createManualScrollable(
  element: HTMLElement,
  ngZone: NgZone,
): { scrollable: ManualScrollable; destroy: () => void } {
  const elementScrolled = new Subject<Event>();
  const listener = (event: Event) => elementScrolled.next(event);
  // Matches CdkScrollable's own ngOnInit() pattern (scrolling.mjs) —
  // registered outside the zone since RepositionScrollStrategy's own
  // updatePosition() call is likewise unzoned (a direct inline-style DOM
  // write, not template-bound, so it doesn't need change detection).
  const removeListener = ngZone.runOutsideAngular(() => {
    element.addEventListener('scroll', listener, { passive: true });
    return () => element.removeEventListener('scroll', listener);
  });
  return {
    scrollable: { elementScrolled: () => elementScrolled },
    destroy: () => {
      removeListener();
      elementScrolled.complete();
    },
  };
}

// ACC-41 — permanent shared select component, replacing p-select for fields
// where PrimeNG's own scroll-chaining bug is reachable (see CLAUDE.md's
// PrimeNG-components-only exception note for the confirmed root cause and
// when to reach for this vs. p-select). Composes three separately-verified-
// against-source CDK mechanisms:
//
// 1. Overlay + RepositionScrollStrategy: repositions on ancestor scroll
//    instead of closing (PrimeNG's own ConnectedOverlayScrollHandler closes
//    on ANY ancestor scroll, with no reliable way to prevent it).
// 2. @angular/cdk/listbox (CdkListbox + CdkOption): real keyboard nav/ARIA
//    (arrows, Home/End, typeahead, SPACE/ENTER) via CDK's own
//    ActiveDescendantKeyManager — not hand-written key handlers.
// 3. Manual ScrollDispatcher registration (below): CDK's ScrollDispatcher
//    only reacts to a bubble-phase `document` listener plus whatever is
//    explicitly registered — verified nested `scroll` events do not bubble,
//    and nothing in this app uses `[cdkScrollable]` anywhere, so without
//    this, RepositionScrollStrategy would never learn a dialog's own scroll
//    area scrolled at all (neither reposition nor close). `[cdkScrollable]`
//    as a template directive isn't reachable for PrimeNG-internal markup
//    (e.g. `.p-dialog-content`, generated by p-dialog's own template, not
//    this app's) — directives only match within the template that declares
//    them, not on runtime-added classes. Registering imperatively here,
//    scoped to whatever ancestors this component's own trigger actually has
//    at open() time (mirroring PrimeNG's own DomHandler.getScrollableParents()
//    walk), works uniformly for both EditDialogComponent's own scroll area
//    and PrimeNG's internal one, without touching either of those files.
//
// The OverlayRef itself is created ONCE, lazily, on first open(), and reused
// via attach()/detach() for every subsequent cycle — matches CDK's own
// CdkMenuTrigger (@angular/cdk/menu), verified directly against its source.
// Recreating a fresh OverlayRef per open() (an earlier version of this
// component did) leaves each cycle's now-empty host/pane DOM nodes behind in
// .cdk-overlay-container forever, since detach() alone never removes them —
// only dispose() does, and only ngOnDestroy() calls that here, same as
// CdkMenuTrigger's own _destroyOverlay().
@Component({
  selector: 'app-overlay-select',
  standalone: true,
  imports: [CdkListbox, CdkOption, NgTemplateOutlet, TranslatePipe],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => OverlaySelectComponent),
      multi: true,
    },
  ],
  template: `
    <div
      #trigger
      class="am-overlay-select-trigger"
      [class.am-overlay-select-trigger-open]="isOpen()"
      [class.am-overlay-select-trigger-disabled]="disabled()"
      tabindex="0"
      (click)="toggle()"
      (keydown.enter)="toggle()"
      (keydown.space)="toggle(); $event.preventDefault()"
      (keydown.arrowDown)="open(); $event.preventDefault()"
      (keydown.arrowUp)="open(); $event.preventDefault()"
      (keydown.escape)="close()"
    >
      <span
        class="am-overlay-select-label"
        [class.am-overlay-select-placeholder]="!selectedLabel()"
      >
        {{ selectedLabel() || placeholder() }}
      </span>
      @if (showClear() && value !== null && value !== undefined) {
        <i class="pi pi-times am-overlay-select-clear-icon" (click)="clear($event)"></i>
      }
      <i class="pi pi-chevron-down am-overlay-select-chevron"></i>
    </div>

    <ng-template #panelTpl>
      <div
        #listboxEl
        cdkListbox
        class="am-overlay-select-panel"
        [style.width.px]="triggerWidth()"
        [cdkListboxValue]="value === null || value === undefined ? [] : [value]"
        (cdkListboxValueChange)="onListboxChange($event)"
      >
        @for (flat of flattenedOptions(); track getOptionValue(flat.node)) {
          <div
            cdkOption
            [cdkOption]="getOptionValue(flat.node)"
            [cdkOptionTypeaheadLabel]="getOptionLabel(flat.node, flat.isGroup)"
            [cdkOptionDisabled]="flat.isGroup && !groupsSelectable()"
            class="am-overlay-select-option"
            [class.am-overlay-select-group-header]="flat.isGroup && !groupsSelectable()"
            [style.paddingInlineStart.rem]="0.75 + flat.depth * 1"
          >
            @if (itemTemplate(); as tpl) {
              <ng-container *ngTemplateOutlet="tpl; context: { $implicit: flat.node }" />
            } @else {
              {{ getOptionLabel(flat.node, flat.isGroup) }}
            }
          </div>
        } @empty {
          <div class="am-overlay-select-option am-overlay-select-option-empty">
            {{ 'common.noResults' | translate }}
          </div>
        }
      </div>
    </ng-template>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .am-overlay-select-trigger {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        min-height: 2.5rem;
        padding: 0.5rem 0.75rem;
        background: var(--am-card);
        border: 1px solid var(--am-border);
        border-radius: 6px;
        cursor: pointer;
        font-size: 0.875rem;
        color: var(--am-text-primary);
        outline: none;
        transition: border-color 0.15s ease;
      }

      .am-overlay-select-trigger:hover {
        border-color: var(--am-blue-light, #64b5d9);
      }

      .am-overlay-select-trigger:focus,
      .am-overlay-select-trigger-open {
        border-color: var(--am-blue-primary);
        box-shadow: 0 0 0 1px var(--am-blue-primary);
      }

      .am-overlay-select-trigger-disabled {
        cursor: not-allowed;
        opacity: 0.6;
      }

      .am-overlay-select-label {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .am-overlay-select-placeholder {
        color: var(--am-text-secondary);
      }

      .am-overlay-select-clear-icon {
        font-size: 0.75rem;
        color: var(--am-text-secondary);
      }

      .am-overlay-select-clear-icon:hover {
        color: var(--am-text-primary);
      }

      .am-overlay-select-chevron {
        font-size: 0.75rem;
        color: var(--am-text-secondary);
      }

      .am-overlay-select-panel {
        max-height: 15rem;
        overflow-y: auto;
        background: var(--am-card);
        border: 1px solid var(--am-border);
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
        overscroll-behavior: contain;
      }

      .am-overlay-select-option {
        padding: 0.5rem 0.75rem;
        font-size: 0.875rem;
        color: var(--am-text-primary);
        cursor: pointer;
      }

      .am-overlay-select-option:hover {
        background: var(--am-surface);
      }

      /* ACC-55 — a non-selectable group renders as a heading, not a dead
         option: no pointer cursor and no hover highlight, so it never looks
         clickable in the first place. CdkOption already blocks the click and
         the keyboard; this is what stops it inviting one. */
      .am-overlay-select-option.am-overlay-select-group-header {
        cursor: default;
        font-weight: 600;
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        color: var(--am-text-secondary);
      }

      .am-overlay-select-option.am-overlay-select-group-header:hover {
        background: transparent;
      }

      /* aria-selected is managed by CdkOption itself — style off the real
         attribute rather than a separately-recomputed class, so the
         highlight can never drift out of sync with CDK's own state. */
      .am-overlay-select-option[aria-selected='true'] {
        background: var(--am-blue-primary);
        color: #ffffff;
      }

      /* cdk-option-active reflects keyboard-focused/active item (roving
         tabindex), distinct from selected — gets its own subtle affordance
         so keyboard navigation is visible even before a selection. */
      .am-overlay-select-option.cdk-option-active:not([aria-selected='true']) {
        background: var(--am-surface);
        outline: 2px solid var(--am-blue-light, #64b5d9);
        outline-offset: -2px;
      }

      .am-overlay-select-option-empty {
        color: var(--am-text-secondary);
        cursor: default;
      }

      .am-overlay-select-option-empty:hover {
        background: transparent;
      }
    `,
  ],
})
export class OverlaySelectComponent implements ControlValueAccessor, OnDestroy {
  private readonly overlay = inject(Overlay);
  private readonly viewContainerRef = inject(ViewContainerRef);
  private readonly scrollDispatcher = inject(ScrollDispatcher);
  private readonly ngZone = inject(NgZone);
  private manualScrollables: { scrollable: ManualScrollable; destroy: () => void }[] = [];

  @ViewChild('trigger', { static: true }) triggerRef!: ElementRef<HTMLElement>;
  @ViewChild('panelTpl') panelTpl!: TemplateRef<unknown>;

  // Dynamic (non-static) ViewChild — the listbox div only exists once the
  // TemplatePortal is attached to the overlay, so this setter fires the
  // moment CD picks it up and focuses it, giving the roving-tabindex
  // ActiveDescendantKeyManager real DOM focus to drive from immediately
  // (arrow keys work with no extra Tab needed).
  @ViewChild('listboxEl') set listboxElRef(ref: ElementRef<HTMLElement> | undefined) {
    if (ref && this.isOpen()) {
      ref.nativeElement.focus();
    }
  }

  readonly options = input<unknown[]>([]);
  readonly optionLabel = input<string>('label');
  readonly optionValue = input<string>('value');
  readonly placeholder = input<string>('');
  readonly showClear = input<boolean>(false);

  // ACC-42 Phase 1 — hierarchy mode, mirrors p-cascadeSelect's own input
  // names exactly (see plan §1.2) so org-unit-form's existing
  // cascadeOptions()/buildCascadeOptions() tree-shape needs zero changes,
  // only the template tag swaps. Hierarchical mode is inferred from
  // whether optionGroupChildren is set — flat mode (every consumer today)
  // is completely unaffected, since flattenedOptions() below degrades to
  // a depth-0 wrapping of options() when it's unset.
  readonly optionGroupLabel = input<string | undefined>(undefined);
  readonly optionGroupChildren = input<string | undefined>(undefined);

  // ACC-55 — opt-in: when false, group (branch) nodes render as inert
  // headings instead of choices.
  //
  // Defaults to TRUE, preserving the behavior ACC-42 deliberately built and
  // pinned with its own test ("every node is individually selectable
  // regardless of depth or branch/leaf status"): org-unit-form's tree needs a
  // parent unit to be a valid parent, so a branch there IS a real choice.
  //
  // But that is a property of THAT data, not of hierarchies generally. A
  // grouped list whose groups are pure categories — the permission picker's
  // 19 module headings, where "committees" is not itself a permission — needs
  // the opposite. Selecting such a heading in ACC-55 silently CLEARED the
  // transition's required permission, widening who could fire it.
  //
  // Implemented via CdkOption's own `cdkOptionDisabled`, not a hand-rolled
  // click guard, so pointer AND keyboard agree for free: CdkListbox applies
  // `skipPredicate(option => option.disabled)` to its ActiveDescendantKeyManager,
  // and guards selection on `!option.disabled` (verified in
  // @angular/cdk/listbox source, not assumed).
  readonly groupsSelectable = input<boolean>(true);

  // ACC-42 Phase 2 — custom option rendering (plan §2.3). CdkOption is a
  // plain directive, not a component, so it has no content-projection
  // mechanism of its own to extend — this component already fully
  // controls each row's markup in the @for loop above, so projection is
  // just an ngTemplateOutlet swapped in when set. Independent of
  // hierarchy mode: works identically whether flattenedOptions() came
  // from a flat list or a flattened tree. cdkOptionTypeaheadLabel (bound
  // in the template) is bound separately to the plain computed label —
  // required because CdkOption.getLabel() falls back to
  // element.textContent when unset, which would concatenate a two-line
  // custom template's text nodes with no separator and corrupt typeahead
  // matching (verified directly against listbox.mjs, not assumed).
  readonly itemTemplate = input<TemplateRef<{ $implicit: unknown }> | undefined>(undefined);

  readonly flattenedOptions = computed<FlattenedOption[]>(() => {
    const childrenField = this.optionGroupChildren();
    if (!childrenField) {
      return this.options().map((node) => ({ node, depth: 0, isGroup: false }));
    }
    return flattenHierarchy(this.options(), childrenField);
  });

  readonly isOpen = signal(false);
  readonly disabled = signal(false);
  readonly triggerWidth = signal(0);

  value: unknown = null;
  private onChange: (value: unknown) => void = () => {};
  private onTouched: () => void = () => {};
  private overlayRef: OverlayRef | null = null;

  // ACC-42 Phase 1 — searches flattenedOptions(), not options() directly.
  // A REAL bug the naive top-level-only search would have hit: a selected
  // node's value can sit several optionGroupChildren levels deep in
  // hierarchy mode and would never be found by a shallow .find() over the
  // raw nested options() tree. In flat mode flattenedOptions() is just a
  // depth-0 wrapping of options(), so this is behaviorally identical to
  // the old top-level search for every existing (flat-mode) consumer.
  get selectedLabel(): () => string {
    return () => {
      const match = this.flattenedOptions().find(
        (flat) => this.getOptionValue(flat.node) === this.value,
      );
      return match ? this.getOptionLabel(match.node, match.isGroup) : '';
    };
  }

  // Matches p-select's own real default: a primitive-array option (e.g.
  // task-form's plain string[] sourceTypes) is its own label/value when
  // optionLabel/optionValue aren't meaningful property lookups on it —
  // only object-array options (e.g. position-form's RoleDto[]) go through
  // the property-lookup path.
  //
  // isGroup selects optionGroupLabel() over optionLabel() when set — real
  // semantic behavior matching p-cascadeSelect's own naming, not a
  // decorative unused input: a branch node's own label field can differ
  // from a leaf's (even though org-unit-form's buildCascadeOptions() today
  // happens to use "label" for both, matching the API is what lets a
  // future consumer with a genuinely different shape work unmodified).
  getOptionLabel(opt: unknown, isGroup = false): string {
    if (opt === null || typeof opt !== 'object') return String(opt);
    const field = (isGroup && this.optionGroupLabel()) || this.optionLabel();
    return String((opt as Record<string, unknown>)[field] ?? '');
  }

  getOptionValue(opt: unknown): unknown {
    if (opt === null || typeof opt !== 'object') return opt;
    return (opt as Record<string, unknown>)[this.optionValue()];
  }

  toggle(): void {
    if (this.disabled()) return;
    this.isOpen() ? this.close() : this.open();
  }

  open(): void {
    if (this.overlayRef?.hasAttached()) return;

    this.triggerWidth.set(this.triggerRef.nativeElement.getBoundingClientRect().width);

    // Register every real scrollable ancestor with CDK's ScrollDispatcher
    // BEFORE the overlay attaches, so RepositionScrollStrategy's
    // scrollDispatcher.scrolled() subscription (enabled on attach) already
    // has something to react to the moment a scroll happens.
    this.manualScrollables = findScrollableAncestors(this.triggerRef.nativeElement).map(
      (ancestor) => createManualScrollable(ancestor, this.ngZone),
    );
    this.manualScrollables.forEach(({ scrollable }) =>
      this.scrollDispatcher.register(asScrollable(scrollable)),
    );

    if (!this.overlayRef) {
      const positionStrategy = this.overlay
        .position()
        .flexibleConnectedTo(this.triggerRef)
        .withPositions([
          { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
          { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
        ])
        .withFlexibleDimensions(false)
        .withPush(true);

      // Reposition, not close, on ancestor scroll — the confirmed root
      // cause fix (see class-level comment above). autoClose only closes
      // once scrolled fully off-viewport — verified directly against the
      // installed CDK source, not assumed.
      const scrollStrategy: ScrollStrategy = this.overlay.scrollStrategies.reposition({
        autoClose: true,
        scrollThrottle: 20,
      });

      this.overlayRef = this.overlay.create({
        positionStrategy,
        scrollStrategy,
        hasBackdrop: true,
        backdropClass: 'cdk-overlay-transparent-backdrop',
        panelClass: 'am-overlay-select-overlay-panel',
      });

      this.overlayRef.backdropClick().subscribe(() => this.close());
      // CDK's OverlayKeyboardDispatcher binds one keydown listener on `body`
      // and only routes events to the topmost ATTACHED overlay (verified
      // against _overlay-module-chunk.mjs) — so this only ever fires while
      // this dropdown is genuinely open. PrimeNG's own Escape-to-close
      // listener (primeng-dialog.mjs) is bound on `document`, an ancestor
      // encountered LATER in the bubble chain than `body`. stopPropagation()
      // here — still inside the synchronous body-listener callback — stops
      // the event before it ever reaches document, so the dropdown's own
      // Escape doesn't fall through and close the parent dialog. Once
      // close() detaches, the dispatcher immediately stops routing to this
      // overlay at all, so the dialog's own Escape-to-close is completely
      // untouched when the dropdown isn't open.
      this.overlayRef.keydownEvents().subscribe((event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          this.close();
        }
      });
      // Single cleanup point for EVERY detach path — my own close(), backdrop
      // click, Escape, and RepositionScrollStrategy's own autoClose-on-
      // viewport-exit detach (which calls overlayRef.detach() directly,
      // bypassing close() entirely) all end up here exactly once.
      this.overlayRef.detachments().subscribe(() => {
        this.isOpen.set(false);
        this.manualScrollables.forEach(({ scrollable, destroy }) => {
          this.scrollDispatcher.deregister(asScrollable(scrollable));
          destroy();
        });
        this.manualScrollables = [];
      });
    }

    const portal = new TemplatePortal(this.panelTpl, this.viewContainerRef);
    this.overlayRef.attach(portal);
    this.isOpen.set(true);
    this.onTouched();
  }

  close(): void {
    this.overlayRef?.detach();
  }

  ngOnDestroy(): void {
    this.close();
    this.overlayRef?.dispose();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- CdkListbox
  // infers T from [cdkOption]="unknown", which TS can't reconcile against a
  // hand-typed ListboxValueChangeEvent<unknown>.
  onListboxChange(event: ListboxValueChangeEvent<any>): void {
    this.value = event.value.length > 0 ? event.value[0] : null;
    this.onChange(this.value);
    this.close();
  }

  clear(event: Event): void {
    event.stopPropagation();
    this.value = null;
    this.onChange(this.value);
  }

  writeValue(value: unknown): void {
    this.value = value;
  }

  registerOnChange(fn: (value: unknown) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }
}
