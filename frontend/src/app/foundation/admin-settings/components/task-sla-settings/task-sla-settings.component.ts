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
import { StageDeadlineConflict, taskSlaStageConflicts } from '../../../workflow/workflow-refusal';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { ListDialogComponent } from '../../../../shared/components/list-dialog/list-dialog.component';
import { TaskSlaHistoryComponent } from './task-sla-history.component';
import { AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { LeaveGuarded } from '../../../roles/permission-matrix/leave-guard';
import {
  ITaskSlaChange,
  ITaskSlaSettings,
  TaskSlaPriority,
  TenantService,
} from '../../../tenant/services/tenant.service';
import { TASK_SLA_PRIORITIES } from './task-sla-change';

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
 * sideways, because it holds no chain that could wrap mid-step. The warning
 * column, the Notifications switch and Reset are later PRs, and are ABSENT
 * here rather than disabled. There is no table of contents (Ahmad, Q9).
 */
@Component({
  selector: 'app-task-sla-settings',
  standalone: true,
  imports: [
    ReactiveFormsModule,
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
                <span dir="ltr">{{ change.changedAt | amDateTime }}</span>
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
                <!-- ACC-208 — the stage-deadline rule's third side, under the
                     priority it is about, said from the refusal's code and
                     numbers, never the server's English. -->
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
              }
            </div>
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

      <!-- ── Escalation per priority: the matrix ─────────────────────────── -->
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
                  <span>{{ 'adminSettings.taskSlaPage.escalation.manager' | translate }}</span>
                  <span>{{ 'adminSettings.taskSlaPage.escalation.head' | translate }}</span>
                </div>
              }
              @for (p of priorities; track p) {
                <div class="am-sla__row" [formGroupName]="p" [attr.data-sla-row]="p">
                  <span class="am-sla__priority" [attr.data-priority]="p">{{ priorityKeys[p] | translate }}</span>
                  <span class="am-sla__limit">
                    @if (stacked()) {
                      <span class="am-sla__limit-label">{{ 'adminSettings.taskSlaPage.escalation.limit' | translate }}</span>
                    }
                    <span data-testid="sla-matrix-limit">{{ limitText(p) }}</span>
                  </span>
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
    </div>

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
      .am-sla__refusal{grid-column:1/-1;display:flex;flex-direction:column;gap:var(--am-space-4);font-size:var(--am-type-meta-size);line-height:var(--am-type-meta-line);font-weight:500;color:var(--am-danger-ink)}
      .am-sla__refusal ul{margin:0;padding-inline-start:var(--am-space-16)}
      .am-sla__refusal a{color:var(--am-primary-700)}
      .am-sla__matrix{display:flex;flex-direction:column;gap:var(--am-space-8);min-inline-size:0}
      .am-sla__row{display:grid;grid-template-columns:106px 120px minmax(0,1fr) minmax(0,1fr);gap:var(--am-space-12);align-items:start}
      .am-sla__row--head{font-size:var(--am-type-meta-size);line-height:var(--am-type-meta-line);font-weight:500;color:var(--am-ink-500);padding-block-end:var(--am-space-4);border-block-end:1px solid var(--am-border)}
      .am-sla__priority{align-self:center;justify-self:start;font-size:var(--am-type-meta-size);font-weight:600;color:var(--am-neutral-chip-ink);background:var(--am-neutral-chip-bg);border:1px solid var(--am-neutral-chip-border);border-radius:var(--am-radius-pill);padding:0 var(--am-space-8)}
      .am-sla__limit{align-self:center;font-size:var(--am-type-body-size);color:var(--am-ink-900);min-inline-size:0}
      .am-sla__matrix--stacked .am-sla__row{grid-template-columns:minmax(0,1fr);padding-block:var(--am-space-12);border-block-start:1px solid var(--am-border)}
      .am-sla__matrix--stacked .am-sla__limit{display:flex;flex-direction:column}
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

  // ── The policy read ──────────────────────────────────────────────────────
  readonly load = signal<Load>('loading');
  /** The tiers the server holds: the baseline both sections compare against. */
  readonly saved = signal<ITaskSlaSettings | null>(null);

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
  private readonly limitsTick = signal(0);

  // ── Escalation ───────────────────────────────────────────────────────────
  readonly escalationForm = this.fb.group({
    LOW: this.escalationGroup(),
    MEDIUM: this.escalationGroup(),
    HIGH: this.escalationGroup(),
    CRITICAL: this.escalationGroup(),
  });
  readonly escalationTried = signal(false);
  readonly escalationSaving = signal(false);
  readonly escalationError = signal<string | null>(null);
  readonly escalationSaved = signal(false);
  private readonly escalationTick = signal(0);

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
      return v.managerEscalationAfterHours !== saved[p].managerEscalationAfterHours || v.headEscalationAfterHours !== saved[p].headEscalationAfterHours;
    });
  });

  /** Invalid fields once a Save was tried, plus every priority a stage refusal names. */
  readonly limitsProblems = computed(() => {
    this.limitsTick();
    const invalid = this.limitsTried() ? this.priorities.filter((p) => this.limitsForm.controls[p].invalid).length : 0;
    return invalid + new Set(this.conflicts().map((c) => c.priority)).size;
  });

  readonly escalationProblems = computed(() => {
    this.escalationTick();
    if (!this.escalationTried()) return 0;
    return this.priorities.reduce((n, p) => {
      const g = this.escalationForm.controls[p].controls;
      return n + (g.managerEscalationAfterHours.invalid ? 1 : 0) + (g.headEscalationAfterHours.invalid ? 1 : 0);
    }, 0);
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
      this.limitsSaved.set(false);
      this.limitsError.set(null);
    });
    const escalation = this.escalationForm.valueChanges.subscribe(() => {
      this.escalationTick.update((n) => n + 1);
      this.escalationSaved.set(false);
      this.escalationError.set(null);
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

  private escalationGroup() {
    return this.fb.group({
      managerEscalationAfterHours: this.fb.control<number | null>(null, [Validators.required, Validators.min(0)]),
      headEscalationAfterHours: this.fb.control<number | null>(null, [Validators.required, Validators.min(0)]),
    });
  }

  // ── Reads ────────────────────────────────────────────────────────────────
  loadPolicy(): void {
    this.load.set('loading');
    this.tenantService.getTaskSla().subscribe({
      next: (tiers) => {
        this.saved.set(tiers);
        this.applyLimits(tiers);
        this.applyEscalation(tiers);
        this.load.set('ready');
      },
      error: () => this.load.set('error'),
    });
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

  private applyEscalation(tiers: ITaskSlaSettings): void {
    const row = (p: TaskSlaPriority) => ({
      managerEscalationAfterHours: tiers[p].managerEscalationAfterHours,
      headEscalationAfterHours: tiers[p].headEscalationAfterHours,
    });
    this.escalationForm.setValue({ LOW: row('LOW'), MEDIUM: row('MEDIUM'), HIGH: row('HIGH'), CRITICAL: row('CRITICAL') }, { emitEvent: false });
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
          this.escalationTick.update((n) => n + 1);
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
    });
    this.escalationSaving.set(true);
    this.escalationError.set(null);
    this.tenantService
      .updateTaskSlaEscalation({ LOW: row('LOW'), MEDIUM: row('MEDIUM'), HIGH: row('HIGH'), CRITICAL: row('CRITICAL') })
      .subscribe({
        next: (tiers) => {
          this.escalationSaving.set(false);
          this.escalationTried.set(false);
          this.saved.set(tiers);
          this.applyEscalation(tiers);
          this.limitsTick.update((n) => n + 1);
          this.escalationSaved.set(true);
          this.loadHistory();
        },
        error: () => {
          this.escalationSaving.set(false);
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
    } else {
      this.applyEscalation(saved);
      this.escalationTried.set(false);
      this.escalationError.set(null);
    }
  }

  /** Focus the first named input that exists (the first problem, in reading order). */
  private focusFirst(ids: string[]): void {
    for (const id of ids) {
      const el = document.getElementById(id);
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

  cellLabel(p: TaskSlaPriority, column: 'manager' | 'head'): string {
    const key = column === 'manager' ? 'adminSettings.taskSlaPage.escalation.managerCell' : 'adminSettings.taskSlaPage.escalation.headCell';
    return this.translate.instant(key, { priority: this.translate.instant(PRIORITY_KEYS[p]) });
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
      max: Math.min(...conflicts.map((c) => c.stageHours)),
    });
  }

  notRecorded(): string {
    return this.translate.instant('common.notRecorded');
  }
}
