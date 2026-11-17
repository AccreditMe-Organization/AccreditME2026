import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { AmDateTimePipe, FormatService } from '../../../../core/formatting';
import { ITaskSlaChange, TaskSlaPriority } from '../../../tenant/services/tenant.service';
import { TaskSlaFieldChange, TaskSlaValue, diffTaskSlaChange } from './task-sla-change';
import { isWarnBeforeDue, warnOptionLabel } from './task-sla-warning';

// Literal keys, so the translation-keys spec sees each one.
const PRIORITY_KEYS: Record<TaskSlaPriority, string> = {
  LOW: 'task.priority.low',
  MEDIUM: 'task.priority.medium',
  HIGH: 'task.priority.high',
  CRITICAL: 'task.priority.critical',
};

const FIELD_KEYS: Record<TaskSlaFieldChange['field'], string> = {
  dueAfterHours: 'adminSettings.taskSlaPage.fields.dueAfterHours',
  warnBeforeDue: 'adminSettings.taskSlaPage.fields.warnBeforeDue',
  managerEscalationAfterHours: 'adminSettings.taskSlaPage.fields.managerEscalationAfterHours',
  headEscalationAfterHours: 'adminSettings.taskSlaPage.fields.headEscalationAfterHours',
  notifyOnDueChange: 'adminSettings.taskSlaPage.fields.notifyOnDueChange',
};

const KIND_KEYS: Record<ITaskSlaChange['kind'], string> = {
  limits: 'adminSettings.taskSlaPage.limits.title',
  escalation: 'adminSettings.taskSlaPage.escalation.title',
  all: 'adminSettings.taskSlaPage.history.kindAll',
  notices: 'adminSettings.taskSlaPage.notices.title',
  reset: 'adminSettings.taskSlaPage.history.kindReset',
  legacy: 'adminSettings.taskSlaPage.history.kindAll',
};

/**
 * ACC-313 — the Task SLA page's change history: the body of its list dialog.
 *
 * Each saved change names its section and lists only the values that moved,
 * old and new with their units. A save from before ACC-313 has no values
 * (`legacy`) and says so rather than showing nothing. Load more asks the next
 * 20; a failure keeps what is shown and offers Retry. The page owns the reads.
 */
