import {
  Component,
  ElementRef,
  Input,
  TemplateRef,
  ViewChild,
  Output,
  EventEmitter,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ReactiveFormsModule, FormsModule, FormBuilder, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { DatePickerModule } from 'primeng/datepicker';
import { CheckboxModule } from 'primeng/checkbox';
import {
  WorkingCalendarService,
  PublicHolidayDto,
  CreatePublicHolidayDto,
} from '../../services/working-calendar.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { IconButtonComponent } from '../../../../shared/components/icon-button/icon-button.component';
import { FormatService } from '../../../../core/formatting';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';

/**
 * Add / edit a public holiday — ACC-111's proof screen for the dialog shell,
 * the field wrapper and the overlay rule.
 *
 * ## The date field is the point of this screen
 *
 * It used to be a `p-datepicker` with a floating panel inside a dialog body:
 * PrimeNG's overlay closes on ANY ancestor scroll, so the panel could vanish
 * mid-interaction.
 *
 * The calendar is now ITS OWN DIALOG at the root, stacked above this form —
 * artboard 7's rule 4 (a picker becomes its own layer) rather than its rule 1
 * (a panel expands in flow). In flow it needed 632px against the dialog
 * body's 420px cap, and the cap is sized for a 768px laptop, so it does not
 * move; a root layer satisfies the same invariant for the stronger reason
 * that it has no scrollable ancestor at all.
 *
 * AN EARLIER VERSION OF THIS COMMENT DESCRIBED THE IN-FLOW PANEL, and was
 * left behind when a613fcb changed the mechanism. The check that goes with
 * this screen is therefore NOT "scroll the dialog body with the panel open" —
 * this dialog has three fields and never scrolls, and the calendar is not in
 * its body. The real proof is: two stacked dialogs, Escape closing exactly
 * ONE layer per press, focus returning to the date field, and the typed path
 * setting a date with the calendar never opened.
 *
 * Typing is a COMPLETE path: the text input alone can set the date, with the
 * calendar never opened. It is an assist, not the only route — which is also
 * what makes the field usable from the keyboard.
 *
 * The buttons are NOT here any more: the dialog owns a fixed footer, outside
 * the scrolling body (see PublicHolidayListComponent). This component exposes
 * `submit()`, `canSave()`, `saving()` and `dirty()` for it to drive.
 */
@Component({
  selector: 'app-public-holiday-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    TranslatePipe,
    InputTextModule,
    DatePickerModule,
    CheckboxModule,
    FieldComponent,
    IconButtonComponent,
    EditDialogComponent,
  ],
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col gap-3">
      <am-field
        [label]="'workingCalendar.holidayNameEn' | translate"
        [control]="form.controls.nameEn"
        [forceShowErrors]="showErrors()"
        [hint]="'workingCalendar.holidayNameHint' | translate"
      >
        <input pInputText formControlName="nameEn" class="w-full" />
      </am-field>

      <am-field
        [label]="'workingCalendar.holidayNameAr' | translate"
        [control]="form.controls.nameAr"
        [forceShowErrors]="showErrors()"
      >
        <input pInputText formControlName="nameAr" dir="rtl" lang="ar" class="w-full" />
      </am-field>

      <am-field
        [label]="'workingCalendar.holidayDate' | translate"
        [control]="form.controls.date"
        [forceShowErrors]="showErrors()"
        [hint]="'workingCalendar.holidayDateHint' | translate"
        [errorMessages]="{ invalidDate: 'workingCalendar.holidayDateInvalid' }"
      >
        <input
          pInputText
          class="w-full"
          [value]="dateText()"
          (input)="onDateTyped($any($event.target).value)"
          (blur)="commitTypedDate()"
          inputmode="numeric"
          autocomplete="off"
        />
        <am-icon-button
          [label]="'workingCalendar.toggleDatePanel' | translate"
          icon="pi pi-calendar"
          (activated)="toggleDatePanel()"
        />
      </am-field>


      <div class="flex items-center gap-3">
        <p-checkbox formControlName="isRecurring" [binary]="true" inputId="isRecurring" />
        <label for="isRecurring" class="text-value cursor-pointer">
          {{ 'workingCalendar.isRecurring' | translate }}
        </label>
      </div>

      @if (saveError()) {
        <p class="text-meta text-[var(--am-danger-ink)]">{{ saveError() | translate }}</p>
      }
    </form>

    <!-- THE CALENDAR IS ITS OWN LAYER, at the root (ACC-111, dialog rule 4
         applied to a panel rather than a list). In flow it needed 632px inside
         a 420px body cap; the cap is sized for a 768px laptop and does not
         move, and three fields have no editorial seam to split into steps. A
         layer at the root has no scrollable ancestor either, so the invariant
         this rule protects holds by the same argument, not a weaker one.

         appendTo="body" is what makes that true: nested in this form's DOM it
         would sit inside the parent dialog's scrolling body again. -->
    <ng-template #calendarTpl>
      <p-datepicker
        [inline]="true"
        [ngModel]="controlDate()"
        [ngModelOptions]="{ standalone: true }"
        (ngModelChange)="onDatePicked($event)"
        styleClass="w-full"
      />
    </ng-template>
    <app-edit-dialog
      [visible]="panelOpen()"
      (visibleChange)="onCalendarVisibleChange($event)"
      [header]="'workingCalendar.chooseDate' | translate"
      [content]="calendarTpl"
      size="picker"
    />
  `,
})
export class PublicHolidayFormComponent implements OnInit {
  @Input() holiday: PublicHolidayDto | null = null;
  @Output() saved = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();

  private readonly svc = inject(WorkingCalendarService);
  private readonly fb = inject(FormBuilder);
  private readonly format = inject(FormatService);
  private readonly translate = inject(TranslateService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly panelOpen = signal(false);

  /**
   * Set when a submit is attempted, so every field speaks at once. Before a
   * submit, a field nobody has typed into is not an error — it is a field
   * nobody has reached yet (ACC-111).
   */
  readonly showErrors = signal(false);

  /** What the text input shows. Kept in step with the control both ways. */
  private readonly typed = signal<string | null>(null);
  /** Read by the calendar layer's template, so not private. */
  readonly controlDate = signal<Date | null>(null);

  readonly dateText = computed(() => this.typed() ?? this.format.dateForInput(this.controlDate()));

  readonly form = this.fb.group({
    nameEn: ['', [Validators.required, Validators.maxLength(255)]],
    nameAr: ['', Validators.maxLength(255)],
    date: [null as Date | null, Validators.required],
    isRecurring: [false],
  });

  /** For the dialog: unsaved work means Escape has to ask first. */
  readonly dirty = (): boolean => this.form.dirty;

  canSave(): boolean {
    return this.form.valid && !this.saving();
  }

  ngOnInit(): void {
    if (this.holiday) {
      this.form.patchValue({
        nameEn: this.holiday.nameEn,
        nameAr: this.holiday.nameAr ?? '',
        date: new Date(this.holiday.date),
        isRecurring: this.holiday.isRecurring,
      });
    }
    this.controlDate.set(this.form.controls.date.value);
    this.form.controls.date.valueChanges.subscribe((value) => {
      this.controlDate.set(value);
      // A pick replaces whatever was half-typed.
      this.typed.set(null);
    });
  }

  @ViewChild('calendarTpl', { read: TemplateRef, static: true })
  calendarTpl!: TemplateRef<unknown>;

  /**
   * A pick closes the layer and writes the value. Focus goes back to the date
   * FIELD rather than the calendar button: the field is what the user was
   * filling in, and it now holds the value they chose.
   */
  onDatePicked(value: Date | null): void {
    this.form.controls.date.setValue(value);
    this.form.controls.date.markAsDirty();
    this.panelOpen.set(false);
    this.focusDateInput();
  }

  onCalendarVisibleChange(visible: boolean): void {
    this.panelOpen.set(visible);
    if (!visible) this.focusDateInput();
  }

  /** Submit moves focus to the first field that needs an answer. */
  private focusFirstInvalid(): void {
    const order: Array<keyof typeof this.form.controls> = ['nameEn', 'nameAr', 'date'];
    const index = order.findIndex((key) => this.form.controls[key].invalid);
    if (index < 0) return;
    this.host.nativeElement
      .querySelectorAll<HTMLInputElement>('am-field input')
      [index]?.focus();
  }

  private focusDateInput(): void {
    setTimeout(() => {
      this.host.nativeElement
        .querySelector<HTMLInputElement>('am-field:nth-of-type(3) input')
        ?.focus();
    });
  }

  onDateTyped(value: string): void {
    this.typed.set(value);
  }

  toggleDatePanel(): void {
    this.panelOpen.set(!this.panelOpen());
  }

  /**
   * Typing is a complete path to a date, so the text has to become a real
   * value — on blur, not per keystroke, or "18 S" is an error before anyone
   * has finished the month.
   */
  commitTypedDate(): void {
    const text = this.typed();
    if (text === null) return;

    const control = this.form.controls.date;
    const trimmed = text.trim();

    if (trimmed === '') {
      control.setValue(null);
      control.markAsDirty();
      this.typed.set(null);
      return;
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      control.setErrors({ ...(control.errors ?? {}), invalidDate: true });
      control.markAsDirty();
      return;
    }

    control.setValue(parsed);
    control.markAsDirty();
    this.typed.set(null);
  }

  submit(): void {
    this.commitTypedDate();
    if (this.form.invalid) {
      this.showErrors.set(true);
      this.focusFirstInvalid();
      return;
    }
    this.saving.set(true);
    this.saveError.set(null);

    const value = this.form.getRawValue();
    const dto: CreatePublicHolidayDto = {
      nameEn: value.nameEn!,
      nameAr: value.nameAr || undefined,
      date: this.dateToIso(value.date!),
      isRecurring: value.isRecurring ?? false,
    };

    const request$ = this.holiday
      ? this.svc.updateHoliday(this.holiday.id, dto)
      : this.svc.addHoliday(dto);

    request$.subscribe({
      next: () => {
        this.saving.set(false);
        this.form.markAsPristine();
        this.saved.emit();
      },
      error: (err: unknown) => {
        this.saveError.set(extractErrorMessage(err, this.translate.instant('common.saveFailed')));
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
