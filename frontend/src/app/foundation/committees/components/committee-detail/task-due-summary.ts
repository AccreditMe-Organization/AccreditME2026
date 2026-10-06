import { TranslateService } from '@ngx-translate/core';
import { EMPTY_VALUE, FormatService } from '../../../../core/formatting';
import { ITaskWithAssigneesDto } from '../../../tasks/services/task.service';
import { isTaskOverdue } from '../../../tasks/task-status';

type DueTask = Pick<ITaskWithAssigneesDto, 'dueAt' | 'status'>;

// ACC-163 — isTaskOverdue moved to tasks/task-status.ts, where every task
// surface reads it; re-exported so this file's existing importers keep working.
export { isTaskOverdue };

// The Committee record's task summary: how late, or when due. The elapsed form
// is used only when overdue, because that is when the magnitude changes what a
// reader does about it.
//
// ACC-94 — the lateness comes from the formatting layer's duration, so a task a
// few hours late reads "Overdue 5 hours". The old whole-day arithmetic showed
// "overdue 0d" for anything under a day late. The due date itself is dateTime,
// the one format for a due date everywhere.
export function taskDueSummary(
  task: DueTask,
  format: FormatService,
  translate: TranslateService,
  now: Date = new Date(),
): string {
  if (!task.dueAt) return EMPTY_VALUE;
  if (isTaskOverdue(task, now)) {
    return translate.instant('task.overdueBy', { duration: format.elapsed(task.dueAt, now) });
  }
  return format.dateTime(task.dueAt);
}
