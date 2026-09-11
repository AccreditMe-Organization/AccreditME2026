import { Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { MessageModule } from 'primeng/message';

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
@Component({
  selector: 'app-record-panel',
  standalone: true,
  imports: [TranslatePipe, ProgressSpinnerModule, MessageModule],
  template: `
    <section
      class="flex flex-col min-w-0 rounded-lg bg-[var(--am-card)] border border-[var(--am-border)]"
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
          @if (count() !== null) {
            <!-- Tabular numerals so counts across a row of panels line up, and
                 dir=ltr so the numeral does not reorder inside Arabic. -->
            <span
              dir="ltr"
              style="unicode-bidi: isolate; font-variant-numeric: tabular-nums"
              class="text-[11.5px] font-semibold px-1.5 py-px rounded text-[var(--am-text-secondary)] bg-[var(--am-surface)]"
            >
              {{ count() }}
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

      <div class="overflow-y-auto" [style.min-height.px]="bodyHeight()">
        @if (error()) {
          <div class="p-4">
            <p-message severity="error" [text]="error()! | translate" />
          </div>
        } @else if (loading()) {
          <div class="flex justify-center items-center h-full py-10">
            <p-progressSpinner styleClass="w-8 h-8" strokeWidth="4" />
          </div>
        } @else if (isEmpty()) {
          <!-- The reference's empty state: a muted placeholder mark, the fact,
               and a sentence saying what will live here. The sentence is what
               separates "this module has not shipped" from "this committee has
               none", and a reader cannot tell the difference without it. -->
          <div
            class="flex flex-col items-center justify-center gap-1.5 text-center px-6 py-4 h-full"
            [style.min-height.px]="bodyHeight()"
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
        } @else {
          <ng-content />
        }
      </div>
    </section>
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

  readonly loading = input(false);
  readonly isEmpty = input(false);

  // A translation KEY, unlike the strings above — it names an app-level
  // failure ('task.errorLoad'), not tenant data.
  readonly error = input<string | null>(null);
}
