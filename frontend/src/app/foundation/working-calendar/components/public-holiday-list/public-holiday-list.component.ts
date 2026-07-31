import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import {
  WorkingCalendarService,
  PublicHolidayDto,
} from '../../services/working-calendar.service';
import { PublicHolidayFormComponent } from '../public-holiday-form/public-holiday-form.component';

@Component({
  selector: 'app-public-holiday-list',
  standalone: true,
  imports: [
    FormsModule,
    TranslatePipe,
    TableModule,
    ButtonModule,
    TagModule,
    DialogModule,
    SelectModule,
    PublicHolidayFormComponent,
  ],
  template: `
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-xl font-semibold">{{ 'workingCalendar.holidays' | translate }}</h2>
      <div class="flex gap-3 items-center">
        <p-select
          [options]="yearOptions"
          optionLabel="label"
          optionValue="value"
          [ngModel]="selectedYear()"
          (ngModelChange)="onYearChange($event)"
        />
        <p-button
          icon="pi pi-plus"
          [label]="'workingCalendar.addHoliday' | translate"
          (onClick)="openForm(null)"
        />
      </div>
    </div>

    @if (error()) {
      <p class="text-red-500 mb-4">{{ error() }}</p>
    }

    <p-table
      [value]="holidays()"
      [loading]="loading()"
      [scrollable]="true"
      scrollHeight="flex"
      styleClass="w-full"
    >
      <ng-template pTemplate="header">
        <tr>
          <th>{{ 'workingCalendar.holidayNameEn' | translate }}</th>
          <th>{{ 'workingCalendar.holidayNameAr' | translate }}</th>
          <th>{{ 'workingCalendar.holidayDate' | translate }}</th>
          <th>{{ 'workingCalendar.isRecurring' | translate }}</th>
          <th></th>
        </tr>
      </ng-template>

      <ng-template pTemplate="body" let-holiday>
        <tr>
          <td>{{ holiday.nameEn }}</td>
          <td dir="rtl">{{ holiday.nameAr ?? '—' }}</td>
          <td>{{ holiday.date }}</td>
          <td>
            @if (holiday.isRecurring) {
              <p-tag
                [value]="'workingCalendar.recurring' | translate"
                severity="info"
              />
            }
          </td>
          <td>
            <div class="flex gap-1 justify-end">
              <p-button
                icon="pi pi-pencil"
                [text]="true"
                size="small"
                (onClick)="openForm(holiday)"
              />
              <p-button
                icon="pi pi-trash"
                [text]="true"
                size="small"
                severity="danger"
                (onClick)="onDelete(holiday)"
              />
            </div>
          </td>
        </tr>
      </ng-template>

      <ng-template pTemplate="emptymessage">
        <tr>
          <td colspan="5" class="text-center py-8 text-[var(--am-text-secondary)]">
            {{ 'workingCalendar.noHolidays' | translate }}
          </td>
        </tr>
      </ng-template>
    </p-table>

    <p-dialog
      [visible]="formVisible()"
      (visibleChange)="formVisible.set($event)"
      [header]="selectedHoliday()
        ? ('workingCalendar.editHoliday' | translate)
        : ('workingCalendar.addHoliday' | translate)"
      [modal]="true"
      [style]="{ width: '480px' }"
    >
      <app-public-holiday-form
        [holiday]="selectedHoliday()"
        (saved)="onSaved()"
        (cancelled)="formVisible.set(false)"
      />
    </p-dialog>
  `,
})
export class PublicHolidayListComponent implements OnInit {
  private readonly svc = inject(WorkingCalendarService);

  readonly loading = signal(false);
  readonly holidays = signal<PublicHolidayDto[]>([]);
  readonly error = signal<string | null>(null);
  readonly formVisible = signal(false);
  readonly selectedHoliday = signal<PublicHolidayDto | null>(null);
  readonly selectedYear = signal(new Date().getFullYear());

  readonly yearOptions = [-1, 0, 1, 2].map((offset) => {
    const y = new Date().getFullYear() + offset;
    return { label: String(y), value: y };
  });

  ngOnInit(): void {
    this.loadHolidays();
  }

  onYearChange(year: number): void {
    this.selectedYear.set(year);
    this.loadHolidays();
  }

  openForm(holiday: PublicHolidayDto | null): void {
    this.selectedHoliday.set(holiday);
    this.formVisible.set(true);
  }

  onSaved(): void {
    this.formVisible.set(false);
    this.loadHolidays();
  }

  onDelete(holiday: PublicHolidayDto): void {
    // TODO: replace with PrimeNG ConfirmationService dialog
    // for proper RTL support and translation
    this.svc.removeHoliday(holiday.id).subscribe({
      next: () => this.loadHolidays(),
      error: (err) => this.error.set(err?.error?.message ?? 'Delete failed'),
    });
  }

  private loadHolidays(): void {
    this.loading.set(true);
    this.error.set(null);
    this.svc.getHolidays(this.selectedYear()).subscribe({
      next: (h) => {
        this.holidays.set(h);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to load holidays');
        this.loading.set(false);
      },
    });
  }
}
