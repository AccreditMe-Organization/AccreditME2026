import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { TranslatePipe } from '@ngx-translate/core';
import { WorkflowService, WorkflowInstanceDto } from '../../services/workflow.service';
import { WorkflowTemplateService, WorkflowTransitionDto } from '../../services/workflow-template.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { LanguageService } from '../../../../core/services/language.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';

// Generic, reusable across every WorkflowObjectType (Committee, and later
// Document, Incident, CAPA, Gap, Audit, KPI, ...) — contains zero
// object-type-specific logic. Renders one button per transition available
// FROM the instance's current stage that the caller holds requiredPermission
// for. Permission filtering here is a UX nicety only, not a security
// boundary — it just avoids showing a button that would 403 on click;
// WorkflowService.triggerTransition() re-validates requiredPermission
// server-side regardless (see workflow.service.ts's triggerTransition()).
//
// Transition labels (labelEn/labelAr) are rendered directly, NOT through
// the | translate pipe — transitions are tenant-editable data (a tenant
// admin can rename "Submit for Approval" to anything via the workflow
// builder), not fixed app strings. Same reasoning as WorkflowStage's
// plain-text nameEn/nameAr display (see
// step-22-committee-management.md's revised Pending Discussion #8 — the
// underlying gap that motivated that decision, WorkflowStage having no
// persisted stage key/slug, applies identically to WorkflowTransition).
//
// Does NOT filter on triggerCondition (e.g. hiding SYSTEM_AUTOMATIC
// transitions a human should never manually fire) — out of scope for this
// pass since no shipped workflow seed uses anything but ROLE_BASED today.
// Flagging here for whichever future module first seeds a
// SYSTEM_AUTOMATIC/SPECIFIC_USER transition and needs this component to
// stop showing it as a clickable button.
@Component({
  selector: 'app-workflow-transition-actions',
  standalone: true,
  imports: [ButtonModule, MessageModule, TranslatePipe],
  template: `
    @if (error()) {
      <p-message severity="error" [text]="error()! | translate" />
    }
    @if (availableTransitions().length > 0) {
      <div class="flex flex-wrap gap-2">
        @for (transition of availableTransitions(); track transition.id) {
          <p-button
            [label]="transitionLabel(transition)"
            size="small"
            [loading]="triggeringId() === transition.id"
            [disabled]="triggeringId() !== null"
            (onClick)="onTrigger(transition)"
          />
        }
      </div>
    }
  `,
})
export class WorkflowTransitionActionsComponent {
  private readonly workflowService = inject(WorkflowService);
  private readonly workflowTemplateService = inject(WorkflowTemplateService);
  private readonly navigationAccessService = inject(NavigationAccessService);
  private readonly languageService = inject(LanguageService);

  readonly instance = input.required<WorkflowInstanceDto>();
  readonly transitioned = output<WorkflowInstanceDto>();

  readonly transitionsFromCurrentStage = signal<WorkflowTransitionDto[]>([]);
  readonly triggeringId = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  readonly availableTransitions = computed(() =>
    this.transitionsFromCurrentStage().filter(
      (t) => !t.requiredPermission || this.navigationAccessService.hasPermission(t.requiredPermission),
    ),
  );

  constructor() {
    effect(() => {
      this.loadTransitions(this.instance());
    });
  }

  transitionLabel(transition: WorkflowTransitionDto): string {
    return this.languageService.isArabic() ? transition.labelAr : transition.labelEn;
  }

  onTrigger(transition: WorkflowTransitionDto): void {
    const instanceId = this.instance().id;
    this.triggeringId.set(transition.id);
    this.error.set(null);

    this.workflowService.triggerTransition(instanceId, { transitionId: transition.id }).subscribe({
      next: (updated) => {
        this.triggeringId.set(null);
        this.transitioned.emit(updated);
      },
      error: (err: unknown) => {
        this.triggeringId.set(null);
        this.error.set(extractErrorMessage(err, 'workflow.errorTransition'));
      },
    });
  }

  private loadTransitions(instance: WorkflowInstanceDto): void {
    if (!instance.currentStageId) {
      this.transitionsFromCurrentStage.set([]);
      return;
    }
    this.workflowTemplateService.getTemplate(instance.workflowTemplateId).subscribe({
      next: (template) => {
        const stage = template.stages?.find((s) => s.id === instance.currentStageId);
        this.transitionsFromCurrentStage.set(stage?.transitions ?? []);
      },
    });
  }
}
