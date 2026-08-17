import {
  AfterViewChecked,
  Component,
  ElementRef,
  OnDestroy,
  TemplateRef,
  ViewChild,
  input,
  output,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { DialogModule } from 'primeng/dialog';

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
  imports: [DialogModule, NgTemplateOutlet],
  template: `
    <p-dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="header()"
      [modal]="true"
      [style]="{ width: width() }"
    >
      @if (visible()) {
        <div class="relative">
          <div
            #scrollArea
            class="max-h-[60vh] overflow-y-auto pr-1"
            (scroll)="onScroll()"
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
    `,
  ],
})
export class EditDialogComponent implements AfterViewChecked, OnDestroy {
  readonly visible = input.required<boolean>();
  readonly header = input<string>('');
  readonly content = input.required<TemplateRef<unknown>>();
  readonly width = input<string>('560px');
  readonly visibleChange = output<boolean>();

  @ViewChild('scrollArea') private readonly scrollAreaRef?: ElementRef<HTMLDivElement>;
  @ViewChild('contentWrapper') private readonly contentWrapperRef?: ElementRef<HTMLDivElement>;

  readonly canScrollMore = signal(false);

  private resizeObserver?: ResizeObserver;
  private observedContentEl?: HTMLDivElement;

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
  }

  onScroll(): void {
    this.updateScrollAffordance();
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
