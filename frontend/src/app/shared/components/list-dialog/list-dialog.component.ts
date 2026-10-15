import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  TemplateRef,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { DialogModule } from 'primeng/dialog';
import { LanguageService } from '../../../core/services/language.service';
import { LayerStackService } from '../../overlay/layer-stack.service';

/** Below this window width the list dialog is a full-screen sheet (Record Tasks Panel §2). */
export const LIST_DIALOG_SHEET_BELOW_PX = 760;

/**
 * `am-list-dialog` — the dialog shell for a LIST, not a form (ACC-229, Record
 * Tasks Panel §2, drawn decision 4).
 *
 * EditDialogComponent's 420px body cap exists because a form must fit a
 * laptop without scrolling; a list is the opposite case — it IS the thing that
 * scrolls — so it gets its own shell rather than a size that breaks the cap's
 * rule for every form:
 *
 * - **1040 × 760**, or the window less 96px each way; **below 760px wide, a
 *   full-screen sheet**.
 * - A fixed header (the title and ✕) above the body template, which owns the
 *   rest of the height. The body decides what scrolls inside it; this shell
 *   never scrolls.
 * - **The body is rebuilt on every open** (TemplateRef + ngTemplateOutlet,
 *   rendered only while open — the EditDialog lesson, ACC-29), so a list opens
 *   on its defaults every time and remembers nothing (drawn Q3).
 * - **Escape closes only the top layer** (LayerStackService), listened for in
 *   the CAPTURE phase: a row menu inside closes itself on Escape before the
 *   event bubbles, and would otherwise hand this dialog the same keypress.
 * - **Focus starts in the body's search box once the dialog has opened**, and
 *   returns to whatever opened it (the panel's "See all").
 * - `role="dialog"`, `aria-modal`, named by its title.
 */
