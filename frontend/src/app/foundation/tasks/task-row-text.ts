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
 * 8 Oct 2026", "⏸ On hold to 20 Oct 2026 · Due 27 Oct 2026", "✓ Completed
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

  /**
   * CC-338 — line 2's status word, or null where line 2 already starts with the
   * hold part: a held task's due label is "⏸ On hold to … · due …", so "On hold"
   * again only pushes the rest into the ellipsis. The one rule for every line 2:
   * the record panel, a person's panel and the list's phone cards.
   */
  lineStatus(row: ITaskRecordRowDto): string | null {
    return row.status === 'ON_HOLD' ? null : this.translate.instant(this.statusKey(row));
  }

  /** Line 2 after the due label: "{who} · {status} · {fact}". Only this part is cut. */
  tail(row: ITaskRecordRowDto): string {
    return [this.who(row), this.lineStatus(row), this.fact(row)].filter((p) => !!p).join(' · ');
  }

  /**
   * ACC-216 — line 2 on a PERSON's Tasks panel, after the due label:
   * "{status} · {fact} · {record}". The person is on every row, so the record takes
   * the "who" place, LAST (CC-331): the line can't wrap in the fixed body, so on a
   * phone the ellipsis falls on the record's name, never on the status. The panel
   * puts the whole line in the title attribute.
   */
  personTail(row: ITaskRecordRowDto): string {
    return [this.lineStatus(row), this.fact(row), this.recordLabel(row)].filter((p) => !!p).join(' · ');
  }

  /**
   * The task's record as the server named it: its name only when the server sent one
   * (the viewer may open the record), else the record type's word; null with no record.
   */
  recordLabel(row: ITaskRecordRowDto): string | null {
    const record = row.record;
    if (!record) return null;
    if (record.nameEn) return this.language.bilingual(record.nameEn, record.nameAr);
    const key = `taskList.recordType.${record.type}`;
    const word = this.translate.instant(key);
    return word === key ? this.translate.instant('taskList.recordType.OTHER') : word;
  }

  requirementKey(row: ITaskRecordRowDto): string | null {
    return row.requirement === 'REQUIRED' ? 'taskList.tag.required' : row.requirement === 'OPTIONAL' ? 'taskList.tag.optional' : null;
  }
}
