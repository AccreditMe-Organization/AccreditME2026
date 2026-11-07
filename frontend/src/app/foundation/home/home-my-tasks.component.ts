import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { FormatService } from '../../core/formatting';
import { LanguageService } from '../../core/services/language.service';
import { CappedPanelComponent, CappedPanelState } from '../../shared/components/capped-panel/capped-panel.component';
import { TaskLinkComponent } from '../tasks/components/task-link/task-link.component';
import { ITaskRecordRowDto } from '../tasks/services/task.service';
import { isTaskOverdue } from '../tasks/task-status';
import { taskRecordTypeKey } from '../tasks/task-row-display';
import { MyWorkCountsService, panelState } from './my-work-counts.service';

interface TaskRow {
  id: string;
  title: string;
  record: string;
  due: string;
  late: boolean;
  held: boolean;
}

/**
 * ACC-279 — Home's My tasks panel: the person's five open tasks, soonest due
 * first (the record list's own `due` order: overdue, then due, then on hold),
 * with the count of all of them and an "n overdue" chip. On am-capped-panel, so
 * it stays the height of the panels beside it.
 *
 * Reads MyWorkCountsService, never its own request, so Home's tile, this panel
 * and the rail can never disagree. A record is named only where the server named
 * it, which it does only for a viewer who may open the record (ACC-228).
 */
@Component({
  selector: 'app-home-my-tasks',
  standalone: true,
  imports: [CappedPanelComponent, TaskLinkComponent, RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <am-capped-panel
      [heading]="'home.myTasks' | translate"
      [state]="state()"
      [total]="total()"
      [shown]="rows().length"
      [offersSeeAll]="false"
      [loadingText]="'home.panel.loading' | translate"
      [errorText]="'home.panel.myTasksFailed' | translate"
      [emptyText]="'home.noOpenTasks' | translate"
      testIdPrefix="home-tasks"
      (retry)="retry()"
    >
      @if (overdueLabel(); as overdue) {
        <span amPanelActions class="am-hp__alert" data-testid="home-tasks-overdue">{{ overdue }}</span>
      }
      <a amPanelActions class="am-hp__link" routerLink="/tasks" data-testid="home-tasks-all">{{ 'home.allMyTasks' | translate }}</a>
      @for (r of rows(); track r.id) {
        <li class="am-cp-row" data-testid="home-task-row">
          <span class="am-cp-l1"><span class="am-cp-cut"><am-task-link [taskId]="r.id" [title]="r.title" /></span></span>
          <span class="am-cp-l2">
            <span class="am-cp-cut">{{ r.record }}</span>
            <span class="am-hp__dot" aria-hidden="true">·</span>
            <span class="am-hp__when" [class.am-hp__late]="r.late" [class.am-hp__held]="r.held">{{ r.due }}</span>
          </span>
        </li>
      }
    </am-capped-panel>
  `,
  styles: [
    `
      app-home-my-tasks{display:block;min-inline-size:0}
      .am-hp__link{flex:none;font-size:12px;font-weight:600;color:var(--am-primary-700);text-decoration:none;white-space:nowrap}
      .am-hp__link:hover{text-decoration:underline}
      .am-hp__link:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
      .am-hp__alert{flex:none;font-size:11px;font-weight:600;color:var(--am-danger-ink);background:var(--am-danger-bg);border-radius:4px;padding:1px 6px;white-space:nowrap}
      .am-hp__dot{flex:none;padding-inline:5px;color:var(--am-ink-500)}
      .am-hp__when{flex:none;white-space:nowrap}
      .am-hp__late{color:var(--am-danger-ink);font-weight:600}
      .am-hp__held{color:var(--am-info-ink)}
    `,
  ],
})
export class HomeMyTasksComponent {
  private readonly counts = inject(MyWorkCountsService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly format = inject(FormatService);

  /** The panel calls a failure `error`. */
  readonly state = computed((): CappedPanelState => panelState(this.counts.myTasks().state));
  readonly total = computed(() => {
    const answer = this.counts.myTasks();
    return answer.state === 'ready' ? answer.value.matching : 0;
  });

  /** "2 overdue", only when the overdue count is known and above 0. */
  readonly overdueLabel = computed(() => {
    this.translate.currentLang();
    const overdue = this.counts.myOverdue();
    return overdue.state === 'ready' && overdue.value > 0 ? this.format.count('home.overdueTasks', overdue.value) : null;
  });

  readonly rows = computed<TaskRow[]>(() => {
    this.translate.currentLang();
    const answer = this.counts.myTasks();
    if (answer.state !== 'ready') return [];
    const now = new Date();
    return answer.value.items.map((t) => this.toRow(t, now));
  });

  retry(): void {
    this.counts.loadMyTasks();
    this.counts.loadMyOverdue();
  }

  private toRow(t: ITaskRecordRowDto, now: Date): TaskRow {
    const late = isTaskOverdue(t, now);
    const held = t.status === 'ON_HOLD';
    return {
      id: t.id,
      title: t.title,
      record: this.recordLine(t),
      late,
      held,
      due: held && t.onHoldUntil
        ? this.translate.instant('home.onHoldUntil', { date: this.format.date(t.onHoldUntil) })
        : late && t.dueAt
          ? this.translate.instant('home.overdueFor', { duration: this.format.elapsed(t.dueAt, now) })
          : t.dueAt
            ? this.translate.instant('home.dueOn', { date: this.format.dateTime(t.dueAt) })
            : this.translate.instant('home.noDueDate'),
    };
  }

  /** "Committee · {name}", or the type alone where the server did not name it. */
  private recordLine(t: ITaskRecordRowDto): string {
    if (!t.record) return this.translate.instant('taskPage.recordType.OTHER');
    const type = this.translate.instant(taskRecordTypeKey(t.record.type)) as string;
    return t.record.nameEn ? `${type} · ${this.language.bilingual(t.record.nameEn, t.record.nameAr)}` : type;
  }
}
