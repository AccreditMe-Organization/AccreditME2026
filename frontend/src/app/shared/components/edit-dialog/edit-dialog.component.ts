import {
  AfterViewChecked,
  Component,
  ElementRef,
  OnDestroy,
  TemplateRef,
  ViewChild,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Dialog, DialogModule } from 'primeng/dialog';
import { ConfirmationService, PrimeTemplate } from 'primeng/api';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LayerStackService } from '../../overlay/layer-stack.service';
import { ListFocusService } from '../data-list/list-focus.service';
import { DIALOG_DENSITY, DialogDensity } from './dialog-density';

/**
 * The three dialog sizes (ACC-111, artboard 7). A size is a KIND of dialog,
 * not a width a caller tunes: confirm asks one question, form holds up to six
 * fields, picker is a search over a scrolling list.
 */
export type DialogSize = 'confirm' | 'form' | 'picker';

const DIALOG_WIDTH: Record<DialogSize, string> = {
  confirm: 'var(--am-dialog-confirm)',
  form: 'var(--am-dialog-form)',
  picker: 'var(--am-dialog-picker)',
};

// Wraps a p-dialog and re-attaches its caller-supplied content via
// ngTemplateOutlet, inside this component's OWN @if(visible()) — not
// via <ng-content>. Content projection does not create a fresh
// instance of a projected component when only a wrapper's internal
// @if toggles (confirmed empirically, see
// backend/Plans/step-29-shared-edit-dialog.md Section 1); ngTemplateOutlet
// re-attached the same way does. Every caller must therefore pass its
// form via a TemplateRef, not as literal projected content.
@Component({
  selector: 'app-edit-dialog',
  standalone: true,
  imports: [DialogModule, NgTemplateOutlet, PrimeTemplate, TranslatePipe],
  // ACC-120 slice 2 — ONLY this component provides the density token, which is
  // what stops compact density reaching a page. See dialog-density.ts.
  providers: [{ provide: DIALOG_DENSITY, useFactory: () => inject(EditDialogComponent).density }],
  template: `
    <p-dialog
      [visible]="visible()"
      (visibleChange)="onDialogVisibleChange($event)"
      [header]="header()"
      [modal]="true"
      [closeOnEscape]="false"
      [dismissableMask]="false"
      [closable]="false"
      [role]="role()"
      appendTo="body"
      [style]="{ width: resolvedWidth() }"
      [attr.data-density]="density()"
    >
      <!-- ACC-96 — the title and, when the caller gives one, a context line
           under it: "on Infection Control Committee". Template 3 draws it
           there because a dialog raised FROM a record has to say which record
           without the user reading the page behind it.

           A header TEMPLATE rather than the [header] input, because p-dialog
           renders that input as a bare string with no room for a second line.
           It is declared unconditionally — p-dialog collects pTemplate
           children at content init, so one that appears later never lands
           (the same trap the task footer hit). The @if is INSIDE. -->
      <!-- OUR OWN ✕, and p-dialog's is off ([closable]="false").
           PrimeNG's close button hides the dialog ITSELF and then emits
           visibleChange. With a one-way [visible] binding the host has no new
           value to push back, so the form vanished before the discard question
           was answered and "Keep editing" had nothing to return to — it asked
           a question whose answer no longer mattered.
           Mirroring the input back was tried and is worse: setting it to the
           value it already held is not a change, so PrimeNG never sees the
           transition and the dialog stays shut for good. Owning the button is
           the fix — every close path then reaches requestClose() with the
           dialog still on screen. Found in a browser; the specs passed either
           way, because they assert on the host's flag and the confirm, and
           PrimeNG's internal state is neither. -->
      <ng-template pTemplate="header">
        <div class="am-dialog__heading">
          <span class="p-dialog-title">{{ header() }}</span>
          @if (context()) {
            <span class="am-dialog__context">{{ context() }}</span>
          }
          @if (headerExtra(); as extra) {
            <ng-container *ngTemplateOutlet="extra" />
          }
        </div>
        @if (!saving()) {
          <button
            type="button"
            class="am-dialog__close"
            [attr.aria-label]="'common.close' | translate"
            (click)="requestClose()"
          >
            <i class="pi pi-times" aria-hidden="true"></i>
          </button>
        }
      </ng-template>

      @if (visible()) {
        <div class="relative am-dialog__body-wrap">
          <div
            #scrollArea
            class="am-dialog__body pr-1"
            (scroll)="onScroll()"
            (wheel)="onWheel($event)"
          >
            <div #contentWrapper>
              <ng-container *ngTemplateOutlet="content()" />
            </div>
          </div>
          @if (canScrollMore()) {
            <div
              aria-hidden="true"
              class="pointer-events-none absolute inset-x-0 bottom-0 flex h-8 items-end justify-center bg-gradient-to-t from-[var(--am-card)] to-transparent"
            >
              <i class="pi pi-chevron-down mb-1 text-xs text-[var(--am-text-secondary)]"></i>
            </div>
          }
        </div>
      }

      <!-- FIXED, and outside the scrolling body (artboard 7). Two reasons, and
           the second is not obvious: a footer inside the scroll container can
           be scrolled away from the cursor mid-click, and its buttons sit flush
           against the container's edge, which CLIPS their focus ring — measured
           in ACC-111, the ring was cropped along the bottom. -->
      @if (footer(); as footerTemplate) {
        <ng-template pTemplate="footer">
          <ng-container *ngTemplateOutlet="footerTemplate" />
        </ng-template>
      }
    </p-dialog>
  `,
  // PrimeNG's connected overlays (p-select, p-multiselect, ...) hide
  // themselves on ANY scroll of a scrollable ancestor of their trigger
  // (ConnectedOverlayScrollHandler binds to every scrollable ancestor,
  // not just the window) rather than repositioning. With appendTo
  // defaulting to 'self', the overlay panel renders as a genuine DOM
  // descendant of this component's own scroll area, so scrolling the
  // overlay's own listbox to its own top/bottom edge lets the browser's
  // native scroll-chaining forward the remaining wheel delta to that
  // ancestor — closing the overlay mid-scroll (confirmed live; see
  // backend/Plans/step-29-shared-edit-dialog.md). overscroll-behavior:
  // contain stops that chaining at the listbox's own boundary, so an
  // internal-list scroll never reaches the ancestor in the first place.
  // ::ng-deep is required because the listbox is rendered by whichever
  // caller's form declared the <p-select>/<p-multiSelect>, not by this
  // component's own template — :host still correctly scopes the rule to
  // overlays that are DOM descendants of THIS dialog, since PrimeNG
  // never moves the element elsewhere when appendTo is 'self'.
  //
  // p-select and p-multiselect render their listbox under genuinely
  // different class names (confirmed directly against PrimeNG's own
  // source: primeng-select.mjs uses 'p-select-list-container',
  // primeng-multiselect.mjs uses 'p-multiselect-list-container' — not a
  // shared base class either selector could catch alone) — ACC-36 found
  // the original single-selector rule left every p-multiSelect-in-dialog
  // screen (e.g. UnassignedTasksComponent's Reassign form) unprotected.
  // Both listed explicitly rather than relying on a wildcard, so a
  // future third overlay type (e.g. p-cascadeselect, which shares the
  // same 'listContainer' class-key convention) is a deliberate addition
  // here, not a silent gap the way p-multiselect was.
  styles: [
    `
      .am-dialog__heading {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-inline-size: 0;
        flex: 1 1 auto;
      }

      /* 32px, above the 24px WCAG 2.5.8 floor, and the same size PrimeNG's own
         close button used. */
      .am-dialog__close {
        display: flex;
        align-items: center;
        justify-content: center;
        flex: none;
        inline-size: 32px;
        block-size: 32px;
        padding: 0;
        border: none;
        background: none;
        border-radius: 999px;
        color: var(--am-ink-500);
        cursor: pointer;
      }

      .am-dialog__close:hover {
        background: var(--am-primary-50);
        color: var(--am-ink-900);
      }

      .am-dialog__close:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: 2px;
      }

      .am-dialog__context {
        font-size: 12.5px;
        font-weight: 400;
        color: var(--am-ink-500);
      }

      /* NO :host (ACC-120). These are ACC-36's scroll-chaining fix, and
         the :host ::ng-deep form scoped them to a descendant of this component, so
         they silently stopped applying the moment a dialog was appended to
         <body>, which is now every dialog. Without it they are global,
         which is the only way they can still do their job and is correct
         everywhere anyway: a dropdown listbox should never chain its scroll to
         an ancestor, in a dialog or on a page. */
      ::ng-deep .p-select-list-container,
      ::ng-deep .p-multiselect-list-container {
        overscroll-behavior: contain;
      }

      /* Capped so the body need not scroll at all (artboard 7): content is
         sized for the dialog with every panel open, and a body that still
         overflows means the pattern is wrong — split it into steps, or make it
         a page. 60vh keeps the cap honest on a short viewport. */
      .am-dialog__body {
        max-height: min(var(--am-dialog-form-body-max), 60vh);
        overflow-y: auto;
      }
    `,
  ],
})
export class EditDialogComponent implements AfterViewChecked, OnDestroy {
  readonly visible = input.required<boolean>();
  readonly header = input<string>('');
  /**
   * An optional line under the title, naming what this dialog was raised from
   * — e.g. "on Infection Control Committee". Empty renders nothing at all, not
   * an empty line.
   */
  readonly context = input<string>('');
  /**
   * Anything else that belongs beside the title rather than in the body — a
   * wizard's step strip, above all. Template 3 draws that inside the header
   * block, and putting it there is what keeps it UNCHANGED when the body is
   * substituted, as well as keeping it off the 420px body cap.
   */
  readonly headerExtra = input<TemplateRef<unknown> | null>(null);
  readonly content = input.required<TemplateRef<unknown>>();
  readonly visibleChange = output<boolean>();

