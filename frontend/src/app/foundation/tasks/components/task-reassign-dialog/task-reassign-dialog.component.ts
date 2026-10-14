import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { ITaskDto, TaskPriority, TaskService } from '../../services/task.service';
import {
  TaskAssigneePickerComponent,
  createAssignGroup,
  toAssignTarget,
} from '../task-assignee-picker/task-assignee-picker.component';
import { TaskWorkloadHintStore } from '../task-assignee-picker/task-workload-hint.store';
import { followedHint } from '../task-assignee-picker/followed-hint';

/** What the dialog needs to say about a rejected task, when it is one. */
export interface TaskRejection {
  byName: string | null;
  reason: string;
}

/**
 * Reassign a task — extracted from Unassigned tasks for ACC-163, where the
 * committee record became its second host: a REJECTED task goes back to its
 * creator, who reassigns it (Q4).
 *
 * Who may use it is the server's decision — a tasks:reassign holder or the
 * task's own creator — and each host gates the button on the same rule.
 *
 * ## Who it goes to — the assignment picker, not the user list (ACC-167)
 *
 * The task goes to a unit and position (or, on a committee's task, a member
 * role), optionally narrowed to one person — the same picker as New task. It
 * passes the task's id, so the picker answers to "may reassign THIS task"
 * rather than tasks:create, and nothing here reads the tenant's user list.
 * That closes ACC-166: before, the people list needed users:view, and a
 * creator whose role lacked it could not reassign their own rejected task.
 *
 * ## Body height — FORM density
 *
 * Re-measured for ACC-167 in the browser (6 Oct 2026, 1440x900), in its
 * tallest state — a rejected task, the strip with a two-line reason, a unit
 * and position chosen, the outcome line, and the reason's required error:
 * 358px English, 371px Arabic. The picker stays stacked here: there is room.
 */
@Component({
  selector: 'app-task-reassign-dialog',
  standalone: true,
  // ACC-199 — "✦ Suggest someone"'s answers, kept while the dialog is open.
  providers: [TaskWorkloadHintStore],
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    ButtonModule,
    InputTextModule,
    EditDialogComponent,
    FieldComponent,
    TaskAssigneePickerComponent,
  ],
  template: `
    <ng-template #bodyTpl>
      <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col gap-3">
        @if (rejection(); as r) {
          <!-- What the creator is acting on. Read-only, and stated before the
               fields, because the reason decides who the task should go to. -->
          <div class="am-reassign-strip">
            <span class="am-reassign-strip__label">{{ 'task.status.rejected' | translate }}</span>
            <span class="am-reassign-strip__body">
              {{ (r.byName ? 'task.rejectedByNamed' : 'task.rejectedReasonOnly') | translate: { name: r.byName, reason: r.reason } }}
            </span>
          </div>
        }

        @if (task(); as t) {
          <app-task-assignee-picker
            [group]="form.controls.assignTo"
            [sourceType]="t.sourceType"
            [sourceId]="t.sourceId"
            [committeeName]="committeeName()"
            [taskId]="t.id"
            [priority]="taskPriority()"
            (hintFollowed)="workloadFollowed.set($event)"
            [required]="true"
            [forceShowErrors]="showErrors()"
          />
        }

        <am-field
          [label]="'task.reassignReason' | translate"
          [control]="form.controls.reason"
          [forceShowErrors]="showErrors()"
          [errorMessages]="{ maxlength: 'task.rejectReasonTooLong' }"
        >
          <input pInputText id="taskReassignReason" formControlName="reason" autocomplete="off" />
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
        <p-button type="button" [label]="'task.reassign' | translate" [loading]="saving()" (onClick)="submit()" />
      </div>
    </ng-template>
    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="'task.reassignNamed' | translate: { title: task()?.title ?? '' }"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [dirty]="form.dirty"
      [saving]="saving()"
      size="form"
    />
  `,
  styles: [
    `
      .am-reassign-strip {
        display: flex;
        gap: var(--am-space-8);
        align-items: flex-start;
        padding: 8px 0;
        border-block: 1px solid var(--am-border);
      }
      .am-reassign-strip__label {
        flex: none;
        font-size: 11px;
        line-height: 18px;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--am-warning-ink);
      }
      .am-reassign-strip__body {
        flex: 1 1 auto;
        min-width: 0;
        font-size: 13px;
        line-height: 18px;
        color: var(--am-ink-900);
        overflow-wrap: anywhere;
      }
    `,
  ],
})
export class TaskReassignDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly taskService = inject(TaskService);
  private readonly hintStore = inject(TaskWorkloadHintStore);

  readonly visible = input.required<boolean>();
  readonly task = input<ITaskDto | null>(null);
  /** Set by a host that knows the task was rejected, so the creator sees why. */
  readonly rejection = input<TaskRejection | null>(null);
  /** Names the committee option, when the host is a committee record. */
  readonly committeeName = input<string | null>(null);
  readonly visibleChange = output<boolean>();
  /** Emitted once the task is reassigned; the host reloads its list. */
  readonly reassigned = output<void>();

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly showErrors = signal(false);
  /** ACC-199 — the priority "✦ Suggest someone" tells the model. */
  readonly taskPriority = computed(() => (this.task()?.priority ?? null) as TaskPriority | null);
  /** ACC-199 — "Assign … instead" was pressed: sent on Reassign while that person is still chosen. */
  readonly workloadFollowed = signal<{ id: string; userId: string } | null>(null);

  readonly form = this.fb.group({
    assignTo: createAssignGroup(true),
    reason: ['', [Validators.required, Validators.maxLength(1000)]],
  });

  constructor() {
    effect(() => {
      if (!this.visible()) return;
      this.form.reset({ assignTo: { scope: null, target: null, userId: null }, reason: '' });
      this.workloadFollowed.set(null);
      // ACC-199 — this dialog outlives an opening; its answers were for another task.
      this.hintStore.answers.set(new Map());
      this.error.set(null);
      this.showErrors.set(false);
    });
  }

  submit(): void {
    const task = this.task();
    if (!task || this.saving()) return;
    const assignTo = toAssignTarget(this.form.controls.assignTo, task.sourceId);
    if (this.form.invalid || !assignTo) {
      this.showErrors.set(true);
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    // ACC-199 — the person chosen came from "✦ Suggest someone", and still is.
    const aiWorkloadHint = followedHint(this.workloadFollowed(), assignTo);
    const dto = { assignTo, reason: this.form.getRawValue().reason!.trim(), ...(aiWorkloadHint ? { aiWorkloadHint } : {}) };
    this.taskService.reassign(task.id, dto).subscribe({
      next: () => {
        this.saving.set(false);
        this.form.markAsPristine();
        this.reassigned.emit();
        this.visibleChange.emit(false);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.error.set(extractErrorMessage(err, 'task.errorReassign'));
      },
    });
  }
}