@Component({
  selector: 'am-task-sla-history',
  standalone: true,
  imports: [TranslatePipe, AmDateTimePipe, ButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="am-slah" data-testid="sla-history">
      <ol class="am-slah__list">
        @for (change of rows(); track change.id) {
          <li class="am-slah__entry" [attr.data-change-kind]="change.kind">
            <div class="am-slah__meta">
              <span data-sla-changed-at>{{ change.changedAt | amDateTime }}</span>
              <span>{{ change.actorName || notRecorded() }}</span>
              <span>{{ kindKeys[change.kind] | translate }}</span>
            </div>
            @if (change.kind === 'legacy') {
              <p class="am-slah__none">{{ 'adminSettings.taskSlaPage.history.legacy' | translate }}</p>
            } @else if (fieldsOf(change).length === 0) {
              <p class="am-slah__none">{{ 'adminSettings.taskSlaPage.history.noFieldsChanged' | translate }}</p>
            } @else {
              <ul class="am-slah__fields">
                @for (f of fieldsOf(change); track (f.priority ?? '') + f.field) {
                  <!-- The meaning is in words as well as decoration: <del>/<ins>
                       and the visually hidden was/now, as on the calendar's history. -->
                  <li>
                    <span class="am-slah__label">{{ changeLabel(f) }}</span>
                    <del class="am-slah__from"><span class="sr-only">{{ 'adminSettings.taskSlaPage.history.was' | translate }}</span>{{ valueText(f.field, f.from) }}</del>
                    <span class="am-slah__arrow" aria-hidden="true">→</span>
                    <ins class="am-slah__to"><span class="sr-only">{{ 'adminSettings.taskSlaPage.history.now' | translate }}</span>{{ valueText(f.field, f.to) }}</ins>
                  </li>
                }
              </ul>
            }
          </li>
        }
      </ol>
      @if (more() === 'failed') {
        <p class="am-slah__foot" role="alert">
          <span>{{ 'adminSettings.taskSlaPage.historyFailed' | translate }}</span>
          <p-button [label]="'common.retry' | translate" severity="secondary" size="small" (onClick)="loadMore.emit()" />
        </p>
      } @else if (rows().length < total()) {
        <p class="am-slah__foot">
          <p-button
            [label]="(more() === 'loading' ? 'record.loadingMore' : 'record.loadMore') | translate"
            severity="secondary"
            size="small"
            [loading]="more() === 'loading'"
            data-testid="sla-history-more"
            (onClick)="loadMore.emit()"
          />
        </p>
      }
    </div>
  `,
  styles: [
    `
      .am-slah{flex:1 1 auto;min-block-size:0;overflow-y:auto;padding:var(--am-space-16) var(--am-space-20)}
      .am-slah__list{display:flex;flex-direction:column;gap:var(--am-space-12);margin:0;padding:0;list-style:none}
      .am-slah__entry{padding-block-end:var(--am-space-12);border-block-end:1px solid var(--am-border)}
      .am-slah__meta{display:flex;flex-wrap:wrap;gap:var(--am-space-8);font-size:var(--am-type-meta-size);color:var(--am-ink-500)}
      .am-slah__fields{margin:var(--am-space-4) 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:var(--am-space-2);font-size:var(--am-type-meta-size)}
      .am-slah__fields li{display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--am-space-6)}
      .am-slah__label{font-weight:500;color:var(--am-ink-900)}
      .am-slah__arrow{display:inline-block;color:var(--am-ink-500)}
      :dir(rtl) .am-slah__arrow{transform:scaleX(-1)}
      .am-slah__from{color:var(--am-ink-500);text-decoration:line-through}
      .am-slah__to{color:var(--am-ink-900);font-weight:500;text-decoration:none}
      .am-slah__none{margin:var(--am-space-4) 0 0;font-size:var(--am-type-meta-size);color:var(--am-ink-500)}
      .am-slah__foot{display:flex;flex-wrap:wrap;align-items:center;gap:var(--am-space-8);margin:var(--am-space-12) 0 0;font-size:var(--am-type-meta-size);color:var(--am-ink-700)}
    `,
  ],
})
export class TaskSlaHistoryComponent {
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);

  readonly rows = input.required<ITaskSlaChange[]>();
  readonly total = input.required<number>();
  readonly more = input<'idle' | 'loading' | 'failed'>('idle');
  readonly loadMore = output<void>();

  readonly kindKeys = KIND_KEYS;

  fieldsOf(change: ITaskSlaChange): TaskSlaFieldChange[] {
    return diffTaskSlaChange(change.before, change.after);
  }

  /** "High · Due after"; the switch, which belongs to no priority, by its own name. */
  changeLabel(f: TaskSlaFieldChange): string {
    if (f.priority === null) return this.translate.instant(FIELD_KEYS[f.field]);
    return this.translate.instant('adminSettings.taskSlaPage.history.fieldLabel', {
      priority: this.translate.instant(PRIORITY_KEYS[f.priority]),
      field: this.translate.instant(FIELD_KEYS[f.field]),
    });
  }

  /**
   * A value as a person reads it: limits in working hours, a warning by its
   * option's name, the switch On or Off. Escalation hours stay "hours": an
   * entry saved before escalation counted working hours (PR 4) was clock
   * hours, and the row does not say which.
   */
  valueText(field: TaskSlaFieldChange['field'], value: TaskSlaValue | null): string {
    if (value === null) return this.notRecorded();
    if (field === 'notifyOnDueChange') return this.translate.instant(value === true ? 'common.on' : 'common.off');
    if (field === 'warnBeforeDue') return isWarnBeforeDue(value) ? warnOptionLabel(value, this.translate, this.format) : String(value);
    if (typeof value !== 'number') return String(value);
    return field === 'dueAfterHours' ? this.format.count('workflow.workingHours', value) : this.format.count('taskSla.hours', value);
  }

  notRecorded(): string {
    return this.translate.instant('common.notRecorded');
  }
}