  /**
   * The kind of dialog, which decides its width (ACC-111, artboard 7).
   * Prefer this to `width`, which stays for callers predating it.
   */
  readonly size = input<DialogSize>('form');

  /** Explicit width. Overrides `size` when set; '' means "use the size". */
  readonly width = input<string>('');

  /**
   * Fixed footer, rendered outside the scrolling body. Optional: callers
   * predating it keep their buttons inside the content.
   */
  readonly footer = input<TemplateRef<unknown> | null>(null);

  /**
   * Whether the form holds unsaved changes. Escape and the close button then
   * ASK before discarding rather than throwing the work away silently.
   */
  readonly dirty = input(false);

  /**
   * A save is in flight. Escape is disarmed and the close button hidden: the
   * outcome is not known yet, so there is nothing truthful to return to.
   */
  readonly saving = input(false);

  /*
   * appendTo IS NO LONGER AN INPUT. Every dialog is appended to <body> and a
   * consumer cannot opt out (ACC-120).
   *
   * It used to default to 'self', and THAT DEFAULT was the defect rather than
   * any one consumer's configuration. A dialog opened from INSIDE another
   * dialog then rendered as a descendant of the parent's `.am-dialog__body` —
   * `max-height: min(420px, 60vh)`, `overflow-y: auto` — and was clipped by it.
   * Measured in the browser: the Arrange-cover dialog froze at 392px in both
   * its views while New Task, the same shell at page level, reached 551. Its
   * form view had been losing 21px since the day it was written, and nobody
   * caught it, because the clip lands on `.p-dialog-content` while OUR
   * `.am-dialog__body` reports its natural height and never overflows.
   *
   * Three consumers had already hit this and set 'body' by hand. That is the
   * shape of a bad default: whoever meets it works around it locally, and the
   * next dialog opened from inside a dialog reproduces it exactly.
   *
   * TWO THINGS THAT WILL MISLEAD ANYONE MEASURING THIS LATER:
   *
   * - `--pui-motion-height` IS STALE AND MEANS NOTHING. PrimeNG captures it when
   *   the dialog opens and never re-measures, so it read 392.390625px (English)
   *   and 404.09375px (Arabic) while the dialog actually rendered 413/514 and
   *   423/526. It is not binding anything. Do not read it as the dialog's height
   *   and conclude the dialog is short.
   * - THE DIALOG ANIMATES IN. Sampled 900ms after opening a date view, the
   *   content measured 293 with the calendar at 0 — mid-transition. It settles
   *   at ~2s. Any snippet or spec that measures height must wait for the
   *   transition or it records a number that was never on screen.
   *
   * WHAT 'self' EXISTED FOR, and why removing it is safe: the two ACC-36
   * overscroll rules below were `:host ::ng-deep`, which compiles to
   * `[_nghost…] …` — the host element stays put while the dialog moves, so a
   * body-appended dialog lost them. They now omit `:host` and survive the move.
   * Nothing else here is host-scoped, no consumer styles dialog content that
   * way, and the `(wheel)` handler is bound in THIS template so it travels with
   * the dialog.
   */

