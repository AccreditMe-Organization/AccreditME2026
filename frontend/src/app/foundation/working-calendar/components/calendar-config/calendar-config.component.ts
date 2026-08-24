import { Component, OnInit, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder } from '@angular/forms';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { DividerModule } from 'primeng/divider';
import {
  WorkingCalendarService,
  WorkingCalendarDto,
  AiHolidaySuggestion,
} from '../../services/working-calendar.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
// ACC-42 Phase 5 — OverlaySelectComponent replaces p-select on this field:
// routed-page-under-<main> context; also re-verification target #2 (plan
// §6) — ACC-38's earlier "PASS" tested a mechanism since confirmed to give
// zero real protection, not this field's actual safety. See CLAUDE.md's
// PrimeNG-components-only exception note and overlay-select.component.ts
// for the full mechanism.
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';

const GCC_DAYS = [0, 1, 2, 3, 4];
const WESTERN_DAYS = [1, 2, 3, 4, 5];

const COMMON_TIMEZONES = [
  { label: 'Asia/Riyadh (UTC+3)', value: 'Asia/Riyadh' },
  { label: 'Asia/Dubai (UTC+4)', value: 'Asia/Dubai' },
  { label: 'Asia/Kuwait (UTC+3)', value: 'Asia/Kuwait' },
  { label: 'Asia/Bahrain (UTC+3)', value: 'Asia/Bahrain' },
  { label: 'Asia/Qatar (UTC+3)', value: 'Asia/Qatar' },
  { label: 'Africa/Cairo (UTC+2)', value: 'Africa/Cairo' },
  { label: 'Asia/Amman (UTC+3)', value: 'Asia/Amman' },
  { label: 'Asia/Beirut (UTC+3)', value: 'Asia/Beirut' },
  { label: 'Europe/London (UTC+0/+1)', value: 'Europe/London' },
  { label: 'Europe/Paris (UTC+1/+2)', value: 'Europe/Paris' },
  { label: 'America/New_York (UTC-5/-4)', value: 'America/New_York' },
  { label: 'America/Chicago (UTC-6/-5)', value: 'America/Chicago' },
  { label: 'America/Los_Angeles (UTC-8/-7)', value: 'America/Los_Angeles' },
  { label: 'UTC', value: 'UTC' },
];

const WEEK_DAYS = [
  { value: 0, labelKey: 'workingCalendar.daySun' },
  { value: 1, labelKey: 'workingCalendar.dayMon' },
  { value: 2, labelKey: 'workingCalendar.dayTue' },
  { value: 3, labelKey: 'workingCalendar.dayWed' },
  { value: 4, labelKey: 'workingCalendar.dayThu' },
  { value: 5, labelKey: 'workingCalendar.dayFri' },
  { value: 6, labelKey: 'workingCalendar.daySat' },
];

interface SuggestionState extends AiHolidaySuggestion {
  accepted: boolean;
}

