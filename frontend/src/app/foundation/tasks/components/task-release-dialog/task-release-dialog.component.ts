import { Component, effect, inject, input, output, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { ITaskDto, TaskService } from '../../services/task.service';

// Whitespace is not a reason — reported as `required`, as the reject dialog
// does, because the server trims and refuses the same input.
function notBlank(control: AbstractControl): ValidationErrors | null {
  return typeof control.value === 'string' && control.value.trim() ? null : { required: true };
}

/**
 * Release a task back to its pool — ACC-167 (decision 5).
 *
 * Only someone who PICKED the task up can release it; a person the assigner
 * chose directly rejects instead, which sends it back to the creator. The two
 * are different acts with different readers, so this is its own dialog, not
 * the reject dialog with another label:
 *
 *   Release  → the task returns to the pool; the pool's members read the reason
 *   Reject   → the task returns to its creator, who reassigns it
 *
 * ## Body height — one field, FORM density
 *
 * The same single textarea block as Reject (145px measured there with the
 * error showing), well under the 420 cap.
 */
@Component({
  selector: 'app-task-release-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, ButtonModule, TextareaModule, EditDialogComponent, FieldComponent],
  template: `
    <ng-template #bodyTpl>
      <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col">
        <am-field
          [label]="'task.releaseReason' | translate"
          [control]="form.controls.reason"
          [hint]="'task.releaseReasonHint' | translate"
          [forceShowErrors]="showErrors()"
          [errorMessages]="{ maxlength: 'task.rejectReasonTooLong' }"
        >
          <textarea pTextarea id="taskReleaseReason" formControlName="reason" rows="4"></textarea>
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
        <p-button type="button" [label]="'task.release' | translate" [loading]="saving()" (onClick)="submit()" />
      </div>
    </ng-template>
    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="'task.releaseNamed' | translate: { title: task()?.title ?? '' }"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [dirty]="form.dirty"
      [saving]="saving()"
      size="form"
    />
  `,
})
export class TaskReleaseDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly taskService = inject(TaskService);

  readonly visible = input.required<boolean>();
  readonly task = input<ITaskDto | null>(null);
  readonly visibleChange = output<boolean>();
  /** Emitted once the task is back in its pool; the host reloads its lists. */
  readonly released = output<void>();

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
    this.taskService.release(task.id, { reason: this.form.getRawValue().reason!.trim() }).subscribe({
      next: () => {
        this.saving.set(false);
        this.form.markAsPristine();
        this.released.emit();
        this.visibleChange.emit(false);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.error.set(extractErrorMessage(err, 'task.errorAction'));
      },
    });
  }
}
