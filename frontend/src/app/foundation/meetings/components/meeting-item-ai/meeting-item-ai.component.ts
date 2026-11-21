import { Component, Injector, afterNextRender, computed, inject, input, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { type Observable } from 'rxjs';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { AiAssistComponent } from '../../../../shared/components/ai-assist/ai-assist.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { InlineCalendarComponent } from '../../../../shared/components/inline-calendar/inline-calendar.component';
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
import { type MeetingFailure, meetingFailure } from '../../meeting-refusal';
import { MeetingMinutesAi } from '../../meeting-minutes-ai';
import { actionOwnerOptions } from '../../meeting-action-owners';
import { dayInstant, meetingDay, meetingStart, meetingTimeText, meetingTimeValidator, meetingToday } from '../../meeting-when';
import { MeetingWhenFieldComponent } from '../meeting-when-field/meeting-when-field.component';
import type { MeetingAiActionSuggestionDto, MeetingAiMinutesSuggestionDto, MeetingAttendanceRowDto, MeetingVotesDto } from '../../services/meeting.service';

function notBlank(control: AbstractControl): ValidationErrors | null {
  return typeof control.value === 'string' && control.value.trim() ? null : { required: true };
}

/** "2026-09-15" as the calendar's plain day. */
function plainDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

/**
 * ACC-322 PR 2 — one agenda item's AI suggestions, under its minutes ("AccreditMe
 * AI for Users" 6.2, 6.3, 6.4). Only whoever records the minutes gets any
 * (the AI read is empty for everyone else, 6.6).
 *
 * THE MINUTES SUGGESTION (am-ai-assist, saved, so `quiet`): the discussion,
 * each decision with its vote as the notes stated it (M6: copied, never
 * changed, and flagged with the minutes' own words when it is above the
 * members present), and the line saying what Accept replaces (M5). "Accept
 * into minutes" writes it; Edit writes it too and moves focus into the
 * discussion box; Discard removes it. An item the notes say nothing about
 * reads so, with Discard only.
 *
 * THE ACTION SUGGESTIONS (one am-ai-assist box, a row each): what, owner and
 * due date, with our code's reason when one is empty (an outside guest is
 * never suggested, M7; a name nobody matches; a date that has passed). Accept
 * is offered only with both an owner and a due date; Edit opens the three
 * fields inline, prefilled, and saving them accepts with those values. An
 * accepted action is an ordinary draft action item: a task when the minutes
 * are approved.
 *
 * Every refusal is said from its code; a suggestion gone (decided elsewhere,
 * or replaced by Draft again) offers Reload.
 */
@Component({
  selector: 'am-meeting-item-ai',
  standalone: true,
  imports: [NgTemplateOutlet, ReactiveFormsModule, TranslatePipe, ButtonModule, InputTextModule, AiAssistComponent, FieldComponent, InlineCalendarComponent, OverlaySelectComponent, MeetingWhenFieldComponent],
  template: `
    @if (minutesSuggestion(); as s) {
      <div class="am-ia" data-ai-suggestion [attr.data-ai-minutes]="s.id">
        @if (s.nothing) {
          <p class="m-0 flex flex-wrap items-center gap-2 text-meta text-[var(--am-ink-500)]" tabindex="-1">
            {{ 'meeting.ai.nothing' | translate }}
            <p-button size="small" [text]="true" [label]="'ai.assist.discard' | translate" [ariaLabel]="'meeting.ai.discardNothing' | translate: { title: itemTitle() }" [disabled]="busy() !== null" data-ai-discard (onClick)="discard(s.id)" />
          </p>
        } @else {
          <am-ai-assist
            [hideTrigger]="true"
            [quiet]="true"
            state="result"
            [triggerLabel]="'meeting.ai.draftMinutes' | translate"
            [tag]="'meeting.ai.minutesTag' | translate"
            [accept]="true"
            [acceptLabel]="'meeting.ai.acceptIntoMinutes' | translate"
            [busy]="busy() !== null"
            [resultTemplate]="minutesTpl"
            (accepted)="acceptMinutes(s, false)"
            (edited)="acceptMinutes(s, true)"
            (discarded)="discard(s.id)"
          />
          <ng-template #minutesTpl>
            <div class="flex flex-col gap-1 text-[13px]">
              @if (s.discussion) {
                <span class="am-ia__label">{{ 'meeting.minutes.discussion' | translate }}</span>
                <span class="whitespace-pre-line" dir="auto" data-ai-discussion>{{ s.discussion }}</span>
              }
              @for (d of s.decisions; track $index) {
                <span class="am-ia__label mt-1">{{ 'meeting.minutes.decision' | translate }}</span>
                <span class="whitespace-pre-line" dir="auto">{{ d.text }}</span>
                <span class="text-meta tabular-nums" [class.text-[var(--am-ink-500)]]="!d.votes" data-ai-votes>{{ votesLine(d.votes) }}</span>
                @if (d.abovePresent && d.votes) {
                  <span class="text-meta font-medium text-[var(--am-danger-ink)]" data-ai-votes-above>{{ aboveLine(d.votes) }}</span>
                }
              }
              @if (replacesKey(s); as key) {
                <span class="mt-1 text-meta text-[var(--am-primary-700)]" data-ai-replaces>{{ key | translate }}</span>
              }
            </div>
          </ng-template>
        }
      </div>
    }

    @if (actionSuggestions().length) {
      <div class="am-ia" data-ai-suggestion data-ai-actions>
        <am-ai-assist [hideTrigger]="true" [quiet]="true" state="result" [triggerLabel]="'meeting.ai.draftMinutes' | translate" [tag]="'meeting.ai.actionsTag' | translate" [resultTemplate]="actionsTpl" />
        <ng-template #actionsTpl>
          <ul class="m-0 flex list-none flex-col ps-0">
            @for (a of actionSuggestions(); track a.id) {
              <li class="am-ia__row flex flex-col gap-0.5" [attr.data-ai-action]="a.id">
                @if (editing() === a.id) {
                  <ng-container *ngTemplateOutlet="editTpl; context: { $implicit: a }" />
                } @else {
                  <span class="text-[13px] font-semibold" dir="auto">{{ a.title }}</span>
                  <span class="text-meta" [class.text-[var(--am-warning-ink)]]="!a.owner || !a.dueAt" [class.text-[var(--am-ink-700)]]="a.owner && a.dueAt">{{ actionMeta(a) }}</span>
                  @for (why of whyLines(a); track why) {
                    <span class="text-meta font-medium text-[var(--am-warning-ink)]" data-ai-why>{{ why }}</span>
                  }
                  <span class="mt-1 flex flex-wrap gap-1">
                    @if (a.owner && a.dueAt) {
                      <p-button size="small" [label]="'ai.assist.accept' | translate" [ariaLabel]="'meeting.ai.acceptAction' | translate: { title: a.title }" [loading]="busy() === a.id" [disabled]="busy() !== null" data-ai-accept (onClick)="acceptAction(a)" />
                    }
                    <p-button size="small" severity="secondary" [outlined]="true" [label]="'ai.assist.edit' | translate" [ariaLabel]="'meeting.ai.editAction' | translate: { title: a.title }" [disabled]="busy() !== null" data-ai-edit (onClick)="startEdit(a)" />
                    <p-button size="small" [text]="true" [label]="'ai.assist.discard' | translate" [ariaLabel]="'meeting.ai.discardAction' | translate: { title: a.title }" [disabled]="busy() !== null" data-ai-discard (onClick)="discard(a.id)" />
                  </span>
                }
              </li>
            }
          </ul>
        </ng-template>
      </div>
    }

    @if (failure(); as f) {
      <p class="m-0 flex flex-wrap items-center gap-2 text-meta text-[var(--am-danger-ink)]" role="alert" data-ai-item-error>
        {{ f.key | translate }}
        @if (f.offer === 'reload') {
          <p-button size="small" [text]="true" [label]="'meeting.agenda.reload' | translate" data-ai-reload (onClick)="reload.emit()" />
        } @else if (f.offer === 'retry') {
          <p-button size="small" [text]="true" [label]="'common.retry' | translate" (onClick)="retry()" />
        }
      </p>
    }

    <!-- Edit on an action suggestion: round 3's three fields, inline, prefilled. Saving accepts it with them. -->
    <ng-template #editTpl let-a>
      @if (dateView()) {
        <div class="flex flex-col gap-2" data-ai-edit-date>
          <button type="button" class="am-backlink self-start" (click)="dateView.set(false)">{{ 'meeting.when.back' | translate }}</button>
          <am-inline-calendar [value]="day()" (valueChange)="pickDay($event)" [minDate]="minDay()" />
        </div>
      } @else {
        <form [formGroup]="form" (ngSubmit)="saveEdit(a)" class="am-ia__edit flex flex-col gap-2" data-ai-edit-row>
          <am-field [label]="'meeting.action.what' | translate" [control]="form.controls.title" [forceShowErrors]="showErrors()" [errorMessages]="{ required: 'meeting.action.whatRequired' }">
            <input pInputText [id]="'aiActionTitle-' + a.id" formControlName="title" maxlength="300" data-ai-edit-title />
          </am-field>
          <am-field [label]="'meeting.action.owner' | translate" [control]="form.controls.ownerUserId" [forceShowErrors]="showErrors()" [errorMessages]="{ required: 'meeting.action.ownerRequired' }">
            <app-overlay-select [options]="ownerOptions(a)" optionLabel="label" optionValue="value" formControlName="ownerUserId" [ariaLabel]="'meeting.action.owner' | translate" data-ai-edit-owner />
          </am-field>
          <am-field
            [label]="'meeting.action.due' | translate"
            [control]="form.controls.time"
            [forceShowErrors]="showErrors()"
            [hint]="'meeting.action.becomesTask' | translate"
            [errorMessages]="{ required: 'meeting.when.required', time: 'meeting.when.time' }"
          >
            <am-meeting-when-field
              [dayText]="dayText()"
              [time]="form.controls.time"
              [invalid]="showErrors() && form.controls.time.invalid"
              [dayId]="'aiActionDay-' + a.id"
              [timeId]="'aiActionTime-' + a.id"
              testIdPrefix="ai-edit-due"
              (calendarRequested)="dateView.set(true)"
            />
          </am-field>
          <span class="flex flex-wrap gap-2">
            <p-button size="small" type="submit" [label]="'meeting.ai.acceptEdited' | translate" [loading]="busy() === a.id" [disabled]="busy() !== null" data-ai-edit-save />
            <p-button size="small" severity="secondary" [text]="true" [label]="'common.cancel' | translate" [disabled]="busy() !== null" (onClick)="cancelEdit()" />
          </span>
        </form>
      }
    </ng-template>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-8);
      }
      .am-ia__label {
        font-size: var(--am-type-micro-size);
        font-weight: var(--am-type-micro-weight);
        letter-spacing: var(--am-type-micro-tracking);
        text-transform: var(--am-type-micro-transform);
        color: var(--am-type-micro-color);
      }
      .am-ia__row {
        padding-block: var(--am-space-8);
        border-block-start: 1px solid var(--am-border);
      }
      .am-ia__row:first-child {
        border-block-start: none;
        padding-block-start: 0;
      }
    `,
  ],
})
export class MeetingItemAiComponent {
  private readonly fb = inject(FormBuilder);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly injector = inject(Injector);
  readonly format = inject(FormatService);
  private readonly store = inject(MeetingMinutesAi);

