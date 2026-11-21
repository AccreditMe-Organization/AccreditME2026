import { Component, untracked, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, debounceTime, distinctUntilChanged, map, of, startWith, switchMap } from 'rxjs';
import { AbstractControl, FormBuilder, FormsModule, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { InlineCalendarComponent } from '../../../../shared/components/inline-calendar/inline-calendar.component';
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
import type { CommitteeMeetingFrequency } from '../../../committees/services/committee.service';
import { MeetingService, type MeetingClashDto } from '../../services/meeting.service';
import { meetingRefusalKey } from '../../meeting-refusal';
import { MeetingWhenFieldComponent } from '../meeting-when-field/meeting-when-field.component';
import { dayInstant, meetingStart, meetingTimeValidator, meetingToday } from '../../meeting-when';
import { MeetingClashComponent } from '../meeting-clash/meeting-clash.component';
import { MeetingRepeatStepComponent, type RepeatBase } from '../meeting-repeat-step/meeting-repeat-step.component';

/** Whose meeting: one committee or one unit, named as the page shows it. */
export interface ScheduleOwner {
  kind: 'COMMITTEE' | 'UNIT';
  id: string;
  name: string;
  /** PR 8a (Q6) — a committee's meeting frequency, where step 2's Every starts; a unit has none. */
  frequency?: CommitteeMeetingFrequency | null;
}

/** The durations offered: one list, meeting-durations.ts (re-exported for this dialog's callers). */
export { MEETING_DURATIONS } from '../../meeting-durations';
import { MEETING_DURATIONS } from '../../meeting-durations';

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
  imports: [
    ReactiveFormsModule,
    FormsModule,
    TranslatePipe,
    ButtonModule,
    InputTextModule,
    EditDialogComponent,
    FieldComponent,
    InlineCalendarComponent,
    OverlaySelectComponent,
    MeetingWhenFieldComponent,
    MeetingClashComponent,
    MeetingRepeatStepComponent,
  ],
  template: `
    <ng-template #bodyTpl>
      @if (step() === 1 && dateView()) {
        <div class="flex flex-col gap-2" data-testid="schedule-date-view">
          <button type="button" class="am-backlink self-start" (click)="dateView.set(false)">{{ 'meeting.when.back' | translate }}</button>
          <am-inline-calendar [value]="day()" (valueChange)="pickDay($event)" [minDate]="minDay()" />
        </div>
      } @else if (step() === 1 && showWho()) {
        <!-- PR 8a — Show who: the rows swap in for the step's body (Meeting Screens round 5, artboard 16), Starts and Duration kept so a change rechecks at once. -->
        <div class="flex flex-col gap-2" data-testid="schedule-who-view">
          <button type="button" class="am-backlink self-start" data-testid="schedule-who-back" (click)="showWho.set(false)">{{ 'meeting.clash.backToDetails' | translate }}</button>
          <am-meeting-clash [clash]="clash()" [toggleLabel]="'meeting.clash.hide' | translate" [showRows]="true" (toggled)="showWho.set(false)" />
          <div class="grid gap-3" style="grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr)">
            <am-field [label]="'meeting.schedule.starts' | translate" [control]="form.controls.time" [forceShowErrors]="showErrors()" [errorMessages]="{ required: 'meeting.when.required', time: 'meeting.when.time' }">
              <am-meeting-when-field
                [dayText]="dayText()"
                [time]="form.controls.time"
                [invalid]="showErrors() && form.controls.time.invalid"
                dayId="scheduleWhoDay"
                timeId="scheduleWhoTime"
                testIdPrefix="schedule-who"
                (calendarRequested)="showWho.set(false); dateView.set(true)"
              />
            </am-field>
            <am-field [label]="'meeting.schedule.duration' | translate" [control]="form.controls.durationMinutes" message="none">
              <app-overlay-select [options]="durationOptions()" optionLabel="label" optionValue="value" [formControl]="form.controls.durationMinutes" [ariaLabel]="'meeting.schedule.duration' | translate" />
            </am-field>
          </div>
          <p class="m-0 text-meta text-[var(--am-info-ink)]">{{ 'meeting.clash.rechecks' | translate }}</p>
        </div>
      } @else if (step() === 1) {
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
          <div class="flex flex-col gap-0.5" data-testid="schedule-starts-block">
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
          <!-- PR 8a — once Starts and Duration are set: who else has a meeting then, in the Starts block (an info line; Schedule stays enabled). -->
          @if (clash()?.people?.length) {
            <am-meeting-clash [clash]="clash()" [toggleLabel]="'meeting.clash.showWho' | translate" (toggled)="showWho.set(true)" />
          }
          </div>
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
      <!-- PR 8a — step 2 (Repeat), kept once opened, so Back and Next keep its choices. -->
      @if (visitedRepeat() && owner()) {
        <am-meeting-repeat-step #repeat [hidden]="step() !== 2" [owner]="owner()!" [base]="base()" [showErrors]="showErrors()" [entry]="repeatEntry()" />
      }
    </ng-template>
    <ng-template #footerTpl>
      <div class="flex flex-wrap items-center justify-end gap-3">
        <!-- The save's refusal sits in the footer, as the design draws it, so it never grows the body. -->
        @if (error()) {
          <p class="m-0 me-auto min-w-0 text-meta text-[var(--am-danger-ink)]" role="alert" data-testid="schedule-error">{{ error()! | translate }}</p>
        } @else {
          <p class="m-0 me-auto text-meta text-[var(--am-ink-500)]" data-testid="schedule-step">{{ 'common.stepOf' | translate: { step: format.number(step()), steps: format.number(2) } }}</p>
        }
        @if (uncertain()) {
          <!-- The request went and no answer came: it may have been scheduled.
               No plain retry, which could make it twice; the list is read again. -->
          <p-button type="button" data-testid="schedule-close" [label]="'common.close' | translate" (onClick)="close()" />
        } @else if (step() === 1) {
          <p-button [label]="'common.cancel' | translate" severity="secondary" [text]="true" type="button" [disabled]="saving()" (onClick)="dialog.requestClose()" />
          <p-button type="button" severity="secondary" data-testid="schedule-submit" [label]="'meeting.schedule.submit' | translate" [loading]="saving()" (onClick)="submit()" />
          <p-button type="button" data-testid="schedule-next" [label]="'meeting.schedule.next' | translate" [disabled]="saving()" (onClick)="next()" />
        } @else {
          <p-button [label]="'common.back' | translate" severity="secondary" [text]="true" type="button" [disabled]="saving()" data-testid="schedule-back" (onClick)="back()" />
          <p-button type="button" data-testid="schedule-submit" [label]="submitLabel()" [loading]="saving()" (onClick)="submit()" />
        }
      </div>
    </ng-template>
    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="'meeting.schedule.title' | translate"
      [context]="context()"
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
  readonly format = inject(FormatService);
  private readonly language = inject(LanguageService);
  private readonly translate = inject(TranslateService);

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
  /** Today in the tenant's zone, read again each time the dialog opens (it may stay on the page past midnight). */
  readonly minDay = signal(meetingToday(this.format));
  readonly types = signal<{ id: string; labelEn: string; labelAr: string | null }[]>([]);
  private readonly titleInput = viewChild<ElementRef<HTMLInputElement>>('titleInput');
  private readonly repeat = viewChild<MeetingRepeatStepComponent>('repeat');

  /** PR 8a — step 1 (the meeting) or step 2 (Repeat); step 2 is kept once opened. */
  readonly step = signal<1 | 2>(1);
  readonly visitedRepeat = signal(false);
  /** Each Next counts one opening of step 2. */
  readonly repeatEntry = signal(0);
  /** Step 1's clash check, for the time chosen (null until Starts and Duration are set). */
  readonly clash = signal<MeetingClashDto | null>(null);
  readonly showWho = signal(false);

  readonly glyph = computed(() => (this.owner()?.kind === 'COMMITTEE' ? '◇' : '▣'));
  readonly typeOptions = computed(() => {
    this.language.isArabic();
    return this.types().map((t) => ({ label: this.language.bilingual(t.labelEn, t.labelAr), value: t.id }));
  });
  readonly durationOptions = computed(() => {
    this.language.isArabic();
    return MEETING_DURATIONS.map((m) => ({ label: this.format.count('meeting.minutes', m), value: m }));
  });

  /** The dialog's context: the owner on step 1; on step 2, also the first meeting's date and time. */
  readonly context = computed(() => {
    const owner = this.owner();
    if (!owner) return '';
    const head = `${this.glyph()} ${owner.name}`;
    const at = this.step() === 2 ? this.startsAt() : null;
    return at ? `${head} · ${this.translate.instant('meeting.repeat.firstMeeting', { when: this.format.dateTime(at) })}` : head;
  });

  /** Step 2's button: "Schedule 5 meetings" from the preview's count, else "Schedule". */
  readonly submitLabel = computed(() => {
    this.translate.currentLang();
    const n = this.repeat()?.count() ?? null;
    return n !== null ? this.format.count('meeting.scheduleMeetings', n) : this.translate.instant('meeting.schedule.submit');
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

  /** The first meeting's start, once the day and time are both set. */
  private readonly formValue = signal(0);
  readonly startsAt = computed(() => {
    this.formValue();
    const v = this.form.getRawValue();
    return meetingStart(this.day(), v.time ?? '', this.format);
  });

  /** What every meeting of the series takes from step 1 (null while step 1 is incomplete). */
  readonly base = computed<RepeatBase | null>(() => {
    this.formValue();
    const at = this.startsAt();
    const v = this.form.getRawValue();
    if (!at || this.form.invalid) return null;
    return {
      subject: v.title!.trim(),
      typeValueId: v.typeValueId!,
      startsAt: at,
      durationMinutes: Number(v.durationMinutes),
      location: v.location?.trim() || null,
      meetingUrl: v.meetingUrl?.trim() || null,
      unitQuorum: v.unitQuorum?.trim() ? Number(v.unitQuorum) : null,
    };
  });

  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.formValue.update((n) => n + 1));
    // PR 8a — the clash line: asked again as Starts or Duration change, the latest answer wins.
    toObservable(
      computed(() => {
        const owner = this.owner();
        const at = this.startsAt();
        this.formValue();
        const minutes = Number(this.form.controls.durationMinutes.value);
        return owner && at && minutes ? { owner, startsAt: at.toISOString(), minutes } : null;
      }),
    )
      .pipe(
        debounceTime(250),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        switchMap((key) => {
          if (!key) return of(null);
          const owner = key.owner.kind === 'COMMITTEE' ? { committeeId: key.owner.id } : { orgUnitId: key.owner.id };
          return this.meetings.clashes({ ...owner, times: [{ startsAt: key.startsAt, durationMinutes: key.minutes }] }).pipe(
            map((r) => r[0] ?? null),
            // A failed check says nothing: the line is a warning, never a gate.
            catchError(() => of(null)),
            startWith(null),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((c) => {
        this.clash.set(c);
        if (!c?.people.length) this.showWho.set(false);
      });
    // The dialog lives on the page whether or not it is open: its choices load when it opens (ACC-238).
    effect(() => {
      if (this.visible()) {
        this.form.reset({ title: '', typeValueId: '', durationMinutes: 60, unitQuorum: '', time: '', location: '', meetingUrl: '' });
        this.day.set(null);
        this.error.set(null);
        this.showErrors.set(false);
        this.dateView.set(false);
        this.minDay.set(meetingToday(this.format));
        this.uncertain.set(false);
        this.step.set(1);
        this.visitedRepeat.set(false);
        this.repeatEntry.set(0);
        this.clash.set(null);
        this.showWho.set(false);
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

  /** Step 1 complete: its errors otherwise, with the first one focused. */
  private stepOneReady(): boolean {
    if (this.form.invalid || !this.startsAt()) {
      this.showErrors.set(true);
      this.step.set(1);
      this.showWho.set(false);
      this.dateView.set(false);
      if (this.form.controls.title.invalid) setTimeout(() => this.titleInput()?.nativeElement.focus());
      return false;
    }
    return true;
  }

  /** "Next: repeats": step 2, its Every from the committee's frequency the first time (Q6). */
  next(): void {
    if (!this.stepOneReady()) return;
    this.showErrors.set(false);
    this.error.set(null);
    this.visitedRepeat.set(true);
    this.step.set(2);
    // The step seeds itself from this count once it exists (its first opening also sets Every).
    this.repeatEntry.update((n) => n + 1);
  }

  back(): void {
    this.error.set(null);
    this.step.set(1);
  }

  submit(): void {
    const owner = this.owner();
    if (!owner || this.saving() || this.uncertain()) return;
    if (!this.stepOneReady()) return;
    const repeat = this.step() === 2 ? this.repeat() : null;
    if (repeat?.repeats()) {
      this.scheduleSeries(repeat);
      return;
    }
    const v = this.form.getRawValue();
    const at = this.startsAt()!;
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

  /** PR 8a — the series: every meeting of the preview, then the first one's page. */
  private scheduleSeries(repeat: MeetingRepeatStepComponent): void {
    const request = repeat.request();
    if (!request || !repeat.ready()) {
      this.showErrors.set(true);
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.meetings.createSeries(request).subscribe({
      next: (r) => {
        this.saving.set(false);
        this.form.markAsPristine();
        this.visibleChange.emit(false);
        void this.router.navigate(['/meetings', r.meetingIds[0]]);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        const refusal = meetingRefusalKey(err);
        if (!refusal && mayHaveBeenWritten(err)) {
          this.uncertain.set(true);
          this.error.set('meeting.schedule.maybeScheduledSeries');
          this.maybeScheduled.emit();
          return;
        }
        this.error.set(refusal ?? 'meeting.schedule.error');
      },
    });
  }
}
