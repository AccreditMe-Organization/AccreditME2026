import { Component, computed, inject, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { Observable } from 'rxjs';
import { LanguageService } from '../../../../core/services/language.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { ITaskPageViewDto, ITaskRecordRowDto, TaskRequestForDecisionDto, TaskRequestType, TaskService } from '../../services/task.service';
import { TaskRowActionId } from '../../task-row-actions';
import { TaskAddEvidenceDialogComponent } from '../task-add-evidence-dialog/task-add-evidence-dialog.component';
import { TaskRejectDialogComponent } from '../task-reject-dialog/task-reject-dialog.component';
import { TaskReleaseDialogComponent } from '../task-release-dialog/task-release-dialog.component';
import { TaskRequestDialogComponent } from '../task-request-dialog/task-request-dialog.component';
import { TaskRequestDecisionDialogComponent } from '../task-request-decision-dialog/task-request-decision-dialog.component';
import { TaskReassignDialogComponent } from '../task-reassign-dialog/task-reassign-dialog.component';
import { TaskEditDialogComponent } from '../task-edit-dialog/task-edit-dialog.component';
import { TaskCancelDialogComponent } from '../task-cancel-dialog/task-cancel-dialog.component';
import { TaskReopenDialogComponent } from '../task-reopen-dialog/task-reopen-dialog.component';
import { TaskEvidenceDialogComponent } from '../task-evidence-dialog/task-evidence-dialog.component';
import { AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';

type DialogId = 'addEvidence' | 'evidence' | 'reject' | 'release' | 'request' | 'decision' | 'reassign' | 'edit' | 'cancel' | 'reopen';

export interface TaskActionFailure {
  taskId: string;
  /** Already translated. */
  message: string;
}

/**
 * ACC-229 — RUNS A ROW'S ACTION, for the record Tasks panel and the All tasks
 * list. Holds every task dialog the rest of the app uses, one at a time.
 *
 * A one-step action (Start, Complete, Resume, Pick up, Withdraw) is called
 * directly. An action with a dialog first reads the task's page view — the
 * dialogs take a whole task, and a list row is not one — then opens the same
 * dialog the task page opens. Nothing here decides who may act: the row's
 * `actions` came from the server, and the server checks again.
 *
 * Success emits `changed` with the task's id; a failure emits `failed` for
 * THAT row (ACC-217: an action's error never blanks the list it came from).
 */
@Component({
  selector: 'app-task-action-host',
  standalone: true,
  imports: [
    TaskAddEvidenceDialogComponent,
    TaskEvidenceDialogComponent,
    TaskRejectDialogComponent,
    TaskReleaseDialogComponent,
    TaskRequestDialogComponent,
    TaskRequestDecisionDialogComponent,
    TaskReassignDialogComponent,
    TaskEditDialogComponent,
    TaskCancelDialogComponent,
    TaskReopenDialogComponent,
  ],
  template: `
    @if (view(); as v) {
      <app-task-add-evidence-dialog [visible]="dialog() === 'addEvidence'" (visibleChange)="onVisible($event)" [task]="v.task" (added)="done()" />
      <app-task-evidence-dialog [visible]="dialog() === 'evidence'" (visibleChange)="onVisible($event)" [task]="v.task" (changed)="done(false)" />
      <app-task-reject-dialog [visible]="dialog() === 'reject'" (visibleChange)="onVisible($event)" [task]="v.task" (rejected)="done()" />
      <app-task-release-dialog [visible]="dialog() === 'release'" (visibleChange)="onVisible($event)" [task]="v.task" (released)="done()" />
      <app-task-request-dialog
        [visible]="dialog() === 'request'"
        (visibleChange)="onVisible($event)"
        [task]="v.task"
        [type]="requestType()"
        (requested)="done()"
      />
      <app-task-request-decision-dialog
        [visible]="dialog() === 'decision'"
        (visibleChange)="onVisible($event)"
        [request]="decisionRequest()"
        (decided)="done()"
      />
      <app-task-reassign-dialog
        [visible]="dialog() === 'reassign'"
        (visibleChange)="onVisible($event)"
        [task]="v.task"
        [rejection]="rejection()"
        [committeeName]="committeeName()"
        (reassigned)="done()"
      />
      <app-task-edit-dialog [visible]="dialog() === 'edit'" (visibleChange)="onVisible($event)" [task]="v.task" (edited)="done()" />
      <app-task-cancel-dialog [visible]="dialog() === 'cancel'" (visibleChange)="onVisible($event)" [task]="v.task" (cancelledTask)="done()" />
      <app-task-reopen-dialog [visible]="dialog() === 'reopen'" (visibleChange)="onVisible($event)" [task]="v.task" (reopened)="done()" />
    }
  `,
})
export class TaskActionHostComponent {
  private readonly tasks = inject(TaskService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly amConfirm = inject(AmConfirmService);
  private readonly router = inject(Router);

  /** The task an action finished on (refresh that row, or the list). */
  readonly changed = output<string>();
  readonly failed = output<TaskActionFailure>();
  /** The task an action is running on, or null when none is. */
  readonly busyChange = output<string | null>();

  readonly view = signal<ITaskPageViewDto | null>(null);
  readonly dialog = signal<DialogId | null>(null);
  readonly requestType = signal<TaskRequestType>('EXTENSION');
  /** An evidence-only dialog that changed nothing still refreshes the count. */
  private dirty = false;

  readonly decisionRequest = computed<TaskRequestForDecisionDto | null>(() => {
    const v = this.view();
    const r = v?.task.openRequest;
    if (!v || !r) return null;
    const t = v.task;
    return { ...r, task: { id: t.id, title: t.title, sourceType: t.sourceType, sourceId: t.sourceId, status: t.status, priority: t.priority, dueAt: t.dueAt } };
  });
  readonly rejection = computed(() => {
    const v = this.view();
    if (!v || v.task.status !== 'REJECTED' || !v.task.rejectedReason) return null;
    return { byName: v.rejectedBy?.name ?? null, reason: v.task.rejectedReason };
  });
  readonly committeeName = computed(() => {
    const r = this.view()?.record;
    return r?.type === 'COMMITTEE' && r.nameEn ? this.language.bilingual(r.nameEn, r.nameAr) : null;
  });

  run(row: ITaskRecordRowDto, id: TaskRowActionId): void {
    switch (id) {
      case 'open':
        void this.router.navigate(['/tasks', row.id]);
        return;
      case 'start':
        return this.call(row.id, this.tasks.start(row.id));
      case 'resume':
        return this.call(row.id, this.tasks.resume(row.id));
      case 'pickUp':
        return this.call(row.id, this.tasks.pick(row.id));
      case 'withdrawRequest':
        if (!row.openRequest) return;
        return this.call(row.id, this.tasks.withdrawRequest(row.id, row.openRequest.id));
      case 'complete':
        if (row.actions.completeNeedsEvidence) return;
        // Confirmed first, as the committee page always did. ACC-240 — the
        // question names the task (titleOf: bilingual(), ACC-160); the message
        // is what complete() does: every other active assignee comes off it
        // (task.service.ts:720–723), it becomes COMPLETED (:725–727), and its
        // open requests are cancelled (:730).
        this.amConfirm.ask({
          tone: 'neutral',
          header: this.translate.instant('task.confirmCompleteHeader', { title: this.titleOf(row) }),
          message: this.translate.instant('task.confirmComplete'),
          acceptLabel: this.translate.instant('task.complete'),
          accept: () => this.call(row.id, this.tasks.complete(row.id)),
        });
        return;
      case 'requestMoreTime':
        this.requestType.set('EXTENSION');
        return this.openDialog(row, 'request');
      case 'requestHold':
        this.requestType.set('ON_HOLD');
        return this.openDialog(row, 'request');
      case 'reviewRequest':
        return this.openDialog(row, 'decision');
      case 'viewEvidence':
        return this.openDialog(row, 'evidence');
      default:
        return this.openDialog(row, id);
    }
  }

  onVisible(visible: boolean): void {
    if (visible) return;
    const id = this.view()?.task.id;
    this.dialog.set(null);
    if (this.dirty && id) this.changed.emit(id);
    this.dirty = false;
  }

  /** A dialog finished its work. `closes` is false for one that stays open (evidence). */
  done(closes = true): void {
    const id = this.view()?.task.id;
    if (!id) return;
    if (closes) {
      this.dialog.set(null);
      this.changed.emit(id);
    } else {
      this.dirty = true;
    }
  }

  private openDialog(row: ITaskRecordRowDto, dialog: DialogId): void {
    this.busyChange.emit(row.id);
    this.tasks.getPage(row.id).subscribe({
      next: (view) => {
        this.busyChange.emit(null);
        this.view.set(view);
        this.dirty = false;
        this.dialog.set(dialog);
      },
      error: (err: unknown) => {
        this.busyChange.emit(null);
        this.fail(row.id, err);
      },
    });
  }

  private call(taskId: string, request: Observable<unknown>): void {
    this.busyChange.emit(taskId);
    request.subscribe({
      next: () => {
        this.busyChange.emit(null);
        this.changed.emit(taskId);
      },
      error: (err: unknown) => {
        this.busyChange.emit(null);
        this.fail(taskId, err);
      },
    });
  }

  private fail(taskId: string, err: unknown): void {
    this.failed.emit({ taskId, message: this.translate.instant(extractErrorMessage(err, 'task.errorAction')) });
  }

  private titleOf(row: ITaskRecordRowDto): string {
    return this.language.bilingual(row.title, row.titleAr);
  }
}