@Component({
  selector: 'app-calendar-config',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    RouterLink,
    TranslatePipe,
    ButtonModule,
    OverlaySelectComponent,
    DatePickerModule,
    DividerModule,
  ],
  template: `
    <div class="flex items-center justify-between mb-6" style="max-width: 680px">
      <h2 class="text-xl font-semibold">{{ 'workingCalendar.title' | translate }}</h2>
      <p-button
        [label]="'workingCalendar.holidays' | translate"
        icon="pi pi-calendar-plus"
        severity="secondary"
        [outlined]="true"
        routerLink="/working-calendar/holidays"
      />
    </div>

    @if (loadError()) {
      <p class="text-red-500 mb-4">{{ loadError() | translate }}</p>
    }

    <div class="flex flex-col gap-6" style="max-width: 680px">

      <!-- Working Days -->
      <section class="flex flex-col gap-3">
        <h3 class="font-medium">{{ 'workingCalendar.workingDays' | translate }}</h3>
        <div class="flex gap-2 mb-2">
          <p-button
            [label]="'workingCalendar.presetGcc' | translate"
            size="small"
            severity="secondary"
            (onClick)="applyGccPreset()"
          />
          <p-button
            [label]="'workingCalendar.presetWestern' | translate"
            size="small"
            severity="secondary"
            (onClick)="applyWesternPreset()"
          />
        </div>
        <div class="flex gap-4 flex-wrap">
          @for (day of weekDays; track day.value) {
            <label class="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                [checked]="isDaySelected(day.value)"
                (change)="toggleDay(day.value)"
              />
              {{ day.labelKey | translate }}
            </label>
          }
        </div>
      </section>

      <p-divider />

      <!-- Working Hours -->
      <section class="flex flex-col gap-3">
        <h3 class="font-medium">{{ 'workingCalendar.workingHours' | translate }}</h3>
        <div class="flex gap-4 items-center flex-wrap">
          <div class="flex flex-col gap-1">
            <label class="text-sm text-[var(--am-text-secondary)]">From</label>
            <p-datepicker
              [(ngModel)]="startTime"
              [timeOnly]="true"
              hourFormat="24"
              styleClass="w-full"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm text-[var(--am-text-secondary)]">To</label>
            <p-datepicker
              [(ngModel)]="endTime"
              [timeOnly]="true"
              hourFormat="24"
              styleClass="w-full"
            />
          </div>
        </div>
      </section>

      <p-divider />

      <!-- Timezone -->
      <section class="flex flex-col gap-3">
        <h3 class="font-medium">{{ 'workingCalendar.timezone' | translate }}</h3>
        <app-overlay-select
          [(ngModel)]="timezone"
          [options]="timezones"
          optionLabel="label"
          optionValue="value"
        />
      </section>

      <p-divider />

      <!-- Save -->
      @if (saveError()) {
        <p class="text-red-500">{{ saveError() | translate }}</p>
      }
      <div class="flex justify-end">
        <p-button
          [label]="'common.save' | translate"
          [loading]="saving()"
          (onClick)="onSave()"
        />
      </div>

      <p-divider />

      <!-- AI Holiday Suggestion -->
      <section class="flex flex-col gap-3">
        <h3 class="font-medium">{{ 'workingCalendar.suggestHolidays' | translate }}</h3>
        <div class="flex gap-3 items-end flex-wrap">
          <div class="flex flex-col gap-1">
            <label class="text-sm text-[var(--am-text-secondary)]">Country code (e.g. SA, AE, GB)</label>
            <input
              [(ngModel)]="aiCountry"
              class="border rounded px-3 py-2 text-sm"
              maxlength="3"
              style="width: 120px"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm text-[var(--am-text-secondary)]">Year</label>
            <input
              type="number"
              [(ngModel)]="aiYear"
              class="border rounded px-3 py-2 text-sm"
              style="width: 100px"
              [min]="2024"
              [max]="2030"
            />
          </div>
          <p-button
            [label]="'workingCalendar.suggestHolidays' | translate"
            icon="pi pi-sparkles"
            severity="secondary"
            [loading]="aiSuggesting()"
            [disabled]="!aiCountry"
            (onClick)="onSuggestHolidays()"
          />
        </div>

        @if (aiSuggestions().length) {
          <div class="flex flex-col gap-3 mt-2">
            <p class="text-sm text-[var(--am-text-secondary)]">{{ 'workingCalendar.aiSuggestionsHint' | translate }}</p>
            @for (s of aiSuggestions(); track s.date; let i = $index) {
              <label class="flex items-center gap-3 cursor-pointer p-3 border rounded">
                <input
                  type="checkbox"
                  [checked]="s.accepted"
                  (change)="toggleSuggestion(i)"
                />
                <span class="flex flex-col gap-1">
                  <span class="font-medium">{{ s.nameEn }}{{ s.nameAr ? ' (' + s.nameAr + ')' : '' }}</span>
                  <span class="text-sm text-[var(--am-text-secondary)]">{{ s.date }}{{ s.isRecurring ? ' · Recurring' : '' }}</span>
                </span>
              </label>
            }
            <div class="flex justify-end">
              <p-button
                label="Add Selected"
                [loading]="aiAdding()"
                [disabled]="!hasAccepted()"
                (onClick)="onAddAccepted()"
              />
            </div>
          </div>
        }

        @if (aiError()) {
          <p class="text-red-500 text-sm">{{ aiError() | translate }}</p>
        }
      </section>

    </div>
  `,
})
export class CalendarConfigComponent implements OnInit {
  private readonly svc = inject(WorkingCalendarService);

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly saveError = signal<string | null>(null);
  readonly aiSuggesting = signal(false);
  readonly aiAdding = signal(false);
  readonly aiError = signal<string | null>(null);
  readonly aiSuggestions = signal<SuggestionState[]>([]);

