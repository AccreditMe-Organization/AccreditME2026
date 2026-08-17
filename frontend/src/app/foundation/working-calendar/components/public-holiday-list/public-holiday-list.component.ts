import { Component, OnInit, TemplateRef, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { SelectModule } from 'primeng/select';
import {
  WorkingCalendarService,
  PublicHolidayDto,
} from '../../services/working-calendar.service';
import { PublicHolidayFormComponent } from '../public-holiday-form/public-holiday-form.component';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';

@Component({
  selector: 'app-public-holiday-list',
  standalone: true,
  imports: [
    FormsModule,
    TranslatePipe,
    TableModule,
    ButtonModule,
    TagModule,
    SelectModule,
    PublicHolidayFormComponent,
    EditDialogComponent,
  ],
  template: `
    <div class="flex justify-between items-center mb-4">
      <div class="flex items-center gap-3">
        <p-button
          icon="pi pi-arrow-left"
          [text]="true"
          size="small"
          [ariaLabel]="'workingCalendar.title' | translate"
          (onClick)="goBack()"
        />
        <h2 class="text-xl font-semibold">{{ 'workingCalendar.holidays' | translate }}</h2>
      </div>
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
      <p class="text-red-500 mb-4">{{ error() | translate }}</p>
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

    <ng-template #formTpl>
      <app-public-holiday-form
        [holiday]="selectedHoliday()"
        (saved)="onSaved()"
        (cancelled)="formVisible.set(false)"
      />
    </ng-template>
    <app-edit-dialog
      [visible]="formVisible()"
      (visibleChange)="formVisible.set($event)"
      [header]="selectedHoliday()
        ? ('workingCalendar.editHoliday' | translate)
        : ('workingCalendar.addHoliday' | translate)"
      [content]="formTpl"
      width="480px"
    />
  `,
})
export class PublicHolidayListComponent implements OnInit {
  @ViewChild('formTpl', { read: TemplateRef, static: true }) formTpl!: TemplateRef<unknown>;

  private readonly svc = inject(WorkingCalendarService);
  private readonly router = inject(Router);

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

  goBack(): void {
    // Absolute path, not relativeTo — see ACC-16 (NG04002 on relative '..'
    // navigation across this route's lazy-loaded boundary).
    void this.router.navigate(['/working-calendar']);
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
      error: (err: unknown) => this.error.set(extractErrorMessage(err, 'Delete failed')),
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