  readonly itemId = input.required<string>();
  readonly itemTitle = input('');
  /** The meeting's attendance rows: who an action may be given to (people of the organisation). */
  readonly attendance = input<MeetingAttendanceRowDto[]>([]);
  /** A stale refusal's Reload: the page reads the meeting again. */
  readonly reload = output<void>();

  readonly minutesSuggestion = computed(() => this.store.minutesOf(this.itemId()));
  readonly actionSuggestions = computed(() => this.store.actionsOf(this.itemId()));
  private readonly present = computed(() => this.store.ai()?.presentMembers ?? 0);

  /** The suggestion whose request is in flight: one at a time per item. */
  readonly busy = signal<string | null>(null);
  readonly failure = signal<MeetingFailure | null>(null);
  private lastTry: (() => void) | null = null;

  // The inline Edit row (one at a time per item).
  readonly editing = signal<string | null>(null);
  readonly showErrors = signal(false);
  readonly dateView = signal(false);
  readonly day = signal<Date | null>(null);
  readonly minDay = signal(meetingToday(this.format));
  readonly form = this.fb.group({
    title: ['', [notBlank, Validators.maxLength(300)]],
    ownerUserId: [null as string | null, Validators.required],
    time: ['', meetingTimeValidator(() => this.day())],
  });

