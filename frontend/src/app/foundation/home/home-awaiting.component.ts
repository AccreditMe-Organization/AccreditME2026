import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { FormatService } from '../../core/formatting';
import { LanguageService } from '../../core/services/language.service';
import { CappedPanelComponent, CappedPanelState } from '../../shared/components/capped-panel/capped-panel.component';
import { recordPageLink } from '../../shared/utils/record-link.util';
import { MyWorkCountsService, panelState } from './my-work-counts.service';

/** How many rows the panel shows. */
export const AWAITING_ROWS = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AwaitingRow {
  id: string;
  kind: 'stage' | 'change';
  /** When it began waiting: entering the stage, or a change request's Submit. */
  since: string;
  title: string;
  meta: string;
  /** "3 days waiting": how long, from `since`. */
  waiting: string;
  /** The record's page; null for a record with no page yet, named without a link. */
  link: string[] | null;
}

/**
 * Home's "Awaiting my action": RECORDS to approve or return (Task Screens §10).
 * Task-request decisions are task work, on the line under the tiles.
 *
 * - **Stage approvals** — GET /workflows/awaiting-me (ACC-271): the records
 *   whose current stage this person works and decides at. The server applies
 *   every rule; this panel only lays the rows out.
 * - **Change requests** under review that this person may decide (ACC-240),
 *   asked only of holders of `committees:approve`.
 *
 * ACC-279 — on am-capped-panel, always shown (Ahmad, Q9): with nothing waiting
 * it says so, and a failed read says THAT, with Retry. Until ACC-279 the card
 * vanished at 0 and on failure alike, so a failure read as "nothing to do".
 * Both reads come from MyWorkCountsService, shared with the tile and the rail;
 * either half failing fails the panel, because a partial count is a wrong one.
 * No "View all": no page lists every record awaiting a person yet, and a link to
 * a list that does not hold them would be a wrong turn.
 */
@Component({
  selector: 'app-home-awaiting',
  standalone: true,
  imports: [CappedPanelComponent, RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <am-capped-panel
      [heading]="'home.awaiting' | translate"
      [state]="state()"
      [total]="count()"
      [shown]="shown().length"
      [offersSeeAll]="false"
      [loadingText]="'home.panel.loading' | translate"
      [errorText]="'home.panel.awaitingFailed' | translate"
      [emptyText]="'home.nothingAwaiting' | translate"
      testIdPrefix="home-awaiting"
      (retry)="counts.loadAwaiting()"
    >
      @for (row of shown(); track row.kind + row.id) {
        <li class="am-cp-row" [attr.data-awaiting-kind]="row.kind">
          <span class="am-cp-l1">
            @if (row.link) {
              <a class="am-cp-cut am-aw__link" [routerLink]="row.link" data-testid="home-awaiting-row">{{ row.title }}</a>
            } @else {
              <span class="am-cp-cut am-aw__name" data-testid="home-awaiting-row">{{ row.title }}</span>
            }
          </span>
          <span class="am-cp-l2">
            <span class="am-cp-cut">{{ row.meta }}</span>
            <span class="am-aw__dot" aria-hidden="true">·</span>
            <span class="am-aw__when" data-testid="home-awaiting-waiting">{{ row.waiting }}</span>
          </span>
        </li>
      }
    </am-capped-panel>
  `,
  styles: [
    `
      app-home-awaiting{display:block;min-inline-size:0}
      .am-aw__link,.am-aw__name{font-size:13px;font-weight:500}
      .am-aw__link{color:var(--am-primary-700);text-decoration:none}
      .am-aw__name{color:var(--am-ink-900)}
      .am-aw__link:hover{text-decoration:underline}
      .am-aw__link:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
      .am-aw__dot{flex:none;padding-inline:5px;color:var(--am-ink-500)}
      .am-aw__when{flex:none;white-space:nowrap}
    `,
  ],
})
export class HomeAwaitingComponent {
  protected readonly counts = inject(MyWorkCountsService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly format = inject(FormatService);

  /** The panel calls a failure `error`. */
  readonly state = computed((): CappedPanelState => panelState(this.counts.awaiting().state));

  /** Every row, oldest first. */
  readonly rows = computed<AwaitingRow[]>(() => {
    this.translate.currentLang();
    const answer = this.counts.awaiting();
    if (answer.state !== 'ready') return [];
    const now = new Date();
    const stageRows = answer.value.stages.rows.map((r): AwaitingRow => ({
      id: r.instanceStageId,
      kind: 'stage',
      since: r.since,
      title: this.language.bilingual(r.record.nameEn, r.record.nameAr),
      meta: this.translate.instant('home.awaitingStageMeta', {
        type: this.translate.instant(`workflow.objectTypeName.${r.record.type}`),
        stage: this.language.bilingual(r.stage.nameEn, r.stage.nameAr),
        position: this.format.number(r.stage.position),
        count: this.format.number(r.stage.stageCount),
      }),
      waiting: this.waiting(r.since, now),
      link: recordPageLink(r.record.type, r.record.id),
    }));
    const changeRows = answer.value.changes.map((r): AwaitingRow => {
      const since = r.submittedAt ?? r.createdAt;
      return {
        id: r.id,
        kind: 'change',
        since,
        title: this.translate.instant('home.awaitingChange', {
          n: this.format.number(r.number),
          committee: this.language.bilingual(r.committeeNameEn, r.committeeNameAr),
        }),
        meta: this.translate.instant('home.awaitingChangeMeta', { name: r.requestedBy.name }),
        waiting: this.waiting(since, now),
        link: ['/committees', r.committeeId, 'change-requests', r.id],
      };
    });
    return [...stageRows, ...changeRows].sort((a, b) => a.since.localeCompare(b.since) || a.id.localeCompare(b.id));
  });

  readonly shown = computed(() => this.rows().slice(0, AWAITING_ROWS));

  /** The server's stage total (past five) plus every change request read. */
  readonly count = computed(() => {
    const answer = this.counts.awaiting();
    return answer.state === 'ready' ? answer.value.stages.total + answer.value.changes.length : 0;
  });

  /** "3 days waiting"; under a day, "waiting since today". Wording, not an SLA. */
  private waiting(since: string, now: Date): string {
    const ms = now.getTime() - new Date(since).getTime();
    return ms < DAY_MS
      ? this.translate.instant('home.waitingToday')
      : // Both forms, as Setup health's ages: English reads the duration ("3 days
        // waiting"), Arabic the relative form, which takes the genitive after its
        // preposition (ACC-94).
        this.translate.instant('home.waitingFor', {
          duration: this.format.duration(Math.floor(ms / DAY_MS) * DAY_MS),
          relative: this.format.relative(since, now),
        });
  }
}
