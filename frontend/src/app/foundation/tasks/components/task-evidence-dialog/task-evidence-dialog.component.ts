import { Component, input, output, signal, viewChild } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { ITaskDto } from '../../services/task.service';
import { TaskEvidenceListComponent } from '../task-evidence-list/task-evidence-list.component';
import { TaskAddEvidenceDialogComponent } from '../task-add-evidence-dialog/task-add-evidence-dialog.component';

/**
 * A task's evidence, opened from a row — ACC-177.
 *
 * The stand-in for the task's own page until ACC-120 slice 3 builds it: it
 * hosts the same Evidence panel (TaskEvidenceListComponent) that page will
 * host, unchanged. "Add evidence" opens the Add evidence dialog as its OWN
 * LAYER above this one (dialog rule 4), so neither body grows.
 *
 * ## Body height — an inner-scroll list, nothing that floats
 *
 * The rows hold text and icon buttons only, so the list frame may scroll on
 * its own and keep the body under the 420px cap (EditDialogComponent's
 * inner-scroll condition: nothing inside the frame opens a floating panel).
 */
@Component({
  selector: 'app-task-evidence-dialog',
  standalone: true,
  imports: [TranslatePipe, ButtonModule, EditDialogComponent, TaskEvidenceListComponent, TaskAddEvidenceDialogComponent],
  template: `
    <ng-template #bodyTpl>
      @if (task(); as t) {
        <div class="am-evidence-frame">
          <app-task-evidence-list
            [taskId]="t.id"
            [requiresEvidence]="t.requiresEvidence"
            [showAdd]="false"
            (canAddChange)="canAdd.set($event)"
            (changed)="changed.emit()"
          />
        </div>
      }
    </ng-template>
    <ng-template #footerTpl>
      <div class="flex justify-end gap-3">
        <p-button [label]="'common.close' | translate" severity="secondary" [text]="true" type="button" (onClick)="dialog.requestClose()" />
        @if (canAdd()) {
          <p-button type="button" icon="pi pi-plus" [label]="'task.evidence.add' | translate" (onClick)="addVisible.set(true)" />
        }
      </div>
    </ng-template>
    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="'task.evidence.title' | translate"
      [context]="task()?.title ?? ''"
      [content]="bodyTpl"
      [footer]="footerTpl"
      size="form"
    />
    <app-task-add-evidence-dialog
      [visible]="addVisible()"
      (visibleChange)="addVisible.set($event)"
      [task]="task()"
      (added)="onAdded()"
    />
  `,
  styles: [
    `
      /* The inner-scroll frame (see the class comment): rows of text and icon
         buttons, nothing that floats. */
      .am-evidence-frame {
        max-block-size: 360px;
        overflow-y: auto;
        overscroll-behavior: contain;
      }
    `,
  ],
})
export class TaskEvidenceDialogComponent {
  readonly visible = input.required<boolean>();
  readonly task = input<Pick<ITaskDto, 'id' | 'title' | 'requiresEvidence'> | null>(null);
  readonly visibleChange = output<boolean>();
  /** Evidence was added or removed; the host reloads its list (the count). */
  readonly changed = output<void>();

  readonly canAdd = signal(false);
  readonly addVisible = signal(false);
  private readonly list = viewChild(TaskEvidenceListComponent);

  onAdded(): void {
    this.list()?.reload();
    this.changed.emit();
  }
}
