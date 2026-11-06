import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LanguageService } from '../../core/services/language.service';
import { NavigationAccessService } from '../../core/services/navigation-access.service';
import { CappedPanelComponent, CappedPanelState } from '../../shared/components/capped-panel/capped-panel.component';
import { StatusChipComponent } from '../../shared/components/status-chip/status-chip.component';
import { CommitteeListStatus, committeeStatusOf } from '../committees/committee-status';
import { MyCommitteeRowDto } from '../committees/services/committee.service';
import { MyWorkCountsService, panelState } from './my-work-counts.service';

interface CommitteeRow {
  id: string;
  name: string;
  /** The committee's page, only for a viewer who may open it (committees:view). */
  link: string[] | null;
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
 * being a member is the entitlement. The name links to the committee only for a
 * viewer who may open it, and "All committees" shows only for them.
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
      @if (mayOpen()) {
        <a amPanelActions class="am-hc__link" routerLink="/committees" data-testid="home-committees-all">{{ 'home.allCommittees' | translate }}</a>
      }
      @for (r of rows(); track r.id) {
        <li class="am-cp-row" data-testid="home-committee-row">
          <span class="am-cp-l1">
            @if (r.link; as to) {
              <a class="am-cp-cut am-hc__name am-hc__name--link" [routerLink]="to">{{ r.name }}</a>
            } @else {
              <span class="am-cp-cut am-hc__name">{{ r.name }}</span>
            }
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
  private readonly access = inject(NavigationAccessService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);

  readonly mayOpen = computed(() => this.access.hasPermission('committees:view'));
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
    const mayOpen = this.mayOpen();
    return answer.value.rows.map((c) => this.toRow(c, mayOpen));
  });

  private toRow(c: MyCommitteeRowDto, mayOpen: boolean): CommitteeRow {
    const seat = c.seat.labelEn
      ? this.language.bilingual(c.seat.labelEn, c.seat.labelAr)
      : (this.translate.instant('home.seatUnknown') as string);
    const stage = c.stage.nameEn ? this.language.bilingual(c.stage.nameEn, c.stage.nameAr) : '—';
    return {
      id: c.committeeId,
      name: this.language.bilingual(c.nameEn, c.nameAr),
      link: mayOpen ? ['/committees', c.committeeId] : null,
      seat,
      stage,
      status: committeeStatusOf(c),
    };
  }
}
