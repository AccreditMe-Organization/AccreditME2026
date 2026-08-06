import { Component, Input, Output, EventEmitter, OnInit, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { DatePickerModule } from 'primeng/datepicker';
import { CheckboxModule } from 'primeng/checkbox';
import {
  WorkingCalendarService,
  PublicHolidayDto,
  CreatePublicHolidayDto,
} from '../../services/working-calendar.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';

@Component({
  selector: 'app-public-holiday-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    ButtonModule,
    InputTextModule,
    DatePickerModule,
    CheckboxModule,
  ],
  template: `
    <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-4">

      <div class="flex flex-col gap-1">
        <label for="nameEn" class="font-medium text-sm">
          {{ 'workingCalendar.holidayNameEn' | translate }} *
        </label>
        <input id="nameEn" pInputText formControlName="nameEn" />
      </div>

      <div class="flex flex-col gap-1">
        <label for="nameAr" class="font-medium text-sm">
          {{ 'workingCalendar.holidayNameAr' | translate }}
        </label>
        <input id="nameAr" pInputText formControlName="nameAr" dir="rtl" />
      </div>

      <div class="flex flex-col gap-1">
        <label for="date" class="font-medium text-sm">
          {{ 'workingCalendar.holidayDate' | translate }} *
        </label>
        <p-datepicker
          id="date"
          formControlName="date"
          dateFormat="yy-mm-dd"
          [showIcon]="true"
          styleClass="w-full"
        />
      </div>

      <div class="flex items-center gap-3">
        <p-checkbox
          formControlName="isRecurring"
          [binary]="true"
          inputId="isRecurring"
        />
        <label for="isRecurring" class="text-sm cursor-pointer">
          {{ 'workingCalendar.isRecurring' | translate }}
        </label>
      </div>

      @if (saveError()) {
        <p class="text-red-500 text-sm">{{ saveError() | translate }}</p>
      }

      <div class="flex gap-3 justify-end">
        <p-button
          [label]="'common.cancel' | translate"
          severity="secondary"
          [text]="true"
          type="button"
          (onClick)="cancelled.emit()"
        />
        <p-button
          type="submit"
          [label]="'common.save' | translate"
          [loading]="saving()"
          [disabled]="form.invalid"
        />
      </div>

    </form>
  `,
})
export class PublicHolidayFormComponent implements OnInit {
  @Input() holiday: PublicHolidayDto | null = null;
  @Output() saved = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();

  private readonly svc = inject(WorkingCalendarService);
  private readonly fb = inject(FormBuilder);

  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);

  readonly form = this.fb.group({
    nameEn: ['', [Validators.required, Validators.maxLength(255)]],
    nameAr: ['', Validators.maxLength(255)],
    date: [null as Date | null, Validators.required],
    isRecurring: [false],
  });

  ngOnInit(): void {
    if (this.holiday) {
      this.form.patchValue({
        nameEn: this.holiday.nameEn,
        nameAr: this.holiday.nameAr ?? '',
        date: new Date(this.holiday.date),
        isRecurring: this.holiday.isRecurring,
      });
    }
  }

  onSubmit(): void {
    if (this.form.invalid) return;
    this.saving.set(true);
    this.saveError.set(null);

    const value = this.form.getRawValue();
    const dto: CreatePublicHolidayDto = {
      nameEn: value.nameEn!,
      nameAr: value.nameAr || undefined,
      date: this.dateToIso(value.date!),
      isRecurring: value.isRecurring ?? false,
    };

    let request$;
    if (this.holiday) {
      // TODO: replace with updateHoliday(id, dto) when backend
      // adds PATCH /working-calendar/holidays/:id endpoint
      request$ = this.svc.addHoliday(dto);
    } else {
      request$ = this.svc.addHoliday(dto);
    }

    request$.subscribe({
      next: () => {
        this.saving.set(false);
        this.saved.emit();
      },
      error: (err: unknown) => {
        this.saveError.set(extractErrorMessage(err, 'Save failed'));
        this.saving.set(false);
      },
    });
  }

  private dateToIso(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}
