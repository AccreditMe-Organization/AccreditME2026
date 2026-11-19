import { Component, untracked, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { AbstractControl, FormBuilder, FormsModule, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { InlineCalendarComponent } from '../../../../shared/components/inline-calendar/inline-calendar.component';
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
import { MeetingService } from '../../services/meeting.service';
import { meetingRefusalKey } from '../../meeting-refusal';
import { MeetingWhenFieldComponent } from '../meeting-when-field/meeting-when-field.component';
import { dayInstant, meetingStart, meetingTimeValidator, meetingToday } from '../../meeting-when';

/** Whose meeting: one committee or one unit, named as the page shows it. */
export interface ScheduleOwner {
  kind: 'COMMITTEE' | 'UNIT';
  id: string;
  name: string;
}

/** The durations offered, in minutes (Meeting Screens round 5: "90 min"). */
export const MEETING_DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240] as const;

/**
 * Whether a failed press may still have written the meeting: the request went
 * and no answer, or a server error, came back (status 0, a 408 or 504
 * timeout, any 5xx). A 4xx is a refusal: nothing was written.
 */
function mayHaveBeenWritten(err: unknown): boolean {
  if (!(err instanceof HttpErrorResponse)) return false;
  return err.status === 0 || err.status === 408 || err.status >= 500;
}

const placeRequired = (group: AbstractControl): ValidationErrors | null => {
  const v = group.value as { location?: string; meetingUrl?: string };
  return v.location?.trim() || v.meetingUrl?.trim() ? null : { place: true };
};

/**
 * ACC-316 PR 6 — Schedule meeting, step 1, for one meeting (Meeting Screens
 * round 5, section 3), opened from a committee's or a unit's Meetings panel, so
 * the owner is fixed. Subject, type and duration, the start (the calendar swaps
 * the body, the 420 cap), and a place: a location or a link, at least one. A
 * unit meeting may set its own quorum. Step 2 (Repeat) is PR 8's: until then
 * the one button is Schedule. Refusals are said from their codes, in the
 * footer (the design's "Couldn't schedule"), so the body never grows.
 * Measured under the 420px cap (meeting-schedule-dialog.layout.spec.ts):
 * Duration, Location and Online link declare message="none" (none can message;
 * the place rule is the line under the pair), ACC-120's compaction.
 */
@Component({
  selector: 'app-meeting-schedule-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, FormsModule, TranslatePipe, ButtonModule, InputTextModule, EditDialogComponent, FieldComponent, InlineCalendarComponent, OverlaySelectComponent, MeetingWhenFieldComponent],
  template: `
    <ng-template #bodyTpl>
      @if (dateView()) {
        <div class="flex flex-col gap-2" data-testid="schedule-date-view">
          <button type="button" class="am-backlink self-start" (click)="dateView.set(false)">{{ 'meeting.when.back' | translate }}</button>
          <am-inline-calendar [value]="day()" (valueChange)="pickDay($event)" [minDate]="minDay" />
        </div>
      } @else {
        <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col gap-3">
          <am-field [label]="'meeting.schedule.subject' | translate" [control]="form.controls.title" [hint]="'meeting.schedule.subjectHint' | translate" [forceShowErrors]="showErrors()" [errorMessages]="{ required: 'meeting.schedule.subjectRequired' }">
            <input #titleInput pInputText formControlName="title" maxlength="200" data-testid="schedule-title" />
          </am-field>
          <div class="grid gap-3" [style.grid-template-columns]="owner()?.kind === 'UNIT' ? 'minmax(0, 0.9fr) minmax(0, 0.9fr) minmax(0, 1.2fr)' : 'repeat(2, minmax(0, 1fr))'">
            <am-field [label]="'meeting.schedule.type' | translate" [control]="form.controls.typeValueId" [forceShowErrors]="showErrors()" [errorMessages]="{ required: 'meeting.schedule.typeRequired' }">
              @if (typesState() === 'error') {
                <span class="flex items-center gap-2 text-meta text-[var(--am-danger-ink)]" role="alert" data-testid="schedule-types-error">
                  {{ 'meeting.schedule.typesError' | translate }}
                  <p-button size="small" [text]="true" [label]="'common.retry' | translate" data-testid="schedule-types-retry" (onClick)="loadTypes()" />
                </span>
              } @else {
                <app-overlay-select [options]="typeOptions()" optionLabel="label" optionValue="value" formControlName="typeValueId" [ariaLabel]="'meeting.schedule.type' | translate" />
              }
            </am-field>
            <am-field [label]="'meeting.schedule.duration' | translate" [control]="form.controls.durationMinutes" message="none">
              <app-overlay-select [options]="durationOptions()" optionLabel="label" optionValue="value" formControlName="durationMinutes" [ariaLabel]="'meeting.schedule.duration' | translate" />
            </am-field>
            @if (owner()?.kind === 'UNIT') {
              <am-field [label]="'meeting.schedule.quorum' | translate" [control]="form.controls.unitQuorum" [forceShowErrors]="showErrors()" [errorMessages]="{ pattern: 'meeting.schedule.quorumNumber' }">
                <input pInputText dir="ltr" inputmode="numeric" formControlName="unitQuorum" [placeholder]="'meeting.schedule.quorumNone' | translate" data-testid="schedule-quorum" />
              </am-field>
            }
          </div>
          <am-field [label]="'meeting.schedule.starts' | translate" [control]="form.controls.time" [forceShowErrors]="showErrors()" [errorMessages]="{ required: 'meeting.when.required', time: 'meeting.when.time' }">
            <am-meeting-when-field
              [dayText]="dayText()"
              [time]="form.controls.time"
              [invalid]="showErrors() && form.controls.time.invalid"
              dayId="scheduleDay"
              timeId="scheduleTime"
              testIdPrefix="schedule"
              (calendarRequested)="dateView.set(true)"
            />
          </am-field>
          <div class="grid gap-3" style="grid-template-columns: repeat(2, minmax(0, 1fr))">
            <am-field [label]="'meeting.schedule.location' | translate" [control]="form.controls.location" message="none">
              <input pInputText formControlName="location" maxlength="300" data-testid="schedule-location" />
            </am-field>
            <am-field [label]="'meeting.schedule.link' | translate" [control]="form.controls.meetingUrl" message="none">
              <input pInputText dir="ltr" formControlName="meetingUrl" maxlength="2000" placeholder="https://" data-testid="schedule-link" />
            </am-field>
          </div>
          <p class="m-0 text-meta" [class.text-[var(--am-danger-ink)]]="showErrors() && form.hasError('place')" data-testid="schedule-place-hint">{{ 'meeting.schedule.placeHint' | translate }}</p>
        </form>
      }
    </ng-template>
    <ng-template #footerTpl>
      <div class="flex items-center justify-end gap-3">
        <!-- The save's refusal sits in the footer, as the design draws it, so it never grows the body. -->
        @if (error()) {
          <p class="m-0 me-auto min-w-0 text-meta text-[var(--am-danger-ink)]" role="alert" data-testid="schedule-error">{{ error()! | translate }}</p>
        }
        @if (uncertain()) {
          <!-- The request went and no answer came: it may have been scheduled.
               No plain retry, which could make it twice; the list is read again. -->
          <p-button type="button" data-testid="schedule-close" [label]="'common.close' | translate" (onClick)="close()" />
        } @else {
          <p-button [label]="'common.cancel' | translate" severity="secondary" [text]="true" type="button" [disabled]="saving()" (onClick)="dialog.requestClose()" />
          <p-button type="button" data-testid="schedule-submit" [label]="'meeting.schedule.submit' | translate" [loading]="saving()" (onClick)="submit()" />
        }
      </div>
    </ng-template>
    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="'meeting.schedule.title' | translate"
      [context]="owner() ? glyph() + ' ' + owner()!.name : ''"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [dirty]="form.dirty"
      [saving]="saving()"
      size="form"
      density="compact"
    />
  `,
})
export class MeetingScheduleDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly meetings = inject(MeetingService);
  private readonly router = inject(Router);
  private readonly format = inject(FormatService);
  private readonly language = inject(LanguageService);

  readonly visible = input.required<boolean>();
  readonly owner = input<ScheduleOwner | null>(null);
  readonly visibleChange = output<boolean>();
  /** A press whose outcome is unknown (no answer, a timeout, a 5xx): the opener reads its list again. */
  readonly maybeScheduled = output<void>();

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly uncertain = signal(false);
  readonly typesState = signal<'loading' | 'ready' | 'error'>('loading');
  readonly showErrors = signal(false);
  readonly dateView = signal(false);
  readonly day = signal<Date | null>(null);
  readonly minDay = meetingToday(this.format);
  readonly types = signal<{ id: string; labelEn: string; labelAr: string | null }[]>([]);
  private readonly titleInput = viewChild<ElementRef<HTMLInputElement>>('titleInput');

  readonly glyph = computed(() => (this.owner()?.kind === 'COMMITTEE' ? '◇' : '▣'));
  readonly typeOptions = computed(() => {
    this.language.isArabic();
    return this.types().map((t) => ({ label: this.language.bilingual(t.labelEn, t.labelAr), value: t.id }));
  });
  readonly durationOptions = computed(() => {
    this.language.isArabic();
    return MEETING_DURATIONS.map((m) => ({ label: this.format.count('meeting.minutes', m), value: m }));
  });

  readonly form = this.fb.group(
    {
      title: ['', [Validators.required, Validators.maxLength(200)]],
      typeValueId: ['', Validators.required],
      durationMinutes: [60 as number, Validators.required],
      unitQuorum: ['', Validators.pattern(/^\s*[1-9]\d{0,2}\s*$/)],
      time: ['', meetingTimeValidator(() => this.day())],
      location: [''],
      meetingUrl: [''],
    },
    { validators: placeRequired },
  );

  constructor() {
    // The dialog lives on the page whether or not it is open: its choices load when it opens (ACC-238).
    effect(() => {
      if (this.visible()) {
        this.form.reset({ title: '', typeValueId: '', durationMinutes: 60, unitQuorum: '', time: '', location: '', meetingUrl: '' });
        this.day.set(null);
        this.error.set(null);
        this.showErrors.set(false);
        this.dateView.set(false);
        this.uncertain.set(false);
        untracked(() => this.loadTypes());
      }
    });
  }

  /** The meeting types; a failure says so, with Retry, rather than leave Type an empty required list. */
  loadTypes(): void {
    this.typesState.set('loading');
    this.meetings.formChoices().subscribe({
      next: (c) => {
        this.types.set(c.types);
        this.typesState.set('ready');
      },
      error: () => {
        this.types.set([]);
        this.typesState.set('error');
      },
    });
  }

  close(): void {
    this.form.markAsPristine();
    this.visibleChange.emit(false);
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
    const owner = this.owner();
    if (!owner || this.saving() || this.uncertain()) return;
    const v = this.form.getRawValue();
    const at = meetingStart(this.day(), v.time ?? '', this.format);
    if (this.form.invalid || !at) {
      this.showErrors.set(true);
      if (this.form.controls.title.invalid) this.titleInput()?.nativeElement.focus();
      return;
    }
    const quorum = v.unitQuorum?.trim() ? Number(v.unitQuorum) : null;
    this.saving.set(true);
    this.error.set(null);
    this.meetings
      .schedule({
        ...(owner.kind === 'COMMITTEE' ? { committeeId: owner.id } : { orgUnitId: owner.id, unitQuorum: quorum }),
        title: v.title!.trim(),
        typeValueId: v.typeValueId!,
        scheduledAt: at.toISOString(),
        durationMinutes: Number(v.durationMinutes),
        location: v.location?.trim() || null,
        meetingUrl: v.meetingUrl?.trim() || null,
      })
      .subscribe({
        next: (m) => {
          this.saving.set(false);
          this.form.markAsPristine();
          this.visibleChange.emit(false);
          void this.router.navigate(['/meetings', m.id]);
        },
        error: (err: unknown) => {
          this.saving.set(false);
          const refusal = meetingRefusalKey(err);
          if (!refusal && mayHaveBeenWritten(err)) {
            this.uncertain.set(true);
            this.error.set('meeting.schedule.maybeScheduled');
            this.maybeScheduled.emit();
            return;
          }
          this.error.set(refusal ?? 'meeting.schedule.error');
        },
      });
  }
}