  /**
   * ACC-122 — the ARIA role, forwarded to p-dialog.
   *
   * 'dialog' is right for the add/edit forms this shell was built for. A
   * dialog that INTERRUPTS to say something time-critical — the idle warning
   * is the first — takes 'alertdialog', which tells a screen reader to
   * announce the contents immediately rather than only on focus. That is the
   * difference between a user hearing "you will be signed out in two minutes"
   * and hearing nothing until they happen to tab into it.
   */
  readonly role = input<'dialog' | 'alertdialog'>('dialog');

  /**
   * ACC-120 slice 2 — artboard 13. Declared ONCE, for the whole dialog, and
   * computed from the field list at design time rather than per screen: a
   * dialog is compact when its standard-density body would exceed the 420px cap
   * or it holds five or more field blocks. `check:dialog-density` mechanises
   * the field-count half; the height half is a measurement recorded in the
   * dialog's own comment, because a static scan cannot measure rendered height
   * honestly.
   *
   * NEVER mixed inside one dialog — two field rhythms in one form reads as a
   * rendering fault.
   */
  readonly density = input<DialogDensity>('form');

  protected readonly resolvedWidth = computed(() => this.width() || DIALOG_WIDTH[this.size()]);

  private readonly layers = inject(LayerStackService);
  private readonly listFocus = inject(ListFocusService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly translate = inject(TranslateService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** What had focus when the dialog opened, so it can be given back. */
  private triggerElement: HTMLElement | null = null;

  /**
   * If the trigger was a control inside a list ROW, the row's position when
   * the dialog opened. Captured then, because by the time the dialog closes
   * the row may be gone and its position unknowable. See the focus-return
   * rule in requestClose's sibling comment below.
   */
  private triggerRowIndex = -1;
  private triggerRowKey: string | null = null;

  /** The p-dialog itself, for the layering check in onKeydown. */
  @ViewChild(Dialog) private readonly dialogRef?: Dialog;

  @ViewChild('scrollArea') private readonly scrollAreaRef?: ElementRef<HTMLDivElement>;
  @ViewChild('contentWrapper') private readonly contentWrapperRef?: ElementRef<HTMLDivElement>;

  readonly canScrollMore = signal(false);


  private resizeObserver?: ResizeObserver;
  private observedContentEl?: HTMLDivElement;

  constructor() {
    // Escape is ours, not p-dialog's (closeOnEscape is off), because it has to
    // consult dirty() and saving() before it closes anything.
    // THIS DIALOG HANDLES ESCAPE LAST, AND ONLY IF NOTHING ELSE CONSUMED IT.
    //
    // It used to listen in the CAPTURE phase, on the reasoning that it must
    // decide about unsaved work before anything closes anything. That was
    // wrong, and expensively so: nothing else closes THIS dialog (the
    // underlying p-dialog has closeOnEscape off), while capture put us ahead
    // of every PrimeNG overlay's own Escape handling and broke all twelve of
    // them at once.
    //
    // Bubble phase is the first half of the guard, and it is BEHAVIOURAL
    // rather than a list of class names:
    //   - p-select and p-multiselect call stopPropagation, so the event never
    //     reaches this listener at all;
    //   - p-datepicker, p-autocomplete, p-cascadeselect and p-tieredmenu call
    //     preventDefault, so defaultPrevented is true;
    //   - our own layers register with LayerStackService and are checked below.
    // All four verified against the installed PrimeNG source, not assumed.
    //
    // THE defaultPrevented GUARD IS GONE, and this is the important part.
    //
    // It was a proxy for "something closed", and for an INLINE component that
    // proxy is false: the calendar in the picker layer is [inline]="true", so
    // it has no overlay to close, yet it still marks Escape handled and
    // refocuses its own grid. The layer that OWNED the keystroke then never
    // answered it — the calendar dialog could not be closed from inside its
    // date cells, and focus jumped to the previous-month arrow.
    //
    // LayerStackService already answers the real question. If this dialog is
    // the top layer, NOTHING ABOVE IT EXISTED to consume the keystroke, so a
    // defaultPrevented flag can only have come from its own content. The
    // isTop check below is therefore the whole guard.
    //
    // Two things were tried first and are recorded so they are not retried:
    // PrimeNG's z-index registry does not see a panel appended to 'self' (the
    // dialog had 1102 and the open datepicker panel had none), and the target's
    // ancestor chain is identical for both — a popup datepicker's Escape comes
    // from its INPUT, whose chain holds nothing positioned either.
    //
    // CONSEQUENCE, stated rather than discovered later: while a FLOATING
    // PrimeNG panel still sits inside a dialog, Escape now closes both it and
    // the dialog. That configuration is the one artboard 7 forbids and
    // check:dialog-overlays counts down to zero; a dialog that cannot be
    // closed from its own content is the worse of the two defects.
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !this.visible()) return;

      // Only the TOP layer answers Escape — a calendar or picker stacked above
      // this dialog, or the discard confirm it opens. See LayerStackService
      // for why listener ordering cannot solve this.
      if (this.layerId !== null && !this.layers.isTop(this.layerId)) return;
      event.stopPropagation();
      this.requestClose();
    };
    document.addEventListener('keydown', onKeydown);
    this.teardownKeydown = () => document.removeEventListener('keydown', onKeydown);

    effect(() => {
      if (this.visible()) {
        if (this.layerId === null) this.layerId = this.layers.push();
        // Remember the trigger BEFORE the dialog takes focus.
        this.triggerElement = document.activeElement as HTMLElement | null;
        const row = this.triggerElement?.closest?.('.am-list-row') ?? null;
        this.triggerRowIndex = row?.parentElement
          ? Array.from(row.parentElement.children).indexOf(row)
          : -1;
        this.triggerRowKey = row?.getAttribute('data-am-row-key') ?? null;
        afterNextRender({ read: () => this.focusFirstField() }, { injector: this.injector });
      } else {
        if (this.layerId !== null) {
          this.layers.remove(this.layerId);
          this.layerId = null;
        }
      }

      if (!this.visible() && this.triggerElement) {
        // WHEN THE TRIGGER IS GONE, THE LIST DECIDES — the one rule that wins
        // over "focus returns to the trigger".
        //
        // Deleting a row runs: focus the row's More button, open the menu,
        // choose Delete, confirm here, the row is removed. Both rules are
        // correct and they collide: this dialog wants to return focus to a
        // button that no longer exists, and the list wants to focus whatever
        // took the row's place. Returning to a detached element focuses
        // nothing at all, so the list wins — but ONLY in that case. While the
        // trigger survives, it still gets focus back.
        if (this.triggerElement.isConnected) {
          this.triggerElement.focus();
        } else if (this.triggerRowIndex >= 0) {
          // Not restored here: the list refetches after a save or a delete,
          // and DataListComponent restores once the new rows are in the DOM.
          // The KEY is what separates the two — see ListFocusService.
          this.listFocus.noteTriggerLost(this.triggerRowKey, this.triggerRowIndex);
        }
        this.triggerElement = null;
        this.triggerRowIndex = -1;
        this.triggerRowKey = null;
      }
    });
  }

