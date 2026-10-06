import { Component, DestroyRef, computed, effect, inject, input, output, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  FormsModule,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputMaskModule } from 'primeng/inputmask';
import { TextareaModule } from 'primeng/textarea';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { InlineCalendarComponent } from '../../../../shared/components/inline-calendar/inline-calendar.component';
import { LayerStackService } from '../../../../shared/overlay/layer-stack.service';
import { FormatService } from '../../../../core/formatting';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { ITaskDto, TaskRequestType, TaskService } from '../../services/task.service';
import { DueDateService } from '../../services/due-date.service';

/** The longest hold anyone may ask for, in calendar days — the server's cap. */
export const MAX_HOLD_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

// Whitespace is not a reason — reported as `required`, as Reject does.
function notBlank(control: AbstractControl): ValidationErrors | null {
  return typeof control.value === 'string' && control.value.trim() ? null : { required: true };
}

/**
 * Ask the task's creator for more time, or to put the task on hold — ACC-173.
 * Modelled on Reject: one dialog, a reason that says who reads it.
 *
 * ## The date, and its convention
 *
 * New task's convention (ACC-96 Part A): a picked day and time are a wall-clock
 * time in the reader's BROWSER zone, sent as an instant. That is the tenant's
 * zone whenever the two agree; where they do not, New task's due block names
 * the difference, and tenant-zone dates are ACC-96 Part B, still open.
 *
 *   More time   the new due DATE and TIME; the time defaults to the task's
 *               current due time, else the end of the working day.
 *   On hold     a DATE only; the hold ends at the START of working hours on
 *               that day.
 *
 * ## The calendar substitutes for the fields
 *
 * As in New task and Set acting head, choosing a date swaps the body for the
 * calendar — same dialog, same footer, values still live — and the view is a
 * LAYER, so Escape closes it before it can reach "Discard changes?".
 *
 * ## Body height — measured in the browser pass, recorded on the PR.
 */
