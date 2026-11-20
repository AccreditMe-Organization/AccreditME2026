import { Component, untracked, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, debounceTime, distinctUntilChanged, map, of, startWith, switchMap } from 'rxjs';
import { AbstractControl, FormBuilder, FormsModule, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { FormatService } from '../../../../core/formatting';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { InlineCalendarComponent } from '../../../../shared/components/inline-calendar/inline-calendar.component';
import { MeetingService, type MeetingClashDto, type MeetingDto, type MeetingEditScope, type MeetingScopePreviewRequest } from '../../services/meeting.service';
import { meetingRefusalKey } from '../../meeting-refusal';
import { MeetingWhenFieldComponent } from '../meeting-when-field/meeting-when-field.component';
import { MeetingClashComponent } from '../meeting-clash/meeting-clash.component';
import { MeetingScopeDialogComponent } from '../meeting-scope-dialog/meeting-scope-dialog.component';
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
 * A refusal is said from its code.
 *
 * PR 8c — the clash line in place under the new time (artboards 10–11): "2 of
 * 10 invitees have another meeting then · Show who", its rows shown in place
 * and scrolling inside a fixed height; asked again as the day or time changes.
 * A warning only. In a series the button reads Next, and "Which meetings
 * change?" follows (`app-meeting-scope-dialog`), whose Apply sends the scope.
 */
@Component({
  selector: 'app-meeting-reschedule-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    TranslatePipe,
    ButtonModule,
    TextareaModule,
    EditDialogComponent,
    FieldComponent,
    InlineCalendarComponent,
    MeetingWhenFieldComponent,
    MeetingClashComponent,
    MeetingScopeDialogComponent,
  ],
  template: `
    <ng-template #bodyTpl>
      @if (dateView()) {
        <div class="flex flex-col gap-2" data-testid="reschedule-date-view">
          <button type="button" class="am-backlink self-start" (click)="dateView.set(false)">{{ 'meeting.when.back' | translate }}</button>
          <am-inline-calendar [value]="day()" (valueChange)="pickDay($event)" [minDate]="minDay()" />
        </div>
      } @else {
        <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col gap-3">
          <div class="flex flex-col gap-1" data-testid="reschedule-when-block">
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
            <!-- PR 8c — who else has a meeting at the new time, its rows in place (a warning; the button stays enabled). -->
            @if (clash()?.people?.length) {
              <am-meeting-clash
                [clash]="clash()"
                [toggleLabel]="(showWho() ? 'meeting.clash.hide' : 'meeting.clash.showWho') | translate"
                [showRows]="showWho()"
                [capped]="true"
                (toggled)="showWho.set(!showWho())"
              />
            }
          </div>
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
        <p-button type="button" data-testid="reschedule-submit" [label]="(inSeries() ? 'meeting.reschedule.next' : 'meeting.reschedule.submit') | translate" [loading]="saving() && !scopeOpen()" (onClick)="submit()" />
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
    <!-- PR 8c — a series meeting: which meetings the move applies to, then the write. -->
    <app-meeting-scope-dialog
      [visible]="scopeOpen()"
      (visibleChange)="scopeOpen.set($event)"
      [meeting]="meeting()"
      [change]="scopeChange()"
      [saving]="saving()"
      [error]="scopeError()"
      (applied)="send($event)"
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

  /** PR 8c — the new time's clash check (null until a day and time are set, or when nobody clashes). */
  readonly clash = signal<MeetingClashDto | null>(null);
  readonly showWho = signal(false);
  /** A series meeting: Next, then "Which meetings change?". */
  readonly inSeries = computed(() => !!this.meeting()?.series);
  readonly scopeOpen = signal(false);
  readonly scopeChange = signal<MeetingScopePreviewRequest | null>(null);
  readonly scopeError = signal<string | null>(null);
  /** The new time and reason Next was pressed with: what Apply sends. */
  private pending: { scheduledAt: string; reason: string } | null = null;
  /** Bumped on every change of the day or time, so the clash check reads them. */
  private readonly when = signal(0);

  readonly form = this.fb.group({
    time: ['', meetingTimeValidator(() => this.day())],
    reason: ['', [notBlank, Validators.maxLength(RESCHEDULE_REASON_MAX)]],
  });

  constructor() {
    this.form.controls.time.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.when.update((n) => n + 1));
    // PR 8c — the clash line: asked again as the day or time changes, the latest answer wins.
    toObservable(
      computed(() => {
        this.when();
        const m = this.meeting();
        const at = this.visible() && m ? meetingStart(this.day(), this.form.controls.time.value ?? '', this.format) : null;
        return m && at ? { id: m.id, startsAt: at.toISOString(), minutes: m.durationMinutes ?? 60 } : null;
      }),
    )
      .pipe(
        debounceTime(250),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        switchMap((key) =>
          key
            ? this.meetings.clashes({ meetingId: key.id, times: [{ startsAt: key.startsAt, durationMinutes: key.minutes }] }).pipe(
                map((r) => r[0] ?? null),
                // A failed check says nothing: the line is a warning, never a gate.
                catchError(() => of(null)),
                startWith(null),
              )
            : of(null),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((c) => {
        this.clash.set(c);
        if (!c?.people.length) this.showWho.set(false);
      });
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
        this.showWho.set(false);
        this.scopeOpen.set(false);
        this.scopeError.set(null);
        this.pending = null;
        this.when.update((n) => n + 1);
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
    this.when.update((n) => n + 1);
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
    this.error.set(null);
    this.pending = { scheduledAt: at.toISOString(), reason: this.form.getRawValue().reason!.trim() };
    if (this.inSeries()) {
      // Next: which meetings change. Nothing is written until Apply.
      this.scopeError.set(null);
      this.scopeChange.set({ change: 'RESCHEDULE', scheduledAt: this.pending.scheduledAt });
      this.scopeOpen.set(true);
      return;
    }
    this.send(null);
  }

  /** The write: one meeting, or (a series) the scope "Which meetings change?" chose. */
  send(scope: MeetingEditScope | null): void {
    const m = this.meeting();
    if (!m || !this.pending || this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    this.scopeError.set(null);
    this.meetings.reschedule(m.id, { ...this.pending, expectedUpdatedAt: m.updatedAt, ...(scope && { scope }) }).subscribe({
      next: () => {
        this.saving.set(false);
        this.form.markAsPristine();
        this.scopeOpen.set(false);
        this.rescheduled.emit();
        this.visibleChange.emit(false);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        const key = meetingRefusalKey(err) ?? 'meeting.reschedule.error';
        // Said where the person is: the scope confirm when it is open, else the dialog.
        if (this.scopeOpen()) this.scopeError.set(key);
        else this.error.set(key);
      },
    });
  }
}
