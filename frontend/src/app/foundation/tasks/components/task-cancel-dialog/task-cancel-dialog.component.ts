import { Component, effect, inject, input, output, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { ITaskDto, TaskService } from '../../services/task.service';

// Whitespace is not a reason — reported as `required`, as Reject does.
function notBlank(control: AbstractControl): ValidationErrors | null {
  return typeof control.value === 'string' && control.value.trim() ? null : { required: true };
}

/**
 * Cancel a task — ACC-174. Its creator (or whoever acts for them) ends the
 * work, with a reason the assignees read. Modelled on Reject: one field, its
 * hint saying who reads it.
 *
 * The assignee rows stay, so the task stays in their lists as Cancelled — with
 * this reason beside it on the record.
 */
@Component({
  selector: 'app-task-cancel-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, ButtonModule, TextareaModule, EditDialogComponent, FieldComponent],
  template: `
    <ng-template #bodyTpl>
      <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col">
        <am-field
          [label]="'task.cancelTask.reason' | translate"
          [control]="form.controls.reason"
          [hint]="'task.cancelTask.reasonHint' | translate"
          [forceShowErrors]="showErrors()"
          [errorMessages]="{ maxlength: 'task.rejectReasonTooLong' }"
        >
          <textarea pTextarea id="taskCancelReason" formControlName="reason" rows="4"></textarea>
        </am-field>
        @if (error()) {
          <p class="text-meta text-[var(--am-danger-ink)]" role="alert">{{ error()! | translate }}</p>
        }
      </form>
    </ng-template>
    <ng-template #footerTpl>
      <div class="flex justify-end gap-3">
        <p-button
          [label]="'task.cancelTask.keep' | translate"
          severity="secondary"
          [text]="true"
          type="button"
          [disabled]="saving()"
          (onClick)="dialog.requestClose()"
        />
        <p-button
          type="button"
          severity="danger"
          [label]="'task.cancelTask.confirm' | translate"
          [loading]="saving()"
          (onClick)="submit()"
        />
      </div>
    </ng-template>
    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="'task.cancelTask.named' | translate: { title: task()?.title ?? '' }"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [dirty]="form.dirty"
      [saving]="saving()"
      size="form"
    />
  `,
})
export class TaskCancelDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly taskService = inject(TaskService);

  readonly visible = input.required<boolean>();
  readonly task = input<ITaskDto | null>(null);
  readonly visibleChange = output<boolean>();
  /** Emitted once the task has been cancelled; the host reloads its list. */
  readonly cancelledTask = output<void>();

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
    this.taskService.cancel(task.id, { reason: this.form.getRawValue().reason!.trim() }).subscribe({
      next: () => {
        this.saving.set(false);
        this.form.markAsPristine();
        this.cancelledTask.emit();
        this.visibleChange.emit(false);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.error.set(extractErrorMessage(err, 'task.errorAction'));
      },
    });
  }
}
