import { Component, TemplateRef, ViewChild, computed, inject, signal, viewChild } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { TaskFormComponent } from '../task-form/task-form.component';
import { TaskFormFooterComponent } from '../task-form/task-form-footer.component';
import { TaskFormStepsComponent } from '../task-form/task-form-steps.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
// ACC-39 — EditDialogComponent replaces this raw p-dialog + manual @if.
// task-form is create-only (no edit flow), so this is architectural
// consistency with the required pattern going forward (SYSTEM-REFERENCE.md
// Section 10.5), not a bug fix — the old @if(formVisible()) wrapping
// <app-task-form> directly was already immune to ACC-29's pre-fill bug.
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { TaskListViewComponent } from '../task-list-view/task-list-view.component';

// The organisation's tasks, at /tasks/all (View all tasks, ACC-244).
//
// ACC-229 — this page never showed a task. It asked for a record's tasks
// (getForSource) and, reached from the rail with no record, returned before
// asking: every visit read "No tasks". It now hosts the All tasks list
// organisation-wide — the same list a record's "See all" opens — which needs
// no record: the server lists every task in the record types the viewer may
// see (ObjectVisibilityService.viewableTypes), 50 at a time.
//
// A record page does not embed this page: it uses the record Tasks panel
// (RecordTasksPanelComponent), whose "See all" opens the same list.
@Component({
  selector: 'app-task-list',
  standalone: true,
  imports: [PageHeaderComponent, TranslatePipe, ButtonModule, TaskFormComponent, TaskFormFooterComponent, TaskFormStepsComponent,
    EditDialogComponent, TaskListViewComponent],
  template: `
    <div class="flex flex-col h-full gap-4">
      <app-page-header [title]="'task.allTasks' | translate">
        <div pageActions>
          @if (canCreate()) {
            <p-button [label]="'task.newTask' | translate" icon="pi pi-plus" (onClick)="onAdd()" />
          }
        </div>
      </app-page-header>

      <app-task-list-view variant="page" />
    </div>

    <ng-template #formTpl>
      <app-task-form
        (saved)="onSaved()"
        (cancelled)="taskDialog.requestClose()"
        (dirtyChange)="formDirty.set($event)"
        (ready)="taskFormRef.set($event)"
      />
    </ng-template>
    <!-- ACC-96 — [dirty] is an opt-in input on the DIALOG, and task-form sits
         inside it, so the state travels outward through (dirtyChange). Without
         it Escape discards a part-filled task silently, which the templates
         have always specified against.

         CANCEL GOES THROUGH requestClose(), not straight to visible=false.
         That method is the single place the dirty question is asked — Escape
         and the header's ✕ already arrived there, and Cancel was the one path
         that bypassed it and discarded a part-filled task without a word. -->
    <!-- Declared HERE, not inside the form: p-dialog collects pTemplate
         children at content init, so a footer arriving later never lands. -->
    <!-- The step strip belongs to the HEADER, beside the title and the
         context line, exactly as Template 3 draws it — so it does not change
         when the date view substitutes the body, and costs nothing against
         the 420px body cap. -->
    <ng-template #taskStepsTpl>
      <app-task-form-steps [form]="taskFormRef()" />
    </ng-template>
    <ng-template #taskFooterTpl>
      <app-task-form-footer [form]="taskFormRef()" />
    </ng-template>
    <app-edit-dialog
      #taskDialog
      [(visible)]="formVisible"
      [header]="'task.newTask' | translate"
      [content]="formTpl"
      [dirty]="formDirty()"
      [headerExtra]="taskStepsTpl"
      [footer]="taskFooterTpl"
    />
  `,
})
export class TaskListComponent {
  readonly formDirty = signal(false);
  readonly taskFormRef = signal<TaskFormComponent | null>(null);

  @ViewChild('formTpl', { read: TemplateRef, static: true }) formTpl!: TemplateRef<unknown>;

  private readonly navigationAccess = inject(NavigationAccessService);
  private readonly list = viewChild(TaskListViewComponent);

  // ACC-118 — the create action is HIDDEN, not disabled, for a caller who
  // cannot use it: a disabled button still announces an action that is not
  // theirs. Same mechanism as committee-detail.component.ts's canEdit /
  // canAddMember, deliberately rather than a second one.
  // POST /tasks enforces Create tasks on the record's type (task.service.ts).
  // ACC-244 — Create tasks on committees, the only record type with task keys.
  readonly canCreate = computed(() => this.navigationAccess.hasPermission('committees:create_tasks'));

  readonly formVisible = signal(false);

  onAdd(): void {
    this.formVisible.set(true);
  }

  onSaved(): void {
    this.formVisible.set(false);
    this.list()?.reload();
  }
}
