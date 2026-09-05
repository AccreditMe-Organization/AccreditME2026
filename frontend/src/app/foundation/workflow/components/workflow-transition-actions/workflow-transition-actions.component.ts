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
    @for (w of warnings(); track w) {
      <p-message severity="warn" [text]="w" />
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
  readonly warnings = signal<string[]>([]);

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
        this.warnings.set(updated.unassignedTaskWarnings);
        this.transitioned.emit(updated);
      },
      error: (err: unknown) => {
        this.triggeringId.set(null);
        this.error.set(extractErrorMessage(err, 'workflow.errorTransition'));
      },
    });
  }

  private loadTransitions(instance: WorkflowInstanceDto): void {
    // ACC-54 (finding F5) — clear BEFORE fetching, not only on success.
    //
    // This runs from an effect on instance(), so it re-runs the moment a
    // transition fires and the instance advances. getTemplate() is an HTTP
    // round-trip, and until it resolved this signal still held the PREVIOUS
    // stage's transitions — so the page kept offering the old stage's action
    // (e.g. "Submit for Approval" after the instance had already moved to
    // Terms Review) for the whole duration of the request.
    //
    // That window is a race, not a property of any particular path: the
    // no-holder path merely happens to widen it (an extra p-message render,
    // and the parent issuing its own concurrent getTemplate() from
    // setCurrentInstance()), which is why it was observed there and not on
    // the clean path. It could surface on either.
    //
    // Showing nothing briefly is strictly better than showing a stale
    // control, because the stale button is CLICKABLE and clicking it fails:
    // triggerTransition() rejects a transition whose fromStageId no longer
    // matches the instance's current stage.
    this.transitionsFromCurrentStage.set([]);

    if (!instance.currentStageId) return;

    this.workflowTemplateService.getTemplate(instance.workflowTemplateId).subscribe({
      next: (template) => {
        const stage = template.stages?.find((s) => s.id === instance.currentStageId);
        this.transitionsFromCurrentStage.set(stage?.transitions ?? []);
      },
    });
  }
}