@Component({
  selector: 'am-list-dialog',
  standalone: true,
  imports: [DialogModule, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-dialog
      [visible]="visible()"
      [modal]="true"
      [closable]="false"
      [closeOnEscape]="false"
      [draggable]="false"
      [focusOnShow]="false"
      [resizable]="false"
      [blockScroll]="true"
      [style]="frameStyle()"
      [maskStyle]="{ background: 'var(--am-overlay-scrim)' }"
      [styleClass]="sheet() ? 'am-list-dialog am-list-dialog--sheet' : 'am-list-dialog'"
      appendTo="body"
      (onShow)="shown()"
      (onHide)="hidden()"
    >
      <ng-template #headless>
        <div
          class="am-list-dialog__frame"
          role="dialog"
          aria-modal="true"
          [attr.aria-labelledby]="titleId"
          [attr.dir]="language.isRtl() ? 'rtl' : 'ltr'"
          data-testid="list-dialog"
        >
          <div class="am-list-dialog__head" data-testid="list-dialog-head">
            <h2 class="am-list-dialog__title" [id]="titleId">{{ heading() }}</h2>
            @if (count() !== null) {
              <span class="am-list-dialog__count">{{ count() }}</span>
            }
            <span class="flex-1"></span>
            <ng-container [ngTemplateOutlet]="headerExtra()" />
            <button
              type="button"
              class="am-list-dialog__close"
              [attr.aria-label]="closeLabel()"
              [attr.title]="closeLabel()"
              data-testid="list-dialog-close"
              (click)="closeRequested.emit()"
            >
              <i class="pi pi-times" aria-hidden="true"></i>
            </button>
          </div>
          @if (rendered()) {
            <div class="am-list-dialog__body"><ng-container [ngTemplateOutlet]="body()" /></div>
          }
        </div>
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      .am-list-dialog.p-dialog{border:0;border-radius:var(--am-radius-card);overflow:hidden;background:var(--am-surface-raised);box-shadow:var(--am-shadow-overlay)}
      .am-list-dialog--sheet.p-dialog{border-radius:0;max-height:none}
      .am-list-dialog__frame{display:flex;flex-direction:column;block-size:100%;min-block-size:0;font-family:var(--am-font-family);color:var(--am-ink-900);background:var(--am-surface-raised)}
      .am-list-dialog__head{flex:none;display:flex;align-items:center;gap:10px;block-size:64px;box-sizing:border-box;padding:0 16px 0 20px;border-block-end:1px solid var(--am-border)}
      [dir=rtl] .am-list-dialog__head{block-size:68px;padding:0 20px 0 16px}
      .am-list-dialog__title{margin:0;min-inline-size:0;font-size:18px;line-height:24px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      [dir=rtl] .am-list-dialog__title{font-size:19px;line-height:28px}
      .am-list-dialog__count{flex:none;font-size:12px;font-weight:600;color:var(--am-ink-700);background:var(--am-surface);border:1px solid var(--am-border);border-radius:var(--am-radius-pill);padding:0 8px}
      .am-list-dialog__close{flex:none;inline-size:var(--am-icon-button-size);block-size:var(--am-icon-button-size);display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--am-control-border);border-radius:var(--am-radius-button);background:var(--am-control-bg);color:var(--am-ink-900);cursor:pointer}
      .am-list-dialog__close:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
      .am-list-dialog__body{flex:1 1 auto;min-block-size:0;display:flex;flex-direction:column}
    `,
  ],
  // Not encapsulated: `.am-list-dialog.p-dialog` styles PrimeNG's own
  // container. Every class is prefixed am-list-dialog, so nothing leaks.
  encapsulation: ViewEncapsulation.None,
})
export class ListDialogComponent {
  protected readonly language = inject(LanguageService);
  private readonly layers = inject(LayerStackService);
  private readonly document = inject(DOCUMENT);

  readonly visible = input(false);
  /** The title, already translated — the dialog's accessible name. */
  readonly heading = input.required<string>();
  /** A count beside the title, or null for none. */
  readonly count = input<string | null>(null);
  /** The ✕'s name, already translated. */
  readonly closeLabel = input.required<string>();
  /** The list itself: rebuilt on every open. */
  readonly body = input.required<TemplateRef<unknown>>();
  /** Header buttons before the ✕ (New task). */
  readonly headerExtra = input<TemplateRef<unknown> | null>(null);
  /** Escape on the top layer, and the ✕. The host closes it. */
  readonly closeRequested = output<void>();

  private static nextId = 0;
  protected readonly titleId = `am-list-dialog-title-${++ListDialogComponent.nextId}`;

  readonly sheet = signal(false);
  /** The body exists only while open, so each open starts fresh. */
  readonly rendered = signal(false);
  readonly frameStyle = computed(() =>
    this.sheet()
      ? { width: '100vw', height: '100vh', 'max-height': '100vh', margin: '0' }
      : { width: 'min(1040px, calc(100vw - 96px))', height: 'min(760px, calc(100vh - 96px))', 'max-height': 'none' },
  );

  private layerId: number | null = null;
  private opener: HTMLElement | null = null;

  constructor() {
    const destroyRef = inject(DestroyRef);
    const query = this.document.defaultView?.matchMedia?.(`(max-width: ${LIST_DIALOG_SHEET_BELOW_PX - 0.02}px)`);
    if (query) {
      this.sheet.set(query.matches);
      const onChange = (e: MediaQueryListEvent): void => this.sheet.set(e.matches);
      query.addEventListener('change', onChange);
      destroyRef.onDestroy(() => query.removeEventListener('change', onChange));
    }

    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !this.visible()) return;
      if (this.layerId === null || !this.layers.isTop(this.layerId)) return;
      event.stopPropagation();
      event.preventDefault();
      this.closeRequested.emit();
    };
    this.document.addEventListener('keydown', onKeydown, true);
    destroyRef.onDestroy(() => this.document.removeEventListener('keydown', onKeydown, true));

    effect(() => {
      if (this.visible()) {
        this.open();
      } else {
        // Released at once, not on PrimeNG's hide: a dialog reopened before its
        // hide event fired would otherwise still hold its old layer and never
        // render its body again.
        this.rendered.set(false);
        this.release();
      }
    });
    destroyRef.onDestroy(() => this.release());
  }

  /**
   * Where focus goes once the dialog has FINISHED opening (PrimeNG's onShow
   * fires after its enter animation). Before then the body exists but the
   * dialog is not yet in the page, so a body that focuses itself on its first
   * render focuses nothing — which is why, live, focus landed on the frame
   * (ACC-229). So the shell decides, now:
   *   1. something inside already has focus (a deep link's row): leave it;
   *   2. else the body's search box (`[autofocus]`, else `input[type=search]`);
   *   3. else the dialog itself, so its name is announced.
   * PrimeNG's own focusOnShow is off: it would move focus to the first
   * focusable element (the header's ✕) on a timer of its own.
   */
  shown(): void {
    const frame = this.document.querySelector<HTMLElement>(`#${this.titleId}`)?.closest<HTMLElement>('[role=dialog]');
    if (!frame || frame.contains(this.document.activeElement)) return;
    const search = frame.querySelector<HTMLElement>('[autofocus], input[type="search"]');
    if (search) {
      search.focus();
      return;
    }
    frame.setAttribute('tabindex', '-1');
    frame.focus();
  }

  hidden(): void {
    if (this.visible()) return;
    const opener = this.opener;
    this.opener = null;
    if (opener?.isConnected) opener.focus();
  }

  private open(): void {
    if (this.layerId !== null) return;
    this.layerId = this.layers.push();
    const active = this.document.activeElement;
    this.opener = active instanceof HTMLElement ? active : null;
    this.rendered.set(true);
  }

  private release(): void {
    if (this.layerId !== null) {
      this.layers.remove(this.layerId);
      this.layerId = null;
    }
  }
}
