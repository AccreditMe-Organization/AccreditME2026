import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { StageDeadlineConflict, taskSlaStageConflicts } from '../../../workflow/workflow-refusal';
import { ITaskSlaPolicy, TenantService } from '../../../tenant/services/tenant.service';

/** The confirm's detail lines, literal so the translation-keys spec sees each one. */
const RESET_DETAIL_KEYS = [
  'adminSettings.taskSlaPage.reset.confirmDetails.limits',
  'adminSettings.taskSlaPage.reset.confirmDetails.escalation',
  'adminSettings.taskSlaPage.reset.confirmDetails.reminders',
  'adminSettings.taskSlaPage.reset.confirmDetails.notices',
] as const;

/**
 * ACC-313 PR 3 — the Task SLA page's Reset section, last and danger-bordered,
 * on POST /tenant/task-sla/reset (plan §5).
 *
 * "Reset policy…" asks first, through AmConfirmService. The confirm says what
 * goes back and what stays: tasks created afterwards use the defaults, and
 * open tasks keep the limits they were created with (Ahmad: new tasks only).
 *
 * A REFUSAL NAMES THE STAGES. When the defaults would break a stage deadline
 * the server refuses with TASK_SLA_EXCEEDS_STAGE_DEADLINES and writes nothing;
 * the stages come from the refusal's own data, each a link to its stage, under
 * the button. The confirm has already closed by then (it cannot stay open
 * across a request), so the section says it.
 */
@Component({
  selector: 'am-task-sla-reset',
  standalone: true,
  imports: [RouterLink, TranslatePipe, ButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="am-slr" data-sla-section="reset" aria-labelledby="sla-reset-title">
      <div class="am-slr__row">
        <div class="am-slr__text">
          <h2 class="am-slr__title" id="sla-reset-title">{{ 'adminSettings.taskSlaPage.reset.title' | translate }}</h2>
          <p class="am-slr__help">{{ 'adminSettings.taskSlaPage.reset.help' | translate }}</p>
          <p class="am-slr__help">{{ 'adminSettings.taskSlaPage.reset.recorded' | translate }}</p>
        </div>
        <p-button
          [label]="'adminSettings.taskSlaPage.reset.open' | translate"
          severity="danger"
          [outlined]="true"
          [loading]="busy()"
          [disabled]="!ready()"
          data-testid="sla-reset-open"
          (onClick)="ask($event)"
        />
      </div>
      @if (conflicts().length) {
        <div class="am-slr__refusal" role="alert" data-testid="sla-reset-conflicts">
          <span>{{ 'adminSettings.taskSlaPage.reset.conflictLead' | translate }}</span>
          <ul>
            @for (conflict of conflicts(); track conflict.stageId + conflict.priority) {
              <li>
                <a [routerLink]="['/workflows', conflict.workflowTemplateId, 'stages']" [queryParams]="{ stage: conflict.stageId }">{{ conflictStage(conflict) }}</a>
              </li>
            }
          </ul>
          <span>{{ 'adminSettings.taskSlaPage.reset.conflictWayOut' | translate }}</span>
        </div>
      }
      @if (error()) {
        <p class="am-slr__error" role="alert" data-testid="sla-reset-error">{{ 'adminSettings.taskSlaPage.reset.failed' | translate }}</p>
      }
      @if (done()) {
        <p class="am-slr__status" role="status" data-testid="sla-reset-done">{{ 'adminSettings.taskSlaPage.reset.done' | translate }}</p>
      }
    </section>
  `,
  styles: [
    `
      .am-slr{display:flex;flex-direction:column;gap:var(--am-space-12);padding:var(--am-space-16);background:var(--am-surface-raised);border:1px solid var(--am-danger-border);border-radius:var(--am-radius-card);min-inline-size:0}
      .am-slr__row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--am-space-12)}
      .am-slr__text{flex:1 1 280px;min-inline-size:0;display:flex;flex-direction:column;gap:var(--am-space-4)}
      .am-slr__title{margin:0;font-size:var(--am-type-value-size);line-height:var(--am-type-value-line);font-weight:600;color:var(--am-ink-900)}
      .am-slr__help{margin:0;font-size:var(--am-type-meta-size);line-height:var(--am-type-meta-line);color:var(--am-ink-500);text-wrap:pretty}
      .am-slr__refusal{display:flex;flex-direction:column;gap:var(--am-space-4);font-size:var(--am-type-meta-size);line-height:var(--am-type-meta-line);font-weight:500;color:var(--am-danger-ink)}
      .am-slr__refusal ul{margin:0;padding-inline-start:var(--am-space-16)}
      .am-slr__refusal a{color:var(--am-primary-700)}
      .am-slr__error{margin:0;font-size:var(--am-type-meta-size);line-height:var(--am-type-meta-line);font-weight:500;color:var(--am-danger-ink)}
      .am-slr__status{margin:0;font-size:var(--am-type-meta-size);line-height:var(--am-type-meta-line);color:var(--am-ink-700)}
    `,
  ],
})
export class TaskSlaResetComponent {
  private readonly tenantService = inject(TenantService);
  private readonly amConfirm = inject(AmConfirmService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly format = inject(FormatService);

  /** Only once the page holds a policy: a reset before it would race the read. */
  readonly ready = input(false);
  /** The defaults the server wrote, and the working day. */
  readonly reset = output<ITaskSlaPolicy>();

  readonly busy = signal(false);
  readonly error = signal(false);
  readonly done = signal(false);
  readonly conflicts = signal<StageDeadlineConflict[]>([]);

  ask(event?: Event): void {
    if (this.busy()) return;
    this.amConfirm.ask({
      tone: 'destructive',
      header: this.translate.instant('adminSettings.taskSlaPage.reset.confirmHeader'),
      message: this.translate.instant('adminSettings.taskSlaPage.reset.confirmBody'),
      // The four effects, one line each (CC-324); still no numbers: no route
      // gives the defaults before a reset.
      details: RESET_DETAIL_KEYS.map((key) => this.translate.instant(key)),
      acceptLabel: this.translate.instant('adminSettings.taskSlaPage.reset.confirmAccept'),
      rejectLabel: this.translate.instant('common.cancel'),
      opener: (event?.target as HTMLElement | null) ?? null,
      accept: () => this.run(),
    });
  }

  private run(): void {
    this.busy.set(true);
    this.error.set(false);
    this.done.set(false);
    this.conflicts.set([]);
    this.tenantService.resetTaskSla().subscribe({
      next: (policy) => {
        this.busy.set(false);
        this.done.set(true);
        this.reset.emit(policy);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        const conflicts = taskSlaStageConflicts(err);
        if (conflicts?.length) this.conflicts.set(conflicts);
        else this.error.set(true);
      },
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
}
