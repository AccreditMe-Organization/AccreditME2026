import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { catchError, map, of } from 'rxjs';
import { FormatService } from '../../core/formatting';
import { ROUTE_PERMISSIONS, isNavModuleOpen } from '../../core/navigation/nav-items';
import { NavigationAccessService } from '../../core/services/navigation-access.service';
import { SetupConditionRows, severityChipClass } from '../setup-health/setup-condition-rows';
import { HomeTileComponent, HomeTileState } from './home-tile.component';
import {
  HomeAdminSummaryDto,
  HomeCommitteeCountsDto,
  HomeSetupSliceDto,
  HomeSummaryService,
  HomeUserCountsDto,
  isPartFailed,
} from './home-summary.service';
import { Loadable } from './my-work-counts.service';

type Part<T> = { state: HomeTileState; value: T | null };

/**
 * ACC-279 — Home's admin block (Ahmad, 6 Nov): Needs fixing, then the admin tiles,
 * each on its OWN permission, never on a role name. The block renders when at
 * least one part does, the rail's Administration rule (ACC-79); with none, it is
 * absent and its read is never sent.
 *
 *   Needs fixing, Open conditions   setup:view
 *   Active users, Pending invites   users:view (the seats line also tenant:view)
 *   Committees in force             committees:view, and the Committees module open
 *
 * ONE read, GET /home/admin-summary, which answers only the parts the caller may
 * see, each one independently: a part that failed says so with Retry, and the
 * others still show. Needs fixing's rows are worded by SetupConditionRows, the
 * same builder as the Setup health page, so the two never describe a condition
 * differently.
 */
