import { Component, OnDestroy, computed, inject } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { map } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { TenantService, ITenant } from '../../../tenant/services/tenant.service';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { createRequestOutcome } from '../../../../core/request-outcome/request-outcome';
import { AmDatePipe, AmNumberPipe, AmRelativePipe, FormatService } from '../../../../core/formatting';
import { aiCreditsState, aiFeatureNameKey, aiUsageView, AiUsageRow } from './ai-credits-view';

// Left-to-right isolate around a number set inside a translated sentence: the
// digits keep their order in an Arabic line, as a dir="ltr" span would, which a
// translated string cannot carry.
const LRI = '⁦';
const PDI = '⁩';

/**
 * AI credits (ACC-120 slice 8), drawn from the "AI credits" artboard of
 * AccreditMe Settings Screens. Read only: the allocation follows the plan or a
 * platform admin's manual value (ACC-194), and Buy and overage are absent by
 * design. Three states (ai-credits-view.ts): normal, spent and none.
 *
 * One request, GET /tenant, through the shared request outcome: a skeleton
 * after 200ms, a sentence for a 403, an error with Retry, never the server's
 * text. Plan: backend/Plans/step-120-8-ai-credits.md.
 */
@Component({
  selector: 'app-ai-settings',
  standalone: true,
  imports: [PageHeaderComponent, TranslatePipe, MessageModule, ButtonModule, AmDatePipe, AmNumberPipe, AmRelativePipe],
  template: `
    <div class="flex max-w-[640px] flex-col gap-4">
      <app-page-header [title]="'adminSettings.aiSettings' | translate" />

      @switch (outcome().status) {
        @case ('loading') {
          <section class="am-ai-card flex flex-col gap-3" aria-busy="true" data-ai-skeleton>
            <span class="am-skeleton-bar w-1/2"></span>
            <span class="am-skeleton-bar w-1/3"></span>
            <span class="am-skeleton-bar w-full"></span>
            <span class="am-skeleton-bar w-2/3"></span>
          </section>
        }
        @case ('denied') {
          <section class="am-ai-card" role="status" data-ai-denied>
            <p class="text-[13px] text-[var(--am-ink-700)]">{{ 'aiCredits.denied' | translate }}</p>
          </section>
        }
        @case ('error') {
          <section class="am-ai-card flex flex-col items-start gap-2" role="alert" data-ai-error>
            <p-message severity="error" [text]="'aiCredits.errorLoad' | translate" />
            <p-button size="small" [outlined]="true" [label]="'common.retry' | translate" (onClick)="handle.retry()" />
          </section>
        }
        @case ('rows') {
          @if (tenant(); as t) {
            <section class="am-ai-card" [attr.data-ai-state]="state()">
              @if (state() === 'none') {
                <h2 class="text-[16px] font-semibold">{{ 'aiCredits.noneTitle' | translate }}</h2>
                <div class="mt-[10px] flex items-start gap-[10px] rounded-md border border-dashed border-[var(--am-ink-300)] p-3" data-ai-none>
                  <span
                    class="flex size-[30px] flex-none items-center justify-center rounded-md border border-dashed border-[var(--am-ink-300)] text-[var(--am-ink-500)]"
                    aria-hidden="true"
                  >✦</span>
                  <span class="min-w-0 text-[12.5px] text-[var(--am-ink-700)]">
                    {{ 'aiCredits.noneBody' | translate: { plan: ('aiCredits.plan.' + t.plan) | translate } }}
                  </span>
                </div>
              } @else {
                <div class="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 class="text-[16px] font-semibold">{{ 'aiCredits.periodTitle' | translate }}</h2>
                  @if (t.ai.resetDate) {
                    <p class="text-[12.5px] text-[var(--am-ink-500)]" data-ai-reset>
                      {{ 'aiCredits.resets' | translate }}
                      <strong class="font-semibold text-[var(--am-ink-900)]">{{ t.ai.resetDate | amDate }}</strong>
                      · {{ t.ai.resetDate | amRelative }}
                    </p>
                  }
                </div>
                @if (t.ai.periodStart && t.ai.resetDate) {
                  <p class="text-[12.5px] text-[var(--am-ink-500)]" data-ai-period>
                    {{ t.ai.periodStart | amDate }} – {{ t.ai.resetDate | amDate }}
                  </p>
                }

                <div class="mt-2 flex flex-wrap items-baseline gap-2" data-ai-left>
                  <span dir="ltr" class="text-[28px] leading-[34px] font-semibold tabular-nums">{{ t.ai.creditsRemaining | amNumber }}</span>
                  <span class="text-[13px] text-[var(--am-ink-700)] tabular-nums">{{ leftOf() }}</span>
                  @if (state() === 'spent') {
                    <span
                      class="rounded-full border border-[var(--am-danger-border)] bg-[var(--am-danger-bg)] px-[9px] py-px text-[11.5px] font-semibold text-[var(--am-danger-ink)]"
                      data-ai-paused
                    >{{ 'aiCredits.paused' | translate: { date: (t.ai.resetDate | amDate) } }}</span>
                  }
                </div>

                <div
                  role="meter"
                  aria-valuemin="0"
                  [attr.aria-valuemax]="t.ai.monthlyCredits"
                  [attr.aria-valuenow]="t.ai.creditsRemaining"
                  [attr.aria-label]="meterLabel()"
                  [attr.aria-valuetext]="meterLabel()"
                  class="mt-2 flex h-[14px] overflow-hidden rounded border border-[var(--am-control-border)] bg-[var(--am-surface-raised)]"
                  data-ai-meter
                >
                  @for (row of usage().rows; track row.key ?? '__other') {
                    @if (row.segmentPercent > 0) {
                      <span
                        class="h-full flex-none border-e border-[var(--am-surface-raised)]"
                        [style.width.%]="row.segmentPercent"
                        [style.background]="inkOf(row)"
                        data-ai-segment
                      ></span>
                    }
                  }
                </div>
                <div class="mt-1 flex justify-between text-[11.5px] text-[var(--am-ink-500)]">
                  <span>{{ 'aiCredits.used' | translate }} <span dir="ltr" class="tabular-nums" data-ai-used>{{ t.ai.creditsUsed | amNumber }}</span></span>
                  <span>{{ 'aiCredits.left' | translate }} <span dir="ltr" class="tabular-nums">{{ t.ai.creditsRemaining | amNumber }}</span></span>
                </div>

                <h3 class="mt-[14px] mb-1 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--am-ink-500)]">
                  {{ 'aiCredits.breakdownTitle' | translate }}
                </h3>
                @if (usage().rows.length === 0) {
                  <p class="text-[12.5px] text-[var(--am-ink-500)]" data-ai-nothing-used>{{ 'aiCredits.nothingUsed' | translate }}</p>
                } @else {
                  <ul data-ai-breakdown>
                    @for (row of usage().rows; track row.key ?? '__other') {
                      <li
                        class="flex min-h-[32px] items-center gap-[10px] border-b border-[var(--am-border)]"
                        [attr.aria-label]="rowLabel(row)"
                        data-ai-row
                      >
                        <span
                          class="flex size-4 flex-none items-center justify-center rounded-[3px] text-[8px] text-[var(--am-surface-raised)]"
                          [style.border]="row.mark ? null : '1px solid var(--am-ink-300)'"
                          [style.background]="inkOf(row)"
                          aria-hidden="true"
                        >{{ row.mark?.glyph ?? '' }}</span>
                        <span class="min-w-0 flex-auto text-[13px]" aria-hidden="true">{{ nameKey(row) | translate }}</span>
                        <span dir="ltr" class="w-[44px] flex-none text-end text-[13px] font-medium tabular-nums" aria-hidden="true">{{ row.credits | amNumber }}</span>
                        <span dir="ltr" class="w-[40px] flex-none text-end text-[12px] text-[var(--am-ink-500)] tabular-nums" aria-hidden="true">{{ percentText(row) }}</span>
                      </li>
                    }
                  </ul>
                  @if (usage().hasOther) {
                    <p class="mt-[6px] text-[11.5px] text-[var(--am-ink-500)]" data-ai-other-note>{{ 'aiCredits.otherNote' | translate }}</p>
                  }
                }
              }
            </section>
          }
        }
      }
    </div>
  `,
  styles: [
    `
      .am-ai-card {
        border: 1px solid var(--am-border);
        border-radius: var(--am-radius-card);
        background: var(--am-surface-raised);
        padding: 14px 16px;
      }
    `,
  ],
})
export class AiSettingsComponent implements OnDestroy {
  private readonly tenantService = inject(TenantService);
  private readonly format = inject(FormatService);
  private readonly translate = inject(TranslateService);

