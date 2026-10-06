import { Component, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { IUserDto, UserService } from '../../../user/services/user.service';
import { ITaskDto, TaskService } from '../../services/task.service';

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
 * ## The people list needs users:view, and that is a known limitation
 *
 * The picker reads the tenant's user list, which requires users:view. Every
 * seeded role that can create a task also holds it, but a custom role, or a
 * workflow creator whose role lacks it, gets the "assignees unavailable"
 * message and cannot reassign here (SYSTEM-REFERENCE §3.6). Same degradation
 * New Task already has, for the same reason.
 *
 * ## Body height — FORM density
 *
 * Measured in the browser (5 Oct 2026, 1440x900): 243px in English for a
 * rejected task, with the rejection strip and a two-line reason; 186px in
 * Arabic without the strip. Both against the 420 cap, neither scrolling.
 *
 * The people picker is a trigger (OverlaySelectComponent), not the ~200px
 * inline listbox the Unassigned tasks screen used to render, so the dialog
 * stays a three-block form.
 */
@Component({
  selector: 'app-task-reassign-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    ButtonModule,
    InputTextModule,
    MessageModule,
    EditDialogComponent,
    FieldComponent,
    OverlaySelectComponent,
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

        @if (usersRefused()) {
          <p-message severity="info" [text]="'task.assigneesUnavailable' | translate" />
        } @else {
          <am-field
            [label]="'task.newAssignees' | translate"
            [control]="form.controls.newAssigneeUserIds"
            [forceShowErrors]="showErrors()"
          >
            <app-overlay-select
              formControlName="newAssigneeUserIds"
              [options]="users()"
              optionLabel="name"
              optionValue="id"
              [multiple]="true"
              [removeLabel]="'task.removeAssignee' | translate"
              [placeholder]="'task.selectAssignees' | translate"
            />
          </am-field>
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
        <p-button
          type="button"
          [label]="'task.reassign' | translate"
          [loading]="saving()"
          [disabled]="usersRefused()"
          (onClick)="submit()"
        />
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
  private readonly userService = inject(UserService);

  readonly visible = input.required<boolean>();
  readonly task = input<ITaskDto | null>(null);
  /** Set by a host that knows the task was rejected, so the creator sees why. */
  readonly rejection = input<TaskRejection | null>(null);
  readonly visibleChange = output<boolean>();
  /** Emitted once the task is reassigned; the host reloads its list. */
  readonly reassigned = output<void>();

  readonly users = signal<IUserDto[]>([]);
  readonly usersRefused = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly showErrors = signal(false);
  private usersRequested = false;

  readonly form = this.fb.group({
    newAssigneeUserIds: [[] as string[], [Validators.required, Validators.minLength(1)]],
    reason: ['', [Validators.required, Validators.maxLength(1000)]],
  });

  constructor() {
    effect(() => {
      if (!this.visible()) return;
      this.form.reset({ newAssigneeUserIds: [], reason: '' });
      this.error.set(null);
      this.showErrors.set(false);
      this.loadUsersOnce();
    });
  }

  // Loaded on first open, not on construction: a host renders this dialog for
  // a page most of whose viewers never reassign anything.
  private loadUsersOnce(): void {
    if (this.usersRequested) return;
    this.usersRequested = true;
    this.userService.listAllUsers({ status: 'ACTIVE' }).subscribe({
      next: (users) => this.users.set(users),
      error: () => this.usersRefused.set(true),
    });
  }

  submit(): void {
    const task = this.task();
    if (!task || this.saving() || this.usersRefused()) return;
    if (this.form.invalid) {
      this.showErrors.set(true);
      return;
    }
    const value = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    this.taskService
      .reassign(task.id, { newAssigneeUserIds: value.newAssigneeUserIds!, reason: value.reason!.trim() })
      .subscribe({
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
