import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { WorkflowService, WorkflowInstanceDto, WorkflowMoveDto } from '../../services/workflow.service';
import {
  OpenStageTask,
  membersBelowQuorum,
  openStageTasks,
  plainWorkflowRefusalKey,
  requiredSeatsEmpty,
} from '../../workflow-refusal';
import { FormatService } from '../../../../core/formatting';
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
// The buttons are exactly the moves GET /workflows/instances/:id/moves returns
// (ACC-271): a person's moves, for whoever works the stage. The app's own moves
// are never offered. ACC-282: each move carries its label and the stage it leads
// to, so this component reads no template (GET /workflow-templates/:id needs
// workflows:view, which a pool member may not hold).
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
  private readonly languageService = inject(LanguageService);

  readonly instance = input.required<WorkflowInstanceDto>();
  /** ACC-208 — the record's own name, for the "Can't move yet" dialog's context line. */
  readonly recordLabel = input<string | null>(null);
  /** ACC-282 — the current stage's name, as the page shows it, for the same line. */
  readonly stageLabel = input<string | null>(null);
  readonly transitioned = output<WorkflowInstanceDto>();

  /** ACC-271 / ACC-282 — the moves the server says this person may press, as it labels them. */
  readonly moves = signal<WorkflowMoveDto[]>([]);
  readonly triggeringId = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly warnings = signal<string[]>([]);
  /** ACC-208 — a move refused for open mandatory tasks: what was pressed, where to, and which tasks. */
  readonly cantMove = signal<{ label: string; toStage: string; tasks: OpenStageTask[] } | null>(null);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);

  /** "Infection Control Committee · Terms Review" — the record, then the stage it is held in. */
  readonly refusalContext = computed(() => {
    const stage = this.stageLabel() ?? '';
    const record = this.recordLabel();
    return record ? `${record} · ${stage}` : stage;
  });

  readonly availableTransitions = computed(() => this.moves());

  constructor() {
    effect(() => {
      this.loadTransitions(this.instance());
    });
  }

  /** Tenant data, chosen by language (ACC-160). */
  transitionLabel(transition: WorkflowMoveDto): string {
    return this.languageService.bilingual(transition.labelEn, transition.labelAr);
  }

  onTrigger(transition: WorkflowMoveDto): void {
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
            toStage: this.languageService.bilingual(transition.toStageNameEn, transition.toStageNameAr),
            tasks,
          });
          return;
        }
        this.error.set(this.goingLiveRefusal(err) ?? plainWorkflowRefusalKey(err) ?? extractErrorMessage(err, 'workflow.errorTransition'));
      },
    });
  }

  /**
   * ACC-286 — a committee refused going live, in words: how many members it
   * has against its quorum, or which required seats are empty (tenant data,
   * named in the reader's language). Null for any other refusal.
   */
  private goingLiveRefusal(err: unknown): string | null {
    const below = membersBelowQuorum(err);
    if (below) return this.format.count('workflow.membersBelowQuorum', below.quorum, { members: this.format.number(below.members) });
    const seats = requiredSeatsEmpty(err);
    if (seats) {
      const names = seats
        .map((s) => this.languageService.bilingual(s.labelEn, s.labelAr))
        .join(this.translate.instant('common.listSeparator'));
      return this.translate.instant('workflow.refusal.requiredSeatsEmpty', { seats: names || '—' }) as string;
    }
    return null;
  }

  private loadTransitions(instance: WorkflowInstanceDto): void {
    // ACC-54 (finding F5) — clear BEFORE fetching, not only on success.
    //
    // This runs from an effect on instance(), so it re-runs the moment a
    // transition fires and the instance advances. The moves read is an HTTP
    // round-trip (it was getTemplate() until ACC-282), and until it resolved this
    // signal still held the PREVIOUS stage's transitions — so the page kept offering the old stage's action
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
    this.moves.set([]);

    if (!instance.currentStageId) return;

    // ACC-282 — one read: which moves this person may press, each with its label
    // and where it leads. An empty answer (outside the pool) shows no button.
    this.workflowService.getMoves(instance.id).subscribe({
      next: (answer) => this.moves.set(answer.moves),
    });
  }
}
