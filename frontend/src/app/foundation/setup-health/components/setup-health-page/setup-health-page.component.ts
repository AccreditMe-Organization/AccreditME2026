import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { TooltipModule } from 'primeng/tooltip';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { AmDateTimePipe } from '../../../../core/formatting';
import { AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { WorkflowTemplateService } from '../../../workflow/services/workflow-template.service';
import {
  SetupConditionDto,
  SetupConditionFreshnessDto,
  SetupConditionSeverity,
  SetupConditionType,
  SetupHealthDto,
  SetupHealthService,
} from '../../services/setup-health.service';
import { ConditionRow, SetupConditionRows, severityChipClass } from '../../setup-condition-rows';

// ACC-82 — Setup health, built against
// frontend/design-reference/AccreditMe App Shell.dc.html (SYSTEM-REFERENCE §13).
//
// The page lists CONDITIONS, not messages: each row exists because its cause
// is true at the last check, and disappears at the next check after it is
// fixed. So there is deliberately no dismiss, no read state and no snooze —
// the reference's "Snooze 7d" belongs to a Hygiene tier that does not ship
// (§13.8), and its "Export as evidence" is unbuilt, so neither is shown.
//
// Two things the reference does not have to say, and this page must:
//   - HOW FRESH each type's rows are. Checks run hourly per tenant per type, and
//     a check can fail or be late. A failed check never clears rows, so the
//     rows stay as last confirmed, and the page names the time (§13.5).
//   - WHAT AN AGE MEANS. Units and stages record when they entered the
//     condition; tasks do not, so theirs is "first detected".

export type SeverityFilter = 'ALL' | SetupConditionSeverity;

// Group order when severities tie. Matches §13.2's table.
const TYPE_ORDER: SetupConditionType[] = [
  'ORG_UNIT_WITHOUT_HEAD',
  'ORG_UNIT_WITHOUT_TYPE',
  'ACTING_HEAD_OPEN_ENDED',
  'STAGE_WITHOUT_ASSIGNEE',
  'STAGE_ON_STARTING_ASSIGNMENT',
  'TASK_WITHOUT_OWNER',
  'COMMITTEE_MISSING_REQUIRED_SEAT',
  'STORAGE_ACCESS_WITHDRAWN',
  'STORAGE_SECRET_EXPIRING',
  'STORAGE_ALMOST_FULL',
];

const SEVERITY_RANK: Record<SetupConditionSeverity, number> = { BLOCKS_WORK: 0, AT_RISK: 1 };

export interface ConditionGroup {
  type: SetupConditionType;
  label: string;
  severity: SetupConditionSeverity;
  rows: ConditionRow[];
}

export interface ClearedRow {
  id: string;
  text: string;
  clearedAt: string;
}

@Component({
  selector: 'app-setup-health-page',
  standalone: true,
  imports: [PageHeaderComponent, AmDateTimePipe, RouterLink, TranslatePipe, TooltipModule],
  template: `
    <div class="flex flex-col gap-3">
      <app-page-header
        [title]="'setupHealth.title' | translate"
        [purpose]="'setupHealth.purpose' | translate"
      />

      @if (error()) {
        <p class="m-0 text-sm text-[var(--am-severity-critical)]" role="alert">
          {{ error() | translate }}
        </p>
      }

      <!-- A check that failed, is late, or never ran. Above the list, because
           it changes how every row below it should be read. -->
      @if (freshnessNotices().length > 0) {
        <div
          class="rounded-lg border px-[13px] py-[10px] text-[12.5px] bg-[var(--am-condition-risk-bg)] border-[var(--am-condition-risk-border)] text-[var(--am-condition-risk-ink)]"
          role="status"
        >
          <ul class="m-0 ps-4 flex flex-col gap-1">
            @for (notice of freshnessNotices(); track notice) {
              <li>{{ notice }}</li>
            }
          </ul>
        </div>
      }

      <section class="bg-[var(--am-card)] border border-[var(--am-border)] rounded-lg">
        <div
          class="flex flex-wrap items-center gap-[7px] px-[13px] py-[10px] border-b border-[var(--am-border)]"
        >
          @for (f of filters(); track f.key) {
            <button
              type="button"
              class="am-health-filter"
              [class.am-health-filter--on]="filter() === f.key"
              [attr.aria-pressed]="filter() === f.key"
              (click)="filter.set(f.key)"
            >
              {{ f.label }}
              <span class="ms-[5px] text-[10.5px] opacity-70 tabular-nums">{{ f.count }}</span>
            </button>
          }
          @if (objectFilter()) {
            <span class="inline-flex items-center gap-2 text-[12px] text-[var(--am-text-secondary)]" data-testid="health-object-filter">
              {{ objectFilterName() ? ('setupHealth.objectFilter' | translate: { name: objectFilterName() }) : ('setupHealth.objectFilterNone' | translate) }}
              <button type="button" class="am-health-showall" (click)="showAllObjects()" data-testid="health-show-all">
                {{ 'setupHealth.showAll' | translate }}
              </button>
            </span>
          }
          <span class="flex-1"></span>
          @if (lastChecked(); as checked) {
            <span class="text-[11.5px] text-[var(--am-text-secondary)] tabular-nums">{{ checked }}</span>
          }
        </div>

        @if (loading() && !health()) {
          <p class="m-0 px-[13px] py-6 text-sm text-[var(--am-text-secondary)]">
            {{ 'common.loading' | translate }}
          </p>
        } @else if (health()) {
          @for (group of groups(); track group.type) {
            <section [attr.aria-labelledby]="'health-group-' + group.type">
              <div
                class="flex items-center justify-between gap-[10px] px-[13px] py-2 bg-[var(--am-surface)] border-b border-[var(--am-border)]"
              >
                <div class="flex items-center gap-2 min-w-0">
                  <h2
                    [id]="'health-group-' + group.type"
                    class="m-0 text-[12.5px] font-semibold text-pretty"
                  >
                    {{ group.label }}
                  </h2>
                  <span
                    class="flex-none text-[11px] font-semibold px-[6px] py-px rounded bg-[var(--am-border)] text-[var(--am-text-secondary)] tabular-nums"
                    >{{ group.rows.length }}</span
                  >
                </div>
                <span [class]="severityChipClass(group.severity)">{{ severityLabel(group.severity) }}</span>
              </div>

              <ul class="m-0 p-0 list-none">
                @for (row of group.rows; track row.id) {
                  <li
                    class="flex flex-wrap items-center gap-[10px] px-[13px] py-[9px] border-b border-[var(--am-border)]"
                  >
                    <span class="flex-[1_1_320px] min-w-0">
                      <span class="block text-[13px] font-medium text-pretty">{{ row.objectName }}</span>
                      @if (row.context) {
                        <span class="block text-[11.5px] text-[var(--am-text-secondary)]">{{ row.context }}</span>
                      }
                      <span class="block text-[11.5px] text-[var(--am-text-secondary)] text-pretty">{{
                        row.consequence
                      }}</span>
                      @if (row.hint) {
                        <span class="block text-[11.5px] text-[var(--am-text-primary)] text-pretty">{{ row.hint }}</span>
                      }
                    </span>
                    <span
                      class="flex-none w-[150px] text-[11.5px] text-[var(--am-text-secondary)] tabular-nums"
                      [pTooltip]="row.openedAt | amDateTime"
                      tooltipPosition="top"
                      >{{ row.age }}</span
                    >
                    <span class="flex-none flex flex-wrap items-center gap-2">
                      @if (row.fix; as fix) {
                        <a class="am-health-fix" [routerLink]="fix.link" [queryParams]="fix.queryParams">{{
                          fix.label
                        }}</a>
                        @if (row.keep; as keep) {
                          @if (kept().has(keep.stageId)) {
                            <span class="text-[11.5px] text-[var(--am-text-secondary)]" role="status" data-testid="health-kept">{{
                              'setupHealth.keep.kept' | translate
                            }}</span>
                          } @else {
                            <button
                              type="button"
                              class="am-health-keep"
                              [disabled]="keeping() === keep.stageId"
                              [attr.aria-label]="'setupHealth.keep.buttonFor' | translate: { stage: keep.stageName }"
                              (click)="askKeep(keep, $event)"
                              data-testid="health-keep"
                            >
                              {{ 'setupHealth.keep.button' | translate }}
                            </button>
                          }
                        }
                      } @else if (row.fixNeeds) {
                        <span class="block max-w-[220px] text-[11.5px] text-[var(--am-text-secondary)] text-pretty">{{
                          row.fixNeeds
                        }}</span>
                      }
                    </span>
                  </li>
                }
              </ul>
            </section>
          } @empty {
            <p class="m-0 px-[13px] py-6 text-sm text-[var(--am-text-secondary)]">
              {{ emptyMessageKey() | translate }}
            </p>
          }
        }
      </section>

      @if (health()) {
        <section
          class="bg-[var(--am-card)] border border-[var(--am-border)] rounded-lg"
          aria-labelledby="health-cleared"
        >
          <div
            class="flex items-center justify-between gap-[10px] px-[13px] py-[10px] border-b border-[var(--am-border)]"
          >
            <h2
              id="health-cleared"
              class="m-0 text-[11px] font-bold tracking-[0.07em] uppercase text-[var(--am-text-secondary)]"
            >
              {{ 'setupHealth.cleared.title' | translate }}
            </h2>
            <span class="text-[11.5px] text-[var(--am-text-secondary)]">{{
              'setupHealth.cleared.window' | translate
            }}</span>
          </div>
          <ul class="m-0 p-0 list-none">
            @for (item of cleared(); track item.id) {
              <li
                class="flex flex-wrap items-baseline gap-[9px] px-[13px] py-2 border-b border-[var(--am-border)]"
              >
                <span class="flex-none text-xs text-[var(--am-condition-cleared)]" aria-hidden="true">✓</span>
                <span class="flex-[1_1_300px] min-w-0 text-[12.5px] text-pretty">{{ item.text }}</span>
                <span class="flex-none text-[11.5px] text-[var(--am-text-secondary)]">
                  {{ 'setupHealth.cleared.at' | translate: { date: (item.clearedAt | amDateTime) } }}
                </span>
              </li>
            } @empty {
              <li class="px-[13px] py-3 text-[12.5px] text-[var(--am-text-secondary)]">
                {{ 'setupHealth.cleared.none' | translate }}
              </li>
            }
          </ul>
          <p class="m-0 px-[13px] py-[9px] text-[11.5px] text-[var(--am-text-secondary)] text-pretty">
            {{ 'setupHealth.cleared.note' | translate }}
          </p>
        </section>
      }
    </div>
  `,
  styles: [
    `
      .am-health-filter {
        border: 1px solid var(--am-border);
        background: var(--am-card);
        color: var(--am-text-secondary);
        border-radius: 999px;
        padding: 4px 11px;
        font: inherit;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        white-space: nowrap;
      }
      .am-health-filter--on {
        border-color: var(--am-blue-primary);
        color: var(--am-blue-primary);
        font-weight: 600;
      }
      .am-health-keep {
        display: inline-block;
        border: 1px solid var(--am-control-border, var(--am-border));
        background: var(--am-card);
        color: var(--am-text-primary);
        border-radius: 5px;
        padding: 4px 11px;
        font: inherit;
        font-size: 12.5px;
        font-weight: 600;
        white-space: nowrap;
        cursor: pointer;
      }
      .am-health-filter:focus-visible,
      .am-health-keep:focus-visible,
      .am-health-fix:focus-visible {
        outline: 2px solid var(--am-blue-primary);
        outline-offset: 1px;
      }
      .am-health-fix {
        display: inline-block;
        background: var(--am-blue-primary);
        color: #fff;
        border-radius: 5px;
        padding: 5px 12px;
        font-size: 12.5px;
        font-weight: 600;
        text-decoration: none;
        white-space: nowrap;
      }
      .am-health-showall {
        font: inherit;
        padding: 0;
        border: 0;
        background: none;
        color: var(--am-primary-700);
        font-weight: 600;
        cursor: pointer;
      }
      .am-health-fix:hover {
        filter: brightness(0.92);
      }
    `,
  ],
})
export class SetupHealthPageComponent implements OnInit {
  private readonly setupHealthService = inject(SetupHealthService);
  private readonly translate = inject(TranslateService);
  private readonly rows = inject(SetupConditionRows);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly confirm = inject(AmConfirmService);
  private readonly workflows = inject(WorkflowTemplateService);

  /**
   * ACC-271 PR 5a — stages kept on their starting assignment this visit. The
   * condition stays open until the next hourly check closes it, so the row
   * says "Kept, closes on the next check" instead of offering Keep again.
   */
  readonly kept = signal<ReadonlySet<string>>(new Set());
  /** The stage whose Keep is being saved. */
  readonly keeping = signal<string | null>(null);

  /**
   * "Keep this assignment" (drawing section 11): asks through the one confirm,
   * then keeps it and reads the page again once.
   */
  askKeep(keep: { stageId: string; stageName: string; adminName: string }, event: Event): void {
    this.confirm.ask({
      tone: 'neutral',
      header: this.translate.instant('setupHealth.keep.header', { admin: keep.adminName, stage: keep.stageName }),
      message: this.translate.instant('setupHealth.keep.message'),
      acceptLabel: this.translate.instant('setupHealth.keep.accept'),
      opener: event.currentTarget as HTMLElement | null,
      accept: () => {
        this.keeping.set(keep.stageId);
        this.error.set(null);
        this.workflows.keepStartingAssignment(keep.stageId).subscribe({
          next: () => {
            this.keeping.set(null);
            this.kept.update((s) => new Set(s).add(keep.stageId));
            this.load();
          },
          error: () => {
            this.keeping.set(null);
            this.error.set('setupHealth.keep.failed');
          },
        });
      },
    });
  }

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly health = signal<SetupHealthDto | null>(null);
  readonly filter = signal<SeverityFilter>('ALL');
  /**
   * ACC-120 slice 11 (PR D) — `?object=<id>`: only that object's open
   * conditions, from an org unit record's "+ N more". Read once; Show all
   * clears it.
   */
  readonly objectFilter = signal<string | null>(inject(ActivatedRoute).snapshot.queryParamMap.get('object'));
  /** The open conditions in scope: one object's, or every one. */
  private readonly scoped = computed(() => {
    const open = this.health()?.open ?? [];
    const id = this.objectFilter();
    return id ? open.filter((c) => c.objectId === id) : open;
  });
  /** The filtered object's name, from its own conditions. */
  readonly objectFilterName = computed(() => {
    this.translate.currentLang();
    const first = this.scoped()[0];
    return first ? this.objectName(first) : null;
  });

  showAllObjects(): void {
    this.objectFilter.set(null);
    void this.router.navigate([], { relativeTo: this.route, queryParams: { object: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }
  // Relative ages are measured from when the data arrived, not re-ticked: the
  // rows themselves are at most an hour fresh, so a live clock would imply a
  // precision they do not have.
  readonly loadedAt = signal(new Date());

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.setupHealthService.getHealth().subscribe({
      next: (health) => {
        this.loadedAt.set(new Date());
        this.health.set(health);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('setupHealth.errorLoad');
        this.loading.set(false);
      },
    });
  }

  readonly filters = computed(() => {
    this.translate.currentLang();
    const open = this.scoped();
    const count = (s: SetupConditionSeverity) => open.filter((c) => c.severity === s).length;
    return [
      { key: 'ALL' as const, label: this.translate.instant('setupHealth.filter.all'), count: open.length },
      { key: 'BLOCKS_WORK' as const, label: this.severityLabel('BLOCKS_WORK'), count: count('BLOCKS_WORK') },
      { key: 'AT_RISK' as const, label: this.severityLabel('AT_RISK'), count: count('AT_RISK') },
    ];
  });

  readonly groups = computed<ConditionGroup[]>(() => {
    this.translate.currentLang();
    const health = this.health();
    if (!health) return [];
    const filter = this.filter();
    const open = this.scoped();
    const shown = filter === 'ALL' ? open : open.filter((c) => c.severity === filter);

    return TYPE_ORDER.map((type) => {
      // The API already orders rows blocking first, then oldest first.
      const conditions = shown.filter((c) => c.type === type);
      if (conditions.length === 0) return null;
      const severity = conditions.reduce<SetupConditionSeverity>(
        (worst, c) => (SEVERITY_RANK[c.severity] < SEVERITY_RANK[worst] ? c.severity : worst),
        'AT_RISK',
      );
      return {
        type,
        label: this.translate.instant(`setupHealth.types.${type}`),
        severity,
        rows: conditions.map((c) => this.toRow(c)),
      };
    })
      .filter((g): g is ConditionGroup => g !== null)
      .sort(
        (a, b) =>
          SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
          TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type),
      );
  });

  readonly cleared = computed<ClearedRow[]>(() => {
    this.translate.currentLang();
    return (this.health()?.recentlyCleared ?? []).map((c) => ({
      id: c.id,
      text: `${this.translate.instant(`setupHealth.types.${c.type}`)} — ${this.objectName(c)}`,
      clearedAt: c.clearedAt ?? c.lastSeenAt,
    }));
  });

  // One line per type whose rows cannot be read as current. A type with no
  // open rows still gets one: "nothing listed" only means "nothing wrong" if
  // the check behind it ran.
  readonly freshnessNotices = computed<string[]>(() => {
    this.translate.currentLang();
    const freshness = this.health()?.freshness ?? [];
    return freshness
      .filter((f) => f.status !== 'CURRENT')
      .map((f) => this.freshnessNotice(f));
  });

  // The toolbar's "checked" time is the OLDEST confirmation across types, so
  // it never claims more freshness than the stalest group has.
  readonly lastChecked = computed<string | null>(() => {
    this.translate.currentLang();
    return this.rows.lastChecked(this.health()?.freshness ?? [], this.loadedAt());
  });

  readonly emptyMessageKey = computed(() => {
    const health = this.health();
    if (!health) return 'setupHealth.empty';
    if (this.objectFilter() && this.scoped().length === 0) return 'setupHealth.emptyObject';
    if (health.open.length > 0) return 'setupHealth.emptyFiltered';
    return health.freshness.every((f) => f.status === 'CURRENT')
      ? 'setupHealth.empty'
      : 'setupHealth.emptyUnconfirmed';
  });

  severityLabel(severity: SetupConditionSeverity): string {
    return this.rows.severityLabel(severity);
  }

  severityChipClass(severity: SetupConditionSeverity): string {
    return severityChipClass(severity);
  }

  private toRow(condition: SetupConditionDto): ConditionRow {
    return this.rows.toRow(condition, this.loadedAt());
  }

  private objectName(condition: SetupConditionDto): string {
    return this.rows.objectName(condition);
  }

  private freshnessNotice(f: SetupConditionFreshnessDto): string {
    return this.rows.freshnessNotice(f);
  }
}
