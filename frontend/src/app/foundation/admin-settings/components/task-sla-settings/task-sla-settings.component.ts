import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { RouterLink } from '@angular/router';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { StageDeadlineConflict, taskSlaStageConflicts } from '../../../workflow/workflow-refusal';
import { InputNumberModule } from 'primeng/inputnumber';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { TenantService, ITaskSlaSettings } from '../../../tenant/services/tenant.service';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { InputNumberLatinDigits } from '../../../../core/formatting/latin-digits';

// ACC-46 Section 2.7.c/2.7.d — one card per TaskPriority, three numeric
// fields per card. LOW->CRITICAL order matches task-form.component.ts's
// own PRIORITIES ordering, not the interface's own CRITICAL-first property
// order (that's just declaration order, not a UI convention).
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

// Literal keys, so the translation-keys spec sees each one.
const PRIORITY_KEYS: Record<(typeof PRIORITIES)[number], string> = {
  LOW: 'task.priority.low',
  MEDIUM: 'task.priority.medium',
  HIGH: 'task.priority.high',
  CRITICAL: 'task.priority.critical',
};

@Component({
  selector: 'app-task-sla-settings',
  standalone: true,
  imports: [PageHeaderComponent, ReactiveFormsModule, RouterLink, TranslatePipe, InputNumberModule, InputNumberLatinDigits, ButtonModule, MessageModule, CardComponent],
  template: `
    <div class="flex flex-col gap-4">
      <app-page-header
        [title]="'adminSettings.taskSla' | translate"
        [purpose]="'adminSettings.taskSlaNote' | translate"
      />

      @if (error()) {
        <p-message severity="error" [text]="error()! | translate" />
      }
      @if (savedMessage()) {
        <p-message severity="success" [text]="savedMessage()! | translate" />
      }

      <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" [formGroup]="form">
          @for (priority of priorities; track priority) {
            <app-card [formGroupName]="priority">
              <div class="flex flex-col gap-3">
                <h3 class="font-medium">{{ ('task.priority.' + priority.toLowerCase()) | translate }}</h3>
                <div class="flex flex-col gap-1">
                  <label class="text-sm text-[var(--am-text-secondary)]">{{ 'adminSettings.dueAfterHours' | translate }}</label>
                  <p-inputNumber
                    formControlName="dueAfterHours"
                    [min]="1"
                    [showButtons]="true"
                    styleClass="w-full"
                    [inputStyleClass]="conflictsFor(priority).length ? 'w-full p-invalid' : 'w-full'"
                  />
                  <!-- ACC-208 — the stage-deadline rule's third side. Every
                       stage this change would break, each a link to its row
                       (the ?stage= Fix link expands it), and the way out. -->
                  @if (conflictsFor(priority); as conflicts) {
                    @if (conflicts.length) {
                      <div class="am-sla-refusal" role="alert" [attr.data-sla-conflicts]="priority">
                        <span>{{ conflictLead(priority, conflicts) }}</span>
                        <ul>
                          @for (conflict of conflicts; track conflict.stageId) {
                            <li>
                              <a
                                [routerLink]="['/workflows', conflict.workflowTemplateId, 'stages']"
                                [queryParams]="{ stage: conflict.stageId }"
                              >{{ conflictStage(conflict) }}</a>
                            </li>
                          }
                        </ul>
                        <span>{{ conflictWayOut(priority, conflicts) }}</span>
                      </div>
                    }
                  }
                </div>
                <div class="flex flex-col gap-1">
                  <label class="text-sm text-[var(--am-text-secondary)]">{{ 'adminSettings.managerEscalationAfterHours' | translate }}</label>
                  <p-inputNumber formControlName="managerEscalationAfterHours" [min]="0" [showButtons]="true" styleClass="w-full" inputStyleClass="w-full" />
                </div>
                <div class="flex flex-col gap-1">
                  <label class="text-sm text-[var(--am-text-secondary)]">{{ 'adminSettings.headEscalationAfterHours' | translate }}</label>
                  <p-inputNumber formControlName="headEscalationAfterHours" [min]="0" [showButtons]="true" styleClass="w-full" inputStyleClass="w-full" />
                </div>
              </div>
            </app-card>
          }
        </div>
        <div class="flex justify-end">
          <p-button [label]="'common.save' | translate" type="submit" [loading]="saving()" [disabled]="form.invalid" />
        </div>
      </form>
    </div>
  `,
  styles: [
    `
      .am-sla-refusal {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-4);
        margin-block-start: var(--am-space-4);
        font-size: var(--am-type-meta-size);
        font-weight: 500;
        color: var(--am-danger-ink);
      }
      .am-sla-refusal ul {
        margin: 0;
        padding-inline-start: var(--am-space-16);
      }
      .am-sla-refusal a {
        color: var(--am-primary-600);
      }
    `,
  ],
})
export class TaskSlaSettingsComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly tenantService = inject(TenantService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly format = inject(FormatService);

  readonly priorities = PRIORITIES;
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly savedMessage = signal<string | null>(null);

  private buildTierGroup() {
    return this.fb.group({
      dueAfterHours: [1, [Validators.required, Validators.min(1)]],
      managerEscalationAfterHours: [0, [Validators.required, Validators.min(0)]],
      headEscalationAfterHours: [0, [Validators.required, Validators.min(0)]],
    });
  }

  readonly form = this.fb.group({
    LOW: this.buildTierGroup(),
    MEDIUM: this.buildTierGroup(),
    HIGH: this.buildTierGroup(),
    CRITICAL: this.buildTierGroup(),
  });

  /** ACC-208 — the stages a refused save would have broken, until the form changes. */
  readonly conflicts = signal<StageDeadlineConflict[]>([]);

  conflictsFor(priority: (typeof PRIORITIES)[number]): StageDeadlineConflict[] {
    return this.conflicts().filter((c) => c.priority === priority);
  }

  /** "High would become 24 working hours, which passes the deadline of:" */
  conflictLead(priority: (typeof PRIORITIES)[number], conflicts: StageDeadlineConflict[]): string {
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
  conflictWayOut(priority: (typeof PRIORITIES)[number], conflicts: StageDeadlineConflict[]): string {
    return this.translate.instant('adminSettings.taskSlaRefusal.wayOut', {
      priority: this.translate.instant(PRIORITY_KEYS[priority]),
      max: Math.min(...conflicts.map((c) => c.stageHours)),
    });
  }

  ngOnInit(): void {
    this.form.valueChanges.subscribe(() => this.conflicts.set([]));
    this.tenantService.getTaskSla().subscribe({
      next: (settings) => this.form.patchValue(settings),
      error: () => this.error.set('adminSettings.errorLoad'),
    });
  }

  onSubmit(): void {
    if (this.form.invalid) return;

    this.saving.set(true);
    this.error.set(null);
    this.savedMessage.set(null);
    this.conflicts.set([]);

    const dto = this.form.getRawValue() as ITaskSlaSettings;
    this.tenantService.updateTaskSla(dto).subscribe({
      next: () => {
        this.saving.set(false);
        this.savedMessage.set('adminSettings.savedSuccess');
      },
      error: (err: unknown) => {
        this.saving.set(false);
        // ACC-208 — refused for breaking stage deadlines: say which, under the
        // priority that breaks each one, rather than a generic failure.
        const conflicts = taskSlaStageConflicts(err);
        if (conflicts?.length) {
          this.conflicts.set(conflicts);
          return;
        }
        this.error.set('adminSettings.errorSave');
      },
    });
  }
}