  /** "Vote: 5 for · 1 against · 0 abstain · from your notes", or "not in your notes · left empty". */
  votesLine(v: MeetingVotesDto | null): string {
    if (!v) return this.translate.instant('meeting.ai.votesEmpty') as string;
    return this.translate.instant('meeting.ai.votes', { for: this.format.number(v.for), against: this.format.number(v.against), abstain: this.format.number(v.abstain) }) as string;
  }

  /** M6 — the minutes' own flag, before Accept: "These add up to 7, more than the 6 members present." */
  aboveLine(v: MeetingVotesDto): string {
    return this.format.count('meeting.aiVotesAbove', this.present(), { total: this.format.number(v.for + v.against + v.abstain) });
  }

  /** M5 — what Accept replaces of what is already in the minutes, or null when it replaces nothing. */
  replacesKey(s: MeetingAiMinutesSuggestionDto): string | null {
    if (s.replaces.discussion && s.replaces.decisions) return 'meeting.ai.replacesBoth';
    if (s.replaces.discussion) return 'meeting.ai.replacesDiscussion';
    if (s.replaces.decisions) return 'meeting.ai.replacesDecisions';
    return null;
  }

  /** "Dr. Huda Zahrani · Due 30 Nov 2026, 16:00", with "Owner —" and "Due —" where empty. */
  actionMeta(a: MeetingAiActionSuggestionDto): string {
    const owner = a.owner?.name ?? (this.translate.instant('meeting.ai.ownerNone') as string);
    const due = a.dueAt ? (this.translate.instant('meeting.minutes.due', { at: this.format.dateTime(a.dueAt) }) as string) : (this.translate.instant('meeting.ai.dueNone') as string);
    return `${owner} · ${due}`;
  }

