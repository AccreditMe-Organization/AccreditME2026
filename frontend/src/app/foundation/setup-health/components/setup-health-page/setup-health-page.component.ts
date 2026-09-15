import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { TooltipModule } from 'primeng/tooltip';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { LanguageService } from '../../../../core/services/language.service';
import {
  SetupConditionDto,
  SetupConditionFreshnessDto,
  SetupConditionSeverity,
  SetupConditionType,
  SetupHealthDto,
  SetupHealthService,
} from '../../services/setup-health.service';

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
//     condition; tasks and positions do not, so theirs is "first detected".

export type SeverityFilter = 'ALL' | SetupConditionSeverity;

// Group order when severities tie. Matches §13.2's table.
const TYPE_ORDER: SetupConditionType[] = [
  'ORG_UNIT_WITHOUT_HEAD',
  'STAGE_WITHOUT_ASSIGNEE',
  'TASK_WITHOUT_OWNER',
  'POSITION_WITHOUT_ROLE',
];

const SEVERITY_RANK: Record<SetupConditionSeverity, number> = { BLOCKS_WORK: 0, AT_RISK: 1 };

// Where each Fix goes, and what the viewer must hold for the fix to work.
// BOTH permissions: the destination route's own, and the one its save needs —
// a Fix that opened a dialog whose save was then refused would be the
// disabled-without-a-reason trap in a different shape (§13.6).
interface FixTarget {
  link: string[];
  queryParams: Record<string, string>;
  permissions: string[];
}

function fixTargetFor(condition: SetupConditionDto): FixTarget | null {
  switch (condition.type) {
    case 'ORG_UNIT_WITHOUT_HEAD':
      return {
        link: ['/organization'],
        queryParams: { head: condition.objectId },
        permissions: ['org:view', 'org:manage'],
      };
    case 'STAGE_WITHOUT_ASSIGNEE':
      // The template id is in the snapshot; without it there is no page to open.
      return condition.subject.templateId
        ? {
            link: ['/workflows', condition.subject.templateId, 'stages'],
            queryParams: { stage: condition.objectId },
            permissions: ['workflows:view', 'workflows:manage'],
          }
        : null;
    case 'TASK_WITHOUT_OWNER':
      return {
        link: ['/tasks/unassigned'],
        queryParams: { reassign: condition.objectId },
        permissions: ['tasks:manage', 'tasks:reassign'],
      };
    case 'POSITION_WITHOUT_ROLE':
      return {
        link: ['/org-positions'],
        queryParams: { edit: condition.objectId },
        permissions: ['positions:view', 'positions:manage'],
      };
  }
}

export interface ConditionRow {
  id: string;
  severity: SetupConditionSeverity;
  objectName: string;
  context: string | null;
  consequence: string;
  age: string;
  openedAt: string;
  fix: { label: string; link: string[]; queryParams: Record<string, string> } | null;
  // Shown instead of a Fix the viewer could not use. Never a disabled button.
  fixNeeds: string | null;
}

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

const DAY_MS = 24 * 60 * 60 * 1000;

