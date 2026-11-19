import { Component, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { InlineCalendarComponent } from '../../../../shared/components/inline-calendar/inline-calendar.component';
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
import { MeetingService, type MeetingAttendanceRowDto, type MeetingMinutesDto } from '../../services/meeting.service';
import { meetingRefusalKey } from '../../meeting-refusal';
import { MeetingWhenFieldComponent } from '../meeting-when-field/meeting-when-field.component';
import { dayInstant, meetingStart, meetingTimeValidator, meetingToday } from '../../meeting-when';

function notBlank(control: AbstractControl): ValidationErrors | null {
  return typeof control.value === 'string' && control.value.trim() ? null : { required: true };
}

/**
 * ACC-316 PR 7b — Raise action item (Meeting Screens, dialogs): a DRAFT inside
 * its agenda item, in Minutes Draft. What, an owner from the meeting's invitees
 * who are people of the organisation (an outside guest has no user and never
 * owns one), and a due date and time. No task exists and the owner isn't told
 * until the minutes are approved, which the dialog says. A refusal is said
 * from its code; the calendar swaps the body (the 420 cap, ACC-111).
 */
@Component({
  selector: 'app-meeting-action-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, ButtonModule, InputTextModule, EditDialogComponent, FieldComponent, InlineCalendarComponent, OverlaySelectComponent, MeetingWhenFieldComponent],
  template: `
    <ng-template #bodyTpl>
      @if (dateView()) {
        <div class="flex flex-col gap-2" data-testid="action-date-view">
          <button type="button" class="am-backlink self-start" (click)="dateView.set(false)">{{ 'meeting.when.back' | translate }}</button>
          <am-inline-calendar [value]="day()" (valueChange)="pickDay($event)" [minDate]="minDay()" />
        </div>
      } @else {
        <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col gap-3">
          <am-field [label]="'meeting.action.what' | translate" [control]="form.controls.title" [forceShowErrors]="showErrors()" [errorMessages]="{ required: 'meeting.action.whatRequired' }">
            <input #titleInput pInputText id="actionTitle" formControlName="title" maxlength="300" data-testid="action-title" />
          </am-field>
          <am-field [label]="'meeting.action.owner' | translate" [control]="form.controls.ownerUserId" [forceShowErrors]="showErrors()" [errorMessages]="{ required: 'meeting.action.ownerRequired' }">
            <app-overlay-select [options]="ownerOptions()" optionLabel="label" optionValue="value" formControlName="ownerUserId" [ariaLabel]="'meeting.action.owner' | translate" data-testid="action-owner" />
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
              dayId="actionDay"
              timeId="actionTime"
              testIdPrefix="action-due"
              (calendarRequested)="dateView.set(true)"
            />
          </am-field>
        </form>
      }
    </ng-template>
    <ng-template #footerTpl>
      <div class="flex items-center justify-end gap-3">
        @if (error()) {
          <p class="m-0 me-auto min-w-0 text-meta text-[var(--am-danger-ink)]" role="alert" data-testid="action-error">{{ error()! | translate }}</p>
        }
        <p-button [label]="'common.cancel' | translate" severity="secondary" [text]="true" type="button" [disabled]="saving()" (onClick)="dialog.requestClose()" />
        <p-button type="button" data-testid="action-submit" [label]="'meeting.action.submit' | translate" [loading]="saving()" (onClick)="submit()" />
      </div>
    </ng-template>
    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="'meeting.action.title' | translate"
      [context]="context()"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [dirty]="form.dirty"
      [saving]="saving()"
      size="form"
    />
  `,
})
export class MeetingActionDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly meetings = inject(MeetingService);
  private readonly format = inject(FormatService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);

  readonly visible = input.required<boolean>();
  readonly meetingId = input.required<string>();
  /** The agenda item the action comes from: its id, place and title. */
  readonly item = input<{ id: string; order: number; title: string } | null>(null);
  /** The meeting's attendance rows: its invitees, members and guests. */
  readonly attendance = input<MeetingAttendanceRowDto[]>([]);
  readonly visibleChange = output<boolean>();
  readonly saved = output<MeetingMinutesDto>();

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly showErrors = signal(false);
  readonly dateView = signal(false);
  readonly day = signal<Date | null>(null);
  readonly minDay = signal(meetingToday(this.format));
  private readonly titleInput = viewChild<ElementRef<HTMLInputElement>>('titleInput');

  readonly form = this.fb.group({
    title: ['', [notBlank, Validators.maxLength(300)]],
    ownerUserId: [null as string | null, Validators.required],
    time: ['', meetingTimeValidator(() => this.day())],
  });

  readonly context = computed(() => {
    const it = this.item();
    return it ? (this.translate.instant('meeting.action.from', { n: this.format.number(it.order), title: it.title }) as string) : '';
  });

  /** People of the organisation among the invitees; an outside guest has no user. */
  readonly ownerOptions = computed(() => {
    this.language.isArabic();
    return this.attendance()
      .filter((r) => !!r.userId)
      .map((r) => ({
        value: r.userId!,
        label: `${r.name} · ${r.kind === 'MEMBER' && r.seat ? this.language.bilingual(r.seat.labelEn, r.seat.labelAr) : this.translate.instant(r.kind === 'MEMBER' ? 'meeting.agendaItem.member' : 'meeting.invitees.guest')}`,
      }));
  });

  constructor() {
    effect(() => {
      if (!this.visible()) return;
      untracked(() => {
        this.day.set(null);
        this.form.reset({ title: '', ownerUserId: null, time: '' });
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
    const it = this.item();
    if (!it || this.saving()) return;
    const due = meetingStart(this.day(), this.form.getRawValue().time ?? '', this.format);
    if (this.form.invalid || !due) {
      this.showErrors.set(true);
      if (this.form.controls.title.invalid) this.titleInput()?.nativeElement.focus();
      return;
    }
    const v = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    this.meetings.addAction(this.meetingId(), it.id, { title: v.title!.trim(), ownerUserId: v.ownerUserId!, dueAt: due.toISOString() }).subscribe({
      next: (minutes) => {
        this.saving.set(false);
        this.form.markAsPristine();
        this.saved.emit(minutes);
        this.visibleChange.emit(false);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.error.set(meetingRefusalKey(err) ?? 'meeting.action.error');
      },
    });
  }
}
