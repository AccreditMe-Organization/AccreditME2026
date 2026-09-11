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

// ACC-76 — where a record is in its workflow, answered two ways, in one
// component. Generic over object type, like WorkflowTransitionActionsComponent
// beside it: it takes an instance and nothing module-specific.
//
//   SEQUENCE  a numbered stepper over every stage the template defines, in
//             order, always — including before the record has been anywhere.
//             Tells a reader what the lifecycle IS and where this record sits.
//   HISTORY   the chronology of actual transitions, with who fired each one
//             and why. Tells them what happened to THIS record.
//
// WHY A STEPPER IS SAFE HERE, given it was argued against earlier. The
// objection was real: a stepper's usual grammar — ticks behind you, "step 3 of
// 6" — states something false about a record that revisited a stage, and this
// engine produces those by design (Committee's TERMS_REVIEW -> FORMATION
// "Revise Terms" transition). WorkflowStage.order cannot rescue it: order is a
// display field, not a traversal record.
//
// This stepper drops the part that lied and keeps the part that helps. It
// shows every stage in order with the current one numbered and emphasised, and
// annotates a repeated stage "revisited ×2" — so the loop is visible IN the
// sequence rather than contradicted by it. What it does NOT render is an
// "N of M" progress counter: with six stages of which two (Suspended,
// Dissolution Pending) are branches rather than steps, a suspended committee
// would read "4 of 6" and look further along than a healthy active one.
// "In stage 214 days" says something true instead.
@Component({
  selector: 'app-workflow-stage-indicator',
  standalone: true,
  imports: [DatePipe, TranslatePipe],
  template: `
    @if (history(); as h) {
      @if (show() !== 'history') {
        <div class="flex flex-col gap-3">
          <div class="flex items-baseline justify-between gap-3">
            <span
              class="text-[11px] font-semibold uppercase tracking-wider text-[var(--am-text-secondary)]"
            >
              {{ 'workflow.stageIndicator.lifecycle' | translate }}
            </span>
            @if (timeInStage(); as elapsed) {
              <!-- dir=ltr + isolate so the numeral does not reorder inside an
                   Arabic sentence. The one technique the design reference does
                   better than anything else in this codebase. -->
              <span
                dir="ltr"
                style="unicode-bidi: isolate"
                class="text-xs text-[var(--am-text-secondary)]"
              >
                {{ elapsed }}
              </span>
            }
          </div>

          <!-- Scrolls rather than wraps. Six nodes need ~684px and the card has
               less than that below about 1370px; a wrapped stepper stops
               reading as a sequence, which is the whole point of it. -->
          <div class="overflow-x-auto">
            <div class="flex items-start min-w-max">
              @for (stage of h.stages; track stage.id) {
                <div class="flex flex-col items-center gap-1.5 shrink-0 w-[104px] px-1">
                  <span
                    class="w-[26px] h-[26px] rounded-full flex items-center justify-center text-[13px] font-semibold"
                    [style.background]="nodeBackground(stage.isCurrent, stage.visitCount)"
                    [style.color]="nodeInk(stage.isCurrent, stage.visitCount)"
                    [style.border]="nodeBorder(stage.isCurrent, stage.visitCount)"
                    [style.box-shadow]="
                      stage.isCurrent ? '0 0 0 4px color-mix(in srgb, var(--am-blue-primary) 15%, transparent)' : 'none'
                    "
                  >
                    @if (stage.visitCount > 0 && !stage.isCurrent) {
                      <i class="pi pi-check text-[11px]"></i>
                    } @else {
                      {{ $index + 1 }}
                    }
                  </span>

                  <span
                    class="text-[12.5px] text-center leading-tight"
                    [class.font-bold]="stage.isCurrent"
                    [class.font-medium]="!stage.isCurrent"
                    [style.color]="labelInk(stage.isCurrent, stage.visitCount)"
                  >
                    {{ stageName(stage.nameEn, stage.nameAr) }}
                  </span>

                  <span
                    dir="ltr"
                    style="unicode-bidi: isolate"
                    class="text-[11px] text-center text-[var(--am-text-secondary)]"
                  >
                    {{ stageMeta(stage.id, stage.isCurrent, stage.visitCount) }}
                  </span>
                </div>

                @if (!$last) {
                  <!-- Solid once the record has been past this point, dashed
                       ahead of it. Carries no arrowhead: the connector says
                       "next in the template", not "next for this record". -->
                  <div
                    class="flex-1 min-w-[12px] mt-[13px]"
                    [style.border-top]="connectorStyle(h.stages[$index + 1]!)"
                  ></div>
                }
              }
            </div>
          </div>
        </div>
      }

      @if (show() !== 'sequence') {
        <div class="flex flex-col">
          @for (visit of orderedHistory(); track visit.id) {
            <div class="grid grid-cols-[76px_1fr_auto] gap-2.5 items-baseline py-1.5">
              <span
                dir="ltr"
                style="unicode-bidi: isolate"
                class="text-[11.5px] text-start text-[var(--am-text-secondary)]"
              >
                {{ visit.enteredAt | date: 'dd MMM y' }}
              </span>

              <span class="text-[12.5px] min-w-0">
                <span class="font-medium">{{ stageName(visit.stageNameEn, visit.stageNameAr) }}</span>
                <!-- The transition that brought the record here, then the
                     reason given for firing it. Both describe the SAME event
                     as the actor on the right — see WorkflowStageVisitDto on
                     why the comment is the previous visit's. -->
                @if (transitionLabel(visit.transitionLabelEn, visit.transitionLabelAr); as label) {
                  <span class="text-[var(--am-text-secondary)]"> — {{ label }}</span>
                }
                @if (visit.comment) {
                  <span class="text-[var(--am-text-secondary)]"> — {{ visit.comment }}</span>
                }
                @if (visit.isUnassigned) {
                  <span class="text-[var(--am-text-secondary)]">
                    · {{ 'workflow.stageIndicator.unassigned' | translate }}
                  </span>
                }
              </span>

              <span class="text-[11.5px] whitespace-nowrap text-[var(--am-text-secondary)]">
                @if (visit.actorName) {
                  {{ visit.actorName }}{{ delegationQualifier(visit.delegation) }}
                }
              </span>
            </div>
          }
        </div>
      }
    }
  `,
})
export class WorkflowStageIndicatorComponent {
  private readonly workflowService = inject(WorkflowService);
  private readonly languageService = inject(LanguageService);
  private readonly translate = inject(TranslateService);

