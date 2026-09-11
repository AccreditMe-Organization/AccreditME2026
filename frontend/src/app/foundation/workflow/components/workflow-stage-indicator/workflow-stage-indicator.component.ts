import { Component, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  WorkflowService,
  WorkflowInstanceDto,
  WorkflowStageHistoryDto,
} from '../../services/workflow.service';
import { LanguageService } from '../../../../core/services/language.service';
import { ResolvedDelegationDto } from '../../../tasks/services/task.service';

// ACC-76 — a read-only view of where a record is in its workflow, replacing
// the bare "Current Stage: X" label. Generic over object type, like
// WorkflowTransitionActionsComponent beside it: it takes an instance and
// nothing module-specific.
//
// TWO VIEWS, BOTH REQUIRED — and an earlier revision of this component
// shipped only the second, which was wrong.
//
//   SEQUENCE   every stage the template defines, in order, always. Tells a
//              reader what the lifecycle IS and where this record sits in it.
//   HISTORY    the chronology of actual visits, repeats preserved. Tells them
//              what happened to THIS record.
//
// The argument that produced the mistake still holds, but proves something
// narrower than it first appeared. A stepper's grammar — numbered nodes, ticks
// behind you, "step 3 of 6" — states something false about a record that
// revisited a stage, and this engine produces those by design (Committee's
// TERMS_REVIEW -> FORMATION "Revise Terms" transition). WorkflowStage.order
// cannot rescue it: order is a display field, not a traversal record.
//
// What follows is not "drop the sequence" but "the sequence must not claim to
// be a progression". So it asserts only reached / current / not yet reached,
// and shows a repeat as a visit count rather than flattening it away.
@Component({
  selector: 'app-workflow-stage-indicator',
  standalone: true,
  imports: [DatePipe, TranslatePipe],
  template: `
    @if (history(); as h) {
      <div class="flex flex-col gap-5">
        @if (show() !== 'history') {
        <!-- THE SEQUENCE. Every stage the template defines, in order, always
             — including before the record has been anywhere. This is what
             tells a reader who has never seen a committee before what the
             lifecycle actually is.

             It admits loops rather than hiding them: a stage entered more
             than once carries its count. What it deliberately does NOT do is
             tick off "completed" stages or number them "3 of 6" — with a
             revisit there is no such number, and claiming one would be
             false. Reached / current / not yet reached is all it asserts. -->
        <div class="flex flex-wrap items-center gap-x-1 gap-y-2">
          @for (stage of h.stages; track stage.id) {
            <span
              class="text-sm px-2.5 py-1 rounded-full whitespace-nowrap"
              [style.background]="stage.isCurrent ? 'var(--am-blue-primary)' : 'transparent'"
              [style.color]="
                stage.isCurrent
                  ? 'white'
                  : stage.visitCount > 0
                    ? 'var(--am-text-primary)'
                    : 'var(--am-text-secondary)'
              "
              [style.border]="
                stage.isCurrent
                  ? '1px solid var(--am-blue-primary)'
                  : stage.visitCount > 0
                    ? '1px solid var(--am-text-secondary)'
                    : '1px dashed var(--am-border)'
              "
            >
              {{ stageName(stage.nameEn, stage.nameAr) }}
              @if (stage.visitCount > 1) {
                <span class="text-xs opacity-80">×{{ stage.visitCount }}</span>
              }
            </span>
            @if (!$last) {
              <!-- A chevron, not an arrow into a progress bar: it separates
                   stages in the template's declared order and claims nothing
                   about what this record will do next. RTL-safe via the
                   direction-aware icon. -->
              <i
                class="pi text-xs text-[var(--am-text-secondary)]"
                [class.pi-chevron-right]="!isRtl()"
                [class.pi-chevron-left]="isRtl()"
              ></i>
            }
          }
          </div>
        }

        @if (show() !== 'sequence') {
        <ol class="flex flex-col">
          @for (visit of h.visits; track visit.id) {
            <li class="flex gap-3">
              <!-- Rail: a dot per visit, with a connector to the next. The
                   connector joins consecutive VISITS, which is a real
                   chronological relationship — unlike a connector between
                   template stages, which would assert an order that does not
                   exist. -->
              <div class="flex flex-col items-center">
                <span
                  class="mt-1.5 w-2.5 h-2.5 rounded-full shrink-0"
                  [style.background]="
                    isCurrent(visit.exitedAt)
                      ? 'var(--am-blue-primary)'
                      : 'var(--am-text-secondary)'
                  "
                ></span>
                @if (!$last) {
                  <span class="w-px flex-1 my-1" style="background: var(--am-border)"></span>
                }
              </div>

              <div class="pb-4 flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span [class]="isCurrent(visit.exitedAt) ? 'font-semibold' : 'font-medium'">
                    {{ stageName(visit.stageNameEn, visit.stageNameAr) }}
                  </span>
                  @if (isCurrent(visit.exitedAt)) {
                    <span
                      class="text-xs px-2 py-0.5 rounded-full"
                      style="background: var(--am-blue-primary); color: white"
                    >
                      {{ 'workflow.stageIndicator.current' | translate }}
                    </span>
                  }
                  @if (visit.isUnassigned) {
                    <span class="text-xs text-[var(--am-text-secondary)]">
                      {{ 'workflow.stageIndicator.unassigned' | translate }}
                    </span>
                  }
                </div>

                <p class="text-xs text-[var(--am-text-secondary)] mt-0.5">
                  {{ visit.enteredAt | date: 'medium' }}
                  @if (visit.actorName) {
                    — {{ visit.actorName }}{{ delegationQualifier(visit.delegation) }}
                  }
                </p>

                @if (visit.comment) {
                  <p class="text-sm mt-1">{{ visit.comment }}</p>
                }
              </div>
            </li>
          }
        </ol>
        }
      </div>
    }
  `,
})
export class WorkflowStageIndicatorComponent {
  private readonly workflowService = inject(WorkflowService);
  private readonly languageService = inject(LanguageService);
  private readonly translate = inject(TranslateService);

