import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { Observable } from 'rxjs';
import { FormatService } from '../../../../core/formatting';
import { AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { meetingRefusalKey } from '../../meeting-refusal';
import { refusalCode } from '../../../../core/http/refusal';
import { MinutesWriteOrder } from '../../minutes-write-order';
import { HttpErrorResponse } from '@angular/common/http';
import { MeetingService, type MeetingDecisionDto, type MeetingDecisionRequest, type MeetingMinutesDto, type MeetingMinutesItemDto } from '../../services/meeting.service';

interface DecisionDraft {
  /** The decision edited, or null for a new one. */
  id: string | null;
  text: string;
  for: string;
  against: string;
  abstain: string;
}

/**
 * ACC-316 PR 7b — one agenda item's minutes (Meeting Screens, "Minutes Draft ·
 * action items, votes, open actions"): the DISCUSSION, the DECISIONS with their
 * votes (counts only, all three or none) and "Taken without quorum" where the
 * meeting was below it, and the action item DRAFTS, which sit inside their
 * item: no task exists and the owner isn't told until the minutes are approved.
 *
 * Whoever records the minutes writes here while the stage takes them
 * (`canWrite`, the minutes read's `may.recordMinutes`); anyone else reads.
 * Every write answers with the whole minutes, which the page shows when it
 * answers the page's newest write (MinutesWriteOrder, P206).
 *
 * P206: the discussion box follows the STORED discussion only while the person
 * hasn't typed in it. If the stored text changes while they have, their text
 * stays and a line says it changed elsewhere, with Reload. Vote counts are
 * checked here first (whole numbers, 0 or more, all three or none).
 */
@Component({
  selector: 'am-meeting-item-minutes',
  standalone: true,
  imports: [NgTemplateOutlet, FormsModule, TranslatePipe, ButtonModule, TextareaModule],
  template: `
    <div class="flex flex-col gap-2" [attr.data-item-minutes]="item().id">
      <div class="am-im__cols grid gap-3">
        <div class="flex min-w-0 flex-col gap-1">
          <span class="am-im__label">{{ 'meeting.minutes.discussion' | translate }}</span>
          @if (canWrite()) {
            <textarea
              pTextarea
              rows="3"
              maxlength="20000"
              [attr.aria-label]="'meeting.minutes.discussionFor' | translate: { title: item().title }"
              [ngModel]="discussion()"
              (ngModelChange)="discussion.set($event)"
              data-item-discussion
            ></textarea>
            @if (changedElsewhere()) {
              <p class="m-0 flex flex-wrap items-center gap-2 text-meta text-[var(--am-warning-ink)]" role="status" data-item-discussion-elsewhere>
                {{ 'meeting.minutes.changedElsewhere' | translate }}
                <p-button size="small" [text]="true" [label]="'meeting.minutes.reloadDiscussion' | translate" data-item-discussion-reload (onClick)="reloadDiscussion()" />
              </p>
            }
            @if (discussionChanged()) {
              <p-button class="self-start" size="small" [label]="'common.save' | translate" [loading]="busy() === 'discussion'" data-item-discussion-save (onClick)="saveDiscussion()" />
            }
          } @else {
            <p class="m-0 whitespace-pre-line text-[13px]" [class.text-[var(--am-ink-500)]]="!item().discussion">{{ item().discussion || ('meeting.minutes.noDiscussion' | translate) }}</p>
          }
        </div>
        <div class="flex min-w-0 flex-col gap-1">
          <span class="am-im__label">{{ 'meeting.minutes.decisions' | translate }}</span>
          @for (d of item().decisions; track d.id) {
            @if (draft()?.id === d.id) {
              <ng-container *ngTemplateOutlet="decisionForm" />
            } @else {
              <div class="flex flex-col gap-0.5" [attr.data-decision]="d.id">
                <span class="whitespace-pre-line text-[13px]">{{ d.text }}</span>
                @if (d.votes) {
                  <span class="text-meta text-[var(--am-ink-500)]" data-decision-votes>{{ votesLine(d) }}</span>
                }
                @if (d.takenWithoutQuorum) {
                  <span class="am-im__noquorum self-start" data-decision-no-quorum>{{ 'meeting.minutes.withoutQuorum' | translate }}</span>
                }
                @if (canWrite()) {
                  <span class="flex gap-1">
                    <p-button size="small" [text]="true" [label]="'common.edit' | translate" [attr.data-decision-edit]="d.id" (onClick)="editDecision(d)" />
                    <p-button size="small" [text]="true" severity="danger" [label]="'common.remove' | translate" [attr.data-decision-remove]="d.id" (onClick)="removeDecision(d)" />
                  </span>
                }
              </div>
            }
          } @empty {
            @if (!canWrite()) {
              <p class="m-0 text-[13px] text-[var(--am-ink-500)]">{{ 'meeting.minutes.noDecisions' | translate }}</p>
            }
          }
          @if (draft() && draft()!.id === null) {
            <ng-container *ngTemplateOutlet="decisionForm" />
          } @else if (canWrite() && !draft()) {
            <p-button class="self-start" size="small" [text]="true" icon="pi pi-plus" [label]="'meeting.minutes.addDecision' | translate" data-decision-add (onClick)="newDecision()" />
          }
        </div>
      </div>

      <div class="flex flex-col gap-1">
        @for (a of item().actionItems; track a.id) {
          <div class="flex flex-wrap items-center gap-2 text-[13px]" [attr.data-action]="a.id">
            <span>{{ a.title }}</span>
            <span class="text-meta text-[var(--am-ink-500)]">{{ a.owner.name }} · {{ 'meeting.minutes.due' | translate: { at: format.dateTime(a.dueAt) } }}</span>
            @if (!a.task) {
              <span class="am-im__draft" data-action-draft>{{ 'meeting.minutes.draft' | translate }}</span>
            }
            @if (canWrite() && !a.task) {
              <p-button size="small" [text]="true" severity="danger" [label]="'common.remove' | translate" [attr.data-action-remove]="a.id" (onClick)="removeAction(a.id, a.title)" />
            }
          </div>
        }
        @if (canWrite()) {
          <p-button class="self-start" size="small" [text]="true" icon="pi pi-plus" [label]="'meeting.minutes.raiseAction' | translate" data-action-raise (onClick)="raiseAction.emit()" />
        }
      </div>
      @if (error()) {
        <p class="m-0 text-meta text-[var(--am-danger-ink)]" role="alert" data-item-minutes-error>{{ error()!.key | translate: error()!.params }}</p>
      }
    </div>

    <ng-template #decisionForm>
      @if (draft(); as d) {
        <div class="flex flex-col gap-2 rounded border border-[var(--am-border)] p-2" data-decision-form>
          <textarea pTextarea rows="2" maxlength="4000" [attr.aria-label]="'meeting.minutes.decision' | translate" [ngModel]="d.text" (ngModelChange)="patchDraft({ text: $event })" data-decision-text></textarea>
          <fieldset class="m-0 flex flex-wrap gap-2 border-0 p-0" [attr.aria-describedby]="voteError() ? 'votes-error-' + item().id : null">
            <legend class="am-im__label mb-1">{{ 'meeting.minutes.votes' | translate }}</legend>
            @for (v of voteFields; track v.key) {
              <label class="flex items-center gap-1 text-meta">
                {{ v.label | translate }}
                <input
                  type="text"
                  inputmode="numeric"
                  dir="ltr"
                  class="am-im__vote"
                  [attr.aria-invalid]="voteError() ? true : null"
                  [ngModel]="d[v.key]"
                  (ngModelChange)="patchVote(v.key, $event)"
                  [attr.data-vote]="v.key"
                />
              </label>
            }
          </fieldset>
          @if (voteError()) {
            <p class="m-0 text-meta text-[var(--am-danger-ink)]" [id]="'votes-error-' + item().id" data-votes-error>{{ voteError()! | translate }}</p>
          }
          <span class="flex gap-2">
            <p-button size="small" [label]="'common.save' | translate" [loading]="busy() === 'decision'" data-decision-save (onClick)="saveDecision()" />
            <p-button size="small" [text]="true" severity="secondary" [label]="'common.cancel' | translate" (onClick)="draft.set(null)" />
          </span>
        </div>
      }
    </ng-template>
  `,
  styles: [
    `
      .am-im__cols {
        grid-template-columns: repeat(auto-fit, minmax(calc(var(--am-space-40) * 5 + var(--am-space-20)), 1fr));
      }
      .am-im__label {
        font-size: var(--am-type-micro-size);
        font-weight: var(--am-type-micro-weight);
        letter-spacing: var(--am-type-micro-tracking);
        text-transform: var(--am-type-micro-transform);
        color: var(--am-type-micro-color);
      }
      .am-im__noquorum,
      .am-im__draft {
        padding-inline: var(--am-space-8);
        border-radius: var(--am-radius-pill);
        font-size: var(--am-type-meta-size);
      }
      .am-im__noquorum {
        color: var(--am-danger-ink);
        background: var(--am-danger-bg);
      }
      .am-im__draft {
        color: var(--am-ink-700);
        background: var(--am-surface);
      }
      .am-im__vote {
        inline-size: calc(var(--am-space-40) + var(--am-space-16));
        min-block-size: var(--am-control-height);
        padding-inline: var(--am-space-8);
        border: 1px solid var(--am-control-border);
        border-radius: var(--am-radius-button);
        background: var(--am-control-bg);
      }
    `,
  ],
})
export class MeetingItemMinutesComponent {
  private readonly meetings = inject(MeetingService);
  private readonly translate = inject(TranslateService);
  private readonly confirm = inject(AmConfirmService);
  readonly format = inject(FormatService);

  readonly meetingId = input.required<string>();
  readonly item = input.required<MeetingMinutesItemDto>();
  /** Whoever records the minutes, while the stage takes them. */
  readonly canWrite = input(false);
  readonly minutesChange = output<MeetingMinutesDto>();
  /** "Raise action item": the page opens the dialog for this item. */
  readonly raiseAction = output<void>();

  readonly voteFields = [
    { key: 'for' as const, label: 'meeting.minutes.votesFor' },
    { key: 'against' as const, label: 'meeting.minutes.votesAgainst' },
    { key: 'abstain' as const, label: 'meeting.minutes.votesAbstain' },
  ];

  private readonly order = inject(MinutesWriteOrder, { optional: true }) ?? new MinutesWriteOrder();

  readonly discussion = signal('');
  readonly draft = signal<DecisionDraft | null>(null);
  readonly busy = signal<'discussion' | 'decision' | 'remove' | null>(null);
  readonly error = signal<{ key: string; params?: Record<string, string> } | null>(null);
  readonly voteError = signal<string | null>(null);
  /** The stored discussion changed while the person had typed in the box. */
  readonly changedElsewhere = signal(false);
  /** The stored discussion the box last took (or was told about). */
  private lastStored: string | null = null;

  readonly discussionChanged = computed(() => (this.discussion().trim() || null) !== (this.item().discussion ?? null));

  constructor() {
    // The box follows the STORED discussion, and only when that string changes:
    // a new minutes object with the same text (any other write answers with the
    // whole minutes) leaves typed text alone. A change while the box holds typed
    // text keeps it and says so (P206).
    effect(() => {
      const stored = this.item().discussion ?? '';
      untracked(() => {
        if (this.lastStored === null) {
          this.lastStored = stored;
          this.discussion.set(stored);
          return;
        }
        if (stored === this.lastStored) return;
        const dirty = this.discussion() !== this.lastStored;
        this.lastStored = stored;
        if (dirty) this.changedElsewhere.set(true);
        else this.discussion.set(stored);
      });
    });
  }

  /** Reload: the box takes the stored discussion, dropping what was typed. */
  reloadDiscussion(): void {
    this.discussion.set(this.lastStored ?? '');
    this.changedElsewhere.set(false);
  }

  votesLine(d: MeetingDecisionDto): string {
    const v = d.votes!;
    return this.translate.instant('meeting.minutes.votesLine', {
      for: this.format.number(v.for),
      against: this.format.number(v.against),
      abstain: this.format.number(v.abstain),
    }) as string;
  }

  saveDiscussion(): void {
    const value = this.discussion().trim() || null;
    this.run('discussion', this.meetings.saveDiscussion(this.meetingId(), this.item().id, value), () => {
      // The saved text is now the stored one: the box is clean.
      this.lastStored = value ?? '';
      this.discussion.set(value ?? '');
      this.changedElsewhere.set(false);
    });
  }

  newDecision(): void {
    this.error.set(null);
    this.voteError.set(null);
    this.draft.set({ id: null, text: '', for: '', against: '', abstain: '' });
  }

  editDecision(d: MeetingDecisionDto): void {
    this.error.set(null);
    this.voteError.set(null);
    this.draft.set({ id: d.id, text: d.text, for: d.votes ? String(d.votes.for) : '', against: d.votes ? String(d.votes.against) : '', abstain: d.votes ? String(d.votes.abstain) : '' });
  }

  patchDraft(patch: Partial<DecisionDraft>): void {
    this.draft.update((d) => (d ? { ...d, ...patch } : d));
  }

  patchVote(key: 'for' | 'against' | 'abstain', value: string): void {
    this.draft.update((d) => (d ? { ...d, [key]: value } : d));
  }

  saveDecision(): void {
    const d = this.draft();
    if (!d) return;
    // Checked here before sending: whole numbers, 0 or more, all three or none.
    const typed = [d.for, d.against, d.abstain].map((s) => s.trim());
    const given = typed.filter((s) => s !== '').length;
    if (typed.some((s) => s !== '' && !/^\d+$/.test(s))) {
      this.voteError.set('meeting.minutes.votesWhole');
      return;
    }
    if (given !== 0 && given !== 3) {
      this.voteError.set('meeting.minutes.votesAllOrNone');
      return;
    }
    this.voteError.set(null);
    const count = (s: string): number | null => (s === '' ? null : Number(s));
    const body: MeetingDecisionRequest = { text: d.text.trim(), votesFor: count(typed[0]!), votesAgainst: count(typed[1]!), votesAbstain: count(typed[2]!) };
    const request = d.id
      ? this.meetings.updateDecision(this.meetingId(), this.item().id, d.id, body)
      : this.meetings.addDecision(this.meetingId(), this.item().id, body);
    this.run('decision', request, () => this.draft.set(null));
  }

  removeDecision(d: MeetingDecisionDto): void {
    this.confirm.ask({
      tone: 'destructive',
      header: this.translate.instant('meeting.minutes.removeDecisionTitle'),
      message: this.translate.instant('meeting.minutes.removeDecisionLead'),
      acceptLabel: this.translate.instant('common.remove'),
      accept: () => this.run('remove', this.meetings.removeDecision(this.meetingId(), this.item().id, d.id)),
    });
  }

  removeAction(actionId: string, title: string): void {
    this.confirm.ask({
      tone: 'destructive',
      header: this.translate.instant('meeting.minutes.removeActionTitle'),
      message: this.translate.instant('meeting.minutes.removeActionLead', { title }),
      acceptLabel: this.translate.instant('common.remove'),
      accept: () => this.run('remove', this.meetings.removeAction(this.meetingId(), actionId)),
    });
  }

  private run(kind: 'discussion' | 'decision' | 'remove', request: Observable<MeetingMinutesDto>, done?: () => void): void {
    if (this.busy()) return;
    const seq = this.order.begin();
    this.busy.set(kind);
    this.error.set(null);
    request.subscribe({
      next: (minutes) => {
        this.busy.set(null);
        done?.();
        if (this.order.answered(seq)) this.minutesChange.emit(minutes);
      },
      error: (err: unknown) => {
        this.order.failed(seq);
        this.busy.set(null);
        this.error.set(this.refusal(err));
      },
    });
  }

  /** A refusal from its code; the votes refusal says its numbers. */
  private refusal(err: unknown): { key: string; params?: Record<string, string> } {
    if (refusalCode(err) === 'MEETING_VOTES_EXCEED_PRESENT' && err instanceof HttpErrorResponse) {
      const body = err.error as { total?: number; present?: number } | null;
      if (typeof body?.total === 'number' && typeof body.present === 'number') {
        return { key: 'meeting.refusal.votesExceedPresent', params: { votes: this.format.count('meeting.votes', body.total), members: this.format.count('meeting.presentMembers', body.present) } };
      }
      // Without its numbers the sentence would show raw placeholders: a plain one instead.
      return { key: 'meeting.minutes.votesAbovePresent' };
    }
    return { key: meetingRefusalKey(err) ?? 'meeting.minutes.error' };
  }
}
