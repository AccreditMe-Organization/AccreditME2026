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
import { DialogModule } from 'primeng/dialog';
import { ConfirmationService, PrimeTemplate } from 'primeng/api';
import { TranslateService } from '@ngx-translate/core';
import { LayerStackService } from '../../overlay/layer-stack.service';
import { ListFocusService } from '../data-list/list-focus.service';

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
  imports: [DialogModule, NgTemplateOutlet, PrimeTemplate],
  template: `
    <p-dialog
      [visible]="visible()"
      (visibleChange)="onDialogVisibleChange($event)"
      [header]="header()"
      [modal]="true"
      [closeOnEscape]="false"
      [dismissableMask]="false"
      [closable]="!saving()"
      [appendTo]="appendTo()"
      [style]="{ width: resolvedWidth() }"
    >
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
      :host ::ng-deep .p-select-list-container,
      :host ::ng-deep .p-multiselect-list-container {
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

  /**
   * Where the dialog's own DOM goes. 'self' (the default) keeps it a
   * descendant of this component, which the ACC-36 overscroll rules depend on:
   * they are :host ::ng-deep, so a body-appended dialog silently loses them.
   *
   * 'body' is for a layer that must have NO scrollable ancestor at all — a
   * calendar or picker stacked above another dialog (ACC-111, dialog rule 4).
   * Safe there precisely because such a layer holds no PrimeNG overlay of its
   * own, so there is nothing for those rules to protect.
   */
  readonly appendTo = input<'self' | 'body'>('self');

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
    // Bubble phase plus defaultPrevented is the whole guard now, and it is
    // BEHAVIOURAL rather than a list of class names:
    //   - p-select and p-multiselect call stopPropagation, so the event never
    //     reaches this listener at all;
    //   - p-datepicker, p-autocomplete, p-cascadeselect and p-tieredmenu call
    //     preventDefault, so defaultPrevented is true;
    //   - our own layers register with LayerStackService and are checked below.
    // All four verified against the installed PrimeNG source, not assumed.
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !this.visible()) return;
      // Something else already dealt with this keystroke.
      if (event.defaultPrevented) return;
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
          // Not restored here: the list refetches after a delete, and
          // DataListComponent restores once the new rows are in the DOM.
          this.listFocus.noteRowRemoved(this.triggerRowIndex);
        }
        this.triggerElement = null;
        this.triggerRowIndex = -1;
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
    const field = this.host.nativeElement.querySelector<HTMLElement>(
      '.p-dialog-content input:not([type="hidden"]), .p-dialog-content select, .p-dialog-content textarea, .p-dialog-content [tabindex]:not([tabindex="-1"])',
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
