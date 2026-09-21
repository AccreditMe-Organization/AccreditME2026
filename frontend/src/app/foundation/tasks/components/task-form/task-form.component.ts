import { Component, OnInit, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
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
// ACC-96 — the due-date calendar is its own LAYER rather than a floating panel
// inside this dialog. See the template comment beside it.
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FormatService } from '../../../../core/formatting';

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
    FormsModule,
    TranslatePipe,
    InputTextModule,
    TextareaModule,
    SelectModule,
    DatePickerModule,
    ButtonModule,
    MessageModule,
    ListboxModule,
    OverlaySelectComponent,
    EditDialogComponent,
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
          <!-- ACC-96 — NOT a <p-datepicker> with its own floating panel. That
               panel is appended inside this dialog, and PrimeNG's
               ConnectedOverlayScrollHandler closes it on ANY ancestor scroll:
               confirmed live here, where scrolling the dialog body 60px shut
               the calendar while an untouched one stayed open. The calendar is
               now its own layer at the root (see below), which has no
               scrollable ancestor at all.
               Typing stays a COMPLETE path to a value — it was one before this
               change, and removing it would trade one defect for another. -->
          <div class="flex gap-1">
            <input
              pInputText
              id="dueDate"
              class="flex-1"
              [value]="dueDateText()"
              (input)="onDueDateTyped($any($event.target).value)"
              (blur)="commitTypedDueDate()"
              autocomplete="off"
            />
            <p-button
              type="button"
              icon="pi pi-calendar"
              [text]="true"
              [ariaLabel]="'task.toggleDuePanel' | translate"
              (onClick)="toggleDuePanel()"
            />
          </div>
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

    <!-- ACC-96 — the calendar as its own layer, at the root, exactly as
         public-holiday-form does it (ACC-111 a613fcb). [inline] means PrimeNG
         builds no overlay, so there is nothing for its scroll handler to
         close; appendTo="body" keeps the layer out of THIS dialog's scrolling
         body. EditDialogComponent registers it with LayerStackService, which
         is what makes Escape close exactly one layer per press. -->
    <ng-template #dueDateTpl>
      <p-datepicker
        [inline]="true"
        [showTime]="true"
        [ngModel]="controlDueDate()"
        [ngModelOptions]="{ standalone: true }"
        (ngModelChange)="onDueDatePicked($event)"
        styleClass="w-full"
      />
    </ng-template>
    <app-edit-dialog
      [visible]="duePanelOpen()"
      (visibleChange)="onDuePanelVisibleChange($event)"
      [header]="'task.chooseDueDate' | translate"
      [content]="dueDateTpl"
      size="picker"
      appendTo="body"
    />
  `,
})
export class TaskFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly taskService = inject(TaskService);
  private readonly userService = inject(UserService);
  private readonly format = inject(FormatService);

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

  // ── Due date (ACC-96) ──────────────────────────────────────────────────
  // Mirrors public-holiday-form's date field, which is the worked example of
  // this pattern. Two signals rather than one: `typed` holds what the user is
  // part-way through writing, `controlDueDate` holds the committed value, and
  // the displayed text prefers the former. Without that split, re-rendering
  // mid-keystroke rewrites the field under the cursor.
  readonly duePanelOpen = signal(false);
  private readonly typedDueDate = signal<string | null>(null);
  readonly controlDueDate = signal<Date | null>(null);

  // dateTimeForInput, not dateTime: this value is typed back, so it stays
  // Gregorian with English months even for an Arabic or Hijri reader (ACC-94
  // D4). Dropping the time here would read as midnight.
  readonly dueDateText = computed(
    () => this.typedDueDate() ?? this.format.dateTimeForInput(this.controlDueDate()),
  );

  toggleDuePanel(): void {
    this.duePanelOpen.set(!this.duePanelOpen());
  }

  /**
   * A pick closes the layer and writes the value, then returns focus to the
   * FIELD rather than the calendar button — the field is what was being
   * filled in, and it now holds the chosen value.
   */
  onDueDatePicked(value: Date | null): void {
    this.form.controls.dueDate.setValue(value);
    this.form.controls.dueDate.markAsDirty();
    this.controlDueDate.set(value);
    this.typedDueDate.set(null);
    this.duePanelOpen.set(false);
    this.focusDueDateInput();
  }

  onDuePanelVisibleChange(visible: boolean): void {
    this.duePanelOpen.set(visible);
    if (!visible) this.focusDueDateInput();
  }

  onDueDateTyped(value: string): void {
    this.typedDueDate.set(value);
  }

  /**
   * On BLUR, not per keystroke — "15 Sep" is not yet a date, and validating it
   * as one would put an error under someone mid-word. Same parse and same
   * invalidDate error shape as public-holiday-form, deliberately: one way to
   * fail in this app, not two.
   */
  commitTypedDueDate(): void {
    const text = this.typedDueDate();
    if (text === null) return;

    const control = this.form.controls.dueDate;
    const trimmed = text.trim();

    if (trimmed === '') {
      control.setValue(null);
      control.markAsDirty();
      this.controlDueDate.set(null);
      this.typedDueDate.set(null);
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
    this.controlDueDate.set(parsed);
    this.typedDueDate.set(null);
  }

  private focusDueDateInput(): void {
    setTimeout(() => {
      document.getElementById('dueDate')?.focus();
    });
  }

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

    // ACC-96 — the display signal follows the control, so a reset or a
    // patchValue from outside is reflected in the field rather than leaving
    // stale text behind.
    this.controlDueDate.set(this.form.controls.dueDate.value);
    this.form.controls.dueDate.valueChanges.subscribe((value) => {
      this.controlDueDate.set(value);
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
    // ACC-96 — Save can be reached straight from the date field, without a
    // blur, so the typed text has to be committed here too or a value the
    // user can see would not be submitted.
    this.commitTypedDueDate();
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
