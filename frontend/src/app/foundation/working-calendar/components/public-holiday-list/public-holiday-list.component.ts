import { Component, OnInit, TemplateRef, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
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
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { IconButtonComponent } from '../../../../shared/components/icon-button/icon-button.component';
import { AmDatePipe } from '../../../../core/formatting';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';

@Component({
  selector: 'app-public-holiday-list',
  standalone: true,
  imports: [PageHeaderComponent, 
    FormsModule,
    TranslatePipe,
    AmDatePipe,
    TableModule,
    ButtonModule,
    TagModule,
    SelectModule,
    PublicHolidayFormComponent,
    EditDialogComponent,
    IconButtonComponent,
  ],
  template: `
    <!-- ACC-79 — no back arrow: the breadcrumb links Working calendar. -->
    <app-page-header [title]="'workingCalendar.holidays' | translate">
      <div pageActions class="flex gap-3 items-center">
        <p-select
          [options]="yearOptions"
          optionLabel="label"
          optionValue="value"
          [ngModel]="selectedYear()"
          (ngModelChange)="onYearChange($event)"
        />
        @if (canCreate()) {
          <p-button
            icon="pi pi-plus"
            [label]="'workingCalendar.addHoliday' | translate"
            (onClick)="openForm(null)"
          />
        }
      </div>
    </app-page-header>

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
          <td>{{ holiday.date | amDate }}</td>
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
              <!-- ACC-111 — the label names the OBJECT: a screen reader on row
                   nine hears "Edit Eid Al-Fitr", not the ninth "Edit". -->
              <am-icon-button
                icon="pi pi-pencil"
                [label]="'workingCalendar.editHolidayNamed' | translate: { name: holiday.nameEn }"
                (activated)="openForm(holiday)"
              />
              <am-icon-button
                icon="pi pi-trash"
                severity="danger"
                [label]="'workingCalendar.deleteHolidayNamed' | translate: { name: holiday.nameEn }"
                (activated)="onDelete(holiday)"
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
        (cancelled)="dialog.requestClose()"
      />
    </ng-template>

    <!-- ACC-111 — the footer is FIXED, outside the scrolling body, so it
         cannot scroll away from a cursor already moving toward Save and its
         focus ring is not clipped by the body's edge. The form owns the
         submit; the footer drives it through the component instance. -->
    <ng-template #footerTpl>
      <div class="flex justify-end gap-3">
        <p-button
          [label]="'common.cancel' | translate"
          severity="secondary"
          [text]="true"
          type="button"
          [disabled]="!!form?.saving()"
          (onClick)="dialog.requestClose()"
        />
        <p-button
          type="button"
          [label]="'common.save' | translate"
          [loading]="!!form?.saving()"
          [disabled]="!form?.canSave()"
          (onClick)="form?.submit()"
        />
      </div>
    </ng-template>

    <app-edit-dialog
      #dialog
      [visible]="formVisible()"
      (visibleChange)="formVisible.set($event)"
      [header]="selectedHoliday()
        ? ('workingCalendar.editHoliday' | translate)
        : ('workingCalendar.addHoliday' | translate)"
      [content]="formTpl"
      [footer]="footerTpl"
      size="form"
      [dirty]="!!form?.dirty()"
      [saving]="!!form?.saving()"
    />
  `,
})
export class PublicHolidayListComponent implements OnInit {
  @ViewChild('formTpl', { read: TemplateRef, static: true }) formTpl!: TemplateRef<unknown>;
  @ViewChild('footerTpl', { read: TemplateRef, static: true }) footerTpl!: TemplateRef<unknown>;

  /**
   * The form inside the dialog. The footer lives outside the body (ACC-111),
   * so the buttons cannot reach the form through a template reference — the
   * two templates are separate embedded views — and drive it through this
   * instead. Undefined while the dialog is closed, hence every `?.`.
   */
  @ViewChild(PublicHolidayFormComponent) form?: PublicHolidayFormComponent;

  private readonly svc = inject(WorkingCalendarService);
  private readonly navigationAccess = inject(NavigationAccessService);

  // ACC-118 — the create action is HIDDEN, not disabled, for a caller who
  // cannot use it: a disabled button still announces an action that is not
  // theirs. Same mechanism as committee-detail.component.ts's canEdit /
  // canAddMember, deliberately rather than a second one.
  // POST /working-calendar/holidays enforces ORG_PERMISSIONS.MANAGE — org:manage.
  // Nothing in that string names a holiday or a calendar, which is exactly why
  // it was read off the decorator (working-calendar.controller.ts).
  readonly canCreate = computed(() => this.navigationAccess.hasPermission('org:manage'));

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
