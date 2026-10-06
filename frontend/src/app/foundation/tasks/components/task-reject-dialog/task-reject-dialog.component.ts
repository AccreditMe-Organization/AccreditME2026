import { Component, effect, inject, input, output, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { ITaskDto, TaskService } from '../../services/task.service';

// Whitespace is not a reason. Reported as `required`, so the field shows the
// ordinary "This field is required." and marks itself required — the server
// trims and refuses the same input, and the two should say the same thing.
function notBlank(control: AbstractControl): ValidationErrors | null {
  return typeof control.value === 'string' && control.value.trim() ? null : { required: true };
}

/**
 * Reject a task — ACC-163 (Q4).
 *
 * The assignee hands the task back with a reason. The reason is the whole
 * point: it is what the task's creator reads when they reassign it, so it is
 * required and its hint says who will read it.
 *
 * ## Body height — one field, well under the 420 cap, so FORM density
 *
 * Measured in the browser (5 Oct 2026, 1440x900): 145px in English WITH the
 * required-field error showing, which is its tallest state. One block, and
 * nowhere near five, so not compact.
 *
 * The 1000-character limit is a validator, not a `maxlength` attribute: an
 * attribute silently stops typing at the limit, where a validator says so.
 */
@Component({
  selector: 'app-task-reject-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, ButtonModule, TextareaModule, EditDialogComponent, FieldComponent],
  template: `
    <ng-template #bodyTpl>
      <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col">
        <am-field
          [label]="'task.rejectReason' | translate"
          [control]="form.controls.reason"
          [hint]="'task.rejectReasonHint' | translate"
          [forceShowErrors]="showErrors()"
          [errorMessages]="{ maxlength: 'task.rejectReasonTooLong' }"
        >
          <textarea pTextarea id="taskRejectReason" formControlName="reason" rows="4"></textarea>
        </am-field>
        @if (error()) {
          <p class="text-meta text-[var(--am-danger-ink)]" role="alert">{{ error()! | translate }}</p>
        }
      </form>
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
          severity="danger"
          [label]="'task.reject' | translate"
          [loading]="saving()"
          (onClick)="submit()"
        />
      </div>
    </ng-template>
    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="'task.rejectNamed' | translate: { title: task()?.title ?? '' }"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [dirty]="form.dirty"
      [saving]="saving()"
      size="form"
    />
  `,
})
export class TaskRejectDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly taskService = inject(TaskService);

  readonly visible = input.required<boolean>();
  readonly task = input<ITaskDto | null>(null);
  readonly visibleChange = output<boolean>();
  /** Emitted once the task has been rejected; the host reloads its list. */
  readonly rejected = output<void>();

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly showErrors = signal(false);

  readonly form = this.fb.group({
    reason: ['', [notBlank, Validators.maxLength(1000)]],
  });

  constructor() {
    // Every opening starts clean: a reason typed for one task must never be
    // sent for the next.
    effect(() => {
      if (this.visible()) {
        this.form.reset({ reason: '' });
        this.error.set(null);
        this.showErrors.set(false);
      }
    });
  }

  submit(): void {
    const task = this.task();
    if (!task || this.saving()) return;
    if (this.form.invalid) {
      this.showErrors.set(true);
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.taskService.reject(task.id, { reason: this.form.getRawValue().reason!.trim() }).subscribe({
      next: () => {
        this.saving.set(false);
        this.form.markAsPristine();
        this.rejected.emit();
        this.visibleChange.emit(false);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.error.set(extractErrorMessage(err, 'task.errorAction'));
      },
    });
  }
}
