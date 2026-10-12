import { Component, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { OpenStageTask, OpenStageTaskPool } from '../../workflow-refusal';

/**
 * ACC-208 — "Can't move yet": the open mandatory tasks holding a record in its
 * stage (STAGE_TASKS_OPEN), as a 420 Confirm with Close only (drawing section
 * 3.2). Each task is a link with one line under it: who has it, or the pool it
 * waits in; when it is due; Mandatory; and whether it needs evidence.
 *
 * ## Standalone, so the vote screen can reuse it
 *
 * The same refusal answers a deciding approval vote (ACC-190, 9 Oct, J), which
 * the drawing titles "Your vote isn't recorded yet". No vote screen exists today
 * — `WorkflowService.submitApproval()` has no frontend caller — so the title
 * and lead are inputs: the transition button passes its own, and a vote screen
 * will pass its own.
 *
 * ## Where a link goes (Ahmad, 12 Oct, D2)
 *
 * There is no task page. A link goes to the task's row on the record's own
 * page: the current route with `?task=<id>`, which the record page reads to
 * scroll to the row, focus it and highlight it. Following one closes this
 * dialog.
 */
@Component({
  selector: 'app-cant-move-dialog',
  standalone: true,
  imports: [EditDialogComponent, ButtonModule, RouterLink, TranslatePipe],
  template: `
    <ng-template #body>
      <p class="am-cant-move__lead">{{ lead() }}</p>
      <ul class="am-cant-move__list">
        @for (task of tasks(); track task.id) {
          <li class="am-cant-move__task" data-cant-move-task>
            <a
              [routerLink]="[]"
              [queryParams]="{ task: task.id }"
              queryParamsHandling="merge"
              (click)="closed.emit()"
            >{{ titleOf(task) }}</a>
            <span class="am-cant-move__meta">{{ metaOf(task) }}</span>
          </li>
        }
      </ul>
    </ng-template>
    <ng-template #footer>
      <div class="am-cant-move__footer">
        @if (openedFrom()) {
          <span class="am-cant-move__from">{{ 'workflow.cantMove.openedFrom' | translate: { transition: openedFrom() } }}</span>
        } @else {
          <span></span>
        }
        <p-button [label]="'common.close' | translate" (onClick)="closed.emit()" data-cant-move-close />
      </div>
    </ng-template>
    <app-edit-dialog
      [visible]="visible()"
      (visibleChange)="$event || closed.emit()"
      [header]="title()"
      [context]="context()"
      role="alertdialog"
      size="confirm"
      [content]="body"
      [footer]="footer"
    />
  `,
  styles: [
    `
      .am-cant-move__lead {
        margin: 0;
      }
      .am-cant-move__list {
        list-style: none;
        margin: var(--am-space-4) 0 0;
        padding: 0;
      }
      .am-cant-move__task {
        display: flex;
        flex-direction: column;
        padding-block: var(--am-space-6);
        border-block-end: 1px solid var(--am-border);
      }
      .am-cant-move__task a {
        font-weight: 600;
        color: var(--am-primary-600);
        text-decoration: none;
      }
      .am-cant-move__task a:hover {
        text-decoration: underline;
      }
      .am-cant-move__meta,
      .am-cant-move__from {
        font-size: var(--am-type-meta-size);
        color: var(--am-ink-700);
      }
      .am-cant-move__footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--am-space-8);
        inline-size: 100%;
      }
    `,
  ],
})
export class CantMoveDialogComponent {
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly format = inject(FormatService);

  readonly visible = input(false);
  readonly tasks = input<OpenStageTask[]>([]);
  /** "Can't move to Active yet" — or, for a vote, "Your vote isn't recorded yet". */
  readonly title = input.required<string>();
  /** "Finish these tasks before moving to Active:" */
  readonly lead = input.required<string>();
  /** The record and its stage, under the title. */
  readonly context = input('');
  /** The transition (or vote) that was refused. */
  readonly openedFrom = input<string | null>(null);

  readonly closed = output<void>();

  titleOf(task: OpenStageTask): string {
    return this.language.bilingual(task.title, task.titleAr);
  }

  /** "Nora Al-Otaibi (Quality Officer, Cardiology) · due 12 Oct 2026, 13:00 · Mandatory · evidence required" */
  metaOf(task: OpenStageTask): string {
    const pool = task.pool ? this.poolWords(task.pool) : null;
    const who = task.assignees.length
      ? task.assignees.map((a) => a.name).join(this.translate.instant('common.listSeparator')) + (pool ? ` (${pool})` : '')
      : pool
        ? this.translate.instant('workflow.cantMove.waitingFor', { pool })
        : this.translate.instant('workflow.cantMove.nobody');
    const due = task.dueAt
      ? this.translate.instant('workflow.cantMove.due', { date: this.format.dateTime(task.dueAt) })
      : this.translate.instant('workflow.cantMove.noDue');
    return [
      who,
      due,
      this.translate.instant('workflow.stageTasks.mandatory'),
      ...(task.requiresEvidence ? [this.translate.instant('workflow.cantMove.evidence')] : []),
    ].join(' · ');
  }

  private poolWords(pool: OpenStageTaskPool): string {
    if (pool.kind === 'POSITION') {
      return this.translate.instant('workflow.stageTasks.route.position', {
        position: this.language.bilingual(pool.position.nameEn, pool.position.nameAr),
        unit: this.language.bilingual(pool.orgUnit.nameEn, pool.orgUnit.nameAr),
      });
    }
    return this.translate.instant('workflow.stageTasks.route.committee', {
      role: this.language.bilingual(pool.role.labelEn, pool.role.labelAr),
      committee: this.language.bilingual(pool.committee.nameEn, pool.committee.nameAr),
    });
  }
}
