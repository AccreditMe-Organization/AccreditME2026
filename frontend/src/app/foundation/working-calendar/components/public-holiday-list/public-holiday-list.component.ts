import {
  Component,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { switchMap } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { ConfirmationService } from 'primeng/api';
import {
  PublicHolidayDto,
  WorkingCalendarService,
} from '../../services/working-calendar.service';
import {
  DataListColumn,
  DataListComponent,
} from '../../../../shared/components/data-list/data-list.component';
import {
  DataListSource,
  clientSideSource,
} from '../../../../shared/components/data-list/data-list.source';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { IconButtonComponent } from '../../../../shared/components/icon-button/icon-button.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { InlineCalendarComponent } from '../../../../shared/components/inline-calendar/inline-calendar.component';
import { AmDatePipe, FormatService } from '../../../../core/formatting';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';

/**
 * Public holidays — ACC-120 slice 1, Templates Rev 6, Template 5's inline row
 * over the Template 1 list.
 *
 * ## ADD IS NO LONGER A DIALOG, and the reason is throughput
 *
 * Eight ministry holidays arrive at once each year. A modal per holiday is
 * eight open–fill–save cycles; a row that stays open after Enter is one. So the
 * row sits above the list it feeds, Enter adds and keeps it open, and focus
 * returns to the first field for the next one.
 *
 * `PublicHolidayFormComponent` is deleted rather than restyled, and with it the
 * nested "Choose a date" modal it opened. That modal was measured before
 * deletion and is worth recording, because it is what a local calendar costs:
 * `.am-cal` absent so none of the shared calendar's CSS applied, 32px cells
 * against the shared 28, a 229x280 grid against 178, 306px of calendar in a
 * 478px body — and **0 of 35 day cells reachable by keyboard**, every one at
 * `tabIndex -1`. Its only focusable controls were Close and the four month/year
 * buttons. Nothing of it is carried across.
 *
 * ## The calendar expands IN FLOW, and that is not the dialog rule
 *
 * Artboard 7's no-floating-panel rule governs a dialog BODY. This row is on a
 * page, so the panel may expand in flow beneath it, pushing the list down —
 * which is the drawn shape and also the one that gets the shared calendar's
 * keyboard grid for free (`am-inline-calendar`, ACC-96). Typing stays a
 * complete path to a value with the calendar never opened.
 *
 * ## Gregorian entry, Hijri confirmation
 *
 * Dates are entered in Gregorian everywhere in the application and Hijri is
 * display only (ACC-94 D4, restored with no exception by Ahmad on 2026-09-26).
 * **The Gregorian | Hijri entry switch drawn on this row in Template 5 is
 * REMOVED, not hidden**, and the paragraph beside it arguing for it is
 * superseded — do not restore it on meeting that text. The measurements behind
 * the decision are on ACC-121: a Hijri holiday can fall twice in one Gregorian
 * year (Eid al-Fitr, 3 Jan and 23 Dec 2033), a day-30 holiday does not exist in
 * about half of all years, and the calculated Umm al-Qura date is not the
 * sighted date a ministry announces.
 *
 * What survives from that drawing is the equivalent shown BEFORE the row is
 * saved, never after — entry confirmation, not a reader preference. See
 * `FormatService.hijri()` for why those are different things.
 *
 * ## One row, two modes — an interpretation, recorded as one
 *
 * The drawing's list row shows only a delete `✕`. Editing a holiday is not
 * drawn anywhere, but this screen has always had it, and dropping a working
 * capability in a MIGRATION slice is a feature removal rather than a migration.
 * So the one row serves both: Edit fills it with that holiday's values and the
 * button becomes Save changes, exactly as the deleted dialog served both.
 */
@Component({
  selector: 'app-public-holiday-list',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    TranslatePipe,
    AmDatePipe,
    ButtonModule,
    CheckboxModule,
    InputTextModule,
    SelectModule,
    TagModule,
    PageHeaderComponent,
    IconButtonComponent,
    FieldComponent,
    InlineCalendarComponent,
    DataListComponent,
  ],
  template: `
    <!-- ACC-79 — no back arrow: the breadcrumb links Working calendar. -->
    <app-page-header [title]="'workingCalendar.holidays' | translate" />

    <!-- THE INLINE ADD ROW, above the list it feeds. Hidden, not disabled, for
         a caller who cannot write — the same rule every create action follows
         (check:create-gating). -->
    @if (canManage()) {
      <form
        class="am-holiday-row"
        [formGroup]="form"
        (ngSubmit)="submit()"
        [attr.aria-label]="
          (editing() ? 'workingCalendar.row.editLabel' : 'workingCalendar.row.addLabel') | translate
        "
      >
        <div class="am-holiday-row__fields">
          <am-field
            class="am-holiday-row__name"
            [label]="'workingCalendar.holidayNameEn' | translate"
            [control]="form.controls.nameEn"
            [forceShowErrors]="showErrors()"
          >
            <input pInputText formControlName="nameEn" [id]="nameEnId" class="w-full" />
          </am-field>

          <am-field
            class="am-holiday-row__name"
            [label]="'workingCalendar.holidayNameAr' | translate"
            [control]="form.controls.nameAr"
            [forceShowErrors]="showErrors()"
          >
            <input pInputText formControlName="nameAr" dir="rtl" lang="ar" class="w-full" />
          </am-field>

          <!-- The hint slot carries the Hijri equivalent. It is reserved at all
               times (ACC-111), so the line appearing as a date becomes valid
               never moves the row. -->
          <am-field
            class="am-holiday-row__date"
            [label]="'workingCalendar.holidayDate' | translate"
            [control]="form.controls.date"
            [forceShowErrors]="showErrors()"
            [hint]="dateHint()"
            [errorMessages]="{ invalidDate: 'workingCalendar.holidayDateInvalid' }"
          >
            <input
              pInputText
              dir="ltr"
              [id]="dateId"
              class="w-full"
              [value]="dateText()"
              (input)="onDateTyped($any($event.target).value)"
              (blur)="commitTypedDate()"
              autocomplete="off"
            />
            <!-- The LABEL carries the toggle's state, because am-icon-button has
                 no pressed input and inventing one for this row would be a
                 shared-component change for one caller. "Show"/"Hide the
                 calendar" is what a screen reader needs either way. -->
            <am-icon-button
              [label]="
                (calendarOpen()
                  ? 'workingCalendar.row.hideCalendar'
                  : 'workingCalendar.row.showCalendar'
                ) | translate
              "
              icon="pi pi-calendar"
              (activated)="toggleCalendar()"
            />
          </am-field>
        </div>

        <!-- WORDING ONLY, and it is the whole of decision E: nothing validates
             this and no Setup health detector watches it ("we can't prevent all
             user mistakes with complex validations"). The label has to carry the
             meaning, because a Hijri holiday ticked here silently moves the SLA
             clock to the wrong day from year two. -->
        <div class="am-holiday-row__repeat">
          <div class="flex items-center gap-3">
            <p-checkbox formControlName="isRecurring" [binary]="true" [inputId]="recurringId" />
            <label [attr.for]="recurringId" class="text-value cursor-pointer">
              {{ 'workingCalendar.row.repeats' | translate }}
            </label>
          </div>
          <p class="am-holiday-row__hint">{{ 'workingCalendar.row.repeatsHint' | translate }}</p>
        </div>

        <div class="am-holiday-row__actions">
          @if (saveError()) {
            <p class="am-holiday-row__error" role="alert">{{ saveError()! | translate }}</p>
          } @else {
            <p class="am-holiday-row__hint">{{ 'workingCalendar.row.enterHint' | translate }}</p>
          }
          <div class="flex gap-3">
            <p-button
              type="button"
              severity="secondary"
              [text]="true"
              [label]="'common.cancel' | translate"
              [disabled]="saving()"
              (onClick)="resetRow()"
            />
            <p-button
              type="submit"
              [label]="
                (editing() ? 'workingCalendar.row.saveChanges' : 'workingCalendar.row.add')
                  | translate
              "
              [loading]="saving()"
            />
          </div>
        </div>

        <!-- IN FLOW, not floating. Pushes the list down; nothing to dismiss. -->
        @if (calendarOpen()) {
          <div class="am-holiday-row__calendar">
            <am-inline-calendar [value]="pickedDate()" (valueChange)="onDatePicked($event)" />
          </div>
        }
      </form>
    }

    <app-data-list
      #list
      variant="page"
      [source]="source"
      [trackBy]="trackById"
      [columns]="columns()"
      [searchPlaceholder]="'workingCalendar.searchPlaceholder' | translate"
      [emptyTitle]="'workingCalendar.noHolidays' | translate"
      [emptyMessage]="'workingCalendar.noHolidaysReason' | translate: { year: selectedYear() }"
      persistKey="publicHolidays"
      [urlSync]="true"
    >
      <!-- FOUR options, so p-select is correct here rather than
           OverlaySelectComponent: CLAUDE.md's threshold is five, below which
           PrimeNG's scroll-chaining close cannot be reached in any DOM context.
           In listFilters, which is where the list pattern puts a filter. -->
      <div listFilters class="flex items-center gap-1.5 shrink-0">
        <p-select
          [options]="yearOptions"
          optionLabel="label"
          optionValue="value"
          [ngModel]="selectedYear()"
          (ngModelChange)="onYearChange($event)"
          [ariaLabel]="'workingCalendar.filterByYear' | translate"
        />
      </div>

      <ng-template #listHeader let-h>
        @for (column of columns(); track column.key) {
          @if (h.visible(column.key)) {
            @if (column.sortBy) {
              <button
                type="button"
                class="flex items-center gap-1 text-start uppercase hover:text-[var(--am-blue-primary)]"
                (click)="h.sort(column.key)"
              >
                {{ column.label }}
                @if (h.sortBy === column.sortBy) {
                  <i
                    class="pi text-[10px]"
                    [class.pi-arrow-up]="h.sortDir === 'asc'"
                    [class.pi-arrow-down]="h.sortDir === 'desc'"
                    aria-hidden="true"
                  ></i>
                }
              </button>
            } @else {
              <span class="uppercase">{{ column.label }}</span>
            }
          }
        }
        <span></span>
      </ng-template>

      <ng-template #listRow let-holiday let-visible="visible">
        @if (visible('nameEn')) {
          <span class="truncate">{{ holiday.nameEn }}</span>
        }
        @if (visible('nameAr')) {
          <span class="truncate" dir="rtl">{{ holiday.nameAr || '—' }}</span>
        }
        @if (visible('date')) {
          <span>{{ holiday.date | amDate }}</span>
        }
        @if (visible('isRecurring')) {
          <span>
            <!-- The tag carries its own word, not a bare "Yes" beside a column
                 header that is somewhere else on the row. -->
            @if (holiday.isRecurring) {
              <p-tag severity="info" [value]="'workingCalendar.recurring' | translate" />
            } @else {
              <span class="text-meta text-[var(--am-text-secondary)]">—</span>
            }
          </span>
        }
        <span class="flex gap-1 justify-end">
          @if (canManage()) {
            <!-- The label names the OBJECT: a screen reader on row nine hears
                 "Edit Eid Al-Fitr", not the ninth "Edit" (ACC-111). -->
            <am-icon-button
              icon="pi pi-pencil"
              [label]="'workingCalendar.editHolidayNamed' | translate: { name: holiday.nameEn }"
              (activated)="startEdit(holiday)"
            />
            <am-icon-button
              icon="pi pi-trash"
              severity="danger"
              [label]="'workingCalendar.deleteHolidayNamed' | translate: { name: holiday.nameEn }"
              (activated)="confirmDelete(holiday)"
            />
          }
        </span>
      </ng-template>
    </app-data-list>
  `,
  styles: [
    `
      .am-holiday-row {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-12);
        padding: var(--am-space-16);
        margin-block-end: var(--am-space-16);
        background: var(--am-card);
        border: 1px solid var(--am-border);
        border-radius: 8px;
      }

      /* Wraps rather than scrolls: the row is three fields and a checkbox, and a
         field that wraps is readable where a horizontally scrolled form is not. */
      .am-holiday-row__fields {
        display: flex;
        flex-wrap: wrap;
        gap: var(--am-space-12);
      }
      .am-holiday-row__name {
        flex: 1 1 200px;
        min-width: 0;
      }
      .am-holiday-row__date {
        flex: 1 1 210px;
        min-width: 0;
      }

      .am-holiday-row__repeat {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .am-holiday-row__actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--am-space-12);
      }

      .am-holiday-row__hint {
        margin: 0;
        font-size: 11.5px;
        line-height: 17px;
        color: var(--am-ink-500);
        text-wrap: pretty;
      }

      .am-holiday-row__error {
        margin: 0;
        font-size: 11.5px;
        line-height: 17px;
        font-weight: 500;
        color: var(--am-danger-ink);
      }

      /* Capped and scrollable only if a viewport genuinely cannot hold it. The
         calendar is 258px and the row above it is short, so on any ordinary
         screen nothing scrolls — but a 500px-tall window must not strand the
         list below it. */
      .am-holiday-row__calendar {
        max-width: 320px;
      }
    `,
  ],
})
export class PublicHolidayListComponent implements OnInit {
  private readonly svc = inject(WorkingCalendarService);
  private readonly fb = inject(FormBuilder);
  private readonly format = inject(FormatService);
  private readonly translate = inject(TranslateService);
  private readonly confirmation = inject(ConfirmationService);
  private readonly navigationAccess = inject(NavigationAccessService);

