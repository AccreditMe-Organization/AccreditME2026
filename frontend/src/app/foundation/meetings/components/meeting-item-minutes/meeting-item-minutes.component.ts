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
 * Every write answers with the whole minutes, which the page shows.
 */
@Component({
  selector: 'am-meeting-item-minutes',
  standalone: true,
  imports: [NgTemplateOutlet, FormsModule, TranslatePipe, ButtonModule, TextareaModule],
  template: `
    <div class="flex flex-col gap-2" [attr.data-item-minutes]="item().id">
      <div class="grid gap-3" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr))">
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
        <p class="m-0 text-meta text-[var(--am-danger-ink)]" role="alert" data-item-minutes-error>{{ error()! | translate }}</p>
      }
    </div>

    <ng-template #decisionForm>
      @if (draft(); as d) {
        <div class="flex flex-col gap-2 rounded border border-[var(--am-border)] p-2" data-decision-form>
          <textarea pTextarea rows="2" maxlength="4000" [attr.aria-label]="'meeting.minutes.decision' | translate" [ngModel]="d.text" (ngModelChange)="patchDraft({ text: $event })" data-decision-text></textarea>
          <fieldset class="m-0 flex flex-wrap gap-2 border-0 p-0">
            <legend class="am-im__label mb-1">{{ 'meeting.minutes.votes' | translate }}</legend>
            @for (v of voteFields; track v.key) {
              <label class="flex items-center gap-1 text-meta">
                {{ v.label | translate }}
                <input type="text" inputmode="numeric" dir="ltr" class="am-im__vote" [ngModel]="d[v.key]" (ngModelChange)="patchVote(v.key, $event)" [attr.data-vote]="v.key" />
              </label>
            }
          </fieldset>
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
      .am-im__label {
        font-size: var(--am-type-meta-size);
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--am-ink-500);
      }
      .am-im__noquorum,
      .am-im__draft {
        padding-inline: var(--am-space-8);
        border-radius: 999px;
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
        inline-size: 56px;
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

  readonly discussion = signal('');
  readonly draft = signal<DecisionDraft | null>(null);
  readonly busy = signal<'discussion' | 'decision' | 'remove' | null>(null);
  readonly error = signal<string | null>(null);

  readonly discussionChanged = computed(() => (this.discussion().trim() || null) !== (this.item().discussion ?? null));

  constructor() {
    // The box follows the stored discussion whenever the server's changes.
    effect(() => {
      const stored = this.item().discussion ?? '';
      untracked(() => this.discussion.set(stored));
    });
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
    this.run('discussion', this.meetings.saveDiscussion(this.meetingId(), this.item().id, this.discussion().trim() || null));
  }

  newDecision(): void {
    this.error.set(null);
    this.draft.set({ id: null, text: '', for: '', against: '', abstain: '' });
  }

  editDecision(d: MeetingDecisionDto): void {
    this.error.set(null);
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
    const count = (s: string): number | null => (s.trim() === '' ? null : Number(s.trim()));
    const body: MeetingDecisionRequest = { text: d.text.trim(), votesFor: count(d.for), votesAgainst: count(d.against), votesAbstain: count(d.abstain) };
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
    this.busy.set(kind);
    this.error.set(null);
    request.subscribe({
      next: (minutes) => {
        this.busy.set(null);
        done?.();
        this.minutesChange.emit(minutes);
      },
      error: (err: unknown) => {
        this.busy.set(null);
        this.error.set(meetingRefusalKey(err) ?? 'meeting.minutes.error');
      },
    });
  }
}
