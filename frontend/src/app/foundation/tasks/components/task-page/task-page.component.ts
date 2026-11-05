import { Component, DestroyRef, OnDestroy, computed, effect, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Observable, map, of } from 'rxjs';
import { AmDateTimePipe, FormatService } from '../../../../core/formatting';
import { FormatContext } from '../../../../core/formatting/format-context';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { LanguageService } from '../../../../core/services/language.service';
import { registerPageName } from '../../../../core/services/document-title.service';
import { BreadcrumbParentService } from '../../../../core/navigation/breadcrumb-parent.service';
import { createRequestOutcome } from '../../../../core/request-outcome/request-outcome';
import { RecordPanelComponent } from '../../../../shared/components/record-panel/record-panel.component';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import {
  ITaskActionsDto,
  ITaskHistoryEventDto,
  ITaskPagePersonDto,
  ITaskPageViewDto,
  TaskRequestForDecisionDto,
  TaskRequestType,
  TaskService,
} from '../../services/task.service';
import { displayStatus, isTaskOverdue, taskStatusLabelKey, taskStatusSeverity } from '../../task-status';
import { taskPriorityGlyph, taskRecordHref } from '../../task-row-display';
import { taskPoolLabel } from '../../task-pool-label';
import { TaskEvidenceListComponent } from '../task-evidence-list/task-evidence-list.component';
import { TaskAddEvidenceDialogComponent } from '../task-add-evidence-dialog/task-add-evidence-dialog.component';
import { TaskRejectDialogComponent } from '../task-reject-dialog/task-reject-dialog.component';
import { TaskReleaseDialogComponent } from '../task-release-dialog/task-release-dialog.component';
import { TaskRequestDialogComponent } from '../task-request-dialog/task-request-dialog.component';
import { TaskRequestDecisionDialogComponent } from '../task-request-decision-dialog/task-request-decision-dialog.component';
import { TaskReassignDialogComponent } from '../task-reassign-dialog/task-reassign-dialog.component';
import { TaskEditDialogComponent } from '../task-edit-dialog/task-edit-dialog.component';
import { TaskCancelDialogComponent } from '../task-cancel-dialog/task-cancel-dialog.component';
import { TaskReopenDialogComponent } from '../task-reopen-dialog/task-reopen-dialog.component';
import { TASK_ACTION_LABELS, TaskActionId, taskPrimaryActionId } from '../../task-row-actions';

// ACC-229 — the labels and the main-action mapping are shared with the record
// Tasks panel and the All tasks list (task-row-actions.ts); where each action
// sits on THIS page is decided below.
type ActionId = TaskActionId;

interface PageAction {
  id: ActionId;
  labelKey: string;
  danger?: boolean;
  disabled?: boolean;
}

const LABELS = TASK_ACTION_LABELS;

/**
 * ACC-120 slice 4 — the status as the design tones it (Task Screens' ST):
 * from taskStatusSeverity, with the two cases the design draws apart. A
 * waiting pool task reads in a paler blue; On hold and Cancelled are grey;
 * Assigned and Completed have no dot, and Completed reads "Completed ✓".
 * Tokens only; the classes are Tailwind utilities, so the styles keep to
 * their budget.
 */
interface StatusTone {
  dot: string | null;
  ink: string;
  done: boolean;
}
const INK_PLAIN = 'text-[var(--am-ink-700)]';
const INK_GREY = 'text-[var(--am-ink-700)] font-medium';
const INK_PRIMARY = 'text-[var(--am-primary-700)] font-medium';
const INK_WARNING = 'text-[var(--am-warning-ink)] font-medium';
const DOT_PRIMARY = 'bg-[var(--am-primary-600)]';
const DOT_WAITING = 'bg-[color-mix(in_srgb,var(--am-primary-600)_60%,var(--am-surface-raised))]';
const DOT_WARNING = 'bg-[var(--am-warning-ink)]';
const DOT_GREY = 'bg-[var(--am-ink-300)]';

// Shown as buttons beside the main one, at most two, in this order.
const SECONDARY_ORDER: ActionId[] = ['addEvidence', 'edit', 'reassign'];
// Everything else, in the ⋯ menu: the assignee's own work first, then the
// creator's, then the rest (Record Tasks Panel §4's menu order).
const MENU_ORDER: ActionId[] = [
  'complete',
  'start',
  'resume',
  'addEvidence',
  'requestMoreTime',
  'requestHold',
  'withdrawRequest',
  'reject',
  'release',
  'pickUp',
  'reviewRequest',
  'reassign',
  'edit',
  'cancel',
  'reopen',
];

type PageState =
  | { kind: 'loading' }
  | { kind: 'ready'; view: ITaskPageViewDto }
  | { kind: 'notFound' }
  | { kind: 'error'; errorId: string | null };

/**
 * ACC-228 — A TASK'S OWN PAGE, /tasks/:id (Task Screens §1).
 *
 * A small record page: a header with the task's status, priority and due date
 * and the viewer's actions; four relations (About, With, Created by,
 * Evidence); then two columns — description and evidence; the open request,
 * any rejection, cancellation or reopening, and history.
 *
 * WHO SEES IT is the server's answer (Q4) and nothing here re-decides it: a
 * task the viewer may not open and a task that does not exist both arrive as
 * the same 404, and render the same not-found state — so this page can never
 * say which.
 *
 * WHAT THE VIEWER MAY DO is the server's `actions`, computed from the rules
 * each action's endpoint applies. Every action reuses the dialog the rest of
 * the app uses; the page only decides where each one sits: the main next step
 * as a filled button, up to two more beside it, the rest in a worded ⋯ menu on
 * the CDK menu (reposition strategy — it cannot be cut off by a scroll).
 */