  private readonly list = viewChild<DataListComponent<PublicHolidayDto>>('list');

  private static nextId = 0;
  private readonly uid = `am-holiday-${PublicHolidayListComponent.nextId++}`;
  protected readonly nameEnId = `${this.uid}-nameEn`;
  protected readonly dateId = `${this.uid}-date`;
  protected readonly recurringId = `${this.uid}-recurring`;

  /** `org:manage` — what every holiday write endpoint carries. */
  readonly canManage = computed(() => this.navigationAccess.hasPermission('org:manage'));

  readonly selectedYear = signal(new Date().getFullYear());
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly showErrors = signal(false);

  /** The holiday being edited, or null in add mode. */
  readonly editing = signal<PublicHolidayDto | null>(null);

  readonly yearOptions = [-1, 0, 1, 2].map((offset) => {
    const y = new Date().getFullYear() + offset;
    return { label: String(y), value: y };
  });

  readonly form = this.fb.group({
    nameEn: ['', [Validators.required, Validators.maxLength(255)]],
    nameAr: ['', Validators.maxLength(255)],
    date: [null as Date | null, Validators.required],
    isRecurring: [false],
  });

  // ── The date field ──────────────────────────────────────────────────────
  readonly calendarOpen = signal(false);
  private readonly typedDate = signal<string | null>(null);
  readonly pickedDate = signal<Date | null>(null);

