import { Component, untracked, ElementRef, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { AbstractControl, FormBuilder, FormsModule, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { FormatService } from '../../../../core/formatting';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { InlineCalendarComponent } from '../../../../shared/components/inline-calendar/inline-calendar.component';
import { MeetingService, type MeetingDto } from '../../services/meeting.service';
import { meetingRefusalKey } from '../../meeting-refusal';
import { MeetingWhenFieldComponent } from '../meeting-when-field/meeting-when-field.component';
import { dayInstant, meetingDay, meetingStart, meetingTimeText, meetingTimeValidator, meetingToday } from '../../meeting-when';

/** The longest reason the server accepts (RescheduleMeetingDto). */
export const RESCHEDULE_REASON_MAX = 500;

function notBlank(control: AbstractControl): ValidationErrors | null {
  return typeof control.value === 'string' && control.value.trim() ? null : { required: true };
}

/**
 * ACC-316 PR 6 — Reschedule a meeting (Meeting Screens round 5, section 5): a
 * new date and time and a required reason, sent to the invitees with it. The
 * calendar swaps the dialog body rather than growing it (the 420 cap, ACC-111).
 * A refusal is said from its code. One meeting only: a series' "this and
 * later" is PR 8's screen.
 */
@Component({
  selector: 'app-meeting-reschedule-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, FormsModule, TranslatePipe, ButtonModule, TextareaModule, EditDialogComponent, FieldComponent, InlineCalendarComponent, MeetingWhenFieldComponent],
  template: `
    <ng-template #bodyTpl>
      @if (dateView()) {
        <div class="flex flex-col gap-2" data-testid="reschedule-date-view">
          <button type="button" class="am-backlink self-start" (click)="dateView.set(false)">{{ 'meeting.when.back' | translate }}</button>
          <am-inline-calendar [value]="day()" (valueChange)="pickDay($event)" [minDate]="minDay()" />
        </div>
      } @else {
        <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col gap-3">
          <am-field [label]="'meeting.reschedule.when' | translate" [control]="form.controls.time" [forceShowErrors]="showErrors()" [errorMessages]="{ required: 'meeting.when.required', time: 'meeting.when.time' }">
            <am-meeting-when-field
              [dayText]="dayText()"
              [time]="form.controls.time"
              [invalid]="showErrors() && form.controls.time.invalid"
              dayId="rescheduleDay"
              timeId="rescheduleTime"
              testIdPrefix="reschedule"
              (calendarRequested)="dateView.set(true)"
            />
          </am-field>
          <am-field
            [label]="'meeting.reschedule.reason' | translate"
            [control]="form.controls.reason"
            [hint]="'meeting.reschedule.reasonHint' | translate"
            [forceShowErrors]="showErrors()"
            [errorMessages]="{ required: 'meeting.reschedule.reasonRequired' }"
          >
            <textarea #reasonInput pTextarea id="rescheduleReason" formControlName="reason" rows="3"></textarea>
          </am-field>
          @if (error()) {
            <p class="text-meta text-[var(--am-danger-ink)] m-0" role="alert" data-testid="reschedule-error">{{ error()! | translate }}</p>
          }
        </form>
      }
    </ng-template>
    <ng-template #footerTpl>
      <div class="flex justify-end gap-3">
        <p-button [label]="'common.cancel' | translate" severity="secondary" [text]="true" type="button" [disabled]="saving()" (onClick)="dialog.requestClose()" />
        <p-button type="button" data-testid="reschedule-submit" [label]="'meeting.reschedule.submit' | translate" [loading]="saving()" (onClick)="submit()" />
      </div>
    </ng-template>
    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="'meeting.reschedule.title' | translate"
      [context]="meeting()?.title ?? ''"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [dirty]="form.dirty"
      [saving]="saving()"
      size="form"
    />
  `,
})
export class MeetingRescheduleDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly meetings = inject(MeetingService);
  private readonly format = inject(FormatService);

  readonly visible = input.required<boolean>();
  readonly meeting = input<MeetingDto | null>(null);
  readonly visibleChange = output<boolean>();
  readonly rescheduled = output<void>();

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly showErrors = signal(false);
  readonly dateView = signal(false);
  readonly day = signal<Date | null>(null);
  /** Today in the tenant's zone, read again each time the dialog opens (it may stay on the page past midnight). */
  readonly minDay = signal(meetingToday(this.format));
  private readonly reasonInput = viewChild<ElementRef<HTMLTextAreaElement>>('reasonInput');

  readonly form = this.fb.group({
    time: ['', meetingTimeValidator(() => this.day())],
    reason: ['', [notBlank, Validators.maxLength(RESCHEDULE_REASON_MAX)]],
  });

  constructor() {
    // Every OPENING starts from the meeting as it stands, on the tenant's wall
    // clock. Only the opening: a reload of the meeting while the dialog is open
    // never wipes what the person has typed.
    effect(() => {
      if (!this.visible()) return;
      untracked(() => {
        const m = this.meeting();
        if (!m) return;
        this.day.set(meetingDay(m.scheduledAt, this.format));
        this.form.reset({ time: meetingTimeText(m.scheduledAt, this.format), reason: '' });
        this.error.set(null);
        this.showErrors.set(false);
        this.dateView.set(false);
        this.minDay.set(meetingToday(this.format));
      });
    });
  }

  dayText(): string {
    const d = this.day();
    return d ? this.format.dateWithWeekday(dayInstant(d, this.format)) : '';
  }

  pickDay(day: Date | null): void {
    this.day.set(day);
    this.form.controls.time.updateValueAndValidity();
    this.form.markAsDirty();
    this.dateView.set(false);
  }

  submit(): void {
    const m = this.meeting();
    if (!m || this.saving()) return;
    const at = meetingStart(this.day(), this.form.getRawValue().time ?? '', this.format);
    if (this.form.invalid || !at) {
      this.showErrors.set(true);
      if (this.form.controls.reason.invalid) this.reasonInput()?.nativeElement.focus();
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.meetings.reschedule(m.id, { scheduledAt: at.toISOString(), reason: this.form.getRawValue().reason!.trim(), expectedUpdatedAt: m.updatedAt }).subscribe({
      next: () => {
        this.saving.set(false);
        this.form.markAsPristine();
        this.rescheduled.emit();
        this.visibleChange.emit(false);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.error.set(meetingRefusalKey(err) ?? 'meeting.reschedule.error');
      },
    });
  }
}