@Component({
  selector: 'app-setup-health-page',
  standalone: true,
  imports: [PageHeaderComponent, DatePipe, RouterLink, TranslatePipe, TooltipModule],
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
                    </span>
                    <span
                      class="flex-none w-[150px] text-[11.5px] text-[var(--am-text-secondary)] tabular-nums"
                      [pTooltip]="(row.openedAt | date: 'medium') ?? ''"
                      tooltipPosition="top"
                      >{{ row.age }}</span
                    >
                    <span class="flex-none">
                      @if (row.fix; as fix) {
                        <a class="am-health-fix" [routerLink]="fix.link" [queryParams]="fix.queryParams">{{
                          fix.label
                        }}</a>
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
                  {{ 'setupHealth.cleared.at' | translate: { date: (item.clearedAt | date: 'medium') } }}
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
      .am-health-filter:focus-visible,
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
      .am-health-fix:hover {
        filter: brightness(0.92);
      }
    `,
  ],
})
export class SetupHealthPageComponent implements OnInit {
  private readonly setupHealthService = inject(SetupHealthService);
  private readonly access = inject(NavigationAccessService);
  private readonly languageService = inject(LanguageService);
  private readonly translate = inject(TranslateService);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly health = signal<SetupHealthDto | null>(null);
  readonly filter = signal<SeverityFilter>('ALL');
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
    const open = this.health()?.open ?? [];
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
    const shown = filter === 'ALL' ? health.open : health.open.filter((c) => c.severity === filter);

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
    const times = (this.health()?.freshness ?? [])
      .map((f) => f.computedAt)
      .filter((t): t is string => t !== null)
      .map((t) => new Date(t).getTime());
    if (times.length === 0) return null;
    return this.translate.instant('setupHealth.checked', {
      when: this.relativeTime(new Date(Math.min(...times))),
    });
  });

  readonly emptyMessageKey = computed(() => {
    const health = this.health();
    if (!health) return 'setupHealth.empty';
    if (health.open.length > 0) return 'setupHealth.emptyFiltered';
    return health.freshness.every((f) => f.status === 'CURRENT')
      ? 'setupHealth.empty'
      : 'setupHealth.emptyUnconfirmed';
  });

  severityLabel(severity: SetupConditionSeverity): string {
    return this.translate.instant(`setupHealth.severity.${severity}`);
  }

  // Whole class strings, never assembled from a tone name: Tailwind only
  // generates classes it can find written out in the source.
  severityChipClass(severity: SetupConditionSeverity): string {
    const base = 'flex-none text-[11px] font-semibold rounded px-[7px] py-px whitespace-nowrap border ';
    return severity === 'BLOCKS_WORK'
      ? base +
          'text-[var(--am-condition-blocks-ink)] bg-[var(--am-condition-blocks-bg)] border-[var(--am-condition-blocks-border)]'
      : base + 'text-[var(--am-condition-risk-ink)] bg-[var(--am-condition-risk-bg)] border-[var(--am-condition-risk-border)]';
  }

  private toRow(condition: SetupConditionDto): ConditionRow {
    const target = fixTargetFor(condition);
    const permitted = !!target && target.permissions.every((p) => this.access.hasPermission(p));
    return {
      id: condition.id,
      severity: condition.severity,
      objectName: this.objectName(condition),
      context: this.context(condition),
      consequence: this.consequence(condition),
      age: this.age(condition),
      openedAt: condition.openedAt,
      fix:
        target && permitted
          ? {
              label: this.translate.instant(`setupHealth.fix.${condition.type}`),
              link: target.link,
              queryParams: target.queryParams,
            }
          : null,
      fixNeeds: target && !permitted ? this.translate.instant(`setupHealth.fixNeeds.${condition.type}`) : null,
    };
  }

  // Tenant data: chosen by language, never translated (SYSTEM-REFERENCE §9.3).
  private objectName(condition: SetupConditionDto): string {
    const s = condition.subject;
    if (condition.type === 'TASK_WITHOUT_OWNER') return s.title ?? '—';
    return (this.languageService.isArabic() && s.nameAr) || s.nameEn || '—';
  }

  private context(condition: SetupConditionDto): string | null {
    if (condition.type !== 'STAGE_WITHOUT_ASSIGNEE') return null;
    const s = condition.subject;
    const template = (this.languageService.isArabic() && s.templateNameAr) || s.templateNameEn;
    return template ? this.translate.instant('setupHealth.context.template', { name: template }) : null;
  }

  private consequence(condition: SetupConditionDto): string {
    const s = condition.subject;
    const t = (key: string, params?: Record<string, unknown>) =>
      this.translate.instant(`setupHealth.consequence.${key}`, params);
    switch (condition.type) {
      case 'ORG_UNIT_WITHOUT_HEAD':
        return t(s.escalationResolves === false ? 'unitUncovered' : 'unitCovered');
      case 'STAGE_WITHOUT_ASSIGNEE':
        return t(s.affectedInstances === 1 ? 'stageOne' : 'stageMany', { count: s.affectedInstances ?? 0 });
      case 'TASK_WITHOUT_OWNER':
        return t('task');
      case 'POSITION_WITHOUT_ROLE':
        return (s.holdersWithNoRoles ?? 0) > 0
          ? t('positionNoRoles', { holders: s.activeHolders ?? 0, noRoles: s.holdersWithNoRoles })
          : t('positionHolders', { holders: s.activeHolders ?? 0 });
    }
  }

  private age(condition: SetupConditionDto): string {
    const days = Math.max(0, Math.floor((this.loadedAt().getTime() - new Date(condition.openedAt).getTime()) / DAY_MS));
    const basis = condition.ageBasis === 'FIRST_DETECTED' ? 'detected' : 'open';
    const size = days === 0 ? 'Today' : days === 1 ? 'OneDay' : 'Days';
    return this.translate.instant(`setupHealth.age.${basis}${size}`, { count: days });
  }

  private freshnessNotice(f: SetupConditionFreshnessDto): string {
    const type = this.translate.instant(`setupHealth.types.${f.type}`);
    const when = f.computedAt ? this.relativeTime(new Date(f.computedAt)) : null;
    const key =
      f.status === 'FAILED'
        ? when
          ? 'failed'
          : 'failedNever'
        : f.status === 'OVERDUE'
          ? 'overdue'
          : 'neverRun';
    return this.translate.instant(`setupHealth.freshness.${key}`, { type, when });
  }

  private relativeTime(at: Date): string {
    const minutes = Math.max(0, Math.round((this.loadedAt().getTime() - at.getTime()) / 60000));
    if (minutes < 1) return this.translate.instant('setupHealth.relative.justNow');
    if (minutes < 60) return this.translate.instant('setupHealth.relative.minutes', { count: minutes });
    const hours = Math.round(minutes / 60);
    if (hours < 48) return this.translate.instant('setupHealth.relative.hours', { count: hours });
    return this.translate.instant('setupHealth.relative.days', { count: Math.round(hours / 24) });
  }
}
