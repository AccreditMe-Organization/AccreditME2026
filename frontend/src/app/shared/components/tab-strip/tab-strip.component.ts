import { Component, ElementRef, inject, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { AmCountPipe } from '../../../core/formatting';
import { LanguageService } from '../../../core/services/language.service';

export interface TabStripItem {
  /** Stable id; also builds the tab's and its panel's element ids. */
  id: string;
  /** A translation key, not a label — the strip translates it. */
  key: string;
  /** Problems on this tab; drawn as "⚠ n" and named for a screen reader. */
  errors?: number;
}

/**
 * The tab strip for a TABBED dialog (ACC-238), rendered in the dialog HEADER.
 *
 * ## Tabs, not steps
 *
 * A stepped dialog (`am-step-strip`) walks a reader through an order: Next,
 * then Back. A tabbed one holds several groups of the same record that may be
 * filled in any order and are saved together by one Save — the committee's
 * Edit dialog in Formation is the first. So these are real tabs: a WAI-ARIA
 * tablist whose buttons switch the panel the caller renders below.
 *
 * ## Why in the header
 *
 * For the step strip's reasons: the header does not change between tabs, and
 * a strip in the header costs NOTHING against the 420px body cap.
 *
 * ## Keyboard
 *
 * One tab stop for the strip (roving tabindex on the selected tab). The arrow
 * keys move AND select, following reading direction — in Arabic the left
 * arrow is "next" — and Home and End go to the first and last tab.
 *
 * ## Errors
 *
 * A tab holding a problem shows "⚠" and its count, the drawing's mark, and
 * its accessible name says how many. Colour is never the only carrier.
 *
 * Renders nothing below two tabs, as the step strip does.
 */
@Component({
  selector: 'am-tab-strip',
  standalone: true,
  imports: [TranslatePipe, AmCountPipe],
  template: `
    @if (tabs().length > 1) {
      <div class="am-tabs" role="tablist" [attr.aria-label]="ariaLabel()" (keydown)="onKeydown($event)">
        @for (t of tabs(); track t.id) {
          <button
            type="button"
            role="tab"
            class="am-tabs__tab"
            [class.am-tabs__tab--on]="t.id === selected()"
            [id]="tabId(t.id)"
            [attr.aria-selected]="t.id === selected()"
            [attr.aria-controls]="panelId(t.id)"
            [attr.tabindex]="t.id === selected() ? 0 : -1"
            [attr.data-tab]="t.id"
            (click)="select(t.id)"
          >
            <span>{{ t.key | translate }}</span>
            @if (t.errors) {
              <span class="am-tabs__errors" aria-hidden="true" [attr.data-tab-errors]="t.id">⚠ {{ t.errors }}</span>
              <span class="sr-only">{{ t.errors | amCount: 'shell.tabProblems' }}</span>
            }
          </button>
        }
      </div>
    }
  `,
  styles: [
    `
      .am-tabs {
        display: flex;
        block-size: 36px;
        margin: var(--am-space-12) 0 0;
        border-block-end: 1px solid var(--am-border);
      }
      :host-context([dir='rtl']) .am-tabs {
        block-size: 40px;
      }

      .am-tabs__tab {
        display: inline-flex;
        align-items: center;
        gap: var(--am-space-8);
        padding: 0 var(--am-space-12);
        margin-block-end: -1px;
        border: 0;
        border-block-end: 2px solid transparent;
        background: none;
        font: inherit;
        font-size: calc(var(--am-type-meta-size) + 1px);
        white-space: nowrap;
        color: var(--am-ink-700);
        cursor: pointer;
      }

      .am-tabs__tab--on {
        font-weight: 600;
        color: var(--am-primary-700);
        border-block-end-color: var(--am-primary-600);
      }

      .am-tabs__tab:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: calc(-1 * var(--am-focus-ring-width));
      }

      .am-tabs__errors {
        color: var(--am-danger-ink);
        font-weight: 600;
      }
    `,
  ],
})
export class TabStripComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly language = inject(LanguageService);

  readonly tabs = input.required<readonly TabStripItem[]>();
  readonly selected = input.required<string>();
  readonly ariaLabel = input<string>('');
  /** Prefixes the tab and panel ids, so two strips on one page cannot collide. */
  readonly idPrefix = input.required<string>();
  readonly selectedChange = output<string>();

  tabId(id: string): string {
    return `${this.idPrefix()}-tab-${id}`;
  }

  /** The id the caller gives the panel for this tab (`role="tabpanel"`). */
  panelId(id: string): string {
    return `${this.idPrefix()}-panel-${id}`;
  }

  select(id: string): void {
    if (id !== this.selected()) this.selectedChange.emit(id);
  }

  onKeydown(event: KeyboardEvent): void {
    const ids = this.tabs().map((t) => t.id);
    const at = ids.indexOf(this.selected());
    const forward = this.language.isRtl() ? 'ArrowLeft' : 'ArrowRight';
    const backward = this.language.isRtl() ? 'ArrowRight' : 'ArrowLeft';
    let next: number;
    if (event.key === forward) next = (at + 1) % ids.length;
    else if (event.key === backward) next = (at - 1 + ids.length) % ids.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = ids.length - 1;
    else return;
    event.preventDefault();
    const id = ids[next]!;
    this.select(id);
    // Focus follows the selection, after the selected tab has re-rendered.
    queueMicrotask(() => this.host.nativeElement.querySelector<HTMLElement>(`[data-tab="${id}"]`)?.focus());
  }
}