@Component({
  selector: 'app-task-request-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    TranslatePipe,
    ButtonModule,
    InputTextModule,
    InputMaskModule,
    TextareaModule,
    EditDialogComponent,
    FieldComponent,
    InlineCalendarComponent,
  ],
  template: `
    <ng-template #bodyTpl>
      @if (dateView()) {
        <div class="am-request-dateview">
          <button type="button" class="am-backlink" (click)="closeDateView()">
            <i class="pi pi-arrow-left am-backlink__icon" aria-hidden="true"></i>
            {{ 'task.request.backToDetails' | translate }}
          </button>
          <am-inline-calendar
            [value]="form.controls.date.value"
            (valueChange)="onDayPicked($event)"
            [minDate]="today()"
            [workingDays]="dueDates.workingDays()"
            [holidays]="dueDates.holidays()"
          />
        </div>
      } @else {
        <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col">
          @if (type() === 'EXTENSION' && currentDueLine()) {
            <p class="am-request-current">{{ currentDueLine() }}</p>
          }

          <am-field
            [label]="(type() === 'EXTENSION' ? 'task.request.newDueDate' : 'task.request.holdUntil') | translate"
            [control]="form.controls.date"
            [hint]="(type() === 'ON_HOLD' ? 'task.request.holdUntilHint' : '') | translate"
            [forceShowErrors]="showErrors()"
            [errorMessages]="dateErrors"
          >
            <div class="am-request-date">
              <input
                pInputText
                dir="ltr"
                id="taskRequestDate"
                readonly
                class="am-request-date__text"
                [value]="dateText()"
                [placeholder]="'task.request.chooseDate' | translate"
                (click)="openDateView()"
              />
              <button
                type="button"
                class="am-request-date__button"
                [attr.aria-label]="'task.request.chooseDate' | translate"
                (click)="openDateView()"
              >
                <i class="pi pi-calendar" aria-hidden="true"></i>
              </button>
              @if (type() === 'EXTENSION') {
                <p-inputmask
                  inputId="taskRequestTime"
                  dir="ltr"
                  mask="99:99"
                  [ariaLabel]="'task.request.time' | translate"
                  [placeholder]="'task.due.timePlaceholder' | translate"
                  formControlName="time"
                />
              }
            </div>
          </am-field>

          <am-field
            [label]="'task.request.reason' | translate"
            [control]="form.controls.reason"
            [hint]="'task.request.reasonHint' | translate"
            [forceShowErrors]="showErrors()"
            [errorMessages]="{ maxlength: 'task.rejectReasonTooLong' }"
          >
            <textarea pTextarea id="taskRequestReason" formControlName="reason" rows="3"></textarea>
          </am-field>

          @if (error()) {
            <p class="text-meta text-[var(--am-danger-ink)]" role="alert">{{ error()! | translate }}</p>
          }
        </form>
      }
    </ng-template>
    <ng-template #footerTpl>
      <div class="flex justify-end gap-3">
        <p-button
          [label]="'common.cancel' | translate"
          severity="secondary"
          [text]="true"
          type="button"
          [disabled]="saving()"
          (onClick)="dialog.requestClose()"
        />
        <p-button
          type="button"
          [label]="(type() === 'EXTENSION' ? 'task.request.sendExtension' : 'task.request.sendHold') | translate"
          [loading]="saving()"
          (onClick)="submit()"
        />
      </div>
    </ng-template>
    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="
        (type() === 'EXTENSION' ? 'task.request.extensionNamed' : 'task.request.holdNamed')
          | translate: { title: task()?.title ?? '' }
      "
      [content]="bodyTpl"
      [footer]="footerTpl"
      [dirty]="form.dirty"
      [saving]="saving()"
      size="form"
    />
  `,
  styles: [
    `
      .am-request-current {
        margin: 0 0 var(--am-space-12);
        font-size: var(--am-type-meta-size);
        line-height: var(--am-type-meta-line);
        color: var(--am-ink-500);
      }
      .am-request-date {
        display: flex;
        gap: var(--am-space-8);
        align-items: center;
      }
      .am-request-date__text {
        flex: 1 1 auto;
        min-width: 0;
        cursor: pointer;
      }
      .am-request-date__button {
        flex: none;
        inline-size: 36px;
        block-size: 36px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid var(--am-control-border);
        border-radius: var(--am-radius-control);
        background: var(--am-surface-raised);
        color: var(--am-ink-700);
        cursor: pointer;
      }
      .am-request-date__button:hover {
        border-color: var(--am-control-border-hover);
      }
      .am-request-date .p-inputmask {
        flex: none;
        inline-size: 112px;
      }
      .am-request-dateview {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-8);
      }
      .am-backlink {
        align-self: flex-start;
        display: inline-flex;
        gap: var(--am-space-8);
        align-items: center;
        border: 0;
        background: none;
        padding: 0;
        font: inherit;
        color: var(--am-primary-600);
        cursor: pointer;
      }
      :dir(rtl) .am-backlink__icon {
        transform: scaleX(-1);
      }
      .am-backlink:focus-visible,
      .am-request-date__button:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: var(--am-focus-ring-offset);
      }
    `,
  ],
})
export class TaskRequestDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly taskService = inject(TaskService);
  private readonly format = inject(FormatService);
  private readonly translate = inject(TranslateService);
  private readonly layers = inject(LayerStackService);
  private readonly destroyRef = inject(DestroyRef);
  readonly dueDates = inject(DueDateService);

  readonly visible = input.required<boolean>();
  readonly task = input<ITaskDto | null>(null);
  readonly type = input<TaskRequestType>('EXTENSION');
  readonly visibleChange = output<boolean>();
  /** Emitted once the request is sent; the host reloads its list. */
  readonly requested = output<void>();

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly showErrors = signal(false);
  readonly dateView = signal(false);
  private readonly picked = signal<Date | null>(null);
  private dateViewLayerId: number | null = null;

  readonly dateErrors = {
    past: 'task.request.errorPast',
    notAfterDue: 'task.request.errorNotAfterDue',
    tooLong: 'task.request.errorTooLong',
  };

  readonly form = this.fb.group({
    date: [null as Date | null, [Validators.required, (c: AbstractControl) => this.validateDate(c)]],
    time: ['', [(c: AbstractControl) => this.validateTime(c)]],
    reason: ['', [notBlank, Validators.maxLength(1000)]],
  });

  readonly today = computed(() => {
    const at = new Date();
    at.setHours(0, 0, 0, 0);
    return at;
  });

  readonly dateText = computed(() => {
    const day = this.picked();
    return day ? this.format.dateForInput(day) : '';
  });

  readonly currentDueLine = computed(() => {
    const due = this.task()?.dueAt;
    return due ? this.translate.instant('task.request.currentDue', { date: this.format.dateTime(due) }) : '';
  });

  constructor() {
    effect(() => {
      if (!this.visible()) return;
      this.dueDates.load();
      const due = this.task()?.dueAt ? new Date(this.task()!.dueAt!) : null;
      this.picked.set(null);
      this.form.reset({ date: null, time: this.defaultTime(due), reason: '' });
      this.error.set(null);
      this.showErrors.set(false);
      this.closeDateView();
    });

    // The date view is a layer: Escape closes it before EditDialogComponent's
    // own capture-phase handler can ask about discarding the form (ACC-111).
    effect(() => {
      const open = this.dateView();
      if (open && this.dateViewLayerId === null) {
        this.dateViewLayerId = this.layers.push();
      } else if (!open && this.dateViewLayerId !== null) {
        this.layers.remove(this.dateViewLayerId);
        this.dateViewLayerId = null;
      }
    });
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !this.dateView()) return;
      if (this.dateViewLayerId === null || !this.layers.isTop(this.dateViewLayerId)) return;
      event.preventDefault();
      event.stopPropagation();
      this.closeDateView();
    };
    document.addEventListener('keydown', onKeydown);
    this.destroyRef.onDestroy(() => {
      document.removeEventListener('keydown', onKeydown);
      if (this.dateViewLayerId !== null) this.layers.remove(this.dateViewLayerId);
    });
  }

  openDateView(): void {
    this.dateView.set(true);
  }

  closeDateView(): void {
    this.dateView.set(false);
  }

  onDayPicked(day: Date | null): void {
    this.picked.set(day);
    this.form.controls.date.setValue(day);
    this.form.controls.date.markAsDirty();
    this.closeDateView();
  }

  /**
   * The instant sent: for more time, the picked day at the picked time; for a
   * hold, the picked day at the start of working hours.
   */
  instant(): Date | null {
    const day = this.form.controls.date.value;
    if (!day) return null;
    if (this.type() === 'ON_HOLD') {
      return this.dueDates.startOfDayFor(day) ?? withTime(day, '08:00');
    }
    const time = this.form.controls.time.value;
    return /^\d{2}:\d{2}$/.test(time ?? '') ? withTime(day, time!) : null;
  }

  submit(): void {
    const task = this.task();
    if (!task || this.saving()) return;
    this.form.controls.date.updateValueAndValidity();
    if (this.form.invalid) {
      this.showErrors.set(true);
      return;
    }
    const at = this.instant();
    if (!at) {
      this.showErrors.set(true);
      return;
    }
    const reason = this.form.getRawValue().reason!.trim();
    this.saving.set(true);
    this.error.set(null);
    const dto =
      this.type() === 'EXTENSION'
        ? { type: 'EXTENSION' as const, requestedDueAt: at.toISOString(), reason }
        : { type: 'ON_HOLD' as const, holdUntil: at.toISOString(), reason };
    this.taskService.requestChange(task.id, dto).subscribe({
      next: () => {
        this.saving.set(false);
        this.form.markAsPristine();
        this.requested.emit();
        this.visibleChange.emit(false);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.error.set(extractErrorMessage(err, 'task.errorAction'));
      },
    });
  }

  // The same rules the server applies, so the reader sees them before Send.
  private validateDate(control: AbstractControl): ValidationErrors | null {
    if (!control.value || !this.form) return null;
    const at = this.instant();
    if (!at) return null;
    const now = Date.now();
    if (at.getTime() <= now) return { past: true };
    if (this.type() === 'EXTENSION') {
      const due = this.task()?.dueAt;
      if (due && at.getTime() <= new Date(due).getTime()) return { notAfterDue: true };
    } else if (at.getTime() > now + MAX_HOLD_DAYS * DAY_MS) {
      return { tooLong: true };
    }
    return null;
  }

  private validateTime(control: AbstractControl): ValidationErrors | null {
    if (this.type() !== 'EXTENSION') return null;
    const m = /^(\d{2}):(\d{2})$/.exec(control.value ?? '');
    return m && Number(m[1]) <= 23 && Number(m[2]) <= 59 ? null : { required: true };
  }

  private defaultTime(due: Date | null): string {
    if (due) return hhmm(due);
    const end = this.dueDates.endOfDayFor(new Date());
    return end ? hhmm(end) : '16:00';
  }
}

function hhmm(at: Date): string {
  return `${`${at.getHours()}`.padStart(2, '0')}:${`${at.getMinutes()}`.padStart(2, '0')}`;
}

function withTime(day: Date, time: string): Date {
  const [h, m] = time.split(':').map(Number);
  const at = new Date(day);
  at.setHours(h ?? 0, m ?? 0, 0, 0);
  return at;
}