  readonly weekDays = WEEK_DAYS;
  readonly timezones = COMMON_TIMEZONES;

  selectedDays = signal<number[]>([]);
  startTime = new Date();
  endTime = new Date();
  timezone = 'Asia/Riyadh';
  aiCountry = '';
  aiYear = new Date().getFullYear();

  ngOnInit(): void {
    this.loading.set(true);
    this.svc.getCalendar().subscribe({
      next: (cal) => this.applyCalendar(cal),
      error: () => {
        this.loadError.set('Failed to load working calendar');
        this.loading.set(false);
      },
    });
  }

  isDaySelected(day: number): boolean {
    return this.selectedDays().includes(day);
  }

  toggleDay(day: number): void {
    const current = this.selectedDays();
    this.selectedDays.set(
      current.includes(day)
        ? current.filter((d) => d !== day)
        : [...current, day].sort((a, b) => a - b),
    );
  }

  applyGccPreset(): void {
    this.selectedDays.set([...GCC_DAYS]);
  }

  applyWesternPreset(): void {
    this.selectedDays.set([...WESTERN_DAYS]);
  }

  onSave(): void {
    this.saving.set(true);
    this.saveError.set(null);
    const dto = {
      workingDays: this.selectedDays(),
      workingHoursStart: this.dateToHhmm(this.startTime),
      workingHoursEnd: this.dateToHhmm(this.endTime),
      timezone: this.timezone,
    };
    this.svc.updateCalendar(dto).subscribe({
      next: () => this.saving.set(false),
      error: (err: unknown) => {
        this.saveError.set(extractErrorMessage(err, 'Save failed'));
        this.saving.set(false);
      },
    });
  }

  onSuggestHolidays(): void {
    this.aiSuggesting.set(true);
    this.aiError.set(null);
    this.aiSuggestions.set([]);
    this.svc.suggestHolidays(this.aiCountry, this.aiYear).subscribe({
      next: (suggestions) => {
        this.aiSuggestions.set(suggestions.map((s) => ({ ...s, accepted: true })));
        this.aiSuggesting.set(false);
      },
      error: () => {
        this.aiError.set('AI suggestion failed. Try again.');
        this.aiSuggesting.set(false);
      },
    });
  }

  toggleSuggestion(index: number): void {
    this.aiSuggestions.update((list) =>
      list.map((s, i) => (i === index ? { ...s, accepted: !s.accepted } : s)),
    );
  }

  hasAccepted(): boolean {
    return this.aiSuggestions().some((s) => s.accepted);
  }

  onAddAccepted(): void {
    const accepted = this.aiSuggestions().filter((s) => s.accepted);
    if (!accepted.length) return;
    this.aiAdding.set(true);
    let remaining = accepted.length;
    for (const s of accepted) {
      this.svc
        .addHoliday({ nameEn: s.nameEn, nameAr: s.nameAr ?? undefined, date: s.date, isRecurring: s.isRecurring })
        .subscribe({
          next: () => {
            remaining--;
            if (remaining === 0) {
              this.aiAdding.set(false);
              this.aiSuggestions.set([]);
            }
          },
          error: () => {
            remaining--;
            if (remaining === 0) this.aiAdding.set(false);
          },
        });
    }
  }

  private applyCalendar(cal: WorkingCalendarDto): void {
    this.selectedDays.set([...cal.workingDays]);
    this.startTime = this.hhmmToDate(cal.workingHoursStart);
    this.endTime = this.hhmmToDate(cal.workingHoursEnd);
    this.timezone = cal.timezone;
    this.loading.set(false);
  }

  private hhmmToDate(hhmm: string): Date {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
  }

  private dateToHhmm(date: Date): string {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
}
