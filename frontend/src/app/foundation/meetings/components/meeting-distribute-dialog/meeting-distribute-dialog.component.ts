import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { FormatService } from '../../../../core/formatting';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { InlineCalendarComponent } from '../../../../shared/components/inline-calendar/inline-calendar.component';
import { MeetingService, type MeetingMinutesDto } from '../../services/meeting.service';
import { meetingRefusalKey } from '../../meeting-refusal';
import { dayInstant, meetingToday } from '../../meeting-when';

/** "2026-10-01" as the calendar's plain day. */
function plainDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

function isoDay(day: Date): string {
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

/**
 * ACC-316 PR 7b — Distribute Minutes? (Meeting Screens, dialogs; a confirm at
 * 420 with a date): the present members review by the date, and no answer by
 * then counts as no corrections. The date opens on the server's default (five
 * working days ahead, `distribute.defaultReviewBy`: the screen does no
 * working-day arithmetic), and is sent only when the person changes it.
 *
 * While attendance is incomplete the dialog says who is missing and offers no
 * Distribute (the server refuses it, `MEETING_ATTENDANCE_INCOMPLETE`).
 */
@Component({
  selector: 'app-meeting-distribute-dialog',
  standalone: true,
  imports: [TranslatePipe, ButtonModule, InputTextModule, EditDialogComponent, InlineCalendarComponent],
  template: `
    <ng-template #bodyTpl>
      @if (blocked(); as b) {
        <div class="flex flex-col gap-2" data-testid="distribute-blocked">
          @if (b.code === 'MEETING_ATTENDANCE_INCOMPLETE') {
            <p class="m-0 text-[13px]">{{ 'meeting.distribute.recordFirst' | translate }}</p>
            <ul class="m-0 ps-4 text-[13px]">
              @for (p of b.missing; track p.attendeeId) {
                <li>{{ p.name }}</li>
              }
            </ul>
          } @else {
            <p class="m-0 text-[13px]">{{ 'meeting.distribute.votesAbove' | translate }}</p>
            <ul class="m-0 ps-4 text-[13px]" data-testid="distribute-votes-above">
              @for (i of b.items; track i.agendaItemId) {
                <li>{{ 'meeting.distribute.votesAboveItem' | translate: { title: i.title, total: format.number(i.total), present: format.number(i.present) } }}</li>
              }
            </ul>
          }
        </div>
      } @else if (dateView()) {
        <div class="flex flex-col gap-2" data-testid="distribute-date-view">
          <button type="button" class="am-backlink self-start" (click)="dateView.set(false)">{{ 'meeting.when.back' | translate }}</button>
          <am-inline-calendar [value]="day()" (valueChange)="pickDay($event)" [minDate]="minDay()" />
        </div>
      } @else {
        <div class="flex flex-col gap-3">
          <p class="m-0 text-[13px]">{{ 'meeting.distribute.lead' | translate }}</p>
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium" for="distributeReviewBy">{{ 'meeting.distribute.reviewBy' | translate }}</label>
            <span class="flex items-center gap-2">
              <input pInputText readonly id="distributeReviewBy" class="min-w-0 flex-1" [value]="dayText()" data-testid="distribute-review-by" (click)="dateView.set(true)" />
              <p-button type="button" severity="secondary" icon="pi pi-calendar" [ariaLabel]="'meeting.distribute.chooseDate' | translate" (onClick)="dateView.set(true)" />
            </span>
          </div>
          <p class="m-0 text-meta text-[var(--am-ink-500)]" data-testid="distribute-reviewers">{{ reviewers() }}</p>
          @if (error()) {
            <p class="m-0 text-meta text-[var(--am-danger-ink)]" role="alert" data-testid="distribute-error">{{ error()! | translate }}</p>
          }
        </div>
      }
    </ng-template>
    <ng-template #footerTpl>
      <div class="flex justify-end gap-3">
        @if (blocked()) {
          <p-button [label]="'common.close' | translate" type="button" (onClick)="dialog.requestClose()" />
        } @else {
          <p-button [label]="'meeting.distribute.notYet' | translate" severity="secondary" [text]="true" type="button" [disabled]="saving()" (onClick)="dialog.requestClose()" />
          <p-button type="button" data-testid="distribute-submit" [label]="'meeting.distribute.submit' | translate" [loading]="saving()" (onClick)="submit()" />
        }
      </div>
    </ng-template>
    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="'meeting.distribute.title' | translate"
      [context]="context()"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [dirty]="false"
      [saving]="saving()"
      size="confirm"
    />
  `,
})
export class MeetingDistributeDialogComponent {
  private readonly meetings = inject(MeetingService);
  readonly format = inject(FormatService);
  private readonly translate = inject(TranslateService);

  readonly visible = input.required<boolean>();
  readonly meetingId = input.required<string>();
  readonly context = input('');
  readonly minutes = input<MeetingMinutesDto | null>(null);
  readonly visibleChange = output<boolean>();
  /** Distributed: the page reads the meeting again (its stage moved). */
  readonly distributed = output<void>();

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly dateView = signal(false);
  readonly day = signal<Date | null>(null);
  /** The earliest review date: the day after today, on the tenant's calendar. */
  readonly minDay = signal(this.tomorrow());
  private chosen = false;

  /** What holds Distribute: attendance not recorded, or votes above the members present (the server's one check). */
  readonly blocked = computed(() => this.minutes()?.distribute?.blockedBy ?? null);

  readonly reviewers = computed(() => {
    const present = (this.minutes()?.attendance ?? []).filter((r) => r.kind === 'MEMBER' && r.attendance === 'PRESENT').length;
    return this.translate.instant('meeting.distribute.asked', { members: this.format.count('meeting.presentMembers', present) }) as string;
  });

  constructor() {
    effect(() => {
      if (!this.visible()) return;
      untracked(() => {
        const fallback = this.minutes()?.distribute?.defaultReviewBy;
        this.day.set(fallback ? plainDay(fallback) : null);
        this.chosen = false;
        this.error.set(null);
        this.dateView.set(false);
        this.minDay.set(this.tomorrow());
      });
    });
  }

  dayText(): string {
    const d = this.day();
    return d ? this.format.dateWithWeekday(dayInstant(d, this.format)) : '';
  }

  pickDay(day: Date | null): void {
    if (day) {
      this.day.set(day);
      this.chosen = true;
    }
    this.dateView.set(false);
  }

  submit(): void {
    if (this.saving()) return;
    const d = this.day();
    this.saving.set(true);
    this.error.set(null);
    this.meetings.distribute(this.meetingId(), this.chosen && d ? isoDay(d) : undefined).subscribe({
      next: () => {
        this.saving.set(false);
        this.distributed.emit();
        this.visibleChange.emit(false);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.error.set(meetingRefusalKey(err) ?? 'meeting.distribute.error');
      },
    });
  }

  private tomorrow(): Date {
    const today = meetingToday(this.format);
    return new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  }
}