  // Takes the INSTANCE, not its id — matching WorkflowTransitionActionsComponent
  // beside it, and load-bearing rather than cosmetic.
  //
  // This was `instanceId: string` and did not refresh after a transition:
  // triggerTransition() returns an updated instance, the parent stores it, but
  // the ID IS UNCHANGED — so the input signal never notified, the effect never
  // re-ran, and the timeline showed stale history until a manual page reload.
  // Signal inputs compare by reference (Object.is), and the parent sets the
  // fresh object it got back, so taking the object makes every transition
  // reload the history with no reload call anywhere.
  readonly instance = input.required<WorkflowInstanceDto>();

  // Which of the two views to render. Default 'both' keeps the component
  // usable standalone; committee-detail splits them because they belong in
  // different places on that page — the sequence is always-visible page
  // furniture in the header band, the history is reference material in the
  // rail. Splitting is a LAYOUT choice, not a suggestion that either view is
  // optional: both are rendered, just not adjacently.
  //
  // One fetch serves both regardless of this input — the request is keyed on
  // the instance, not on what is displayed.
  readonly show = input<'both' | 'sequence' | 'history'>('both');

  readonly history = signal<WorkflowStageHistoryDto | null>(null);

  constructor() {
    // Fails silently: a caller without workflows:view gets a 403 and this
    // panel renders nothing, exactly as the "Current Stage" label it replaced
    // already did.
    effect(() => {
      const instance = this.instance();
      this.workflowService.getStageHistory(instance.id).subscribe({
        next: (history) => this.history.set(history),
        error: () => this.history.set(null),
      });
    });
  }

  // The open visit IS the current stage. Never compared against
  // instance.currentStageId — with a repeat, that id matches two visits and
  // cannot say which one is live.
  isCurrent(exitedAt: string | null): boolean {
    return exitedAt === null;
  }

  // Stage names are tenant-editable data: isArabic() selection, never
  // `| translate` (SYSTEM-REFERENCE §9.3).
  stageName(nameEn: string, nameAr: string): string {
    return this.languageService.isArabic() ? nameAr : nameEn;
  }

  // ACC-40 §2.6.3's qualifier, reaching a screen for the first time. Renders
  // as " — Acting Head of Cardiology" or " — covering for Ahmad", appended to
  // the actor's name, so the row says the person acted in a delegated
  // capacity rather than implying they hold the position outright.
  //
  // Returns '' when the stamp is absent or its referent no longer resolves —
  // a raw id beside someone's name would be worse than no qualifier.
  delegationQualifier(delegation: ResolvedDelegationDto | null): string {
    if (!delegation) return '';
    const label = this.languageService.isArabic()
      ? delegation.contextLabelAr
      : delegation.contextLabelEn;
    if (!label) return '';

    const key =
      delegation.reason === 'ACTING_HEAD'
        ? 'workflow.stageIndicator.actingHeadOf'
        : 'workflow.stageIndicator.coveringFor';
    return ` — ${this.translate.instant(key, { context: label })}`;
  }

  // Drives the chevron direction between sequence stages. Read from
  // LanguageService rather than derived locally — it is the single owning
  // mechanism for direction (SYSTEM-REFERENCE §9.1).
  isRtl(): boolean {
    return this.languageService.isRtl();
  }
}
