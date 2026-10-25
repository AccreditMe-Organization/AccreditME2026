import { Component, computed, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { MessageModule } from 'primeng/message';
import { ButtonModule } from 'primeng/button';
import { RequestOutcome } from '../../../core/request-outcome/request-outcome';

// ACC-76 — the object-detail pattern's building block. Committee is its first
// consumer; Meeting Management is expected to reuse it rather than rebuild it.
//
// WHAT IT OWNS: the panel chrome — a small-caps heading, a count chip, an
// action slot, a fixed-height scrolling body — and the three states every
// panel has: loading, error, empty.
//
// A PANEL WITH NOTHING IN IT IS STILL A PANEL — deliberately, and the point of
// the component rather than an accident of it. A Committee's Documents section
// reading "No documents linked" says something true: the relationship exists
// (Committee.termsOfReferenceDocumentId is in the schema today) and is
// unpopulated. Styling it as scaffolding — a "coming soon" ribbon — would say
// a different and worse thing, that the page is unfinished. Same information,
// different message. So the empty state is visually identical whether the
// module ships tomorrow or has shipped and simply has no rows.
//
// FAILS ALONE, BY CONSTRUCTION: `error` is an input, so a panel whose fetch
// 403s renders its own message and leaves every sibling untouched.
//
// FIXED BODY HEIGHT, NOT A MAX: equal-height panels sitting in one row is what
// makes the five-across layout read as a row rather than a ragged edge. It is
// a min-height in practice — see bodyHeight — because Arabic runs longer and
// clipping a row is worse than a slightly uneven edge.
//
// ## THE OPT-IN OUTCOME (ACC-120 slice 5)
//
// ACC-104 left a record page with no panel-level outcome, and the Committee
// page hand-rolls one per panel — a centred spinner, an error on one panel
// only, no Retry. Binding `[outcome]` instead hands the panel the shared
// state machine (core/request-outcome), and the panel then renders artboard
// 8's states itself:
//
//   idle      nothing — an answer inside 200ms never flashes a shape
//   loading   skeleton rows, never a centred spinner
//   empty     the empty state below, unchanged
//   error     the message, Retry (emits `retry`) and the error id when the
//             server sent one; the count reads "—", not a number it does not have
//   denied    ABSENT. The host element is hidden, so the grid reflows as if the
//             panel were never there (Template 2: "the panel is absent")
//   rows      the projected rows
//
// OPT-IN, so nothing changes for a caller that does not bind it: `loading`,
// `isEmpty` and `error` still drive the Committee page exactly as before.
//
// ## FILL (ACC-265)
//
// `[fill]="true"` makes the panel take its cell's height instead of setting
// it: the card is full height, the body takes what is left and scrolls, with
// no min-height. The caller gives the cell its height (the committee page's
// Stage history sits beside the Lifecycle card with `contain: size`, so the
// card alone sets the row). The scrolling body is then a focusable region,
// named by the heading, so a keyboard user can scroll it. Off by default:
// every other panel keeps its fixed body height.
@Component({
  selector: 'app-record-panel',
  standalone: true,
  imports: [TranslatePipe, ProgressSpinnerModule, MessageModule, ButtonModule, NgTemplateOutlet],
  host: { '[style.display]': "isDenied() ? 'none' : null", '[attr.data-outcome]': 'outcome()?.status ?? null' },
  template: `
    <section
      class="flex flex-col min-w-0 rounded-lg bg-[var(--am-card)] border border-[var(--am-border)]"
      [class.h-full]="fill()"
    >
      <header
        class="flex items-center justify-between gap-2.5 px-4 py-2.5 border-b border-[var(--am-border)]"
      >
        <div class="flex items-center gap-2 min-w-0">
          <h3
            class="text-[11px] font-semibold uppercase tracking-wider text-[var(--am-text-secondary)] truncate"
          >
            {{ heading() }}
          </h3>
          @if (shownCount() !== null) {
            <!-- Tabular numerals so counts across a row of panels line up, and
                 dir=ltr so the numeral does not reorder inside Arabic. -->
            <span
              dir="ltr"
              style="unicode-bidi: isolate; font-variant-numeric: tabular-nums"
              class="text-[11.5px] font-semibold px-1.5 py-px rounded text-[var(--am-text-secondary)] bg-[var(--am-surface)]"
            >
              {{ shownCount() }}
            </span>
          }
          @if (badge()) {
            <span
              class="text-[11.5px] font-semibold px-1.5 py-px rounded"
              [style.color]="badgeInk()"
              [style.background]="badgeBackground()"
            >
              {{ badge() }}
            </span>
          }
        </div>
        <!-- Actions live HERE, on the record, rather than sending the user
             elsewhere to act on it. Each caller gates its own on the
             permission the underlying endpoint requires, so an action is shown
             only to someone it will work for. -->
        <div class="flex items-center gap-3 shrink-0">
          <ng-content select="[panelActions]" />
        </div>
      </header>

      <div
        class="overflow-y-auto"
        [class.flex-1]="fill()"
        [class.min-h-0]="fill()"
        [style.min-height.px]="fill() ? null : bodyHeight()"
        [attr.tabindex]="fill() ? 0 : null"
        [attr.role]="fill() ? 'region' : null"
        [attr.aria-label]="fill() ? heading() : null"
        data-panel-body
      >
        @if (outcome(); as o) {
          @switch (o.status) {
            @case ('loading') {
              <div class="flex flex-col gap-3 px-4 py-4" aria-busy="true" data-panel-skeleton>
                <span class="am-skeleton-bar w-3/4"></span>
                <span class="am-skeleton-bar w-1/2"></span>
                <span class="am-skeleton-bar w-2/3"></span>
              </div>
            }
            @case ('error') {
              <div class="flex flex-col items-start gap-2 p-4" role="alert" data-panel-error>
                <p-message severity="error" [text]="(error() ?? 'recordPanel.errorLoad') | translate" />
                @if (o.errorId) {
                  <span dir="ltr" class="text-xs text-[var(--am-text-secondary)] [unicode-bidi:isolate]">
                    {{ 'recordPanel.errorId' | translate: { id: o.errorId } }}
                  </span>
                }
                <p-button size="small" [outlined]="true" [label]="'common.retry' | translate" (onClick)="retry.emit()" />
              </div>
            }
            @case ('empty') {
              <ng-container [ngTemplateOutlet]="emptyTpl" />
            }
            @case ('rows') {
              <ng-container [ngTemplateOutlet]="rowsTpl" />
            }
          }
        } @else if (error()) {
          <div class="p-4">
            <p-message severity="error" [text]="error()! | translate" />
          </div>
        } @else if (loading()) {
          <div class="flex justify-center items-center h-full py-10">
            <p-progressSpinner styleClass="w-8 h-8" strokeWidth="4" />
          </div>
        } @else if (isEmpty()) {
          <ng-container [ngTemplateOutlet]="emptyTpl" />
        } @else {
          <ng-container [ngTemplateOutlet]="rowsTpl" />
        }
      </div>
    </section>

    <ng-template #emptyTpl>
      <!-- The reference's empty state: a muted placeholder mark, the fact,
           and a sentence saying what will live here. The sentence is what
           separates "this module has not shipped" from "this committee has
           none", and a reader cannot tell the difference without it. -->
      <div
        class="flex flex-col items-center justify-center gap-1.5 text-center px-6 py-4 h-full"
        [style.min-height.px]="fill() ? null : bodyHeight()"
      >
        <span
          class="w-[34px] h-[34px] rounded-lg border border-dashed border-[var(--am-border)] bg-[var(--am-surface)]"
        ></span>
        <span class="text-[13px] font-medium mt-0.5">{{ emptyTitle() }}</span>
        @if (emptyMessage()) {
          <span class="text-xs text-[var(--am-text-secondary)] max-w-[30ch]">
            {{ emptyMessage() }}
          </span>
        }
      </div>
    </ng-template>
    <!-- ONE default slot, reached from either path. Two <ng-content /> without a
         selector would project the rows into only one of them. -->
    <ng-template #rowsTpl><ng-content /></ng-template>
  `,
})
export class RecordPanelComponent {
  // Already-resolved display strings, NOT translation keys — a heading may be
  // tenant-editable data, which SYSTEM-REFERENCE §9.3 requires be rendered by
  // isArabic() selection rather than `| translate`. Callers use TranslatePipe
  // in their own templates where the string is a fixed app label.
  readonly heading = input.required<string>();
  readonly emptyTitle = input<string>('');
  readonly emptyMessage = input<string>('');

  // Null hides the chip entirely — distinct from 0, which is a real and
  // displayable answer ("Documents 0" is the point of the empty panel).
  readonly count = input<number | null>(null);

  // A second chip for something that needs attention — "2 overdue". Left
  // generic: the panel does not know what is worth flagging, its caller does.
  readonly badge = input<string | null>(null);
  readonly badgeInk = input<string>('var(--am-severity-critical)');
  readonly badgeBackground = input<string>('var(--am-surface)');

  readonly bodyHeight = input<number>(214);

  /** ACC-265 — take the cell's height, and scroll the body inside it (see FILL above). */
  readonly fill = input(false);

  readonly loading = input(false);
  readonly isEmpty = input(false);

  // A translation KEY, unlike the strings above — it names an app-level
  // failure ('task.errorLoad'), not tenant data.
  readonly error = input<string | null>(null);

  /**
   * The shared request outcome, when the caller uses it. Overrides `loading`
   * and `isEmpty`; `error`, if also bound, supplies the message's key.
   */
  readonly outcome = input<RequestOutcome<unknown> | null>(null);
  /** The error state's Retry. The caller re-runs its request. */
  readonly retry = output<void>();

  protected readonly isDenied = computed(() => this.outcome()?.status === 'denied');

  /** "—" on a failed request: a count the panel does not have is not a number. */
  protected readonly shownCount = computed<number | string | null>(() =>
    this.outcome()?.status === 'error' && this.count() !== null ? '—' : this.count(),
  );
}
