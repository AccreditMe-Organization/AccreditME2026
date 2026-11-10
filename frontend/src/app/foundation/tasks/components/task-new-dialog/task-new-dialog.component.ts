// ACC-280 — THE New task dialog (plan §5, decision 5): one component for /tasks,
// Home and a record's own page. It holds what each of them assembled inline
// before: the edit-dialog shell, the form, the step strip in the header and the
// footer, and the unsaved-work question (ACC-96).
//
// - Unlocked (/tasks, Home): the record is picked (TaskRecordPickerComponent),
//   from the types the server names (`createTypes`, GET /tasks/views).
// - Locked (a record's page): the record is set and shown, never asked; the
//   header says which record the task is raised on.
//
// Declared HERE, not inside the form: p-dialog collects pTemplate children at
// content init, so a footer arriving later never lands. The step strip sits in
// the HEADER, so the body's 420px cap is the form's alone.

import { Component, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { TaskFormComponent } from '../task-form/task-form.component';
import { TaskFormFooterComponent } from '../task-form/task-form-footer.component';
import { TaskFormStepsComponent } from '../task-form/task-form-steps.component';

/** The record a task is raised on, from its own page: its type, id and the name shown. */
export interface TaskNewLockedRecord {
  type: string;
  id: string;
  label: string;
}

@Component({
  selector: 'app-task-new-dialog',
  standalone: true,
  imports: [TranslatePipe, EditDialogComponent, TaskFormComponent, TaskFormFooterComponent, TaskFormStepsComponent],
  template: `
    <ng-template #formTpl>
      <app-task-form
        [allowedSourceTypes]="locked() ? null : createTypes()"
        [lockedSourceType]="locked()?.type ?? null"
        [lockedSourceId]="locked()?.id ?? null"
        [lockedSourceLabel]="locked()?.label ?? null"
        (saved)="onSaved()"
        (cancelled)="dialog.requestClose()"
        (dirtyChange)="dirty.set($event)"
        (ready)="formRef.set($event)"
      />
    </ng-template>
    <ng-template #stepsTpl>
      <app-task-form-steps [form]="formRef()" />
    </ng-template>
    <ng-template #footerTpl>
      <app-task-form-footer [form]="formRef()" />
    </ng-template>
    <!-- Cancel goes through requestClose(), the one place the unsaved-work
         question is asked (ACC-96). -->
    <app-edit-dialog
      #dialog
      [(visible)]="visible"
      [header]="'task.newTask' | translate"
      [context]="context()"
      [content]="formTpl"
      [dirty]="dirty()"
      [headerExtra]="stepsTpl"
      [footer]="footerTpl"
    />
  `,
})
export class TaskNewDialogComponent {
  private readonly translate = inject(TranslateService);

  readonly visible = model(false);
  /** The record types New task may create on (GET /tasks/views' create.types). Ignored when locked. */
  readonly createTypes = input<readonly string[]>([]);
  /** Set on a record's own page: the task belongs to it, so it is not asked. */
  readonly locked = input<TaskNewLockedRecord | null>(null);
  /** A task was created; the dialog has closed. */
  readonly created = output<void>();

  readonly dirty = signal(false);
  readonly formRef = signal<TaskFormComponent | null>(null);

  /** "on Quality Committee" under the title, when the record is set by the page. */
  readonly context = computed(() => {
    this.translate.currentLang();
    const locked = this.locked();
    return locked ? (this.translate.instant('task.raisedFrom', { record: locked.label }) as string) : '';
  });

  constructor() {
    // A closed dialog holds no unsaved work: the next open is a fresh form.
    effect(() => {
      if (!this.visible()) untracked(() => this.dirty.set(false));
    });
  }

  onSaved(): void {
    this.dirty.set(false);
    this.visible.set(false);
    this.created.emit();
  }
}
