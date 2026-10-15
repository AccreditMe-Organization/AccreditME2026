import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { FormatService } from '../../core/formatting';
import { LanguageService } from '../../core/services/language.service';
import { ITaskRecordRowDto } from './services/task.service';
import { isTaskOverdue, taskStatusLabelKey } from './task-status';
import { taskPoolLabel } from './task-pool-label';

export type TaskDueTone = 'danger' | 'info' | 'muted' | 'ok';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * ACC-229 — HOW A TASK ROW READS, for the record Tasks panel and the All tasks
 * list (Record Tasks Panel §1).
 *
 * The due label leads the second line and is never cut: "⚠ 4 days overdue ·
 * 8 Oct 2026", "⏸ On hold to 20 Oct 2026 · due 27 Oct 2026", "✓ Completed
 * 2 Oct 2026". Overdue and On hold always carry a symbol AND words, never
 * colour alone. Dates go through the formatting layer (ACC-94); a span of time
 * is a duration, never a plural object.
 */
@Injectable({ providedIn: 'root' })
export class TaskRowText {
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);
  private readonly language = inject(LanguageService);

  title(row: ITaskRecordRowDto): string {
    return this.language.bilingual(row.title, row.titleAr);
  }

  due(row: ITaskRecordRowDto, now: Date = new Date()): { text: string; tone: TaskDueTone } {
    if (row.status === 'COMPLETED') {
      return { text: this.translate.instant('taskList.due.completedOn', { date: this.format.date(row.completedAt) }), tone: 'muted' };
    }
    if (row.status === 'CANCELLED') {
      return { text: this.translate.instant('taskList.due.cancelledOn', { date: this.format.date(row.cancelledAt) }), tone: 'muted' };
    }
    if (row.status === 'ON_HOLD') {
      const hold = this.format.date(row.onHoldUntil);
      return {
        text: row.dueAt
          ? this.translate.instant('taskList.due.onHoldDue', { hold, date: this.format.date(row.dueAt) })
          : this.translate.instant('taskList.due.onHold', { hold }),
        tone: 'info',
      };
    }
    if (!row.dueAt) return { text: this.translate.instant('taskList.due.none'), tone: 'ok' };
    const due = new Date(row.dueAt);
    if (isTaskOverdue(row, now)) {
      return {
        text: this.translate.instant('taskList.due.overdue', {
          span: this.format.duration(now.getTime() - due.getTime()),
          date: this.format.date(row.dueAt),
        }),
        tone: 'danger',
      };
    }
    if (due.getTime() - now.getTime() <= 7 * DAY_MS) {
      return {
        text: this.translate.instant('taskList.due.soon', { when: this.format.relative(row.dueAt, now), date: this.format.date(row.dueAt) }),
        tone: 'ok',
      };
    }
    return { text: this.translate.instant('taskList.due.on', { date: this.format.date(row.dueAt) }), tone: 'ok' };
  }

  /** Who has it: the people on it, the pool it waits in, or nobody. */
  who(row: ITaskRecordRowDto): string {
    if (row.assignees.length) {
      const names = row.assignees.map((a) => a.name);
      return names.length <= 2 ? names.join(this.language.isArabic() ? '، ' : ', ') : this.format.count('task.assignees', names.length);
    }
    if (row.pool) {
      const pool = taskPoolLabel(row.pool, (en, ar) => this.language.bilingual(en, ar), this.language.isArabic());
      return row.waitingInPool ? this.translate.instant('taskPage.waitingFor', { pool }) : pool;
    }
    return this.translate.instant('task.unassigned');
  }

  /** The first person's position, for the list's sub-line. */
  position(row: ITaskRecordRowDto): string {
    const a = row.assignees[0];
    return a?.positionNameEn ? this.language.bilingual(a.positionNameEn, a.positionNameAr) : '';
  }

  statusKey(row: ITaskRecordRowDto): string {
    if (row.waitingInPool && (row.status === 'PENDING' || row.status === 'OVERDUE')) return 'taskPage.status.waiting';
    return taskStatusLabelKey(row);
  }

  /** The one changing fact: a request waiting, a rejection, a cancellation. */
  fact(row: ITaskRecordRowDto): string | null {
    const r = row.openRequest;
    if (r) {
      return r.type === 'EXTENSION'
        ? this.translate.instant('task.request.recordExtension', { name: r.requestedByName, date: this.format.dateTime(r.requestedDueAt) })
        : this.translate.instant('task.request.recordHold', { name: r.requestedByName, date: this.format.date(r.holdUntil) });
    }
    if (row.status === 'REJECTED' && row.rejectedReason) {
      return this.translate.instant('task.rejectedReasonOnly', { reason: row.rejectedReason });
    }
    if (row.status === 'CANCELLED' && row.cancelledReason) {
      return this.translate.instant('task.cancelTask.line', { reason: row.cancelledReason });
    }
    return null;
  }

  /** Line 2 after the due label: "{who} · {status} · {fact}". Only this part is cut. */
  tail(row: ITaskRecordRowDto): string {
    return [this.who(row), this.translate.instant(this.statusKey(row)), this.fact(row)].filter((p) => !!p).join(' · ');
  }

  requirementKey(row: ITaskRecordRowDto): string | null {
    return row.requirement === 'REQUIRED' ? 'taskList.tag.required' : row.requirement === 'OPTIONAL' ? 'taskList.tag.optional' : null;
  }
}
