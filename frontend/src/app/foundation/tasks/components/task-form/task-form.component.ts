import { Component, OnInit, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ListboxModule } from 'primeng/listbox';
import { TaskService } from '../../services/task.service';
import { UserService, IUserDto } from '../../../user/services/user.service';
// ACC-41 — OverlaySelectComponent replaces p-select here: this field sits in
// a raw p-dialog (not EditDialogComponent), the second confirmed DOM context
// where PrimeNG's own scroll-chaining bug is reachable, and the option list
// here is a plain string[] (exercises the primitive-array fallback in
// getOptionLabel()/getOptionValue()). See CLAUDE.md's PrimeNG-components-only
// exception note and overlay-select.component.ts for the full mechanism.
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';

const SOURCE_TYPES = [
  'MEETING',
  'DOCUMENT',
  'AUDIT',
  'CAPA',
  'INCIDENT',
  'CORRECTIVE_ACTION',
  'STANDARD',
  'KPI',
  'GAP',
  'QUALITY_IMPROVEMENT_PLAN',
  // ACC-76 — was missing, though TaskSourceType has carried it since ACC-22
  // and TaskController's own query union lists it. Manual creation of a
  // committee task was therefore impossible from this form.
  'COMMITTEE',
];

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

@Component({
  selector: 'app-task-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    InputTextModule,
    TextareaModule,
    SelectModule,
    DatePickerModule,
    ButtonModule,
    MessageModule,
    ListboxModule,
    OverlaySelectComponent,
  ],
  template: `
    <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-4">
      <div class="flex flex-col gap-1">
        <label for="title" class="text-sm font-medium">
          {{ 'task.title' | translate }} <span class="text-red-500">*</span>
        </label>
        <input pInputText id="title" formControlName="title" />
      </div>

      <div class="flex flex-col gap-1">
        <label for="description" class="text-sm font-medium">{{ 'task.description' | translate }}</label>
        <textarea pTextarea id="description" formControlName="description" rows="3"></textarea>
      </div>

      <!-- ACC-76 — when this form is opened FROM a record's own detail page,
           the source is not a question: the task belongs to that record. Both
           fields are prefilled and locked TOGETHER. Locking only the id would
           be the worst of both — the type would still be editable, so a
           committee's id could be saved against sourceType DOCUMENT,
           producing a row that resolves to nothing anywhere.

           Rendered as one read-only fact rather than two disabled inputs,
           because the id is a cuid and showing it teaches the reader
           nothing. The controls stay populated (and disabled) behind this, so
           getRawValue() below still submits them. -->
      @if (isSourceLocked()) {
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium">{{ 'task.source' | translate }}</label>
          <p class="text-sm text-[var(--am-text-secondary)]">{{ lockedSourceLabel() }}</p>
        </div>
      } @else {
        <div class="flex gap-4">
          <div class="flex flex-col gap-1 flex-1">
            <label for="sourceType" class="text-sm font-medium">
              {{ 'task.sourceType' | translate }} <span class="text-red-500">*</span>
            </label>
            <app-overlay-select formControlName="sourceType" [options]="sourceTypes" />
          </div>
          <div class="flex flex-col gap-1 flex-1">
            <label for="sourceId" class="text-sm font-medium">
              {{ 'task.sourceId' | translate }} <span class="text-red-500">*</span>
            </label>
            <input pInputText id="sourceId" formControlName="sourceId" />
          </div>
        </div>
      }

      <div class="flex gap-4">
        <div class="flex flex-col gap-1 flex-1">
          <label for="priority" class="text-sm font-medium">{{ 'task.priority.title' | translate }}</label>
          <p-select inputId="priority" formControlName="priority" [options]="priorities" />
        </div>
        <div class="flex flex-col gap-1 flex-1">
          <label for="dueDate" class="text-sm font-medium">{{ 'task.dueDate' | translate }}</label>
          <p-datepicker inputId="dueDate" formControlName="dueDate" [showTime]="true" />
        </div>
      </div>

      <!-- ACC-76 — a real assignee picker, replacing the stopgap message that
           claimed this "will be available once User Management is set up".
           User Management shipped in ACC-12; the message had been stale for
           most of the project, and sat directly above a Save button that is
           disabled whenever the title is empty, so users read it as the reason
           Save was dead.

           p-listbox, not p-multiselect or OverlaySelectComponent: CLAUDE.md
           makes it the required pattern for inline multi-select inside a
           dialog (structurally immune to the scroll-chaining bug rather than
           merely protected from it), and it carries the filter box a user list
           needs — which OverlaySelectComponent deliberately does not have
           (ACC-42). Copied in shape from unassigned-tasks' Reassign field,
           which already does exactly this.

           ALL ACTIVE USERS, not just members of the source record: the backend
           accepts any active user, and a committee task can legitimately go to
           a department head outside the committee who owes it data. -->
      <div class="flex flex-col gap-1">
        <label for="assigneeUserIds" class="text-sm font-medium">
          {{ 'task.assignees' | translate }}
        </label>
        @if (users().length > 0) {
          <p-listbox
            inputId="assigneeUserIds"
            formControlName="assigneeUserIds"
            [options]="users()"
            optionLabel="name"
            optionValue="id"
            [multiple]="true"
            [checkbox]="true"
            [filter]="true"
            filterBy="name,email"
            [showToggleAll]="false"
            [listStyle]="{ 'max-height': '180px' }"
          />
          <small class="text-xs text-[var(--am-text-secondary)]">
            {{ 'task.assigneesHint' | translate }}
          </small>
        } @else {
          <!-- Degrades rather than blocks. A caller whose role grants
               tasks:create but not users:view gets an empty list and a 403 they
               cannot act on; creating the task unassigned is still a real,
               supported outcome — TaskService.create() sets status UNASSIGNED
               and notifies every tenant admin to assign it. -->
          <p-message severity="info" [text]="'task.assigneesUnavailable' | translate" />
        }
      </div>

      <div class="flex justify-end gap-2 pt-2">
        <p-button
          [label]="'common.cancel' | translate"
          severity="secondary"
          [text]="true"
          (onClick)="cancelled.emit()"
          [disabled]="saving()"
        />
        <p-button [label]="'common.save' | translate" type="submit" [loading]="saving()" [disabled]="form.invalid" />
      </div>
    </form>
  `,
})
export class TaskFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly taskService = inject(TaskService);
  private readonly userService = inject(UserService);

  readonly saved = output<void>();
  readonly cancelled = output<void>();

  // ACC-76 — set by a record's own detail page. Both or neither: a locked id
  // with an editable type would let a committee's id be saved against the
  // wrong sourceType, so isSourceLocked() requires all three.
  readonly lockedSourceType = input<string | null>(null);
  readonly lockedSourceId = input<string | null>(null);
  // What the reader actually recognises — the committee's name, not its cuid.
  readonly lockedSourceLabel = input<string | null>(null);

  readonly isSourceLocked = computed(
    () => !!this.lockedSourceType() && !!this.lockedSourceId() && !!this.lockedSourceLabel(),
  );

  readonly saving = signal(false);
  readonly sourceTypes = SOURCE_TYPES;
  readonly priorities = PRIORITIES;

  // Every ACTIVE user in the tenant. The backend filters again through
  // filterActiveUsers() at create time, so a user deactivated between load and
  // submit is dropped there rather than creating a dead assignment.
  readonly users = signal<IUserDto[]>([]);

  ngOnInit(): void {
    // Requires users:view. Every seeded role holding tasks:create also holds
    // it, but a tenant-created role need not — hence the quiet failure: an
    // empty list renders the explanatory message and the task can still be
    // created unassigned.
    this.userService.listAllUsers({ status: 'ACTIVE' }).subscribe({
      next: (users) => this.users.set(users),
      error: () => this.users.set([]),
    });
  }

  readonly form = this.fb.group({
    title: ['', [Validators.required, Validators.maxLength(255)]],
    description: ['', [Validators.maxLength(2000)]],
    sourceType: ['DOCUMENT', [Validators.required]],
    sourceId: ['', [Validators.required]],
    assigneeUserIds: [[] as string[]],
    priority: ['MEDIUM'],
    dueDate: [null as Date | null],
  });

  constructor() {
    // Disabled controls are excluded from form.value but INCLUDED in
    // getRawValue(), which onSubmit() already uses — so locking them changes
    // what the user can edit without changing what gets submitted.
    effect(() => {
      if (!this.isSourceLocked()) return;
      this.form.patchValue({
        sourceType: this.lockedSourceType(),
        sourceId: this.lockedSourceId(),
      });
      this.form.controls.sourceType.disable();
      this.form.controls.sourceId.disable();
    });
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);

    const value = this.form.getRawValue();
    this.taskService
      .create({
        title: value.title!,
        description: value.description || undefined,
        sourceType: value.sourceType!,
        sourceId: value.sourceId!,
        priority: value.priority ?? undefined,
        dueDate: value.dueDate ? value.dueDate.toISOString() : undefined,
        // Empty is a real, supported outcome, not a failure: TaskService
        // .create() sets status UNASSIGNED and notifies every tenant admin to
        // assign it. So the picker is optional rather than required — a task
        // worth recording now is worth recording before its owner is known.
        assigneeUserIds: value.assigneeUserIds ?? [],
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.saved.emit();
        },
        error: () => this.saving.set(false),
      });
  }
}
