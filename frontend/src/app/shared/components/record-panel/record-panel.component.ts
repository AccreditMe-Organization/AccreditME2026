import { Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { MessageModule } from 'primeng/message';
import { CardComponent } from '../card/card.component';

// ACC-76 — the object-detail pattern's building block. Committee is its first
// consumer; Meeting Management is expected to reuse it rather than rebuild it.
//
// WHAT IT OWNS: the chrome (heading, optional count, optional action slot) and
// the three states every panel has — loading, error, empty. The consumer
// projects its own body, because a task table and a sub-committee list have
// nothing structural in common.
//
// A PANEL WITH NOTHING IN IT IS STILL A PANEL — deliberately, and this is the
// point of the component rather than an accident of it. A Committee's
// Documents section reading "No documents linked yet" says a true thing: the
// relationship exists (Committee.termsOfReferenceDocumentId is in the schema
// today) and is unpopulated. Styling that section as scaffolding — a dashed
// border, a "coming soon" ribbon — would say a different and worse thing,
// that the page is unfinished. Same information, different message. So an
// empty state here is visually identical whether the module ships tomorrow or
// has shipped and simply has no rows.
//
// FAILS ALONE, BY CONSTRUCTION: `error` is an input, so a panel whose fetch
// 403s (a user without tasks:view, say) renders its own message and leaves
// every sibling panel untouched. Nothing here can blank the page.
@Component({
  selector: 'app-record-panel',
  standalone: true,
  imports: [TranslatePipe, ProgressSpinnerModule, MessageModule, CardComponent],
  template: `
    <app-card>
      <div class="flex flex-col gap-3">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-baseline gap-2">
            <h3 class="text-lg font-medium">{{ heading() }}</h3>
            @if (count() !== null) {
              <span class="text-sm text-[var(--am-text-secondary)]">({{ count() }})</span>
            }
          </div>
          <!-- Optional trailing controls (e.g. an add button). Projected by
               selector so a consumer that has none renders no empty flex
               child. -->
          <ng-content select="[panelActions]" />
        </div>

        @if (description()) {
          <p class="text-xs text-[var(--am-text-secondary)]">{{ description() }}</p>
        }

        @if (error()) {
          <p-message severity="error" [text]="error()! | translate" />
        } @else if (loading()) {
          <div class="flex justify-center py-6">
            <p-progressSpinner styleClass="w-8 h-8" strokeWidth="4" />
          </div>
        } @else if (isEmpty()) {
          <p class="py-6 text-center text-sm text-[var(--am-text-secondary)]">
            {{ emptyMessage() }}
          </p>
        } @else {
          <ng-content />
        }
      </div>
    </app-card>
  `,
})
export class RecordPanelComponent {
  // Already-resolved display strings, NOT translation keys. Two reasons:
  // a heading may be tenant-editable data (a lookup label, a stage name),
  // which SYSTEM-REFERENCE §9.3 requires be rendered by isArabic() selection
  // rather than `| translate`; and a consumer using TranslatePipe in its own
  // template is the established convention here.
  readonly heading = input.required<string>();
  readonly description = input<string | null>(null);
  readonly emptyMessage = input<string>('');

  // Null hides the count entirely — distinct from 0, which is a real,
  // displayable answer ("Tasks (0)").
  readonly count = input<number | null>(null);

  readonly loading = input(false);
  readonly isEmpty = input(false);

  // A translation KEY, unlike the strings above — it names an app-level
  // failure ('task.errorLoad'), not tenant data. Matches how every existing
  // screen surfaces load errors.
  readonly error = input<string | null>(null);
}
