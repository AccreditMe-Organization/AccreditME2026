import { Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
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
import { ITaskDto, TaskPriority, TaskService } from '../../services/task.service';
import { DueDateService } from '../../services/due-date.service';

// Whitespace is not a reason — reported as `required`, as Reject does.
function notBlank(control: AbstractControl): ValidationErrors | null {
  return typeof control.value === 'string' && control.value.trim() ? null : { required: true };
}

/**
 * Reopen a completed task — ACC-174. Its creator (or whoever acts for them)
 * sends it back, typically because the evidence is wrong or not good enough.
 * Modelled on Reject: the reason is what the assignees read.
 *
 * ## The due date is optional, and only ever EARLIER
 *
 * A reopened task's SLA restarts from now under its priority, and its due date
 * defaults to the end of that window — the line under the field says when. A
 * person may set an earlier one; the calendar stops at the limit, which the
 * server computes (GET /tasks/:id/sla-preview?restart=true) — no screen does
 * working-hours arithmetic. The date follows New task's convention (ACC-96
 * Part A): a day and time read in the browser's zone, sent as an instant.
 *
 * The date view substitutes for the fields as a LAYER, as in the request
 * dialog (ACC-173), so Escape closes it before "Discard changes?".
 */
@Component({
  selector: 'app-task-reopen-dialog',
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
        <div class="am-reopen-dateview">
          <button type="button" class="am-backlink" (click)="closeDateView()">
            <i class="pi pi-arrow-left am-backlink__icon" aria-hidden="true"></i>
            {{ 'task.request.backToDetails' | translate }}
          </button>
          <am-inline-calendar
            [value]="form.controls.date.value"
            (valueChange)="onDayPicked($event)"
            [minDate]="today()"
            [maxDate]="limit()"
            [workingDays]="dueDates.workingDays()"
            [holidays]="dueDates.holidays()"
          />
        </div>
      } @else {
        <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col">
          <am-field
            [label]="'task.reopen.reason' | translate"
            [control]="form.controls.reason"
            [hint]="'task.reopen.reasonHint' | translate"
            [forceShowErrors]="showErrors()"
            [errorMessages]="{ maxlength: 'task.rejectReasonTooLong' }"
          >
            <textarea pTextarea id="taskReopenReason" formControlName="reason" rows="3"></textarea>
          </am-field>

          <am-field
            [label]="'task.reopen.dueDate' | translate"
            [control]="form.controls.date"
            [hint]="dueHint()"
            [forceShowErrors]="showErrors()"
            [errorMessages]="dateErrors"
          >
            <div class="am-reopen-date">
              <input
                pInputText
                dir="ltr"
                id="taskReopenDate"
                readonly
                class="am-reopen-date__text"
                [value]="dateText()"
                [placeholder]="'task.request.chooseDate' | translate"
                (click)="openDateView()"
              />
              <button
                type="button"
                class="am-reopen-date__button"
                [attr.aria-label]="'task.request.chooseDate' | translate"
                (click)="openDateView()"
              >
                <i class="pi pi-calendar" aria-hidden="true"></i>
              </button>
              <p-inputmask
                inputId="taskReopenTime"
                dir="ltr"
                mask="99:99"
                [ariaLabel]="'task.request.time' | translate"
                [placeholder]="'task.due.timePlaceholder' | translate"
                formControlName="time"
              />
            </div>
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
        <p-button type="button" [label]="'task.reopen.confirm' | translate" [loading]="saving()" (onClick)="submit()" />
      </div>
    </ng-template>
    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="'task.reopen.named' | translate: { title: task()?.title ?? '' }"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [dirty]="form.dirty"
      [saving]="saving()"
      size="form"
    />
  `,
  styles: [
    `
      .am-reopen-date {
        display: flex;
        gap: var(--am-space-8);
        align-items: center;
      }
      .am-reopen-date__text {
        flex: 1 1 auto;
        min-width: 0;
        cursor: pointer;
      }
      .am-reopen-date__button {
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
      .am-reopen-date__button:hover {
        border-color: var(--am-control-border-hover);
      }
      /* The inner input of p-inputmask, sized as in New task and the request
         dialog: at its default width it scrolls the body sideways. */
      .am-reopen-date .p-inputmask {
        flex: none;
        inline-size: 112px;
      }
      .am-reopen-date ::ng-deep .p-inputmask input {
        inline-size: 112px;
        min-inline-size: 0;
      }
      .am-reopen-dateview {
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
      .am-reopen-date__button:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: var(--am-focus-ring-offset);
      }
    `,
  ],
})
export class TaskReopenDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly taskService = inject(TaskService);
  private readonly format = inject(FormatService);
  private readonly layers = inject(LayerStackService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly translate = inject(TranslateService);
  readonly dueDates = inject(DueDateService);

  readonly visible = input.required<boolean>();
  readonly task = input<ITaskDto | null>(null);
  readonly visibleChange = output<boolean>();
  /** Emitted once the task has been reopened; the host reloads its list. */
  readonly reopened = output<void>();

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly showErrors = signal(false);
  readonly dateView = signal(false);
  private readonly picked = signal<Date | null>(null);
  /** The restarted window's limit for the task's priority — the latest date. */
  readonly limit = signal<Date | null>(null);
  private dateViewLayerId: number | null = null;

  readonly dateErrors = {
    past: 'task.request.errorPast',
    afterLimit: 'task.reopen.errorAfterLimit',
    timeRequired: 'task.reopen.errorTime',
  };

  readonly form = this.fb.group({
    reason: ['', [notBlank, Validators.maxLength(1000)]],
    date: [null as Date | null, [(c: AbstractControl) => this.validateDate(c)]],
    time: [''],
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

  /** "Leave it empty and it is due {limit}" — so the default is not a surprise. */
  readonly dueHint = computed(() => {
    const limit = this.limit();
    return limit
      ? this.translate.instant('task.reopen.defaultDue', { date: this.format.dateTime(limit) })
      : '';
  });

  constructor() {
    // Each OPENING starts clean and fetches the limit — keyed on the opening and
    // the task only. The rest runs untracked: dueDates.load() reads a signal
    // that changes when the calendar arrives, and re-running on that would
    // reset a half-written reason and fetch the preview twice.
    effect(() => {
      if (!this.visible()) return;
      const task = this.task();
      untracked(() => this.open(task));
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

  private open(task: ITaskDto | null): void {
    this.dueDates.load();
    this.picked.set(null);
    this.limit.set(null);
    this.form.reset({ reason: '', date: null, time: '' });
    this.error.set(null);
    this.showErrors.set(false);
    this.closeDateView();
    if (!task) return;
    this.taskService.getTaskSlaPreview(task.id, true).subscribe({
      next: (preview) => {
        const window = preview[task.priority as TaskPriority];
        this.limit.set(window ? new Date(window.limitAt) : null);
      },
      // No preview, no limit drawn: the server still refuses a later date.
      error: () => this.limit.set(null),
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
    // A chosen day takes the end of its working hours unless a time is set.
    if (day && !this.form.controls.time.value) {
      const end = this.dueDates.endOfDayFor(day);
      this.form.controls.time.setValue(end ? hhmm(end) : '16:00');
    }
    this.form.controls.date.setValue(day);
    this.form.controls.date.markAsDirty();
    this.closeDateView();
  }

  /** The earlier due date, as an instant — or null to keep the SLA's. */
  instant(): Date | null {
    const day = this.form.controls.date.value;
    const time = this.form.controls.time.value ?? '';
    if (!day || !/^\d{2}:\d{2}$/.test(time)) return null;
    const [h, m] = time.split(':').map(Number);
    const at = new Date(day);
    at.setHours(h ?? 0, m ?? 0, 0, 0);
    return at;
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
    const reason = this.form.getRawValue().reason!.trim();
    this.saving.set(true);
    this.error.set(null);
    this.taskService.reopen(task.id, { reason, ...(at ? { dueDate: at.toISOString() } : {}) }).subscribe({
      next: () => {
        this.saving.set(false);
        this.form.markAsPristine();
        this.reopened.emit();
        this.visibleChange.emit(false);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.error.set(extractErrorMessage(err, 'task.errorAction'));
      },
    });
  }

  // The rules the server applies, so the reader sees them before Reopen.
  private validateDate(control: AbstractControl): ValidationErrors | null {
    if (!control.value || !this.form) return null;
    const at = this.instant();
    if (!at) return { timeRequired: true };
    if (at.getTime() <= Date.now()) return { past: true };
    const limit = this.limit();
    if (limit && at.getTime() > limit.getTime()) return { afterLimit: true };
    return null;
  }
}

function hhmm(at: Date): string {
  return `${`${at.getHours()}`.padStart(2, '0')}:${`${at.getMinutes()}`.padStart(2, '0')}`;
}