  /** Our code's sentence for an empty owner or due date (M7; §6 answer 4; the past-date rule). */
  whyLines(a: MeetingAiActionSuggestionDto): string[] {
    const lines: string[] = [];
    if (a.ownerReason?.code === 'OUTSIDE_GUEST') lines.push(this.translate.instant('meeting.ai.whyOutsideGuest', { name: a.ownerReason.name }) as string);
    if (a.ownerReason?.code === 'NO_MATCH') lines.push(this.translate.instant('meeting.ai.whyNoMatch', { name: a.ownerReason.name }) as string);
    if (a.dueReason?.code === 'DATE_PASSED') {
      lines.push(this.translate.instant('meeting.ai.whyDatePassed', { day: this.format.date(dayInstant(plainDay(a.dueReason.day), this.format)) }) as string);
    }
    return lines;
  }

  /** The invitees who may own an action, and the suggested owner if they are a person of the organisation not invited. */
  ownerOptions(a: MeetingAiActionSuggestionDto): { value: string; label: string }[] {
    this.language.isArabic();
    const options = actionOwnerOptions(this.attendance(), this.language, this.translate);
    if (a.owner && !options.some((o) => o.value === a.owner!.userId)) options.unshift({ value: a.owner.userId, label: a.owner.name });
    return options;
  }

  acceptMinutes(s: MeetingAiMinutesSuggestionDto, thenEdit: boolean): void {
    this.run(s.id, () => {
      if (!thenEdit) return;
      // Edit: the text is in the minutes now; focus moves into the discussion box to change it.
      afterNextRender(() => document.querySelector<HTMLElement>(`[data-item-minutes="${this.itemId()}"] [data-item-discussion]`)?.focus(), { injector: this.injector });
    }, () => this.store.accept(s.id));
  }

  acceptAction(a: MeetingAiActionSuggestionDto): void {
    this.run(a.id, null, () => this.store.accept(a.id));
  }

  discard(id: string): void {
    this.run(id, null, () => this.store.discard(id));
  }

  startEdit(a: MeetingAiActionSuggestionDto): void {
    this.failure.set(null);
    this.showErrors.set(false);
    this.dateView.set(false);
    this.minDay.set(meetingToday(this.format));
    this.day.set(a.dueAt ? meetingDay(a.dueAt, this.format) : null);
    this.form.reset({ title: a.title, ownerUserId: a.owner?.userId ?? null, time: a.dueAt ? meetingTimeText(a.dueAt, this.format) : '' });
    this.editing.set(a.id);
    afterNextRender(() => document.getElementById(`aiActionTitle-${a.id}`)?.focus(), { injector: this.injector });
  }

  cancelEdit(): void {
    this.editing.set(null);
    this.dateView.set(false);
  }

  dayText(): string {
    const d = this.day();
    return d ? this.format.dateWithWeekday(dayInstant(d, this.format)) : '';
  }

  pickDay(day: Date | null): void {
    this.day.set(day);
    this.form.controls.time.updateValueAndValidity();
    this.dateView.set(false);
  }

  /** Save the inline row: Accept with what it chose (the server checks owner and date as Raise action item does). */
  saveEdit(a: MeetingAiActionSuggestionDto): void {
    const due = meetingStart(this.day(), this.form.getRawValue().time ?? '', this.format);
    if (this.form.invalid || !due) {
      this.showErrors.set(true);
      return;
    }
    const v = this.form.getRawValue();
    this.run(a.id, () => this.editing.set(null), () => this.store.accept(a.id, { title: v.title!.trim(), ownerUserId: v.ownerUserId!, dueAt: due.toISOString() }));
  }

  retry(): void {
    this.lastTry?.();
  }

  private run<T>(id: string, done: (() => void) | null, request: () => Observable<T>): void {
    if (this.busy() !== null) return;
    this.busy.set(id);
    this.failure.set(null);
    this.lastTry = () => this.run(id, done, request);
    request().subscribe({
      next: () => {
        this.busy.set(null);
        this.lastTry = null;
        done?.();
      },
      error: (err: unknown) => {
        this.busy.set(null);
        this.failure.set(meetingFailure(err, 'meeting.ai.decideUnreachable', 'meeting.ai.decideFailed'));
      },
    });
  }
}
