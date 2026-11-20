import { Component, computed, inject, input, linkedSignal, output } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import type { WorkflowMoveDto } from '../../../workflow/services/workflow.service';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import type { MoveBlock } from '../../../workflow/components/workflow-transition-actions/workflow-transition-actions.component';

/**
 * The codes the meeting page explains: what holds Approve Minutes
 * (`minutesApprovalBlocks()` on the server, one at a time, in the order a
 * Secretary fixes them).
 */
export const MEETING_APPROVAL_BLOCKS: ReadonlySet<string> = new Set([
  'MEETING_REVIEW_OPEN',
  'MEETING_SUGGESTION_OPEN',
  'MEETING_ACTION_PAST_DUE',
  'MEETING_ACTION_PAST_SLA_LIMIT',
]);

/** The dialog lists this many people or action items before "and n more", so it stays under the 420 cap. */
export const CANT_APPROVE_LINES_MAX = 6;

interface BlockedItem {
  id: string;
  title: string;
  agendaItemOrder: number | null;
  dueAt: string;
}

/**
 * ACC-316 PR 7c-2 — "Can't move to Minutes Approved yet" (Meeting Screens; a
 * 420 confirm with Close only, as `CantMoveDialogComponent`): the ONE thing that
 * holds Approve Minutes now, from the move's `blockedBy` (or the press's
 * refusal), said from its code with its details. The server names one blocker
 * at a time (seeing them all is ACC-326), so the lead says what to do about this
 * one and never claims it is the last.
 *
 * The page clears its refusal as the dialog closes; the dialog keeps the last
 * one it was given, so its text doesn't blank during the close animation.
 */
@Component({
  selector: 'app-meeting-cant-approve-dialog',
  standalone: true,
  imports: [TranslatePipe, ButtonModule, EditDialogComponent],
  template: `
    <ng-template #bodyTpl>
      <div class="flex flex-col gap-2" data-testid="cant-approve-body" [attr.data-block]="shown()?.code">
        <p class="m-0 text-[13px]" data-testid="cant-approve-lead">{{ lead() }}</p>
        @if (lines().length) {
          <ul class="m-0 ps-4 text-[13px]" data-testid="cant-approve-lines">
            @for (line of lines(); track $index) {
              <!-- One line each, cut with an ellipsis and whole in its tooltip, so
                   six long titles stay under the cap; the due date comes first. -->
              <li><span class="block truncate" [attr.title]="line">{{ line }}</span></li>
            }
          </ul>
          @if (more(); as m) {
            <p class="m-0 text-meta text-[var(--am-ink-700)]" data-testid="cant-approve-more">{{ m }}</p>
          }
        }
      </div>
    </ng-template>
    <ng-template #footerTpl>
      <div class="flex items-center justify-between gap-3">
        @if (openedFrom(); as from) {
          <span class="min-w-0 text-meta text-[var(--am-ink-700)]">{{ 'workflow.cantMove.openedFrom' | translate: { transition: from } }}</span>
        } @else {
          <span></span>
        }
        <p-button type="button" [label]="'common.close' | translate" data-testid="cant-approve-close" (onClick)="visibleChange.emit(false)" />
      </div>
    </ng-template>
    <app-edit-dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="'workflow.cantMove.title' | translate: { stage: stageName() }"
      [context]="context()"
      [content]="bodyTpl"
      [footer]="footerTpl"
      role="alertdialog"
      size="confirm"
    />
  `,
})
export class MeetingCantApproveDialogComponent {
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);
  private readonly language = inject(LanguageService);

  readonly visible = input.required<boolean>();
  /** The move that is held (Approve Minutes) and what holds it. */
  readonly refusal = input<{ move: WorkflowMoveDto; blockedBy: MoveBlock } | null>(null);
  /** The meeting, then its stage. */
  readonly context = input('');
  readonly visibleChange = output<boolean>();

  /** The last refusal given, kept while the page's goes null on close. */
  private readonly kept = linkedSignal<{ move: WorkflowMoveDto; blockedBy: MoveBlock } | null, { move: WorkflowMoveDto; blockedBy: MoveBlock } | null>({
    source: () => this.refusal(),
    computation: (next, prev) => next ?? prev?.value ?? null,
  });
  /** What holds the move. */
  readonly shown = computed(() => this.kept()?.blockedBy ?? null);
  /** The stage the move enters ("Minutes Approved"), in the reader's language. */
  readonly stageName = computed(() => {
    const m = this.kept()?.move;
    return m ? this.language.bilingual(m.toStageNameEn, m.toStageNameAr) : '';
  });
  /** The move that was pressed ("Approve Minutes"). */
  readonly openedFrom = computed(() => {
    const m = this.kept()?.move;
    return m ? this.language.bilingual(m.labelEn, m.labelAr) : null;
  });

  readonly lead = computed(() => {
    this.translate.currentLang();
    const b = this.shown();
    if (!b) return '';
    switch (b.code) {
      case 'MEETING_REVIEW_OPEN': {
        const by = typeof b['reviewBy'] === 'string' ? (b['reviewBy'] as string) : null;
        return by
          ? (this.translate.instant('meeting.cantApprove.reviewOpen', { day: this.format.date(`${by}T12:00:00.000Z`) }) as string)
          : (this.translate.instant('meeting.cantApprove.reviewOpenNoDate') as string);
      }
      case 'MEETING_SUGGESTION_OPEN':
        return this.format.count('meeting.cantApprove.suggestionsOpen', typeof b['open'] === 'number' ? (b['open'] as number) : 1);
      case 'MEETING_ACTION_PAST_DUE':
        return this.format.count('meeting.cantApprove.actionsPastDue', this.items().length);
      case 'MEETING_ACTION_PAST_SLA_LIMIT': {
        const limit = typeof b['limit'] === 'string' ? this.format.dateTime(b['limit'] as string) : '—';
        return this.format.count('meeting.cantApprove.actionsPastLimit', this.items().length, { limit });
      }
      default:
        return this.translate.instant('meeting.cantApprove.other') as string;
    }
  });

  /** Who the review waits for, or the action items to change: at most CANT_APPROVE_LINES_MAX. */
  readonly lines = computed(() => this.allLines().slice(0, CANT_APPROVE_LINES_MAX));
  /** "and 4 more", past the lines shown; null when every line shows. */
  readonly more = computed(() => {
    const rest = this.allLines().length - CANT_APPROVE_LINES_MAX;
    return rest > 0 ? this.format.count('meeting.cantApprove.more', rest) : null;
  });

  private readonly allLines = computed(() => {
    this.translate.currentLang();
    const b = this.shown();
    if (!b) return [];
    if (b.code === 'MEETING_REVIEW_OPEN') {
      const waiting = Array.isArray(b['waitingFor']) ? (b['waitingFor'] as { name: string }[]) : [];
      return waiting.map((p) => p.name);
    }
    return this.items().map((i) =>
      i.agendaItemOrder
        ? (this.translate.instant('meeting.cantApprove.itemLine', { n: this.format.number(i.agendaItemOrder), title: i.title, at: this.format.dateTime(i.dueAt) }) as string)
        : (this.translate.instant('meeting.cantApprove.itemLineNoOrder', { title: i.title, at: this.format.dateTime(i.dueAt) }) as string),
    );
  });

  private readonly items = computed((): BlockedItem[] => {
    const b = this.shown();
    return b && Array.isArray(b['items']) ? (b['items'] as BlockedItem[]) : [];
  });
}