  readonly dateText = computed(
    () => this.typedDate() ?? this.format.dateForInput(this.pickedDate()),
  );

  /**
   * The Hijri equivalent of what is typed, or the field's help text when there
   * is no date yet. Always shown once a date is readable — this is entry
   * confirmation, not the reader's calendar preference (`FormatService.hijri()`).
   */
  readonly dateHint = computed(() => {
    const at = this.pickedDate();
    if (!at) return this.translate.instant('workingCalendar.holidayDateHint');
    return this.format.hijri(at);
  });

  // ── The list ────────────────────────────────────────────────────────────
  readonly columns = computed<DataListColumn[]>(() => [
    {
      key: 'nameEn',
      label: this.translate.instant('workingCalendar.holidayNameEn'),
      sortBy: 'nameEn',
      alwaysVisible: true,
      width: 'minmax(0, 2fr)',
    },
    {
      key: 'nameAr',
      label: this.translate.instant('workingCalendar.holidayNameAr'),
      width: 'minmax(0, 2fr)',
    },
    {
      key: 'date',
      label: this.translate.instant('workingCalendar.holidayDate'),
      sortBy: 'date',
      width: 'minmax(0, 1fr)',
    },
    {
      key: 'isRecurring',
      label: this.translate.instant('workingCalendar.isRecurring'),
      width: 'minmax(0, 1fr)',
    },
  ]);

