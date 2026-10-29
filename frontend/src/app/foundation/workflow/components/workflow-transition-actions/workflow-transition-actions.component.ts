import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { forkJoin } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { WorkflowService, WorkflowInstanceDto } from '../../services/workflow.service';
import { WorkflowStageDto, WorkflowTemplateService, WorkflowTransitionDto } from '../../services/workflow-template.service';
import { OpenStageTask, openStageTasks, plainWorkflowRefusalKey } from '../../workflow-refusal';
import { CantMoveDialogComponent } from '../cant-move-dialog/cant-move-dialog.component';
import { LanguageService } from '../../../../core/services/language.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';

// Generic, reusable across every WorkflowObjectType (Committee, and later
// Document, Incident, CAPA, Gap, Audit, KPI, ...) — contains zero
// object-type-specific logic. Renders one button per transition available
// FROM the instance's current stage that the SERVER says the caller may press
// (ACC-271 PR 2: GET /workflows/instances/:id/moves). On a converted stage
// that is whoever works it, whatever permission the move once required, so
// this screen keeps no copy of the rule. Still not a security boundary:
// WorkflowService.triggerTransition() decides again on every press.
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
  imports: [ButtonModule, MessageModule, TranslatePipe, CantMoveDialogComponent],
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

    <!-- ACC-208 — an Advance refused while the stage's mandatory tasks are
         open (STAGE_TASKS_OPEN): which tasks, as links to their rows. -->
    @if (cantMove(); as refused) {
      <app-cant-move-dialog
        [visible]="true"
        [tasks]="refused.tasks"
        [title]="'workflow.cantMove.title' | translate: { stage: refused.toStage }"
        [lead]="'workflow.cantMove.lead' | translate: { stage: refused.toStage }"
        [context]="refusalContext()"
        [openedFrom]="refused.label"
        (closed)="cantMove.set(null)"
      />
    }
  `,
})
export class WorkflowTransitionActionsComponent {
  private readonly workflowService = inject(WorkflowService);
  private readonly workflowTemplateService = inject(WorkflowTemplateService);
  private readonly languageService = inject(LanguageService);

  readonly instance = input.required<WorkflowInstanceDto>();
  /** ACC-208 — the record's own name, for the "Can't move yet" dialog's context line. */
  readonly recordLabel = input<string | null>(null);
  readonly transitioned = output<WorkflowInstanceDto>();

  readonly transitionsFromCurrentStage = signal<WorkflowTransitionDto[]>([]);
  /** ACC-271 — the ids the server says this person may press. */
  private readonly pressable = signal<ReadonlySet<string>>(new Set());
  readonly triggeringId = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly warnings = signal<string[]>([]);
  /** ACC-208 — a move refused for open mandatory tasks: what was pressed, where to, and which tasks. */
  readonly cantMove = signal<{ label: string; toStage: string; tasks: OpenStageTask[] } | null>(null);
  private readonly stages = signal<WorkflowStageDto[]>([]);
  private readonly translate = inject(TranslateService);

  /** "Infection Control Committee · Terms Review" — the record, then the stage it is held in. */
  readonly refusalContext = computed(() => {
    const stage = this.stageName(this.instance().currentStageId);
    const record = this.recordLabel();
    return record ? `${record} · ${stage}` : stage;
  });

  readonly availableTransitions = computed(() =>
    this.transitionsFromCurrentStage().filter((t) => this.pressable().has(t.id)),
  );

  constructor() {
    effect(() => {
      this.loadTransitions(this.instance());
    });
  }

  transitionLabel(transition: WorkflowTransitionDto): string {
    return this.languageService.bilingual(transition.labelEn, transition.labelAr);
  }

  /** Tenant data, chosen by language (ACC-160); an unknown id reads as nothing rather than the id. */
  private stageName(stageId: string | null): string {
    const stage = this.stages().find((s) => s.id === stageId);
    return stage ? this.languageService.bilingual(stage.nameEn, stage.nameAr) : '';
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
        const tasks = openStageTasks(err);
        if (tasks) {
          this.cantMove.set({
            label: this.transitionLabel(transition),
            toStage: this.stageName(transition.toStageId),
            tasks,
          });
          return;
        }
        this.error.set(plainWorkflowRefusalKey(err) ?? extractErrorMessage(err, 'workflow.errorTransition'));
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
    this.pressable.set(new Set());

    if (!instance.currentStageId) return;

    // ACC-271 PR 2 — the template for the labels and stages, and the server's
    // answer for which moves this person may press. Neither alone shows a button.
    forkJoin({
      template: this.workflowTemplateService.getTemplate(instance.workflowTemplateId),
      moves: this.workflowService.getMoves(instance.id),
    }).subscribe({
      next: ({ template, moves }) => {
        this.stages.set(template.stages ?? []);
        const stage = template.stages?.find((s) => s.id === instance.currentStageId);
        this.pressable.set(new Set(moves.transitionIds));
        this.transitionsFromCurrentStage.set(stage?.transitions ?? []);
      },
    });
  }
}
