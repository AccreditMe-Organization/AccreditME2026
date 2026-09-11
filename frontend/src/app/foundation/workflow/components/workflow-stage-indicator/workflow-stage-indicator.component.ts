import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  WorkflowService,
  WorkflowInstanceDto,
  WorkflowStageHistoryDto,
} from '../../services/workflow.service';
import { LanguageService } from '../../../../core/services/language.service';
import { ResolvedDelegationDto } from '../../../tasks/services/task.service';

// ACC-76 — a read-only view of the whole path a record has taken, replacing
// the bare "Current Stage: X" label. Generic over object type, like
// WorkflowTransitionActionsComponent beside it: it takes an instance id and
// nothing module-specific.
//
// WHY A TIMELINE AND NOT A STEPPER — the decision this component exists to
// encode, recorded here because the alternative looks more obvious and is
// wrong.
//
// A stepper's visual grammar is linear progress with a fixed step count:
// numbered nodes, checkmarks behind you, "step 3 of 6". Every one of those
// elements states something false about a record that revisited a stage — and
// this engine produces such records by design. Committee's seeded template has
// a TERMS_REVIEW -> FORMATION "Revise Terms" transition, so a real committee
// can read Formation -> Terms Review -> Formation -> Terms Review: four
// visits, two stages, no meaningful "step N of M". WorkflowStage.order cannot
// rescue it either — order is a display field, not a traversal record.
//
// So the primary element is a CHRONOLOGY. A stage entered twice renders twice,
// because the repeat is the information: being sent back to Formation is a
// governance fact a surveyor asks about, not a duplicate to collapse. The
// unreached stages follow as a plain set, with no connectors implying they
// will happen in that sequence.
@Component({
  selector: 'app-workflow-stage-indicator',
  standalone: true,
  imports: [DatePipe, TranslatePipe],
  template: `
    @if (history(); as h) {
      <div class="flex flex-col gap-4">
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

        @if (h.unvisitedStages.length > 0) {
          <div class="flex flex-col gap-1">
            <p class="text-xs text-[var(--am-text-secondary)]">
              {{ 'workflow.stageIndicator.notYetReached' | translate }}
            </p>
            <!-- A set, not a sequence: comma-separated, unnumbered, no
                 connectors. Nothing here claims these will be reached, or
                 reached in this order. -->
            <p class="text-sm text-[var(--am-text-secondary)]">
              {{ unvisitedNames() }}
            </p>
          </div>
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

  readonly unvisitedNames = computed(() => {
    const h = this.history();
    if (!h) return '';
    // ACC-55 — instant() is a plain call, not a signal read, so a computed
    // using it needs an explicit dependency on currentLang or it stays stuck
    // in the previous language for the rest of the session. isArabic() is
    // that dependency here.
    const arabic = this.languageService.isArabic();
    // Arabic comma (U+060C) when Arabic, Latin comma otherwise.
    return h.unvisitedStages.map((s) => (arabic ? s.nameAr : s.nameEn)).join(arabic ? '، ' : ', ');
  });
}