  readonly trackById = (row: PublicHolidayDto): string => row.id;

  /**
   * HTTP per call, then search/sort/slice in memory.
   *
   * The HTTP half is what lets `app-data-list` report the real outcomes — a
   * skeleton on first load, a retry on failure, `denied` on a 403 — which a
   * plain array could not. The in-memory half is honest for a list of a
   * year's holidays: `clientSideSource` does search, sort and slice and
   * nothing else, and a list this size has not outgrown being an array.
   */
  readonly source: DataListSource<PublicHolidayDto> = (query) =>
    this.svc.getHolidays(this.selectedYear()).pipe(
      switchMap((rows) =>
        clientSideSource<PublicHolidayDto>(() => rows, {
          searchFields: (h) => [h.nameEn, h.nameAr],
          comparators: {
            nameEn: (a, b) => a.nameEn.localeCompare(b.nameEn),
            date: (a, b) => a.date.localeCompare(b.date),
          },
          defaultSort: { column: 'date', dir: 'asc' },
        })(query),
      ),
    );

  ngOnInit(): void {
    // Nothing to load here: app-data-list drives `source` itself, and owns the
    // loading, empty, denied and error states while it does.
  }

  onYearChange(year: number): void {
    this.selectedYear.set(year);
    this.list()?.reload();
  }

  // ── Add and edit ────────────────────────────────────────────────────────
  startEdit(holiday: PublicHolidayDto): void {
    this.editing.set(holiday);
    this.saveError.set(null);
    this.showErrors.set(false);
    this.form.setValue({
      nameEn: holiday.nameEn,
      nameAr: holiday.nameAr ?? '',
      date: new Date(holiday.date),
      isRecurring: holiday.isRecurring,
    });
    this.pickedDate.set(new Date(holiday.date));
    this.typedDate.set(null);
    this.focusFirstField();
  }