  readonly handle = createRequestOutcome<ITenant>(() => this.tenantService.getCurrent().pipe(map((t) => [t])), {
    // GET /tenant always answers with the organisation, so there is no empty
    // answer; "none" is a loaded state with its own reason, drawn above.
    describeEmpty: () => ({ reason: 'aiCredits.errorLoad', filtered: false }),
  });
  readonly outcome = this.handle.outcome;

  readonly tenant = computed<ITenant | null>(() => {
    const o = this.outcome();
    return o.status === 'rows' ? o.data[0] : null;
  });
  readonly state = computed(() => {
    const t = this.tenant();
    return t ? aiCreditsState(t.ai) : null;
  });
  readonly usage = computed(() => {
    const t = this.tenant();
    return t ? aiUsageView(t.ai, t.ai.usage ?? []) : { rows: [], hasOther: false };
  });

  /** "credits left of 40": the noun agrees with what is LEFT, the big number beside it. */
  readonly leftOf = computed(() => {
    const t = this.tenant();
    if (!t) return '';
    return this.format.count('aiCredits.leftOf', t.ai.creditsRemaining, {
      total: LRI + this.format.number(t.ai.monthlyCredits) + PDI,
    });
  });

  /** The meter's accessible name: "22 of 40 credits left". */
  readonly meterLabel = computed(() => {
    const t = this.tenant();
    if (!t) return '';
    return this.format.count('aiCredits.meter', t.ai.monthlyCredits, {
      left: LRI + this.format.number(t.ai.creditsRemaining) + PDI,
    });
  });

  nameKey(row: AiUsageRow): string {
    return aiFeatureNameKey(row.key);
  }

  inkOf(row: AiUsageRow): string {
    return row.mark ? row.mark.ink : 'var(--am-restricted-hatch)';
  }

  percentText(row: AiUsageRow): string {
    return row.percent === null ? '—' : `${this.format.number(row.percent)}%`;
  }

  /** One row read as a sentence, since its columns have no header. */
  rowLabel(row: AiUsageRow): string {
    return this.format.count('aiCredits.row', row.credits, {
      name: this.translate.instant(aiFeatureNameKey(row.key)),
      percent: this.percentText(row),
    });
  }

  ngOnDestroy(): void {
    this.handle.destroy();
  }
}