@Component({
  selector: 'app-task-page',
  standalone: true,
  imports: [
    RouterLink,
    TranslatePipe,
    AmDateTimePipe,
    CdkMenu,
    CdkMenuItem,
    CdkMenuTrigger,
    RecordPanelComponent,
    TaskEvidenceListComponent,
    TaskAddEvidenceDialogComponent,
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
    @switch (state().kind) {
      @case ('loading') {
        <div class="flex flex-col gap-3 max-w-[1280px]" aria-busy="true">
          <span class="sr-only" aria-live="polite">{{ 'taskPage.loading' | translate }}</span>
          <div class="h-[34px] w-3/5 rounded bg-[var(--am-surface)]"></div>
          <div class="h-5 w-2/5 rounded bg-[var(--am-surface)]"></div>
          <div class="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr))]" data-testid="task-skeleton-strip">
            @for (i of skeletonCells; track i) {
              <div class="h-[62px] rounded bg-[var(--am-surface)]"></div>
            }
          </div>
          <div class="grid gap-3 items-start [grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr))]">
            <div class="h-40 rounded bg-[var(--am-surface)]"></div>
            <div class="h-40 rounded bg-[var(--am-surface)]"></div>
          </div>
        </div>
      }

      @case ('notFound') {
        <div class="flex flex-col items-start gap-2 py-6" data-testid="task-not-found">
          <h1 class="am-tp__title">{{ 'taskPage.notFound.title' | translate }}</h1>
          <p class="m-0 max-w-[72ch] text-[var(--am-ink-700)]">{{ 'taskPage.notFound.body' | translate }}</p>
          <a class="am-tp__link" routerLink="/tasks">{{ 'taskPage.notFound.back' | translate }}</a>
        </div>
      }

      @case ('error') {
        <div class="flex flex-col items-start gap-2 py-6" role="alert">
          <h1 class="am-tp__title">{{ 'taskPage.error.title' | translate }}</h1>
          @if (errorId(); as id) {
            <p class="m-0 max-w-[72ch] text-[var(--am-ink-700)]">{{ 'recordPanel.errorId' | translate: { id } }}</p>
          }
          <button type="button" class="am-tp-btn" (click)="load()">{{ 'list.retry' | translate }}</button>
        </div>
      }

      @case ('ready') {
        @if (view(); as v) {
          <article class="flex flex-col gap-3 max-w-[1280px]" data-testid="task-page">
            <header class="flex flex-wrap items-start justify-between gap-3">
              <div class="flex-[1_1_520px] min-w-0">
                <div class="am-tp__kicker">{{ 'taskPage.kicker' | translate }}</div>
                <h1 class="am-tp__title" tabindex="-1" #heading>{{ title() }}</h1>
                <div class="am-tp__meta-row flex flex-wrap items-center gap-x-3.5 gap-y-2 mt-1.5 text-[13px] text-[var(--am-ink-700)]">
                  <span class="inline-flex items-center" [class]="statusTone().ink" data-testid="task-status">
                    @if (statusTone().dot; as dot) {
                      <span class="w-1.5 h-1.5 rounded-full me-1.5 flex-none" [class]="dot" aria-hidden="true" data-testid="task-status-dot"></span>
                    }
                    {{ statusKey() | translate }}@if (statusTone().done) {<span aria-hidden="true">&nbsp;✓</span>}
                  </span>
                  @if (overdue()) {
                    <span class="am-tp__flag">{{ 'task.overdueBadge' | translate }}</span>
                  }
                  <!-- Text, never colour: a glyph on High and Critical. -->
                  <span data-testid="task-priority">
                    @if (priorityGlyph(); as glyph) {<span aria-hidden="true">{{ glyph }}&nbsp;</span>}{{ 'taskPage.priority' | translate: { priority: (priorityKey() | translate) } }}
                  </span>
                  <span data-testid="task-due">
                    @if (v.task.dueAt) {
                      <!-- The date reads in the page's direction (an Arabic month
                           must not be turned around); only the time and its
                           offset are one left-to-right run, so "+03" stays beside it. -->
                      {{ 'taskPage.due' | translate }}
                      <bdi class="font-semibold" data-testid="task-due-date">{{ dueDate() }}</bdi>{{ dueSeparator() }}<span dir="ltr" class="[unicode-bidi:isolate]" data-testid="task-due-time"><span class="font-semibold">{{ dueTime() }}</span><span class="text-[var(--am-ink-500)]">&nbsp;{{ zoneOffset() }}</span></span>
                    } @else {
                      {{ 'taskPage.noDue' | translate }}
                    }
                  </span>
                  @if (v.task.status === 'ON_HOLD' && v.task.onHoldUntil) {
                    <span class="text-[var(--am-ink-500)]">
                      {{ 'taskPage.onHoldUntil' | translate: { date: (v.task.onHoldUntil | amDateTime) } }}
                    </span>
                  }
                </div>
              </div>

              @if (primary() || secondaries().length || menuActions().length) {
                <div class="flex flex-wrap items-center gap-2" data-testid="task-actions">
                  @if (primary(); as a) {
                    <button
                      type="button"
                      class="am-tp-btn am-tp-btn--primary"
                      [disabled]="a.disabled || busy()"
                      [attr.aria-describedby]="a.disabled ? 'am-tp-complete-why' : null"
                      [attr.data-action]="a.id"
                      (click)="run(a.id)"
                    >
                      {{ a.labelKey | translate }}
                    </button>
                  }
                  @for (a of secondaries(); track a.id) {
                    <button
                      type="button"
                      class="am-tp-btn"
                      [disabled]="busy()"
                      [attr.data-action]="a.id"
                      (click)="run(a.id)"
                    >
                      {{ a.labelKey | translate }}
                    </button>
                  }
                  @if (menuActions().length) {
                    <button
                      type="button"
                      class="am-tp-btn am-tp-btn--more"
                      [cdkMenuTriggerFor]="moreMenu"
                      [attr.aria-label]="'taskPage.action.moreFor' | translate: { title: title() }"
                      data-testid="task-more"
                    >
                      <i class="pi pi-ellipsis-h" aria-hidden="true"></i>
                    </button>
                  }
                </div>
              }
            </header>

            @if (completeWaits()) {
              <p id="am-tp-complete-why" class="m-0 text-xs text-[var(--am-warning-ink)]">{{ 'task.completeNeedsEvidence' | translate }}</p>
            }
            @if (actionError(); as message) {
              <p class="m-0 text-[12.5px] text-[var(--am-danger-ink)]" role="alert">{{ message }}</p>
            }

            <dl class="am-tp__strip">
              <div class="am-tp__cell">
                <dt class="am-tp__label">{{ 'taskPage.about' | translate }}</dt>
                <dd class="am-tp__value" data-testid="task-about">
                  <span class="text-[var(--am-ink-500)]" aria-hidden="true">◇&nbsp;</span>
                  @if (recordLink(); as link) {
                    <a class="am-tp__link" [routerLink]="link" data-testid="task-about-link">{{ recordName() }}</a>
                  } @else {
                    {{ recordName() }}
                  }
                </dd>
                <dd class="am-tp__sub">{{ recordSub() }}</dd>
              </div>
              <div class="am-tp__cell">
                <dt class="am-tp__label">{{ 'taskPage.with' | translate }}</dt>
                <dd class="am-tp__value">{{ withLine() }}</dd>
                @if (withSub(); as sub) {
                  <dd class="am-tp__sub">{{ sub }}</dd>
                }
              </div>
              <div class="am-tp__cell">
                <dt class="am-tp__label">{{ 'taskPage.createdBy' | translate }}</dt>
                <dd class="am-tp__value">{{ v.createdBy.name }}</dd>
                <dd class="am-tp__sub">{{ createdSub() }}</dd>
              </div>
              <div class="am-tp__cell">
                <dt class="am-tp__label">{{ 'taskPage.evidence' | translate }}</dt>
                <dd class="am-tp__value" [class.am-tp__value--warn]="v.task.requiresEvidence && v.task.evidenceCount === 0">
                  {{ evidenceLine() }}
                </dd>
                @if (completeLine(); as line) {
                  <dd class="am-tp__sub">{{ line | translate }}</dd>
                }
              </div>
            </dl>

            <div class="grid gap-3 items-start [grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr))]">
              <div class="flex flex-col gap-3 min-w-0">
                <section class="am-tp__panel" aria-labelledby="am-tp-description">
                  <h2 class="am-tp__panel-title" id="am-tp-description">{{ 'taskPage.description' | translate }}</h2>
                  <p class="am-tp__panel-body whitespace-pre-wrap [overflow-wrap:anywhere]">{{ v.task.description || ('taskPage.noDescription' | translate) }}</p>
                </section>
                <div class="am-tp__panel">
                  <app-task-evidence-list
                    [taskId]="v.task.id"
                    [requiresEvidence]="v.task.requiresEvidence"
                    [showAdd]="v.actions.addEvidence"
                    (addRequested)="open('addEvidence')"
                    (changed)="reload()"
                  />
                </div>
              </div>

              <div class="flex flex-col gap-3 min-w-0">
                @if (v.task.openRequest; as r) {
                  <section class="am-tp__panel am-tp__panel--request" aria-labelledby="am-tp-request" data-testid="task-open-request">
                    <h2 class="am-tp__panel-title am-tp__panel-title--warn flex flex-wrap items-baseline justify-between gap-2" id="am-tp-request">
                      <span>{{ 'taskPage.openRequest' | translate }}</span>
                      <span class="normal-case tracking-normal font-normal" data-testid="task-request-note">{{ 'taskPage.request.oneAtATime' | translate }}</span>
                    </h2>
                    <div class="am-tp__panel-body">
                      <p class="font-semibold">{{ requestHeadline() }}</p>
                      <p class="text-[12.5px] text-[var(--am-info-ink)]">{{ requestEffect() }}</p>
                      <p class="am-tp__meta">
                        {{ 'taskPage.request.askedBy' | translate: { name: r.requestedByName, when: (r.createdAt | amDateTime) } }}
                      </p>
                      <!-- The reason as typed, isolated between the reading
                           language's quote marks. -->
                      <p class="am-tp__quote" data-testid="task-request-reason">{{ 'tasks.sections.quoteOpen' | translate }}<bdi>{{ r.reason }}</bdi>{{ 'tasks.sections.quoteClose' | translate }}</p>
                      @if (v.actions.reviewRequest || v.actions.withdrawRequest) {
                        <div class="flex flex-wrap items-center gap-2">
                          @if (v.actions.reviewRequest) {
                            <!-- One button, the existing decision dialog: no one-click Approve. -->
                            <button type="button" class="am-tp-btn am-tp-btn--primary" (click)="run('reviewRequest')" data-testid="task-decide">
                              {{ decideKey() | translate }}
                            </button>
                          }
                          @if (v.actions.withdrawRequest) {
                            <button type="button" class="am-tp-btn" [disabled]="busy()" (click)="run('withdrawRequest')">
                              {{ 'taskPage.action.withdrawRequest' | translate }}
                            </button>
                          }
                        </div>
                      }
                    </div>
                  </section>
                }

                @if (closingNote(); as note) {
                  <section class="am-tp__panel" aria-labelledby="am-tp-closing">
                    <h2 class="am-tp__panel-title" id="am-tp-closing">{{ note.titleKey | translate }}</h2>
                    <div class="am-tp__panel-body">
                      <p class="am-tp__meta">{{ note.line }}</p>
                      @if (note.reason) {
                        <p class="am-tp__quote">{{ 'tasks.sections.quoteOpen' | translate }}<bdi>{{ note.reason }}</bdi>{{ 'tasks.sections.quoteClose' | translate }}</p>
                      }
                    </div>
                  </section>
                }

                <app-record-panel
                  [heading]="'taskPage.history' | translate"
                  [emptyMessage]="'taskPage.historyEmpty' | translate"
                  [outcome]="history.outcome()"
                  [bodyHeight]="120"
                  (retry)="history.retry()"
                >
                  <ol class="list-none m-0 p-0">
                    @for (event of historyRows(); track $index) {
                      <li class="am-tp__event" data-testid="task-event">
                        <time class="am-tp__when" [attr.datetime]="event.at" data-testid="task-event-when">{{ eventWhen(event) }}</time>
                        <span class="flex flex-col min-w-0 [overflow-wrap:anywhere]">
                          <span class="font-medium" data-testid="task-event-what">{{ historyLine(event) }}</span>
                          @if (event.reason) {
                            <span class="am-tp__meta">{{ 'tasks.sections.quoteOpen' | translate }}<bdi>{{ event.reason }}</bdi>{{ 'tasks.sections.quoteClose' | translate }}</span>
                          }
                        </span>
                      </li>
                    }
                  </ol>
                </app-record-panel>
              </div>
            </div>
          </article>

          <ng-template #moreMenu>
            <div cdkMenu class="am-tp-menu" data-testid="task-more-menu">
              @for (a of menuActions(); track a.id) {
                <button
                  type="button"
                  cdkMenuItem
                  class="am-tp-menu__item"
                  [class.am-tp-menu__item--danger]="a.danger"
                  [cdkMenuItemDisabled]="!!a.disabled"
                  [attr.data-action]="a.id"
                  (cdkMenuItemTriggered)="run(a.id)"
                >
                  {{ a.labelKey | translate }}
                  @if (a.disabled && a.id === 'complete') {
                    <span class="block text-xs text-[var(--am-ink-500)]">{{ 'task.completeNeedsEvidence' | translate }}</span>
                  }
                </button>
              }
            </div>
          </ng-template>

          <app-task-add-evidence-dialog
            [visible]="dialog() === 'addEvidence'"
            (visibleChange)="onDialogVisible($event)"
            [task]="v.task"
            (added)="reload()"
          />
          <app-task-reject-dialog
            [visible]="dialog() === 'reject'"
            (visibleChange)="onDialogVisible($event)"
            [task]="v.task"
            (rejected)="reload()"
          />
          <app-task-release-dialog
            [visible]="dialog() === 'release'"
            (visibleChange)="onDialogVisible($event)"
            [task]="v.task"
            (released)="reload()"
          />
          <app-task-request-dialog
            [visible]="dialog() === 'request'"
            (visibleChange)="onDialogVisible($event)"
            [task]="v.task"
            [type]="requestType()"
            (requested)="reload()"
          />
          <app-task-request-decision-dialog
            [visible]="dialog() === 'decision'"
            (visibleChange)="onDialogVisible($event)"
            [request]="decisionRequest()"
            (decided)="reload()"
          />
          <app-task-reassign-dialog
            [visible]="dialog() === 'reassign'"
            (visibleChange)="onDialogVisible($event)"
            [task]="v.task"
            [rejection]="rejection()"
            [recordName]="recordName()"
            [committeeName]="v.record.type === 'COMMITTEE' && v.record.nameEn ? recordName() : null"
            (reassigned)="reload()"
          />
          <app-task-edit-dialog
            [visible]="dialog() === 'edit'"
            (visibleChange)="onDialogVisible($event)"
            [task]="v.task"
            (edited)="reload()"
          />
          <app-task-cancel-dialog
            [visible]="dialog() === 'cancel'"
            (visibleChange)="onDialogVisible($event)"
            [task]="v.task"
            (cancelledTask)="reload()"
          />
          <app-task-reopen-dialog
            [visible]="dialog() === 'reopen'"
            (visibleChange)="onDialogVisible($event)"
            [task]="v.task"
            (reopened)="reload()"
          />
        }
      }
    }
  `,
  styles: [
    `
      .am-tp__kicker,.am-tp__label,.am-tp__panel-title{font-size:var(--am-type-micro-size);line-height:var(--am-type-micro-line);font-weight:var(--am-type-micro-weight);letter-spacing:var(--am-type-micro-tracking);text-transform:var(--am-type-micro-transform);color:var(--am-ink-500)}
      .am-tp__title{margin:0;font-size:28px;line-height:34px;font-weight:600;letter-spacing:-.015em;color:var(--am-ink-900);overflow-wrap:anywhere}
      .am-tp__title:focus{outline:none}
      :host-context([dir=rtl]) .am-tp__title{font-size:29px;line-height:40px;letter-spacing:0}
      .am-tp__flag{font-size:12px;font-weight:600;color:var(--am-danger-ink);background:var(--am-danger-bg);border:1px solid var(--am-danger-border);border-radius:var(--am-radius-pill);padding:0 8px}
      .am-tp__meta,.am-tp__sub,.am-tp__when{color:var(--am-ink-500)}
      .am-tp__meta{font-size:12px}
      .am-tp-btn{font:inherit;font-size:13px;font-weight:500;color:var(--am-ink-900);background:var(--am-surface-raised);border:1px solid var(--am-ink-500);border-radius:var(--am-radius-button);padding:7px 13px;cursor:pointer}
      .am-tp-btn--primary{color:var(--am-surface-raised);background:var(--am-primary-600);border-color:var(--am-primary-700);font-weight:600}
      .am-tp-btn--more{padding:7px 11px}
      .am-tp-btn:disabled{cursor:not-allowed;color:var(--am-ink-500);background:var(--am-surface);border-color:var(--am-border)}
      .am-tp-btn:focus-visible,.am-tp-menu__item:focus-visible,.am-tp__link:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
      .am-tp__link{color:var(--am-primary-700);text-decoration:none}
      .am-tp__strip{margin:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));border:1px solid var(--am-border);border-radius:var(--am-radius-card);background:var(--am-surface-raised)}
      .am-tp__cell{padding:9px 12px;border-inline-end:1px solid var(--am-border);min-width:0}
      .am-tp__cell:last-child{border-inline-end:0}
      .am-tp__value{margin:2px 0 0;font-size:14px;font-weight:500;color:var(--am-ink-900);overflow-wrap:anywhere}
      .am-tp__value--warn{color:var(--am-warning-ink)}
      .am-tp__sub{margin:0;font-size:11.5px}
      .am-tp__panel{background:var(--am-surface-raised);border:1px solid var(--am-border);border-radius:var(--am-radius-card);min-width:0}
      .am-tp__panel--request{border-color:var(--am-warning-border)}
      .am-tp__panel-title{margin:0;padding:9px 12px;border-block-end:1px solid var(--am-border)}
      .am-tp__panel-title--warn{color:var(--am-warning-ink);background:var(--am-warning-bg);border-color:var(--am-warning-border)}
      .am-tp__panel-body{margin:0;padding:10px 12px;display:flex;flex-direction:column;gap:4px;font-size:13.5px;color:var(--am-ink-900)}
      .am-tp__panel-body p{margin:0}
      .am-tp__quote{font-size:13px;color:var(--am-ink-700);background:var(--am-surface);border-radius:var(--am-radius-control);padding:8px 10px;overflow-wrap:anywhere}
      .am-tp__event{display:grid;grid-template-columns:92px 1fr;gap:10px;padding:6px 12px;border-block-end:1px solid var(--am-border);font-size:12.5px}
      :host-context([dir=rtl]) .am-tp__meta-row{font-size:14px}:host-context([dir=rtl]) .am-tp__sub{font-size:12.5px}
      .am-tp__when{font-size:11.5px;font-variant-numeric:tabular-nums}
      .am-tp-menu{min-width:220px;padding:4px 0;display:flex;flex-direction:column;background:var(--am-surface-raised);border:1px solid var(--am-border-strong);border-radius:var(--am-radius-card);box-shadow:var(--am-shadow-overlay)}
      .am-tp-menu__item{font:inherit;font-size:13px;text-align:start;color:var(--am-ink-900);background:none;border:0;padding:7px 14px;cursor:pointer}
      .am-tp-menu__item:hover{background:var(--am-primary-50)}
      .am-tp-menu__item[aria-disabled=true]{color:var(--am-ink-500);cursor:not-allowed}
      .am-tp-menu__item--danger{color:var(--am-danger-ink)}
    `,
  ],
})
export class TaskPageComponent implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly tasks = inject(TaskService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);
  private readonly language = inject(LanguageService);
  private readonly breadcrumb = inject(BreadcrumbParentService);
  private readonly formatContext = inject(FormatContext);
  private readonly access = inject(NavigationAccessService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly evidenceList = viewChild(TaskEvidenceListComponent);

  readonly taskId = signal<string | null>(null);
  readonly state = signal<PageState>({ kind: 'loading' });
  readonly busy = signal(false);
  readonly actionError = signal<string | null>(null);

  /** Which dialog is open, if any. One at a time. */
  readonly dialog = signal<'addEvidence' | 'reject' | 'release' | 'request' | 'decision' | 'reassign' | 'edit' | 'cancel' | 'reopen' | null>(null);
  readonly requestType = signal<TaskRequestType>('EXTENSION');

  readonly view = computed(() => {
    const s = this.state();
    return s.kind === 'ready' ? s.view : null;
  });
  readonly errorId = computed(() => {
    const s = this.state();
    return s.kind === 'error' ? s.errorId : null;
  });

  /**
   * History has its own request: if it fails, the History panel offers Retry
   * and the rest of the page stands (§1, "Partial").
   */
  readonly history = createRequestOutcome<ITaskHistoryEventDto>(
    () => {
      const id = this.taskId();
      return id ? this.tasks.getHistory(id) : of([]);
    },
    { describeEmpty: () => ({ reason: this.translate.instant('taskPage.historyEmpty'), filtered: false }) },
  );
  readonly historyRows = computed<readonly ITaskHistoryEventDto[]>(() => {
    const o = this.history.outcome();
    return o.status === 'rows' ? o.data : [];
  });

  readonly title = computed(() => {
    const v = this.view();
    if (!v) return '';
    const task = v.task as { title: string; titleAr?: string | null };
    return this.language.bilingual(task.title, task.titleAr ?? null);
  });

  readonly statusKey = computed(() => {
    const v = this.view();
    if (!v) return '';
    // A task waiting in its pool reads "Waiting to be picked up", not "Assigned".
    if (v.task.pool && v.assignees.length === 0 && v.task.status === 'PENDING') return 'taskPage.status.waiting';
    return taskStatusLabelKey(v.task);
  });
  readonly overdue = computed(() => {
    const v = this.view();
    return !!v && isTaskOverdue(v.task);
  });
  readonly priorityKey = computed(() => `task.priority.${(this.view()?.task.priority ?? 'MEDIUM').toLowerCase()}`);
  readonly priorityGlyph = computed(() => taskPriorityGlyph(this.view()?.task.priority ?? ''));
  protected readonly skeletonCells = [0, 1, 2, 3];

  readonly statusTone = computed<StatusTone>(() => {
    const v = this.view();
    if (!v) return { dot: null, ink: INK_PLAIN, done: false };
    if (this.statusKey() === 'taskPage.status.waiting') return { dot: DOT_WAITING, ink: INK_PRIMARY, done: false };
    const status = displayStatus(v.task.status);
    switch (taskStatusSeverity(v.task)) {
      case 'success':
        return { dot: null, ink: INK_PLAIN, done: true };
      case 'warn':
        return { dot: DOT_WARNING, ink: INK_WARNING, done: false };
      case 'info':
        return status === 'ON_HOLD' ? { dot: DOT_GREY, ink: INK_GREY, done: false } : { dot: DOT_PRIMARY, ink: INK_PRIMARY, done: false };
      default:
        return status === 'CANCELLED' ? { dot: DOT_GREY, ink: INK_GREY, done: false } : { dot: null, ink: INK_PLAIN, done: false };
    }
  });

  // "Due 15 Oct 2026, 17:00 +03": the date, then the time and the tenant's offset.
  readonly dueDate = computed(() => this.format.date(this.view()?.task.dueAt ?? null));
  readonly dueTime = computed(() => this.format.timeOfDay(this.view()?.task.dueAt ?? null));
  readonly dueSeparator = computed(() => (this.language.isArabic() ? '، ' : ', '));
  readonly zoneOffset = computed(() => this.format.zoneOffset(this.formatContext.timeZone()));

  /** The creator's button on the open request, by what was asked. */
  readonly decideKey = computed(() =>
    this.view()?.task.openRequest?.type === 'ON_HOLD' ? 'taskPage.request.decideHold' : 'taskPage.request.decideExtension',
  );

  // ── The action group ──────────────────────────────────────────────────

  private readonly enabled = computed<PageAction[]>(() => {
    const a = this.view()?.actions;
    if (!a) return [];
    return MENU_ORDER.filter((id) => a[id]).map((id) => ({
      id,
      labelKey: id === 'reviewRequest' ? this.decideKey() : LABELS[id],
      danger: id === 'cancel',
      disabled: id === 'complete' && a.completeNeedsEvidence,
    }));
  });
  /** The one next step, by the rule the record panel and the lists use (task-row-actions.ts). */
  readonly primary = computed<PageAction | null>(() => {
    const v = this.view();
    const id = v ? taskPrimaryActionId(v.actions, v.task.status) : null;
    return id ? (this.enabled().find((a) => a.id === id) ?? null) : null;
  });
  readonly secondaries = computed<PageAction[]>(() => {
    const primaryId = this.primary()?.id;
    return SECONDARY_ORDER.map((id) => this.enabled().find((a) => a.id === id))
      .filter((a): a is PageAction => !!a && a.id !== primaryId)
      .slice(0, 2);
  });
  readonly menuActions = computed<PageAction[]>(() => {
    const shown = new Set<ActionId>([...(this.primary() ? [this.primary()!.id] : []), ...this.secondaries().map((a) => a.id)]);
    return this.enabled().filter((a) => !shown.has(a.id));
  });
  readonly completeWaits = computed(() => {
    const a = this.view()?.actions;
    return !!a && a.complete && a.completeNeedsEvidence;
  });

  // ── The four relations ────────────────────────────────────────────────

  readonly recordName = computed(() => {
    const r = this.view()?.record;
    if (!r) return '';
    if (r.nameEn) return this.language.bilingual(r.nameEn, r.nameAr);
    return this.translate.instant(this.recordTypeKey(r.type));
  });
  readonly recordSub = computed(() => {
    const v = this.view();
    if (!v) return '';
    const type = this.translate.instant(this.recordTypeKey(v.record.type));
    // The type is said once: when the record cannot be opened it is already the name.
    const parts = v.record.nameEn ? [type] : [];
    if (v.stage) parts.push(this.language.bilingual(v.stage.nameEn, v.stage.nameAr));
    return parts.join(' · ');
  });
  /** By the one rule (task-row-display.ts): the record's page, for a viewer it admits. */
  readonly recordLink = computed<string[] | null>(() => {
    const r = this.view()?.record;
    return r?.canOpen ? taskRecordHref(r, (p) => this.access.hasPermission(p)) : null;
  });

  readonly withLine = computed(() => {
    const v = this.view();
    if (!v) return '';
    if (v.assignees.length) return v.assignees.map((a) => a.name).join(this.language.isArabic() ? '، ' : ', ');
    if (v.task.pool) {
      return this.translate.instant('taskPage.waitingFor', {
        pool: taskPoolLabel(v.task.pool, (en, ar) => this.language.bilingual(en, ar), this.language.isArabic()),
      });
    }
    return this.translate.instant('task.unassigned');
  });
  readonly withSub = computed<string | null>(() => {
    const v = this.view();
    if (!v) return null;
    if (v.assignees.length === 1) {
      const a = v.assignees[0]!;
      const parts = [this.placement(a)].filter((p) => p);
      if (a.pickedAt) parts.push(this.translate.instant('taskPage.pickedUpOn', { date: this.format.date(a.pickedAt) }));
      return parts.join(' · ') || null;
    }
    if (v.assignees.length === 0 && v.poolMemberCount !== null) {
      return this.format.count('taskPage.canPickUp', v.poolMemberCount);
    }
    return null;
  });
  readonly createdSub = computed(() => {
    const v = this.view();
    if (!v) return '';
    const place = this.placement(v.createdBy);
    const how = v.createdByWorkflow
      ? v.stage
        ? this.translate.instant('taskPage.byWorkflowStage', { stage: this.language.bilingual(v.stage.nameEn, v.stage.nameAr) })
        : this.translate.instant('taskPage.byWorkflow')
      : this.translate.instant('taskPage.byHand', { date: this.format.date(v.task.createdAt) });
    return [place, how].filter((p) => p).join(' · ');
  });
  readonly evidenceLine = computed(() => {
    const v = this.view();
    if (!v) return '';
    const added =
      v.task.evidenceCount === 0
        ? this.translate.instant('taskPage.evidenceNone')
        : this.format.count('task.evidenceAdded', v.task.evidenceCount);
    return `${this.translate.instant(v.task.requiresEvidence ? 'taskPage.evidenceRequired' : 'taskPage.evidenceNotRequired')} · ${added}`;
  });
  readonly completeLine = computed<string | null>(() => {
    const a = this.view()?.actions;
    if (!a?.complete) return null;
    return a.completeNeedsEvidence ? 'task.completeNeedsEvidence' : 'taskPage.completeAvailable';
  });

  // ── The open request and how the task ended ───────────────────────────

  readonly requestHeadline = computed(() => {
    const r = this.view()?.task.openRequest;
    if (!r) return '';
    return r.type === 'ON_HOLD'
      ? this.translate.instant('taskPage.request.hold', { date: this.format.date(r.holdUntil) })
      : this.translate.instant('taskPage.request.extension', { date: this.format.dateTime(r.requestedDueAt) });
  });
  readonly requestEffect = computed(() => {
    const r = this.view()?.task.openRequest;
    if (!r) return '';
    return r.type === 'ON_HOLD'
      ? this.translate.instant('taskPage.request.ifApprovedHold', { date: this.format.date(r.holdUntil) })
      : this.translate.instant('taskPage.request.ifApprovedExtension', { date: this.format.dateTime(r.requestedDueAt) });
  });
  readonly decisionRequest = computed<TaskRequestForDecisionDto | null>(() => {
    const v = this.view();
    const r = v?.task.openRequest;
    if (!v || !r) return null;
    const t = v.task;
    return {
      ...r,
      task: { id: t.id, title: t.title, sourceType: t.sourceType, sourceId: t.sourceId, status: t.status, priority: t.priority, dueAt: t.dueAt },
    };
  });
  readonly rejection = computed(() => {
    const v = this.view();
    if (!v || v.task.status !== 'REJECTED' || !v.task.rejectedReason) return null;
    return { byName: v.rejectedBy?.name ?? null, reason: v.task.rejectedReason, at: v.task.rejectedAt ?? null };
  });
  /** Rejected, Cancelled or Reopened — whichever explains the task's state now. */
  readonly closingNote = computed<{ titleKey: string; line: string; reason: string | null } | null>(() => {
    const v = this.view();
    if (!v) return null;
    const t = v.task;
    if (t.status === 'REJECTED' && t.rejectedAt) {
      return {
        titleKey: 'taskPage.rejected',
        line: this.translate.instant('taskPage.rejectedBy', { name: v.rejectedBy?.name ?? '—', when: this.format.dateTime(t.rejectedAt) }),
        reason: t.rejectedReason,
      };
    }
    if (t.status === 'CANCELLED' && t.cancelledAt) {
      return {
        titleKey: 'taskPage.cancelled',
        line: v.cancelledBy
          ? this.translate.instant('taskPage.cancelledBy', { name: v.cancelledBy.name, when: this.format.dateTime(t.cancelledAt) })
          : this.translate.instant('taskPage.cancelledByWorkflow', { when: this.format.dateTime(t.cancelledAt) }),
        reason: t.cancelledReason,
      };
    }
    if (t.status === 'COMPLETED' && t.completedAt) {
      return {
        titleKey: 'taskPage.completed',
        line: this.translate.instant('taskPage.completedBy', { name: v.completedBy?.name ?? '—', when: this.format.dateTime(t.completedAt) }),
        reason: null,
      };
    }
    if (t.reopenedAt) {
      return {
        titleKey: 'taskPage.reopened',
        line: this.translate.instant('taskPage.reopenedBy', { name: v.reopenedBy?.name ?? '—', when: this.format.dateTime(t.reopenedAt) }),
        reason: t.reopenedReason,
      };
    }
    return null;
  });

  constructor() {
    registerPageName(() => (this.view() ? this.title() : null));

    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.taskId.set(params.get('id'));
      this.load();
    });

    // Q11 — the breadcrumb's parent is the task's record, when the viewer may
    // open it; otherwise the nav model's own (My tasks).
    effect(() => {
      const v = this.view();
      const path = this.path();
      const link = this.recordLink();
      if (v && link) this.breadcrumb.set(path, link.join('/'), this.recordName());
      else this.breadcrumb.clear(path);
    });
  }

  ngOnDestroy(): void {
    this.breadcrumb.clear(this.path());
    this.history.destroy();
  }

  load(): void {
    const id = this.taskId();
    if (!id) return;
    this.state.set({ kind: 'loading' });
    this.actionError.set(null);
    this.fetch(id);
    this.history.retry();
  }

  /** After an action: the page, its history and its evidence, without a skeleton. */
  reload(): void {
    const id = this.taskId();
    if (!id) return;
    this.fetch(id);
    this.history.retry();
    this.evidenceList()?.reload();
  }

  private fetch(id: string): void {
    this.tasks.getPage(id).subscribe({
      next: (view) => this.state.set({ kind: 'ready', view }),
      error: (err: unknown) => {
        // A task that does not exist and one the viewer may not open are the
        // same 404 from the server, and the same state here (ACC-101 clause b).
        if (err instanceof HttpErrorResponse && err.status === 404) {
          this.state.set({ kind: 'notFound' });
          return;
        }
        const body = err instanceof HttpErrorResponse ? (err.error as { errorId?: unknown; requestId?: unknown } | null) : null;
        const errorId = typeof body?.errorId === 'string' ? body.errorId : typeof body?.requestId === 'string' ? body.requestId : null;
        this.state.set({ kind: 'error', errorId });
      },
    });
  }

  // ── Running an action ─────────────────────────────────────────────────

  run(id: ActionId): void {
    const v = this.view();
    if (!v) return;
    this.actionError.set(null);
    switch (id) {
      case 'start':
        return this.call(this.tasks.start(v.task.id));
      case 'complete':
        if (v.actions.completeNeedsEvidence) return;
        return this.call(this.tasks.complete(v.task.id));
      case 'resume':
        return this.call(this.tasks.resume(v.task.id));
      case 'pickUp':
        return this.call(this.tasks.pick(v.task.id));
      case 'withdrawRequest':
        if (!v.task.openRequest) return;
        return this.call(this.tasks.withdrawRequest(v.task.id, v.task.openRequest.id));
      case 'reviewRequest':
        return this.dialog.set('decision');
      case 'requestMoreTime':
        this.requestType.set('EXTENSION');
        return this.dialog.set('request');
      case 'requestHold':
        this.requestType.set('ON_HOLD');
        return this.dialog.set('request');
      default:
        return this.open(id);
    }
  }

  open(id: 'addEvidence' | 'reject' | 'release' | 'reassign' | 'edit' | 'cancel' | 'reopen'): void {
    this.dialog.set(id);
  }

  onDialogVisible(visible: boolean): void {
    if (!visible) this.dialog.set(null);
  }

  private call(request: Observable<unknown>): void {
    this.busy.set(true);
    request.pipe(map(() => undefined)).subscribe({
      next: () => {
        this.busy.set(false);
        this.reload();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        // The page is reloaded too: a 409 usually means the task moved on.
        this.reload();
        this.actionError.set(this.translate.instant(extractErrorMessage(err, 'task.errorAction')));
      },
    });
  }

  // ── Wording ───────────────────────────────────────────────────────────

  /** "1 Oct 09:12": the year only when it isn't this year, in the tenant's zone. */
  eventWhen(event: ITaskHistoryEventDto): string {
    return this.format.eventTime(event.at);
  }

  /**
   * ACC-120 slice 4 — a sentence with its actor inside ("Picked up by Dr. Huda
   * Zahrani"), from what the event carries: its kind, its actor, and for
   * evidence its type ("Evidence added: a link"). A kind with no sentence of
   * its own keeps its words, then the actor.
   */
  historyLine(event: ITaskHistoryEventDto): string {
    const kind =
      event.kind === 'request_made' ? (event.requestType === 'ON_HOLD' ? 'request_made_hold' : 'request_made_extension') : event.kind;
    const name = event.actorName;
    if ((kind === 'evidence_added' || kind === 'evidence_removed') && event.evidenceType) {
      const what = this.translate.instant(`taskPage.evidenceKind.${event.evidenceType}`);
      return this.translate.instant(`taskPage.eventEvidence.${kind}${name ? 'By' : ''}`, { what, name });
    }
    if (name) {
      const key = `taskPage.eventBy.${kind}`;
      const sentence = this.translate.instant(key, { name });
      if (sentence !== key) return sentence;
    }
    const what = this.translate.instant(`taskPage.event.${kind}`);
    return name ? `${what} · ${name}` : what;
  }

  private placement(person: ITaskPagePersonDto): string {
    const position = person.positionNameEn ? this.language.bilingual(person.positionNameEn, person.positionNameAr) : '';
    const unit = person.orgUnitNameEn ? this.language.bilingual(person.orgUnitNameEn, person.orgUnitNameAr) : '';
    return [position, unit].filter((p) => p).join(' · ');
  }

  private recordTypeKey(type: string): string {
    return type === 'COMMITTEE' || type === 'MEETING' ? `taskPage.recordType.${type}` : 'taskPage.recordType.OTHER';
  }

  private path(): string {
    return `/tasks/${this.taskId() ?? ''}`;
  }
}