  submit(): void {
    this.showErrors.set(true);
    this.commitTypedDate();
    if (this.form.invalid || this.saving()) return;

    const { nameEn, nameAr, date, isRecurring } = this.form.getRawValue();
    const dto = {
      nameEn: nameEn!.trim(),
      nameAr: nameAr?.trim() || undefined,
      // Gregorian, and date-only: the value the API stores. Built from the
      // local calendar day the user picked, never from an ISO instant, so a
      // tenant east of UTC does not record the previous day.
      date: toApiDate(date!),
      isRecurring: !!isRecurring,
    };

    const existing = this.editing();
    const request = existing
      ? this.svc.updateHoliday(existing.id, dto)
      : this.svc.addHoliday(dto);

    this.saving.set(true);
    this.saveError.set(null);
    request.subscribe({
      next: () => {
        this.saving.set(false);
        // ENTER KEEPS THE ROW OPEN for the next holiday, which is the whole
        // reason this stopped being a dialog. An edit has nothing further to
        // add, so it returns the row to add mode.
        this.resetRow();
        this.list()?.reload();
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.saveError.set(extractErrorMessage(err, 'workingCalendar.saveFailed'));
      },
    });
  }

  resetRow(): void {
    this.editing.set(null);
    this.form.reset({ nameEn: '', nameAr: '', date: null, isRecurring: false });
    this.pickedDate.set(null);
    this.typedDate.set(null);
    this.showErrors.set(false);
    this.saveError.set(null);
    this.calendarOpen.set(false);
    this.focusFirstField();
  }

  // ── Delete ──────────────────────────────────────────────────────────────
  /**
   * ACC-120 slice 1 — this confirmation was assigned to slice 10 and is pulled
   * forward, because this slice rebuilds the row the button sits on and
   * deleting a holiday silently changes what the SLA clock does. The message
   * says what happens to the calendar, not only what happens to the record.
   */
  confirmDelete(holiday: PublicHolidayDto): void {
    this.confirmation.confirm({
      header: this.translate.instant('workingCalendar.deleteConfirmHeader'),
      message: this.translate.instant('workingCalendar.deleteConfirmMessage', {
        name: holiday.nameEn,
        date: this.format.date(holiday.date),
      }),
      icon: 'pi pi-exclamation-triangle',
      acceptButtonProps: { severity: 'danger' },
      acceptLabel: this.translate.instant('workingCalendar.deleteConfirmAccept'),
      rejectLabel: this.translate.instant('common.cancel'),
      accept: () => {
        this.svc.removeHoliday(holiday.id).subscribe({
          next: () => {
            // An edit in progress on the row that was just deleted would save
            // to a record that no longer exists.
            if (this.editing()?.id === holiday.id) this.resetRow();
            this.list()?.reload();
          },
          error: (err: unknown) =>
            this.saveError.set(extractErrorMessage(err, 'workingCalendar.deleteFailed')),
        });
      },
    });
  }

  // ── Typing and picking ──────────────────────────────────────────────────
  toggleCalendar(): void {
    this.calendarOpen.set(!this.calendarOpen());
  }

  onDatePicked(value: Date | null): void {
    this.pickedDate.set(value);
    this.typedDate.set(null);
    this.form.controls.date.setValue(value);
    this.form.controls.date.markAsDirty();
    // Stays open, as the shared calendar's other consumers do: correcting a
    // mis-click should not be a second navigation.
    document.getElementById(this.dateId)?.focus();
  }

  onDateTyped(value: string): void {
    this.typedDate.set(value);
  }

  /** On BLUR, not per keystroke — "15 S" is not an error, it is unfinished. */
  commitTypedDate(): void {
    const text = this.typedDate();
    if (text === null) return;

    const control = this.form.controls.date;
    const trimmed = text.trim();
    if (trimmed === '') {
      control.setValue(null);
      control.markAsDirty();
      this.pickedDate.set(null);
      this.typedDate.set(null);
      return;
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      control.setErrors({ ...(control.errors ?? {}), invalidDate: true });
      control.markAsDirty();
      return;
    }
    parsed.setHours(0, 0, 0, 0);
    control.setValue(parsed);
    control.markAsDirty();
    this.pickedDate.set(parsed);
    this.typedDate.set(null);
  }

  private focusFirstField(): void {
    setTimeout(() => document.getElementById(this.nameEnId)?.focus());
  }
}

/**
 * A calendar day as 'YYYY-MM-DD', from the LOCAL date parts.
 *
 * Not `toISOString()`: that converts to UTC first, so a day picked in a tenant
 * ahead of UTC would be stored as the day before. A public holiday is a
 * calendar day, not an instant.
 */
function toApiDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