  private readonly injector = inject(Injector);
  private layerId: number | null = null;
  private teardownKeydown: (() => void) | null = null;

  /**
   * Focus the first FIELD, never the close button. PrimeNG focuses whatever is
   * first in the DOM, which is the X — landing a keyboard user on "throw this
   * away" instead of on the work.
   */
  private focusFirstField(): void {
    // FROM #contentWrapper, NOT from this component's host element (ACC-120).
    //
    // The dialog is appended to <body>, so the host no longer contains it and a
    // host-scoped query found nothing — opening any dialog silently stopped
    // moving focus to its first field. Caught by this component's own specs
    // when appendTo moved into the shell, which is the whole argument for the
    // spec living here rather than on one consumer.
    //
    // #contentWrapper is inside the dialog, so it travels with it, and it sits
    // within .p-dialog-content — which is what used to make the old selector's
    // prefixes necessary. Scoping to the wrapper excludes the header's close
    // button by structure instead of by selector.
    const root = this.contentWrapperRef?.nativeElement;
    const field = root?.querySelector<HTMLElement>(
      'input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    field?.focus();
  }

  /**
   * Every close path arrives here: Escape, the header's X, a caller's Cancel.
   * One path, so the dirty question cannot be asked in one place and skipped
   * in another.
   */
  requestClose(): void {
    if (this.saving()) return; // nothing truthful to return to yet

    if (!this.dirty()) {
      this.visibleChange.emit(false);
      return;
    }

    // The confirm is a layer of ours too. PrimeNG's own dialog decides Escape
    // by comparing z-indexes rather than by consuming the event, so without
    // this the confirm would close AND this handler would run again.
    const confirmLayer = this.layers.push();
    const release = (): void => this.layers.remove(confirmLayer);

    this.confirmationService.confirm({
      header: this.translate.instant('dialog.discardHeader'),
      message: this.translate.instant('dialog.discardMessage'),
      acceptLabel: this.translate.instant('dialog.discard'),
      rejectLabel: this.translate.instant('dialog.keepEditing'),
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        release();
        this.visibleChange.emit(false);
      },
      reject: release,
    });
  }

