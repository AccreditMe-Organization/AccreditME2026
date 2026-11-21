import { Component, computed, inject, input } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { MeetingMinutesAi } from '../../meeting-minutes-ai';
import type { MeetingMinutesDto } from '../../services/meeting.service';

/**
 * ACC-322 PR 2 — the Action items card beside the minutes while they are a
 * draft ("AccreditMe AI for Users" 6.2's side column; the summary card the
 * Meetings plan left to PR 7c, which did not build it). Every draft action
 * item of every agenda item, "From item n": no task exists and nobody is told
 * until the minutes are approved, when each becomes a task about the meeting.
 *
 * For whoever records the minutes, the undecided AI action suggestions are
 * counted here too, with the items they sit under: they are not action items
 * until accepted. The count is the AI read's; nobody else gets one (6.6).
 */
@Component({
  selector: 'am-meeting-action-items-card',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <section class="flex flex-col gap-2 rounded-lg border border-[var(--am-border)] bg-[var(--am-card)] p-3" data-testid="meeting-action-items">
      <h2 class="m-0 flex items-center gap-2 text-[15px] font-semibold">
        {{ 'meeting.actionsCard.title' | translate }}
        <span class="text-meta text-[var(--am-ink-500)]">{{ format.number(rows().length) }}</span>
      </h2>
      <p class="m-0 text-meta text-[var(--am-ink-700)]">{{ (rows().length ? 'meeting.actionsCard.lead' : 'meeting.actionsCard.empty') | translate }}</p>
      @if (rows().length) {
        <ul class="m-0 flex list-none flex-col ps-0">
          @for (r of rows(); track r.id) {
            <li class="am-aic__row flex flex-col" [attr.data-action-card-row]="r.id">
              <span class="text-[13px] font-medium" dir="auto">{{ r.title }}</span>
              <span class="text-meta text-[var(--am-ink-500)]">{{ r.owner }} · {{ 'meeting.minutes.due' | translate: { at: format.dateTime(r.dueAt) } }}</span>
              <span class="text-meta text-[var(--am-ink-500)]">{{ 'meeting.actionsCard.fromItem' | translate: { n: format.number(r.itemOrder) } }}</span>
            </li>
          }
        </ul>
      }
      @if (undecided(); as u) {
        <div class="am-aic__ai flex flex-col" data-testid="meeting-action-items-ai">
          <span class="text-meta font-medium text-[var(--am-primary-700)]"><span aria-hidden="true">✦ </span>{{ u.count }} · {{ u.items }}</span>
          <span class="text-meta text-[var(--am-ink-500)]">{{ 'meeting.actionsCard.notYet' | translate }}</span>
        </div>
      }
    </section>
  `,
  styles: [
    `
      .am-aic__row {
        padding-block: var(--am-space-6);
        border-block-start: 1px solid var(--am-border);
      }
      .am-aic__ai {
        padding: var(--am-space-8) var(--am-space-12);
        border-inline-start: 3px dashed var(--am-primary-600);
        background: var(--am-primary-50);
      }
    `,
  ],
})
export class MeetingActionItemsCardComponent {
  readonly format = inject(FormatService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly store = inject(MeetingMinutesAi);

  readonly minutes = input.required<MeetingMinutesDto>();

  /** The draft action items, in agenda order (an item's own order within it). */
  readonly rows = computed(() =>
    this.minutes().items.flatMap((item) => item.actionItems.filter((a) => !a.task).map((a) => ({ id: a.id, title: a.title, owner: a.owner.name, dueAt: a.dueAt, itemOrder: item.order }))),
  );

  /** "3 AI suggestions undecided · items 2, 4", or null with none. */
  readonly undecided = computed(() => {
    this.language.isArabic();
    const actions = this.store.actionSuggestions();
    if (!actions.length) return null;
    const orderOf = new Map(this.minutes().items.map((i) => [i.id, i.order]));
    const orders = [...new Set(actions.map((a) => orderOf.get(a.agendaItemId)).filter((o): o is number => o !== undefined))].sort((a, b) => a - b);
    const list = orders.map((o) => this.format.number(o)).join(this.translate.instant('meeting.ai.listSeparator') as string);
    return {
      count: this.format.count('meeting.aiSuggestionsUndecided', actions.length),
      items: this.format.count('meeting.aiFromItems', orders.length, { list }),
    };
  });
}