@Component({
  selector: 'app-home-admin',
  standalone: true,
  imports: [HomeTileComponent, RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <section class="am-ha" [attr.aria-label]="'home.admin.label' | translate" data-testid="home-admin">
        @if (showSetup()) {
          <section class="am-nf" aria-labelledby="home-nf-h" data-testid="home-needs-fixing">
            <header class="am-nf__head">
              <span class="am-nf__title-row">
                <h2 id="home-nf-h" class="am-nf__title">{{ 'home.needsFixing.title' | translate }}</h2>
                @if (setup().state === 'ready') {
                  <span class="am-nf__count" data-testid="home-needs-fixing-count">{{ format.number(setup().value?.open ?? 0) }}</span>
                }
                @if (checked(); as when) {
                  <span class="am-nf__checked" data-testid="home-needs-fixing-checked">{{ when }}</span>
                }
              </span>
              @if (setupLink(); as to) {
                <a class="am-nf__open" [routerLink]="to" data-testid="home-needs-fixing-open">{{ 'home.needsFixing.open' | translate }}</a>
              }
            </header>
            @switch (setup().state) {
              @case ('loading') {
                <div class="am-nf__skeleton" aria-hidden="true"><span></span><span></span><span></span></div>
                <span class="sr-only">{{ 'common.loading' | translate }}</span>
              }
              @case ('failed') {
                <p class="am-nf__state" role="alert" data-testid="home-needs-fixing-failed">
                  {{ 'home.needsFixing.failed' | translate }}
                  <button type="button" class="am-nf__retry" (click)="load()" data-testid="home-needs-fixing-retry">{{ 'list.retry' | translate }}</button>
                </p>
              }
              @default {
                @if (stale()) {
                  <p class="am-nf__stale" role="status" data-testid="home-needs-fixing-stale">{{ 'home.needsFixing.stale' | translate }}</p>
                }
                @if (rows().length === 0) {
                  <p class="am-nf__state" data-testid="home-needs-fixing-empty">{{ 'home.needsFixing.empty' | translate }}</p>
                } @else {
                  <ul class="am-nf__rows">
                    @for (row of rows(); track row.id) {
                      <li class="am-nf__row" data-testid="home-needs-fixing-row">
                        <span [class]="chipClass(row.severity)">{{ severityLabel(row.severity) }}</span>
                        <span class="am-nf__what">
                          <span class="am-nf__name">{{ row.objectName }}</span>
                          <span class="am-nf__why">{{ row.consequence }}</span>
                        </span>
                        <span class="am-nf__age">{{ row.age }}</span>
                        @if (row.fix; as fix) {
                          <a class="am-nf__fix" [routerLink]="fix.link" [queryParams]="fix.queryParams" data-testid="home-needs-fixing-fix">{{ fix.label }}</a>
                        } @else if (row.fixNeeds) {
                          <span class="am-nf__needs">{{ row.fixNeeds }}</span>
                        }
                      </li>
                    }
                  </ul>
                }
                <p class="am-nf__note">{{ 'home.needsFixing.note' | translate }}</p>
              }
            }
          </section>
        }

        <div class="am-home-tiles" data-testid="home-admin-tiles">
          @if (showSetup()) {
            <am-home-tile
              [label]="'home.tile.openConditions' | translate"
              [state]="setup().state"
              [value]="format.number(setup().value?.open ?? 0)"
              [meta]="blockingMeta()"
              tone="danger"
              [link]="setupLink()"
              testId="home-tile-conditions"
              (retry)="load()"
            />
          }
          @if (showUsers()) {
            <am-home-tile
              [label]="'home.tile.activeUsers' | translate"
              [state]="users().state"
              [value]="format.number(users().value?.active ?? 0)"
              [meta]="seatsMeta()"
              [link]="usersLink()"
              testId="home-tile-users"
              (retry)="load()"
            />
            <am-home-tile
              [label]="'home.tile.pendingInvites' | translate"
              [state]="users().state"
              [value]="format.number(users().value?.invited ?? 0)"
              [meta]="expiredMeta()"
              tone="warning"
              [link]="usersLink()"
              testId="home-tile-invites"
              (retry)="load()"
            />
          }
          @if (showCommittees()) {
            <am-home-tile
              [label]="'home.tile.committeesInForce' | translate"
              [state]="committees().state"
              [value]="format.number(committees().value?.inForce ?? 0)"
              [meta]="quorumMeta()"
              [link]="committeesLink()"
              testId="home-tile-in-force"
              (retry)="load()"
            />
          }
        </div>
      </section>
    }
  `,
  styles: [
    `
      app-home-admin{display:block;min-inline-size:0}
      .am-ha{display:flex;flex-direction:column;gap:12px;min-inline-size:0}
      .am-home-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;min-inline-size:0}
      .am-nf{background:var(--am-surface-raised);border:1px solid var(--am-condition-blocks-border);border-radius:var(--am-radius-card);overflow:hidden;min-inline-size:0}
      .am-nf__head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px 10px;padding:11px 14px;background:var(--am-condition-blocks-bg);border-block-end:1px solid var(--am-condition-blocks-border)}
      .am-nf__title-row{display:flex;flex-wrap:wrap;align-items:center;gap:4px 9px;min-inline-size:0}
      .am-nf__title{margin:0;font-size:12px;line-height:18px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--am-condition-blocks-ink)}
      [dir=rtl] .am-nf__title{letter-spacing:0;text-transform:none;font-size:13px}
      .am-nf__count{font-size:11.5px;font-weight:600;color:var(--am-surface-raised);background:var(--am-danger-ink);border-radius:4px;padding:1px 7px;font-variant-numeric:tabular-nums}
      .am-nf__checked{font-size:11.5px;color:var(--am-ink-700)}
      .am-nf__open{flex:none;font-size:12.5px;font-weight:600;color:var(--am-primary-700);text-decoration:none}
      .am-nf__open:hover,.am-nf__fix:hover{text-decoration:underline}
      .am-nf__open:focus-visible,.am-nf__fix:focus-visible,.am-nf__retry:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
      .am-nf__rows{list-style:none;margin:0;padding:0}
      .am-nf__row{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:10px 14px;border-block-end:1px solid var(--am-row-rule);min-inline-size:0}
      .am-nf__what{flex:1 1 280px;min-inline-size:0;display:flex;flex-direction:column}
      .am-nf__name{font-size:13.5px;font-weight:500;color:var(--am-ink-900);overflow-wrap:anywhere;text-wrap:pretty}
      .am-nf__why{font-size:12px;color:var(--am-ink-500);overflow-wrap:anywhere;text-wrap:pretty}
      .am-nf__age{flex:none;font-size:11.5px;color:var(--am-ink-500);font-variant-numeric:tabular-nums}
      .am-nf__fix{flex:none;font-size:12.5px;font-weight:600;color:var(--am-primary-700);text-decoration:none;border:1px solid var(--am-control-border);border-radius:var(--am-radius-control);padding:4px 11px}
      .am-nf__needs{flex:0 1 220px;font-size:11.5px;color:var(--am-ink-500);text-wrap:pretty}
      .am-nf__note,.am-nf__stale{margin:0;padding:9px 14px;font-size:11.5px;color:var(--am-ink-500);text-wrap:pretty}
      .am-nf__stale{color:var(--am-warning-ink);border-block-end:1px solid var(--am-row-rule)}
      .am-nf__state{margin:0;display:flex;flex-wrap:wrap;gap:4px 8px;padding:14px;font-size:13px;color:var(--am-ink-700)}
      .am-nf__retry{font:inherit;font-weight:600;color:var(--am-primary-700);background:none;border:0;padding:0;cursor:pointer;text-decoration:underline}
      .am-nf__skeleton{display:flex;flex-direction:column;gap:12px;padding:14px}
      .am-nf__skeleton span{display:block;block-size:12px;border-radius:4px;background:var(--am-surface)}
      @media (max-width: 767.98px){.am-nf__fix,.am-nf__needs{margin-inline-start:auto}}
    `,
  ],
})
export class HomeAdminComponent implements OnInit {
  private readonly summary = inject(HomeSummaryService);
  private readonly access = inject(NavigationAccessService);
  private readonly conditions = inject(SetupConditionRows);
  private readonly translate = inject(TranslateService);
  protected readonly format = inject(FormatService);

  readonly showSetup = computed(() => this.access.hasPermission('setup:view'));
  readonly showUsers = computed(() => this.access.hasPermission('users:view'));
  readonly showCommittees = computed(() => this.access.hasPermission('committees:view') && isNavModuleOpen('committees', this.access));
  readonly visible = computed(() => this.showSetup() || this.showUsers() || this.showCommittees());

  private readonly answer = signal<Loadable<HomeAdminSummaryDto>>({ state: 'loading' });
  private readonly loadedAt = signal(new Date());

  readonly setup = computed(() => this.part<HomeSetupSliceDto>((s) => s.setup));
  readonly users = computed(() => this.part<HomeUserCountsDto>((s) => s.users));
  readonly committees = computed(() => this.part<HomeCommitteeCountsDto>((s) => s.committees));

  readonly rows = computed(() => {
    this.translate.currentLang();
    const at = this.loadedAt();
    return (this.setup().value?.top ?? []).map((c) => this.conditions.toRow(c, at));
  });

  readonly checked = computed(() => {
    this.translate.currentLang();
    const slice = this.setup().value;
    return slice ? this.conditions.lastChecked(slice.freshness, this.loadedAt()) : null;
  });

  /** A check that failed, is late, or never ran: the rows are the last confirmed truth. */
  readonly stale = computed(() => (this.setup().value?.freshness ?? []).some((f) => f.status !== 'CURRENT'));

  readonly blockingMeta = computed(() => this.counted('home.blocking', this.setup().value?.blocksWork ?? 0));
  readonly expiredMeta = computed(() => this.counted('home.expiredInvites', this.users().value?.invitedExpired ?? 0));
  readonly quorumMeta = computed(() => this.counted('home.belowQuorum', this.committees().value?.belowQuorum ?? 0));
  /** "{occupied} of {max} seats in use"; absent with no seat limit, so never "of 0". */
  readonly seatsMeta = computed(() => {
    this.translate.currentLang();
    const seats = this.users().value?.seats;
    return seats && seats.maxUsers > 0
      ? this.format.count('home.seatsInUse', seats.maxUsers, { occupied: this.format.number(seats.occupied) })
      : null;
  });

  readonly setupLink = computed(() => this.permittedLink('setup-health'));
  readonly usersLink = computed(() => this.permittedLink('users'));
  readonly committeesLink = computed(() => this.permittedLink('committees'));

  ngOnInit(): void {
    this.load();
  }

  /** One read for every part; Retry anywhere runs it again. */
  load(): void {
    if (!this.visible()) return;
    this.answer.set({ state: 'loading' });
    this.summary
      .adminSummary()
      .pipe(
        map((value): Loadable<HomeAdminSummaryDto> => ({ state: 'ready', value })),
        catchError(() => of<Loadable<HomeAdminSummaryDto>>({ state: 'failed' })),
      )
      .subscribe((answer) => {
        this.loadedAt.set(new Date());
        this.answer.set(answer);
      });
  }

  severityLabel(severity: 'BLOCKS_WORK' | 'AT_RISK'): string {
    return this.conditions.severityLabel(severity);
  }

  chipClass(severity: 'BLOCKS_WORK' | 'AT_RISK'): string {
    return severityChipClass(severity);
  }

  private part<T extends object>(pick: (s: HomeAdminSummaryDto) => T | { failed: true } | null): Part<T> {
    const answer = this.answer();
    if (answer.state !== 'ready') return { state: answer.state, value: null };
    const value = pick(answer.value);
    // null here means the server did not send a part the screen asked for: say
    // it failed rather than drawing a 0 nobody computed.
    if (value === null || isPartFailed(value)) return { state: 'failed', value: null };
    return { state: 'ready', value: value as T };
  }

  /** A count string, only when there is something to say: "0 blocking" is not shown. */
  private counted(key: 'home.blocking' | 'home.expiredInvites' | 'home.belowQuorum', n: number): string | null {
    this.translate.currentLang();
    return n > 0 ? this.format.count(key, n) : null;
  }

  /** The route's link, only for a viewer its guard admits — hidden, never refused. */
  private permittedLink(route: string): string[] | null {
    const needs = ROUTE_PERMISSIONS.get(route) ?? [];
    return needs.every((p) => this.access.hasPermission(p)) ? [`/${route}`] : null;
  }
}
