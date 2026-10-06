import { Component, input, output, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { TaskFormComponent } from '../task-form/task-form.component';
import { TaskFormFooterComponent } from '../task-form/task-form-footer.component';
import { ITaskDto } from '../../services/task.service';

/**
 * Edit a task — ACC-174. The creator's four fields, in New task's own form
 * (its edit mode), so Edit and New task use the same controls by construction.
 *
 * The footer travels the way New task's does (the form instance, not a
 * TemplateRef — see TaskFormFooterComponent). The body is created only while
 * the dialog is open (EditDialogComponent's TemplateRef rule, ACC-29), so each
 * opening starts from the task as it is now.
 */
@Component({
  selector: 'app-task-edit-dialog',
  standalone: true,
  imports: [TranslatePipe, EditDialogComponent, TaskFormComponent, TaskFormFooterComponent],
  template: `
    <ng-template #bodyTpl>
      @if (task(); as t) {
        <app-task-form
          [task]="t"
          (saved)="onSaved()"
          (cancelled)="dialog.requestClose()"
          (dirtyChange)="dirty.set($event)"
          (ready)="formRef.set($event)"
        />
      }
    </ng-template>
    <ng-template #footerTpl>
      <app-task-form-footer [form]="formRef()" />
    </ng-template>
    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="'task.edit.named' | translate: { title: task()?.title ?? '' }"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [dirty]="dirty()"
      size="form"
    />
  `,
})
export class TaskEditDialogComponent {
  readonly visible = input.required<boolean>();
  readonly task = input<ITaskDto | null>(null);
  readonly visibleChange = output<boolean>();
  /** Emitted once the edit is saved; the host reloads its list. */
  readonly edited = output<void>();

  readonly formRef = signal<TaskFormComponent | null>(null);
  readonly dirty = signal(false);

  onSaved(): void {
    this.dirty.set(false);
    this.edited.emit();
    this.visibleChange.emit(false);
  }
}
