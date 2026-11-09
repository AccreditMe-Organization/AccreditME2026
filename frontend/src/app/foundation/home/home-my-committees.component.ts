import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LanguageService } from '../../core/services/language.service';
import { injectNavAccess } from '../../core/navigation/nav-access';
import { isNavItemVisible, tenantNavItemForRoute } from '../../core/navigation/nav-items';
import { CappedPanelComponent, CappedPanelState } from '../../shared/components/capped-panel/capped-panel.component';
import { StatusChipComponent } from '../../shared/components/status-chip/status-chip.component';
import { CommitteeListStatus, committeeStatusOf } from '../committees/committee-status';
import { MyCommitteeRowDto } from '../committees/services/committee.service';
import { MyWorkCountsService, panelState } from './my-work-counts.service';

interface CommitteeRow {
  id: string;
  name: string;
  /** The committee's page: every row is the viewer's own active committee, which they may open. */
  link: string[];
  seat: string;
  stage: string;
  status: CommitteeListStatus;
}

/**
 * ACC-279 — Home's My committees: the committees the person sits on, five, by
 * seat (Chair first), with their status read from the stage's flags through the
 * ONE rule the committees list uses (committeeStatusOf, ACC-256).
 *
 * Every member sees it, with or without committees:view (Ahmad, 6 Nov, Q2):
 * being a member is the entitlement. Every row is one of the viewer's own ACTIVE
 * memberships of an ACTIVE committee (committee-home.service.ts), and since
 * ACC-281 a member may open those, so every name links to its committee.
 * "All committees" shows when the rail would show Committees: the rail's own rule
 * (isNavItemVisible on the Committees item: committees:view, or a member), never a
 * copy of it.
 */
@Component({
  selector: 'app-home-my-committees',
  standalone: true,
  imports: [CappedPanelComponent, StatusChipComponent, RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <am-capped-panel
      [heading]="'home.myCommittees' | translate"
      [state]="state()"
      [total]="total()"
      [shown]="rows().length"
      [offersSeeAll]="false"
      [loadingText]="'home.panel.loading' | translate"
      [errorText]="'home.panel.myCommitteesFailed' | translate"
      [emptyText]="'home.noCommittees' | translate"
      testIdPrefix="home-committees"
      (retry)="counts.loadMyCommittees()"
    >
      @if (showsAll()) {
        <a amPanelActions class="am-hc__link" routerLink="/committees" data-testid="home-committees-all">{{ 'home.allCommittees' | translate }}</a>
      }
      @for (r of rows(); track r.id) {
        <li class="am-cp-row" data-testid="home-committee-row">
          <span class="am-cp-l1">
            <a class="am-cp-cut am-hc__name am-hc__name--link" [routerLink]="r.link">{{ r.name }}</a>
            <app-status-chip variant="committee" labelPrefix="committee.status" [value]="r.status" />
          </span>
          <span class="am-cp-l2">
            <span class="am-cp-cut">{{ r.seat }}</span>
            <span class="am-hc__dot" aria-hidden="true">·</span>
            <span class="am-cp-cut">{{ r.stage }}</span>
          </span>
        </li>
      }
    </am-capped-panel>
  `,
  styles: [
    `
      app-home-my-committees{display:block;min-inline-size:0}
      .am-hc__link{flex:none;font-size:12px;font-weight:600;color:var(--am-primary-700);text-decoration:none;white-space:nowrap}
      .am-hc__link:hover,.am-hc__name--link:hover{text-decoration:underline}
      .am-hc__link:focus-visible,.am-hc__name--link:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
      .am-hc__name{font-size:13px;font-weight:500;color:var(--am-ink-900)}
      .am-hc__name--link{color:var(--am-primary-700);text-decoration:none}
      .am-hc__dot{flex:none;padding-inline:5px;color:var(--am-ink-500)}
    `,
  ],
})
export class HomeMyCommitteesComponent {
  protected readonly counts = inject(MyWorkCountsService);
  private readonly nav = injectNavAccess();
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);

  /** The rail's rule for the Committees item; no item means no link (fail closed). */
  readonly showsAll = computed(() => {
    const item = tenantNavItemForRoute('committees');
    return !!item && isNavItemVisible(item, this.nav);
  });
  /** The panel calls a failure `error`. */
  readonly state = computed((): CappedPanelState => panelState(this.counts.myCommittees().state));
  readonly total = computed(() => {
    const answer = this.counts.myCommittees();
    return answer.state === 'ready' ? answer.value.total : 0;
  });

  readonly rows = computed<CommitteeRow[]>(() => {
    this.translate.currentLang();
    const answer = this.counts.myCommittees();
    if (answer.state !== 'ready') return [];
    return answer.value.rows.map((c) => this.toRow(c));
  });

  private toRow(c: MyCommitteeRowDto): CommitteeRow {
    const seat = c.seat.labelEn
      ? this.language.bilingual(c.seat.labelEn, c.seat.labelAr)
      : (this.translate.instant('home.seatUnknown') as string);
    const stage = c.stage.nameEn ? this.language.bilingual(c.stage.nameEn, c.stage.nameAr) : '—';
    return {
      id: c.committeeId,
      name: this.language.bilingual(c.nameEn, c.nameAr),
      link: ['/committees', c.committeeId],
      seat,
      stage,
      status: committeeStatusOf(c),
    };
  }
}
