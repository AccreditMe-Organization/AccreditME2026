import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { FormatService } from '../../../../core/formatting';
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
  /** When it was rejected, for the label "Rejected by … · 5 Oct 2026". */
  at?: string | null;
}

/**
 * Reassign a task — extracted from Unassigned tasks for ACC-163, where the
 * committee record became its second host: a REJECTED task goes back to its
 * creator, who reassigns it (Q4).
 *
 * Who may use it is the server's decision — a Manage tasks holder or the
 * task's own creator — and each host gates the button on the same rule.
 *
 * ## Who it goes to — the assignment picker, not the user list (ACC-167)
 *
 * The task goes to a unit and position (or, on a committee's task, a member
 * role), optionally narrowed to one person — the same picker as New task. It
 * passes the task's id, so the picker answers to "may reassign THIS task"
 * rather than Create tasks, and nothing here reads the tenant's user list.
 * That closes ACC-166: before, the people list needed users:view, and a
 * creator whose role lacked it could not reassign their own rejected task.
 *
 * ## As drawn (Task Screens, Reassign — ACC-120 slice 4)
 *
 * "Reassign task", with the task and its record as the context line. A
 * rejected task opens with "Rejected by … · date" over the reason in a grey
 * box, two lines at most (the whole reason in its title). Then the picker's
 * `split` layout: the unit or committee across, then position | person
 * (member role | member) in one row, and the outcome beneath. The reason field
 * stays: the server records it.
 *
 * ## Body height — COMPACT density, because form density measured over
 *
 * MEASURED in `task-workload.layout.spec.ts` (real shell, theme, font and
 * translations). The tallest state is a rejected task with a two-line reason
 * box, a person chosen, the "✦ Suggest someone" answer, and the reason's
 * required error. At FORM density it was 416px English and 437px Arabic: over
 * the 420 cap in Arabic, and over the 400 the spec allows (a line of room) in
 * both. Compact density (artboard 13: the whole dialog, never mixed) with the
 * split picker at compact gaps brings it to **385px English, 399px Arabic**.
 * Every other state is lower (counts only 349 / 359, a refusal 367 / 379).
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
      <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col gap-2">
        @if (rejection(); as r) {
          <!-- What the creator is acting on. Read-only, and stated before the
               fields, because the reason decides who the task should go to. -->
          <div class="flex flex-col gap-1" data-testid="reassign-rejection">
            <span class="text-meta text-[var(--am-ink-700)]" data-testid="reassign-rejection-label">{{ rejectionLabel() }}</span>
            <!-- The clamp is on the inner line box: on the padded box itself, a
                 third line shows through the bottom padding. -->
            <p
              class="m-0 [overflow-wrap:anywhere] text-[13px] leading-[18px] text-[var(--am-ink-700)] bg-[var(--am-surface)] rounded-[var(--am-radius-control)] px-2.5 py-1.5"
              [attr.title]="r.reason"
              data-testid="reassign-rejection-reason"
            ><span class="line-clamp-2" data-testid="reassign-rejection-text">{{ 'tasks.sections.quoteOpen' | translate }}<bdi>{{ r.reason }}</bdi>{{ 'tasks.sections.quoteClose' | translate }}</span></p>
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
            layout="split"
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
      [header]="'task.reassignTitle' | translate"
      [context]="contextLine()"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [dirty]="form.dirty"
      [saving]="saving()"
      size="form"
      density="compact"
    />
  `,
})
export class TaskReassignDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly taskService = inject(TaskService);
  private readonly hintStore = inject(TaskWorkloadHintStore);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);

  readonly visible = input.required<boolean>();
  readonly task = input<ITaskDto | null>(null);
  /** Set by a host that knows the task was rejected, so the creator sees why. */
  readonly rejection = input<TaskRejection | null>(null);
  /** Names the committee option, when the host is a committee record. */
  readonly committeeName = input<string | null>(null);
  /** The task's record as the host names it, for the context line. */
  readonly recordName = input<string | null>(null);

  /** "Collect member CVs · ◇ Outbreak Response Task Force". */
  readonly contextLine = computed(() => {
    const title = this.task()?.title ?? '';
    const record = this.recordName();
    return record ? `${title} · ◇ ${record}` : title;
  });
  /** "Rejected by Tariq Suleiman · 5 Oct 2026" — the parts it has. */
  readonly rejectionLabel = computed(() => {
    const r = this.rejection();
    if (!r) return '';
    const by = r.byName ? this.translate.instant('task.reassignRejectedBy', { name: r.byName }) : this.translate.instant('task.status.rejected');
    return r.at ? `${by} · ${this.format.date(r.at)}` : by;
  });
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