  // Takes the INSTANCE, not its id. Load-bearing: triggerTransition() returns
  // an updated instance whose ID IS UNCHANGED, so an id input never notified
  // and the history stayed stale until a manual reload. Signal inputs compare
  // by reference, and the parent stores the fresh object.
  readonly instance = input.required<WorkflowInstanceDto>();

  // Which view to render. The design places the stepper in the record's header
  // band and the history in a panel beside it, so they are split by LAYOUT —
  // not because either is optional. One fetch serves both regardless.
  readonly show = input<'both' | 'sequence' | 'history'>('both');

  readonly history = signal<WorkflowStageHistoryDto | null>(null);

  constructor() {
    // Fails silently: a caller without workflows:view gets a 403 and this
    // renders nothing, exactly as the "Current Stage" label it replaced did.
    effect(() => {
      const instance = this.instance();
      this.workflowService.getStageHistory(instance.id).subscribe({
        next: (history) => this.history.set(history),
        error: () => this.history.set(null),
      });
    });
  }

  // Newest first — a reader of a compliance trail wants the most recent event
  // at the top. The sequence above already carries the forward reading.
  readonly orderedHistory = computed(() => [...(this.history()?.visits ?? [])].reverse());

  // "in stage 214 days", from the open visit. Calendar days, deliberately not
  // WorkingCalendarService: this is how long something has sat, not an SLA or
  // a due date, and a reader counting back on a calendar expects calendar days.
  readonly timeInStage = computed(() => {
    const open = this.history()?.visits.find((v) => v.exitedAt === null);
    if (!open) return null;
    const days = Math.floor((Date.now() - new Date(open.enteredAt).getTime()) / 86_400_000);
    // instant() is a plain call, not a signal read — currentLang() is read
    // explicitly so this re-evaluates on a language switch (ACC-55).
    this.translate.currentLang();
    return this.translate.instant('workflow.stageIndicator.inStageDays', { days });
  });

  private stageEntry(stageId: string) {
    return this.history()?.stages.find((s) => s.id === stageId);
  }

  // Under each node: the date it was first entered, "since X" for the current
  // stage, "revisited ×N" where the record has been back — the annotation that
  // lets a linear stepper tell the truth about a loop.
  stageMeta(stageId: string, isCurrent: boolean, visitCount: number): string {
    if (visitCount === 0) return '—';

    const visits = this.history()?.visits.filter((v) => v.stageId === stageId) ?? [];
    this.translate.currentLang();

    if (visitCount > 1) {
      return this.translate.instant('workflow.stageIndicator.revisited', { count: visitCount });
    }
    const first = visits[0];
    if (!first) return '—';
    const date = new Date(first.enteredAt).toLocaleDateString(
      this.languageService.isArabic() ? 'ar' : 'en-GB',
      { day: '2-digit', month: 'short', year: 'numeric' },
    );
    return isCurrent
      ? this.translate.instant('workflow.stageIndicator.since', { date })
      : date;
  }

  nodeBackground(isCurrent: boolean, visitCount: number): string {
    if (isCurrent) return 'var(--am-card)';
    return visitCount > 0 ? 'var(--am-status-approved)' : 'var(--am-surface)';
  }

  nodeInk(isCurrent: boolean, visitCount: number): string {
    if (isCurrent) return 'var(--am-blue-primary)';
    return visitCount > 0 ? 'var(--am-card)' : 'var(--am-text-secondary)';
  }

  nodeBorder(isCurrent: boolean, visitCount: number): string {
    if (isCurrent) return '2px solid var(--am-blue-primary)';
    return visitCount > 0 ? 'none' : '1px solid var(--am-border)';
  }

  labelInk(isCurrent: boolean, visitCount: number): string {
    if (isCurrent) return 'var(--am-blue-primary)';
    return visitCount > 0 ? 'var(--am-text-primary)' : 'var(--am-text-secondary)';
  }

  // Solid behind the record, dashed ahead of it — read from the stage the
  // connector leads TO, so the solid run ends where the record has reached.
  connectorStyle(next: { visitCount: number; isCurrent: boolean }): string {
    return next.visitCount > 0 || next.isCurrent
      ? '2px solid var(--am-status-approved)'
      : '2px dashed var(--am-border)';
  }

  // Stage and transition names are tenant-editable data: isArabic() selection,
  // never `| translate` (SYSTEM-REFERENCE §9.3).
  stageName(nameEn: string, nameAr: string): string {
    return this.languageService.isArabic() ? nameAr : nameEn;
  }

  transitionLabel(labelEn: string | null, labelAr: string | null): string {
    if (!labelEn && !labelAr) return '';
    return (this.languageService.isArabic() ? labelAr : labelEn) ?? '';
  }

  // ACC-40 §2.6.3 — " — Acting Head of Cardiology" / " — covering for Ahmad".
  // Empty when unstamped or when the referent no longer resolves: a raw id
  // beside a name is worse than no qualifier.
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
}