  protected onDialogVisibleChange(visible: boolean): void {
    if (visible) {
      this.visibleChange.emit(true);
      return;
    }
    this.requestClose();
  }

  // The scroll area (and the content it wraps) only exists in the DOM
  // while visible() is true, so the ResizeObserver is attached/detached
  // here rather than in ngOnInit — this is the one lifecycle hook
  // guaranteed to run after each time the @if above adds or removes it.
  ngAfterViewChecked(): void {
    const contentEl = this.contentWrapperRef?.nativeElement;
    if (contentEl === this.observedContentEl) return;

    this.teardownObserver();
    this.observedContentEl = contentEl;

    if (contentEl) {
      this.resizeObserver = new ResizeObserver(() => this.updateScrollAffordance());
      this.resizeObserver.observe(contentEl);
      this.updateScrollAffordance();
    } else {
      this.canScrollMore.set(false);
    }
  }

  ngOnDestroy(): void {
    this.teardownObserver();
    this.teardownKeydown?.();
    if (this.layerId !== null) {
      this.layers.remove(this.layerId);
      this.layerId = null;
    }
  }

  onScroll(): void {
    this.updateScrollAffordance();
  }

  // ACC-36 — overscroll-behavior: contain (above) is not sufficient alone:
  // measured live, a ~2px scroll leak still reaches this scroll area on
  // some wheel ticks even while the listbox has plenty of room left,
  // enough to fire a genuine native 'scroll' event here and trigger
  // PrimeNG's ConnectedOverlayScrollHandler close-on-scroll logic. This
  // is the standard, targeted fix for Chrome's scroll-chaining: once the
  // listbox has genuinely reached its own boundary in the gesture's
  // direction, preventDefault() on that specific wheel tick stops the
  // browser from doing anything with the leftover delta at all — neither
  // scrolling the (already-maxed) list further nor chaining it up to this
  // ancestor. Every other tick (mid-list, not yet at a boundary) is left
  // completely untouched — this only ever fires at the boundary.
  // Angular's (wheel) binding is not passive by default, so
  // preventDefault() here is not silently ignored.
  onWheel(event: WheelEvent): void {
    const target = event.target as HTMLElement | null;
    const listContainer = target?.closest(
      '.p-select-list-container, .p-multiselect-list-container',
    ) as HTMLElement | null;
    if (!listContainer) return;

    const atTop = listContainer.scrollTop <= 0;
    const atBottom =
      listContainer.scrollTop + listContainer.clientHeight >= listContainer.scrollHeight;

    if ((event.deltaY < 0 && atTop) || (event.deltaY > 0 && atBottom)) {
      event.preventDefault();
    }
  }

  private updateScrollAffordance(): void {
    const el = this.scrollAreaRef?.nativeElement;
    if (!el) {
      this.canScrollMore.set(false);
      return;
    }
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    this.canScrollMore.set(distanceFromBottom > 4);
  }

  private teardownObserver(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
  }
}
