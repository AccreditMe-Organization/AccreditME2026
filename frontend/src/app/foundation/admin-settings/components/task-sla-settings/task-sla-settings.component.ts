import { Component, DestroyRef, ElementRef, HostListener, ViewChild, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { AmDateTimePipe, FormatService } from '../../../../core/formatting';
import { InputNumberLatinDigits } from '../../../../core/formatting/latin-digits';
import { LanguageService } from '../../../../core/services/language.service';
import {
  StageDeadlineConflict,
  TaskSlaWarningRefusal,
  taskSlaStageConflicts,
  taskSlaWarningRefusal,
} from '../../../workflow/workflow-refusal';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { ListDialogComponent } from '../../../../shared/components/list-dialog/list-dialog.component';
import { TaskSlaHistoryComponent } from './task-sla-history.component';
import { TaskSlaNoticesComponent } from './task-sla-notices.component';
import { TaskSlaResetComponent } from './task-sla-reset.component';
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
import { AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { LeaveGuarded } from '../../../roles/permission-matrix/leave-guard';
import {
  ITaskSlaChange,
  ITaskSlaNotices,
  ITaskSlaPolicy,
  ITaskSlaSettings,
  TaskSlaPriority,
  TaskSlaWarnBeforeDue,
  TenantService,
} from '../../../tenant/services/tenant.service';
import { TASK_SLA_PRIORITIES } from './task-sla-change';
import { WARN_BEFORE_DUE_OPTIONS, warnHours, warnOptionLabel, warningFitsLimit } from './task-sla-warning';

// Literal keys, so the translation-keys spec sees each one.
const PRIORITY_KEYS: Record<TaskSlaPriority, string> = {
  LOW: 'task.priority.low',
  MEDIUM: 'task.priority.medium',
  HIGH: 'task.priority.high',
  CRITICAL: 'task.priority.critical',
};

const LIMIT_LABEL_KEYS: Record<TaskSlaPriority, string> = {
  LOW: 'adminSettings.taskSlaPage.limits.low',
  MEDIUM: 'adminSettings.taskSlaPage.limits.medium',
  HIGH: 'adminSettings.taskSlaPage.limits.high',
  CRITICAL: 'adminSettings.taskSlaPage.limits.critical',
};

interface WarnOption {
  value: TaskSlaWarnBeforeDue;
  label: string;
  /** At or past the priority's saved limit: shown, not choosable (Q2). */
  unavailable: boolean;
  reason: string;
}

const HISTORY_PAGE = 20;

/** Below this section width the matrix stacks one block per priority. */
export const SLA_MATRIX_STACK_BELOW_PX = 560;

type SectionKey = 'limits' | 'escalation';
type Load = 'loading' | 'error' | 'ready';

/**
 * Task SLA & escalation — ACC-313 PR 2, template 5's own reference screen,
 * built on PR 1's routes (plan: backend/Plans/step-313-task-sla-settings.md §1).
 *
 * TWO SECTIONS, TWO SAVES. Time limits saves through PATCH …/limits and the
 * escalation matrix through PATCH …/escalation; each section has its own dirty
 * chip, Discard and Save, and the server merges only that section's fields, so
 * one section's unsaved edits never ride on the other's Save.
 *
 * SAVE IS NEVER DISABLED (Design System rule 5.2). An invalid Save reveals every
 * error in the section, counts the problems in its header and moves focus to
 * the first one. The footer — Discard and Save — appears only while the section
 * has something to save, so a clean section has no Save to press at all.
 *
 * ADAPTED FROM THE DRAWING (plan §1): hours, not days; a fixed chain (manager,
 * then unit head), with no handle, add, remove or target select; the matrix
 * stacks one block per priority on a narrow screen instead of scrolling
 * sideways, because it holds no chain that could wrap mid-step. There is no
 * table of contents (Ahmad, Q9).
 *
 * ACC-313 PR 3 / PR 4 (3-fe): the page reads GET …/policy; the Notifications
 * section (immediate, its own component) and Reset (last, its own component)
 * sit around the matrix, and the matrix gains "Warn before due" per priority,
 * saved with escalation. A warning must be shorter than its priority's saved
 * limit (Q2): options at or past it are shown greyed with their reason, and
 * both of the server's refusals are said from their code under the row they
 * name.
 */
@Component({
  selector: 'app-task-sla-settings',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    OverlaySelectComponent,
    TaskSlaNoticesComponent,
    TaskSlaResetComponent,
    RouterLink,
    TranslatePipe,
    AmDateTimePipe,
    ButtonModule,
    InputNumberModule,
    InputNumberLatinDigits,
    PageHeaderComponent,
    FieldComponent,
    ListDialogComponent,
    TaskSlaHistoryComponent,
  ],
  template: `
    <div class="am-sla">
      <app-page-header
        [title]="'adminSettings.taskSla' | translate"
        [purpose]="'adminSettings.taskSlaPage.purpose' | translate"
      />

      <!-- LAST CHANGED, from the audit trail (GET …/history's newest row). -->
      <div class="am-sla__meta" data-testid="sla-meta">
        @switch (historyState()) {
          @case ('ready') {
            @if (lastChange(); as change) {
              <span>
                {{ 'adminSettings.taskSlaPage.lastChangedBy' | translate: { who: change.actorName || notRecorded() } }}
                <span data-sla-changed-at>{{ change.changedAt | amDateTime }}</span>
              </span>
              <p-button
                [label]="'adminSettings.taskSlaPage.changeHistory' | translate"
                severity="secondary"
                size="small"
                data-testid="sla-history-open"
                (onClick)="historyOpen.set(true)"
              />
            } @else {
              <span>{{ 'adminSettings.taskSlaPage.neverChanged' | translate }}</span>
            }
          }
          @case ('error') {
            <span role="alert">{{ 'adminSettings.taskSlaPage.historyFailed' | translate }}</span>
            <p-button [label]="'common.retry' | translate" severity="secondary" size="small" (onClick)="loadHistory()" />
          }
          @default {
            <span class="am-skeleton-bar am-sla__meta-bar" aria-hidden="true"></span>
          }
        }
      </div>

      <!-- ── Time limits ─────────────────────────────────────────────────── -->
      <section class="am-sla__section" data-sla-section="limits" aria-labelledby="sla-limits-title">
        <header class="am-sla__head">
          <div>
            <h2 class="am-sla__title" id="sla-limits-title">{{ 'adminSettings.taskSlaPage.limits.title' | translate }}</h2>
            <p class="am-sla__help">{{ 'adminSettings.taskSlaPage.limits.help' | translate }}</p>
          </div>
          <div class="am-sla__chips">
            @if (limitsProblems() > 0) {
              <span class="am-sla__chip am-sla__chip--problem" data-testid="sla-limits-problems">{{ problemsText(limitsProblems()) }}</span>
            }
            @if (limitsDirty()) {
              <span class="am-sla__chip am-sla__chip--unsaved" data-testid="sla-limits-unsaved">{{ 'common.unsaved' | translate }}</span>
            }
          </div>
        </header>

        @switch (load()) {
          @case ('loading') {
            <div class="am-sla__skeleton" aria-hidden="true">
              <span class="am-skeleton-bar"></span><span class="am-skeleton-bar"></span>
            </div>
          }
          @case ('error') {
            <p class="am-sla__outcome" role="alert">
              <span>{{ 'adminSettings.taskSlaPage.loadFailed' | translate }}</span>
              <p-button [label]="'common.retry' | translate" severity="secondary" size="small" (onClick)="loadPolicy()" />
            </p>
          }
          @default {
            <div class="am-sla__limits" [formGroup]="limitsForm">
              @for (p of priorities; track p) {
                <am-field
                  [label]="limitLabelKeys[p] | translate"
                  [control]="limitsForm.controls[p]"
                  [hint]="(p === 'MEDIUM' ? 'adminSettings.taskSlaPage.limits.unitDefault' : 'adminSettings.taskSlaPage.limits.unit') | translate"
                  [inputId]="'sla-limit-' + p"
                  [forceShowErrors]="limitsTried()"
                  [errorMessages]="limitErrors"
                  [invalid]="limitRefusedHere(p)"
                  [describedBy]="limitRefusedHere(p) ? 'sla-limit-warning-' + p : null"
                  [attr.data-sla-limit]="p"
                >
                  <p-inputNumber
                    [inputId]="'sla-limit-' + p"
                    [formControlName]="p"
                    [min]="1"
                    [showButtons]="true"
                    [fluid]="true"
                    [invalid]="conflictsFor(p).length > 0"
                  />
                </am-field>
              }
            </div>
            <!-- The refusals sit UNDER the row of four fields, never inside its
                 grid: a full-width message between two fields pushed the next
                 priority onto a row of its own (CC-324). Each names its priority. -->
            @for (p of priorities; track p) {
              <!-- ACC-208 — the stage-deadline rule's third side, about one
                   priority, said from the refusal's code and numbers, never
                   the server's English. -->
              @if (conflictsFor(p); as conflicts) {
                @if (conflicts.length) {
                  <div class="am-sla__refusal" role="alert" [attr.data-sla-conflicts]="p">
                    <span>{{ conflictLead(p, conflicts) }}</span>
                    <ul>
                      @for (conflict of conflicts; track conflict.stageId) {
                        <li>
                          <a [routerLink]="['/workflows', conflict.workflowTemplateId, 'stages']" [queryParams]="{ stage: conflict.stageId }">{{ conflictStage(conflict) }}</a>
                        </li>
                      }
                    </ul>
                    <span>{{ conflictWayOut(p, conflicts) }}</span>
                  </div>
                }
              }
              <!-- ACC-313 — a limit at or under this priority's warning. -->
              @if (limitWarningRefusal(); as refusal) {
                @if (refusal.priority === p) {
                  <div class="am-sla__refusal" role="alert" [id]="'sla-limit-warning-' + p" [attr.data-sla-limit-warning]="p">
                    <span>{{ warningRefusalLead(refusal) }}</span>
                    <span>{{ 'adminSettings.taskSlaPage.warnRefusal.limitWayOut' | translate }}</span>
                  </div>
                }
              }
            }
            <p class="am-sla__scope">{{ 'adminSettings.taskSlaPage.limits.scope' | translate }}</p>
            @if (limitsSaved()) {
              <p class="am-sla__status" role="status" data-testid="sla-limits-saved">{{ 'adminSettings.savedSuccess' | translate }}</p>
            }
            @if (limitsDirty() || limitsSaving()) {
              <footer class="am-sla__actions" data-testid="sla-limits-footer">
                @if (limitsError()) {
                  <p class="am-sla__error" role="alert">{{ limitsError()! | translate }}</p>
                }
                <p-button
                  [label]="'common.discard' | translate"
                  severity="secondary"
                  [text]="true"
                  data-testid="sla-limits-discard"
                  (onClick)="discard('limits')"
                />
                <p-button
                  [label]="'adminSettings.taskSlaPage.limits.save' | translate"
                  [loading]="limitsSaving()"
                  data-testid="sla-limits-save"
                  (onClick)="saveLimits()"
                />
              </footer>
            }
          }
        }
      </section>

      <!-- ── Notifications: immediate, no Save (PR 3) ────────────────────── -->
      <am-task-sla-notices [notices]="savedNotices()" [load]="load()" (retry)="loadPolicy()" (changed)="onNoticesChanged($event)" />

      <!-- ── Reminders and escalation per priority: the matrix ──────────── -->
      <section class="am-sla__section" data-sla-section="escalation" aria-labelledby="sla-escalation-title">
        <header class="am-sla__head">
          <div>
            <h2 class="am-sla__title" id="sla-escalation-title">{{ 'adminSettings.taskSlaPage.escalation.title' | translate }}</h2>
            <p class="am-sla__help">{{ 'adminSettings.taskSlaPage.escalation.help' | translate }}</p>
          </div>
          <div class="am-sla__chips">
            @if (escalationProblems() > 0) {
              <span class="am-sla__chip am-sla__chip--problem" data-testid="sla-escalation-problems">{{ problemsText(escalationProblems()) }}</span>
            }
            @if (escalationDirty()) {
              <span class="am-sla__chip am-sla__chip--unsaved" data-testid="sla-escalation-unsaved">{{ 'common.unsaved' | translate }}</span>
            }
          </div>
        </header>

        @switch (load()) {
          @case ('loading') {
            <div class="am-sla__skeleton" aria-hidden="true">
              <span class="am-skeleton-bar"></span><span class="am-skeleton-bar"></span><span class="am-skeleton-bar"></span>
            </div>
          }
          @case ('error') {
            <p class="am-sla__outcome" role="alert">
              <span>{{ 'adminSettings.taskSlaPage.loadFailed' | translate }}</span>
              <p-button [label]="'common.retry' | translate" severity="secondary" size="small" (onClick)="loadPolicy()" />
            </p>
          }
          @default {
            <p class="am-sla__help">{{ 'adminSettings.taskSlaPage.escalation.chain' | translate }}</p>
            <div #matrix class="am-sla__matrix" [class.am-sla__matrix--stacked]="stacked()" [formGroup]="escalationForm" data-testid="sla-matrix">
              @if (!stacked()) {
                <div class="am-sla__row am-sla__row--head" aria-hidden="true">
                  <span>{{ 'task.priority.title' | translate }}</span>
                  <span>{{ 'adminSettings.taskSlaPage.escalation.limit' | translate }}</span>
                  <span>{{ 'adminSettings.taskSlaPage.escalation.warn' | translate }}</span>
                  <span>{{ 'adminSettings.taskSlaPage.escalation.manager' | translate }}</span>
                  <span>{{ 'adminSettings.taskSlaPage.escalation.head' | translate }}</span>
                </div>
              }
              @for (p of priorities; track p) {
                <div class="am-sla__row" [formGroupName]="p" [attr.data-sla-row]="p">
                  <!-- The chip and the Limit sit centred on the CONTROL, not on the
                       control plus its message slot (CC-324): their cells stretch
                       to the row and leave out the slot at the bottom. -->
                  <span class="am-sla__cell self-stretch flex items-center"><span class="am-sla__priority" [attr.data-priority]="p">{{ priorityKeys[p] | translate }}</span></span>
                  <span class="am-sla__limit am-sla__cell self-stretch flex items-center">
                    @if (stacked()) {
                      <span class="am-sla__limit-label">{{ 'adminSettings.taskSlaPage.escalation.limit' | translate }}</span>
                    }
                    <span data-testid="sla-matrix-limit">{{ limitText(p) }}</span>
                  </span>
                  <am-field
                    [label]="cellLabel(p, 'warn')"
                    [labelVisuallyHidden]="!stacked()"
                    [control]="escalationForm.controls[p].controls.warnBeforeDue"
                    [inputId]="'sla-warn-' + p"
                    [forceShowErrors]="escalationTried()"
                    [errorMessages]="warnErrors"
                    [attr.data-sla-warn]="p"
                  >
                    <app-overlay-select
                      formControlName="warnBeforeDue"
                      [options]="warnOptions()[p]"
                      optionLabel="label"
                      optionValue="value"
                      optionDisabled="unavailable"
                      optionDisabledReason="reason"
                      [itemTemplate]="warnItem"
                      [ariaLabel]="cellLabel(p, 'warn')"
                      [panelMinWidth]="200"
                      [panelMaxHeight]="WARN_LIST_MAX_HEIGHT"
                      [invalid]="warnMarked(p)"
                      [ariaDescribedBy]="warnRefusedHere(p) ? 'sla-warn-refusal-' + p : null"
                    />
                  </am-field>
                  <am-field
                    [label]="cellLabel(p, 'manager')"
                    [labelVisuallyHidden]="!stacked()"
                    [control]="escalationForm.controls[p].controls.managerEscalationAfterHours"
                    [inputId]="'sla-manager-' + p"
                    [forceShowErrors]="escalationTried()"
                    [errorMessages]="escalationErrors"
                  >
                    <p-inputNumber [inputId]="'sla-manager-' + p" formControlName="managerEscalationAfterHours" [min]="0" [showButtons]="true" [fluid]="true" />
                  </am-field>
                  <am-field
                    [label]="cellLabel(p, 'head')"
                    [labelVisuallyHidden]="!stacked()"
                    [control]="escalationForm.controls[p].controls.headEscalationAfterHours"
                    [inputId]="'sla-head-' + p"
                    [forceShowErrors]="escalationTried()"
                    [errorMessages]="escalationErrors"
                  >
                    <p-inputNumber [inputId]="'sla-head-' + p" formControlName="headEscalationAfterHours" [min]="0" [showButtons]="true" [fluid]="true" />
                  </am-field>
                </div>
                <!-- ACC-313 — a warning at or past this priority's limit, said from the code. -->
                @if (warningRefusal(); as refusal) {
                  @if (refusal.priority === p) {
                    <div class="am-sla__refusal" role="alert" [id]="'sla-warn-refusal-' + p" [attr.data-sla-warn-refusal]="p">
                      <span>{{ warningRefusalLead(refusal) }}</span>
                      <span>{{ 'adminSettings.taskSlaPage.warnRefusal.warnWayOut' | translate }}</span>
                    </div>
                  }
                }
              }
            </div>
            @if (escalationSaved()) {
              <p class="am-sla__status" role="status" data-testid="sla-escalation-saved">{{ 'adminSettings.savedSuccess' | translate }}</p>
            }
            @if (escalationDirty() || escalationSaving()) {
              <footer class="am-sla__actions" data-testid="sla-escalation-footer">
                @if (escalationError()) {
                  <p class="am-sla__error" role="alert">{{ escalationError()! | translate }}</p>
                }
                <p-button
                  [label]="'common.discard' | translate"
                  severity="secondary"
                  [text]="true"
                  data-testid="sla-escalation-discard"
                  (onClick)="discard('escalation')"
                />
                <p-button
                  [label]="'adminSettings.taskSlaPage.escalation.save' | translate"
                  [loading]="escalationSaving()"
                  data-testid="sla-escalation-save"
                  (onClick)="saveEscalation()"
                />
              </footer>
            }
          }
        }
      </section>

      <!-- ── Reset, last and danger-bordered (PR 3) ─────────────────────── -->
      <am-task-sla-reset [ready]="load() === 'ready'" (reset)="onReset($event)" />
    </div>

    <!-- A greyed warning option says why, beside it (Q2): token utilities, no
         component styles. The reason is also in the option's accessible name. -->
    <ng-template #warnItem let-option>
      <span class="flex flex-col" [attr.data-warn-option]="option.value">
        <span>{{ option.label }}</span>
        @if (option.unavailable) {
          <span class="text-micro text-ink-500">{{ option.reason }}</span>
        }
      </span>
    </ng-template>

    <!-- The change history: a list, so the list shell (ACC-229), 20 at a time. -->
    <ng-template #historyBody>
      <am-task-sla-history [rows]="history()" [total]="historyTotal()" [more]="historyMore()" (loadMore)="loadMoreHistory()" />
    </ng-template>
    <am-list-dialog
      [visible]="historyOpen()"
      [heading]="'adminSettings.taskSlaPage.changeHistory' | translate"
      [count]="historyCountText()"
      [closeLabel]="'common.close' | translate"
      [body]="historyBody"
      size="compact"
      (closeRequested)="historyOpen.set(false)"
    />
  `,
  styles: [
    `
      .am-sla{display:flex;flex-direction:column;gap:var(--am-space-16);max-inline-size:760px;min-inline-size:0}
      .am-sla__meta{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--am-space-12);font-size:var(--am-type-meta-size);line-height:var(--am-type-meta-line);color:var(--am-ink-500)}
      .am-sla__meta-bar{inline-size:240px;max-inline-size:100%}
      .am-sla__section{display:flex;flex-direction:column;gap:var(--am-space-12);padding:var(--am-space-16);background:var(--am-surface-raised);border:1px solid var(--am-border);border-radius:var(--am-radius-card);min-inline-size:0;container-type:inline-size}
      .am-sla__head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:var(--am-space-8)}
      .am-sla__title{margin:0;font-size:var(--am-type-value-size);line-height:var(--am-type-value-line);font-weight:600;color:var(--am-ink-900)}
      .am-sla__help,.am-sla__scope{margin:0;font-size:var(--am-type-meta-size);line-height:var(--am-type-meta-line);color:var(--am-ink-500);text-wrap:pretty}
      .am-sla__chips{display:flex;flex-wrap:wrap;gap:var(--am-space-6)}
      .am-sla__chip{flex:none;font-size:var(--am-type-micro-size);font-weight:600;border-radius:var(--am-radius-pill);padding:0 var(--am-space-8);border:1px solid}
      .am-sla__chip--unsaved{color:var(--am-warning-ink);background:var(--am-warning-bg);border-color:var(--am-warning-border)}
      .am-sla__chip--problem{color:var(--am-danger-ink);background:var(--am-danger-bg);border-color:var(--am-danger-border)}
      .am-sla__limits{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:var(--am-space-12);align-items:start}
      .am-sla__refusal{display:flex;flex-direction:column;gap:var(--am-space-4);font-size:var(--am-type-meta-size);line-height:var(--am-type-meta-line);font-weight:500;color:var(--am-danger-ink)}
      .am-sla__refusal ul{margin:0;padding-inline-start:var(--am-space-16)}
      .am-sla__refusal a{color:var(--am-primary-700)}
      .am-sla__matrix{display:flex;flex-direction:column;gap:var(--am-space-8);min-inline-size:0}
      .am-sla__row{display:grid;grid-template-columns:86px 120px 180px minmax(0,1fr) minmax(0,1fr);gap:var(--am-space-12);align-items:start}
      .am-sla__row--head{font-size:var(--am-type-meta-size);line-height:var(--am-type-meta-line);font-weight:500;color:var(--am-ink-500);padding-block-end:var(--am-space-4);border-block-end:1px solid var(--am-border)}
      .am-sla__priority{font-size:var(--am-type-meta-size);font-weight:600;color:var(--am-neutral-chip-ink);background:var(--am-neutral-chip-bg);border:1px solid var(--am-neutral-chip-border);border-radius:var(--am-radius-pill);padding:0 var(--am-space-8)}
      .am-sla__limit{font-size:var(--am-type-body-size);color:var(--am-ink-900);min-inline-size:0}
      .am-sla__matrix--stacked .am-sla__row{grid-template-columns:minmax(0,1fr);padding-block:var(--am-space-12);border-block-start:1px solid var(--am-border)}
      .am-sla__cell{padding-block-end:calc(var(--am-space-4) + var(--am-field-message-line))}
      .am-sla__matrix--stacked .am-sla__cell{padding:0}
      .am-sla__matrix--stacked .am-sla__limit{flex-direction:column;align-items:flex-start}
      .am-sla__limit-label{font-size:var(--am-type-meta-size);line-height:var(--am-type-meta-line);font-weight:500;color:var(--am-ink-500)}
      .am-sla__actions{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:var(--am-space-12);padding-block-start:var(--am-space-8);border-block-start:1px solid var(--am-border)}
      .am-sla__error{margin:0;margin-inline-end:auto;font-size:var(--am-type-meta-size);line-height:var(--am-type-meta-line);font-weight:500;color:var(--am-danger-ink)}
      .am-sla__status{margin:0;font-size:var(--am-type-meta-size);line-height:var(--am-type-meta-line);color:var(--am-ink-700)}
      .am-sla__outcome{display:flex;flex-wrap:wrap;align-items:center;gap:var(--am-space-8);margin:0;font-size:var(--am-type-body-size);color:var(--am-ink-700)}
      .am-sla__skeleton{display:flex;flex-direction:column;gap:var(--am-space-12)}
    `,
  ],
})
export class TaskSlaSettingsComponent implements LeaveGuarded {
  private readonly fb = inject(FormBuilder);
  private readonly tenantService = inject(TenantService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly format = inject(FormatService);
  private readonly amConfirm = inject(AmConfirmService);

  readonly priorities = TASK_SLA_PRIORITIES;
  /** The warning list shows all six options rather than ending on a cut one (CC-324). */
  readonly WARN_LIST_MAX_HEIGHT = '24rem';
  readonly priorityKeys = PRIORITY_KEYS;
  readonly limitLabelKeys = LIMIT_LABEL_KEYS;
  readonly limitErrors = {
    required: 'adminSettings.taskSlaPage.limits.required',
    min: 'adminSettings.taskSlaPage.limits.min',
  };
  readonly escalationErrors = {
    required: 'adminSettings.taskSlaPage.escalation.required',
    min: 'adminSettings.taskSlaPage.escalation.min',
  };
  readonly warnErrors = {
    notBeforeDue: 'adminSettings.taskSlaPage.warnRefusal.invalid',
  };

  // ── The policy read ──────────────────────────────────────────────────────
  readonly load = signal<Load>('loading');
  /** The tiers the server holds: the baseline both sections compare against. */
  readonly saved = signal<ITaskSlaSettings | null>(null);
  /** The notices the server holds: the switch, and each priority's stored warning. */
  readonly savedNotices = signal<ITaskSlaNotices | null>(null);
  /** The calendar's working day in hours: what "1 working day" means (Q2). */
  readonly hoursPerDay = signal(8);

  // ── Time limits ──────────────────────────────────────────────────────────
  readonly limitsForm = this.fb.group({
    LOW: this.limitControl(),
    MEDIUM: this.limitControl(),
    HIGH: this.limitControl(),
    CRITICAL: this.limitControl(),
  });
  readonly limitsTried = signal(false);
  readonly limitsSaving = signal(false);
  readonly limitsError = signal<string | null>(null);
  readonly limitsSaved = signal(false);
  /** ACC-208 — the stages a refused save would have broken, until the hours change. */
  readonly conflicts = signal<StageDeadlineConflict[]>([]);
  /** ACC-313 — a limit at or under its priority's warning, until the hours change. */
  readonly limitWarningRefusal = signal<TaskSlaWarningRefusal | null>(null);
  private readonly limitsTick = signal(0);

  // ── Escalation ───────────────────────────────────────────────────────────
  readonly escalationForm = this.fb.group({
    LOW: this.escalationGroup('LOW'),
    MEDIUM: this.escalationGroup('MEDIUM'),
    HIGH: this.escalationGroup('HIGH'),
    CRITICAL: this.escalationGroup('CRITICAL'),
  });
  readonly escalationTried = signal(false);
  readonly escalationSaving = signal(false);
  readonly escalationError = signal<string | null>(null);
  readonly escalationSaved = signal(false);
  /** ACC-313 — a warning at or past its priority's limit, until the matrix changes. */
  readonly warningRefusal = signal<TaskSlaWarningRefusal | null>(null);
  private readonly escalationTick = signal(0);

  /** Each priority's warning options: the six, greyed at or past its saved limit. */
  readonly warnOptions = computed(() => {
    this.translate.currentLang();
    const saved = this.saved();
    const perDay = this.hoursPerDay();
    const out = {} as Record<TaskSlaPriority, WarnOption[]>;
    for (const p of this.priorities) {
      const limit = saved?.[p].dueAfterHours ?? Number.POSITIVE_INFINITY;
      out[p] = WARN_BEFORE_DUE_OPTIONS.map((value) => ({
        value,
        label: this.warnLabel(value),
        unavailable: !warningFitsLimit(value, limit, perDay),
        reason: saved ? this.translate.instant('adminSettings.taskSlaPage.warnNotShorter', { limit: this.format.count('workflow.workingHours', limit) }) : '',
      }));
    }
    return out;
  });

  /** The matrix stacks per priority when its section is narrow (phone). */
  readonly stacked = signal(false);
  private resize?: ResizeObserver;

  // ── History ──────────────────────────────────────────────────────────────
  readonly historyState = signal<Load>('loading');
  readonly history = signal<ITaskSlaChange[]>([]);
  readonly historyTotal = signal(0);
  readonly historyMore = signal<'idle' | 'loading' | 'failed'>('idle');
  readonly historyOpen = signal(false);
  readonly lastChange = computed(() => this.history()[0] ?? null);
  readonly historyCountText = computed(() => {
    this.translate.currentLang();
    return this.historyState() === 'ready' ? this.format.number(this.historyTotal()) : null;
  });

  private historyRequest?: Subscription;
  private moreRequest?: Subscription;

  readonly limitsDirty = computed(() => {
    this.limitsTick();
    const saved = this.saved();
    if (!saved) return false;
    return this.priorities.some((p) => this.limitsForm.controls[p].value !== saved[p].dueAfterHours);
  });

  readonly escalationDirty = computed(() => {
    this.escalationTick();
    const saved = this.saved();
    if (!saved) return false;
    return this.priorities.some((p) => {
      const v = this.escalationForm.controls[p].getRawValue();
      return (
        v.managerEscalationAfterHours !== saved[p].managerEscalationAfterHours ||
        v.headEscalationAfterHours !== saved[p].headEscalationAfterHours ||
        v.warnBeforeDue !== (this.savedNotices()?.warnBeforeDue[p] ?? 'OFF')
      );
    });
  });

  /** Invalid fields once a Save was tried, plus every priority a stage refusal names. */
  readonly limitsProblems = computed(() => {
    this.limitsTick();
    const invalid = this.limitsTried() ? this.priorities.filter((p) => this.limitsForm.controls[p].invalid).length : 0;
    const refused = new Set(this.conflicts().map((c) => c.priority));
    const warning = this.limitWarningRefusal();
    if (warning) refused.add(warning.priority);
    return invalid + refused.size;
  });

  readonly escalationProblems = computed(() => {
    this.escalationTick();
    const refused = this.warningRefusal() ? 1 : 0;
    if (!this.escalationTried()) return refused;
    return this.priorities.reduce((n, p) => {
      const g = this.escalationForm.controls[p].controls;
      return n + (g.managerEscalationAfterHours.invalid ? 1 : 0) + (g.headEscalationAfterHours.invalid ? 1 : 0) + (g.warnBeforeDue.invalid ? 1 : 0);
    }, refused);
  });

  @ViewChild('matrix') set matrixRef(el: ElementRef<HTMLElement> | undefined) {
    this.resize?.disconnect();
    if (!el || typeof ResizeObserver === 'undefined') return;
    this.resize = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width > 0) this.stacked.set(width < SLA_MATRIX_STACK_BELOW_PX);
    });
    this.resize.observe(el.nativeElement);
    const width = el.nativeElement.getBoundingClientRect().width;
    if (width > 0) this.stacked.set(width < SLA_MATRIX_STACK_BELOW_PX);
  }

  constructor() {
    const limits = this.limitsForm.valueChanges.subscribe(() => {
      this.limitsTick.update((n) => n + 1);
      this.conflicts.set([]);
      this.limitWarningRefusal.set(null);
      this.limitsSaved.set(false);
      this.limitsError.set(null);
    });
    const escalation = this.escalationForm.valueChanges.subscribe(() => {
      this.escalationTick.update((n) => n + 1);
      this.escalationSaved.set(false);
      this.escalationError.set(null);
      this.warningRefusal.set(null);
    });
    inject(DestroyRef).onDestroy(() => {
      limits.unsubscribe();
      escalation.unsubscribe();
      this.historyRequest?.unsubscribe();
      this.moreRequest?.unsubscribe();
      this.resize?.disconnect();
    });
    this.loadPolicy();
    this.loadHistory();
  }

  private limitControl(): FormControl<number | null> {
    return this.fb.control<number | null>(null, [Validators.required, Validators.min(1)]);
  }

  private escalationGroup(priority: TaskSlaPriority) {
    return this.fb.group({
      // ACC-313 — the warning must be shorter than this priority's SAVED limit.
      warnBeforeDue: this.fb.nonNullable.control<TaskSlaWarnBeforeDue>('OFF', [
        (c) => {
          const limit = this.saved()?.[priority].dueAfterHours;
          return limit === undefined || warningFitsLimit(c.value as TaskSlaWarnBeforeDue, limit, this.hoursPerDay()) ? null : { notBeforeDue: true };
        },
      ]),
      managerEscalationAfterHours: this.fb.control<number | null>(null, [Validators.required, Validators.min(0)]),
      headEscalationAfterHours: this.fb.control<number | null>(null, [Validators.required, Validators.min(0)]),
    });
  }

  // ── Reads ────────────────────────────────────────────────────────────────
  loadPolicy(): void {
    this.load.set('loading');
    this.tenantService.getTaskSlaPolicy().subscribe({
      next: (policy) => {
        this.applyPolicy(policy);
        this.load.set('ready');
      },
      error: () => this.load.set('error'),
    });
  }

  /** The whole stored policy: both sections' baselines and fields, and the switch. */
  private applyPolicy(policy: ITaskSlaPolicy): void {
    this.hoursPerDay.set(policy.workingHoursPerDay);
    this.saved.set(policy.tiers);
    this.savedNotices.set(policy.notices);
    this.applyLimits(policy.tiers);
    this.applyEscalation(policy.tiers, policy.notices);
  }

  loadHistory(): void {
    this.historyRequest?.unsubscribe();
    this.moreRequest?.unsubscribe();
    this.historyState.set('loading');
    this.historyMore.set('idle');
    this.historyRequest = this.tenantService.getTaskSlaHistory(0, HISTORY_PAGE).subscribe({
      next: (page) => {
        this.history.set(page.rows);
        this.historyTotal.set(page.total);
        this.historyState.set('ready');
      },
      error: () => this.historyState.set('error'),
    });
  }

  /** The next 20; a failure keeps what is shown and offers Retry. */
  loadMoreHistory(): void {
    if (this.historyMore() === 'loading') return;
    this.historyMore.set('loading');
    this.moreRequest = this.tenantService.getTaskSlaHistory(this.history().length, HISTORY_PAGE).subscribe({
      next: (page) => {
        this.history.update((rows) => [...rows, ...page.rows.filter((r) => !rows.some((x) => x.id === r.id))]);
        this.historyTotal.set(page.rows.length === 0 ? this.history().length : page.total);
        this.historyMore.set('idle');
      },
      error: () => this.historyMore.set('failed'),
    });
  }

  private applyLimits(tiers: ITaskSlaSettings): void {
    this.limitsForm.setValue(
      { LOW: tiers.LOW.dueAfterHours, MEDIUM: tiers.MEDIUM.dueAfterHours, HIGH: tiers.HIGH.dueAfterHours, CRITICAL: tiers.CRITICAL.dueAfterHours },
      { emitEvent: false },
    );
    this.limitsTick.update((n) => n + 1);
  }

  private applyEscalation(tiers: ITaskSlaSettings, notices: ITaskSlaNotices | null = this.savedNotices()): void {
    const row = (p: TaskSlaPriority) => ({
      warnBeforeDue: notices?.warnBeforeDue[p] ?? ('OFF' as TaskSlaWarnBeforeDue),
      managerEscalationAfterHours: tiers[p].managerEscalationAfterHours,
      headEscalationAfterHours: tiers[p].headEscalationAfterHours,
    });
    this.escalationForm.setValue({ LOW: row('LOW'), MEDIUM: row('MEDIUM'), HIGH: row('HIGH'), CRITICAL: row('CRITICAL') }, { emitEvent: false });
    this.revalidateWarnings();
  }

  /** The warnings are checked against the SAVED limits, so a new baseline re-checks them. */
  private revalidateWarnings(): void {
    for (const p of this.priorities) this.escalationForm.controls[p].controls.warnBeforeDue.updateValueAndValidity({ emitEvent: false });
    this.escalationTick.update((n) => n + 1);
  }

  // ── Saves ────────────────────────────────────────────────────────────────
  saveLimits(): void {
    if (this.limitsSaving()) return;
    this.limitsTried.set(true);
    this.limitsTick.update((n) => n + 1);
    if (this.limitsForm.invalid) {
      this.focusFirst(this.priorities.filter((p) => this.limitsForm.controls[p].invalid).map((p) => `sla-limit-${p}`));
      return;
    }
    const v = this.limitsForm.getRawValue();
    this.limitsSaving.set(true);
    this.limitsError.set(null);
    this.conflicts.set([]);
    this.tenantService
      .updateTaskSlaLimits({
        LOW: { dueAfterHours: v.LOW as number },
        MEDIUM: { dueAfterHours: v.MEDIUM as number },
        HIGH: { dueAfterHours: v.HIGH as number },
        CRITICAL: { dueAfterHours: v.CRITICAL as number },
      })
      .subscribe({
        next: (tiers) => {
          this.limitsSaving.set(false);
          this.limitsTried.set(false);
          // The other section keeps whatever is being edited in it; only the
          // baseline and this section's fields take the saved tiers.
          this.saved.set(tiers);
          this.applyLimits(tiers);
          this.revalidateWarnings();
          this.limitsSaved.set(true);
          this.loadHistory();
        },
        error: (err: unknown) => {
          this.limitsSaving.set(false);
          const conflicts = taskSlaStageConflicts(err);
          if (conflicts?.length) {
            this.conflicts.set(conflicts);
            this.focusFirst(this.priorities.filter((p) => this.conflictsFor(p).length > 0).map((p) => `sla-limit-${p}`));
            return;
          }
          const warning = taskSlaWarningRefusal(err);
          if (warning?.code === 'TASK_SLA_LIMIT_NOT_AFTER_WARNING') {
            this.limitWarningRefusal.set(warning);
            this.focusFirst([`sla-limit-${warning.priority}`]);
            return;
          }
          this.limitsError.set('adminSettings.taskSlaPage.saveFailed');
        },
      });
  }

  saveEscalation(): void {
    if (this.escalationSaving()) return;
    this.escalationTried.set(true);
    this.escalationTick.update((n) => n + 1);
    if (this.escalationForm.invalid) {
      const ids: string[] = [];
      for (const p of this.priorities) {
        const g = this.escalationForm.controls[p].controls;
        if (g.warnBeforeDue.invalid) ids.push(`warn:${p}`);
        if (g.managerEscalationAfterHours.invalid) ids.push(`sla-manager-${p}`);
        if (g.headEscalationAfterHours.invalid) ids.push(`sla-head-${p}`);
      }
      this.focusFirst(ids);
      return;
    }
    const v = this.escalationForm.getRawValue();
    const row = (p: TaskSlaPriority) => ({
      managerEscalationAfterHours: v[p].managerEscalationAfterHours as number,
      headEscalationAfterHours: v[p].headEscalationAfterHours as number,
      warnBeforeDue: v[p].warnBeforeDue,
    });
    this.escalationSaving.set(true);
    this.escalationError.set(null);
    this.warningRefusal.set(null);
    this.tenantService
      .updateTaskSlaEscalation({ LOW: row('LOW'), MEDIUM: row('MEDIUM'), HIGH: row('HIGH'), CRITICAL: row('CRITICAL') })
      .subscribe({
        next: (tiers) => {
          this.escalationSaving.set(false);
          this.escalationTried.set(false);
          this.saved.set(tiers);
          // The route answers the tiers; the warnings were stored as sent.
          const notices = this.savedNotices();
          if (notices) {
            this.savedNotices.set({
              ...notices,
              warnBeforeDue: { LOW: v.LOW.warnBeforeDue, MEDIUM: v.MEDIUM.warnBeforeDue, HIGH: v.HIGH.warnBeforeDue, CRITICAL: v.CRITICAL.warnBeforeDue },
            });
          }
          this.applyEscalation(tiers);
          this.limitsTick.update((n) => n + 1);
          this.escalationSaved.set(true);
          this.loadHistory();
        },
        error: (err: unknown) => {
          this.escalationSaving.set(false);
          const warning = taskSlaWarningRefusal(err);
          if (warning?.code === 'TASK_SLA_WARNING_NOT_BEFORE_DUE') {
            this.warningRefusal.set(warning);
            this.focusFirst([`warn:${warning.priority}`]);
            return;
          }
          this.escalationError.set('adminSettings.taskSlaPage.saveFailed');
        },
      });
  }

  discard(section: SectionKey): void {
    const saved = this.saved();
    if (!saved) return;
    if (section === 'limits') {
      this.applyLimits(saved);
      this.limitsTried.set(false);
      this.limitsError.set(null);
      this.conflicts.set([]);
      this.limitWarningRefusal.set(null);
    } else {
      this.applyEscalation(saved);
      this.escalationTried.set(false);
      this.escalationError.set(null);
      this.warningRefusal.set(null);
    }
  }

  /** The switch was saved: take the stored notices, and read the history again. */
  onNoticesChanged(notices: ITaskSlaNotices): void {
    const held = this.savedNotices();
    // Only the switch moved; an unsaved warning edit in the matrix keeps its baseline.
    this.savedNotices.set(held ? { ...held, notifyOnDueChange: notices.notifyOnDueChange } : notices);
    this.loadHistory();
  }

  /** Reset wrote the defaults: every section takes them, unsaved edits included. */
  onReset(policy: ITaskSlaPolicy): void {
    this.applyPolicy(policy);
    this.limitsTried.set(false);
    this.limitsError.set(null);
    this.conflicts.set([]);
    this.limitWarningRefusal.set(null);
    this.escalationTried.set(false);
    this.escalationError.set(null);
    this.warningRefusal.set(null);
    this.loadHistory();
  }

  /** Focus the first named input that exists (the first problem, in reading order). */
  private focusFirst(ids: string[]): void {
    for (const id of ids) {
      // A warning cell's control is the select's trigger, which has no id.
      const el = id.startsWith('warn:')
        ? document.querySelector<HTMLElement>(`[data-sla-warn="${id.slice(5)}"] .am-overlay-select-trigger`)
        : document.getElementById(id);
      if (el) {
        el.focus();
        return;
      }
    }
  }

  // ── Leaving with unsaved work ────────────────────────────────────────────
  private dirtySectionNames(): string[] {
    const names: string[] = [];
    if (this.limitsDirty()) names.push(this.translate.instant('adminSettings.taskSlaPage.limits.title'));
    if (this.escalationDirty()) names.push(this.translate.instant('adminSettings.taskSlaPage.escalation.title'));
    return names;
  }

  canLeave(): boolean | Promise<boolean> {
    const names = this.dirtySectionNames();
    if (names.length === 0) return true;
    return new Promise<boolean>((resolve) => {
      this.amConfirm.ask({
        tone: 'destructive',
        header: this.translate.instant('adminSettings.taskSlaPage.leave.header'),
        message: this.translate.instant('adminSettings.taskSlaPage.leave.message', {
          sections: names.join(this.translate.instant('common.listSeparator')),
        }),
        acceptLabel: this.translate.instant('adminSettings.taskSlaPage.leave.accept'),
        rejectLabel: this.translate.instant('adminSettings.taskSlaPage.leave.reject'),
        accept: () => resolve(true),
        reject: () => resolve(false),
      });
    });
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirtySectionNames().length === 0) return;
    event.preventDefault();
    event.returnValue = '';
  }

  // ── Words ────────────────────────────────────────────────────────────────
  problemsText(n: number): string {
    return this.format.count('taskSla.problems', n);
  }

  /** The matrix's Limit: the SAVED hours, so an unsaved Time-limits edit is not shown as policy. */
  limitText(p: TaskSlaPriority): string {
    const saved = this.saved();
    return saved ? this.format.count('workflow.workingHours', saved[p].dueAfterHours) : '—';
  }

  cellLabel(p: TaskSlaPriority, column: 'warn' | 'manager' | 'head'): string {
    const key =
      column === 'warn'
        ? 'adminSettings.taskSlaPage.escalation.warnCell'
        : column === 'manager'
          ? 'adminSettings.taskSlaPage.escalation.managerCell'
          : 'adminSettings.taskSlaPage.escalation.headCell';
    return this.translate.instant(key, { priority: this.translate.instant(PRIORITY_KEYS[p]) });
  }

  /** The server refused this priority's LIMIT against its warning; the message is under the row (CC-332). */
  limitRefusedHere(p: TaskSlaPriority): boolean {
    return this.limitWarningRefusal()?.priority === p;
  }

  /** The server refused this priority's warning; its message says so under the row. */
  warnRefusedHere(p: TaskSlaPriority): boolean {
    return this.warningRefusal()?.priority === p;
  }

  /**
   * The warning select is marked invalid (error border, aria-invalid) when the
   * server refused it, or when a Save found it not shorter than its limit.
   * am-field cannot mark it: it marks an input, and the select's trigger is not one.
   */
  warnMarked(p: TaskSlaPriority): boolean {
    this.escalationTick();
    return this.warnRefusedHere(p) || (this.escalationTried() && this.escalationForm.controls[p].controls.warnBeforeDue.invalid);
  }

  warnLabel(value: TaskSlaWarnBeforeDue): string {
    return warnOptionLabel(value, this.translate, this.format);
  }

  /**
   * "Critical's warning is 4 working hours; the limit must be longer than that,
   * and it is 4 working hours." Said from the refusal's own numbers.
   */
  warningRefusalLead(refusal: TaskSlaWarningRefusal): string {
    const warning = refusal.warning as TaskSlaWarnBeforeDue;
    const known = WARN_BEFORE_DUE_OPTIONS.includes(warning);
    return this.translate.instant('adminSettings.taskSlaPage.warnRefusal.lead', {
      priority: this.translate.instant(PRIORITY_KEYS[refusal.priority as TaskSlaPriority]),
      warning: known ? this.format.count('workflow.workingHours', warnHours(warning, this.hoursPerDay())) : refusal.warning,
      limit: this.format.count('workflow.workingHours', refusal.limitHours),
    });
  }

  conflictsFor(priority: TaskSlaPriority): StageDeadlineConflict[] {
    return this.conflicts().filter((c) => c.priority === priority);
  }

  /** "High would become 24 working hours, which passes the deadline of:" */
  conflictLead(priority: TaskSlaPriority, conflicts: StageDeadlineConflict[]): string {
    return this.translate.instant('adminSettings.taskSlaRefusal.lead', {
      priority: this.translate.instant(PRIORITY_KEYS[priority]),
      due: this.format.count('workflow.workingHours', Math.max(...conflicts.map((c) => c.longestTaskHours))),
    });
  }

  /** "Committee Management · Terms Review (16 working hours)" — tenant names, by language. */
  conflictStage(conflict: StageDeadlineConflict): string {
    return this.translate.instant('adminSettings.taskSlaRefusal.stage', {
      template: this.language.bilingual(conflict.templateName, conflict.templateNameAr),
      stage: this.language.bilingual(conflict.stageName, conflict.stageNameAr),
      deadline: this.format.count('workflow.workingHours', conflict.stageHours),
    });
  }

  /** "Raise those deadlines first, or keep High at 16 or less." */
  conflictWayOut(priority: TaskSlaPriority, conflicts: StageDeadlineConflict[]): string {
    return this.translate.instant('adminSettings.taskSlaRefusal.wayOut', {
      priority: this.translate.instant(PRIORITY_KEYS[priority]),
      max: this.format.count('workflow.workingHours', Math.min(...conflicts.map((c) => c.stageHours))),
    });
  }

  notRecorded(): string {
    return this.translate.instant('common.notRecorded');
  }
}
