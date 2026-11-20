import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { FormatService } from '../../core/formatting';
import { LanguageService } from '../../core/services/language.service';
import { CappedPanelComponent, CappedPanelState } from '../../shared/components/capped-panel/capped-panel.component';
import { AwaitingRow, AwaitingWords, changeRow, compareAwaiting, reviewRow, stageRow } from '../awaiting/awaiting-rows';
import { MyWorkCountsService, awaitingTotal, panelState } from './my-work-counts.service';

/** How many rows the panel shows. */
export const AWAITING_ROWS = 5;

export type { AwaitingRow } from '../awaiting/awaiting-rows';

/**
 * Home's "Awaiting my action": RECORDS to approve or return (Task Screens §10).
 * Task-request decisions are task work, on the line under the tiles.
 *
 * - **Stage approvals** — GET /workflows/awaiting-me (ACC-271): the records
 *   whose current stage this person works and decides at. The server applies
 *   every rule; this panel only lays the rows out.
 * - **Change requests** under review that this person may decide (ACC-240),
 *   asked of everyone while the committees module is open, because the server
 *   decides who may decide (ACC-283 PR 2).
 * - **Minutes to review** (ACC-316 PR 7c-2): meetings this person was present
 *   for and hasn't answered this round, while the meetings module is open.
 *
 * Rows are worded by the Awaiting page's own builders (awaiting-rows.ts), so a
 * row reads the same in both places.
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
    const w = this.words();
    return [
      ...answer.value.stages.rows.map((r) => stageRow(r, w, now)),
      ...answer.value.changes.map((r) => changeRow(r, w, now)),
      ...answer.value.reviews.map((r) => reviewRow(r, w, now)),
    ].sort(compareAwaiting);
  });

  readonly shown = computed(() => this.rows().slice(0, AWAITING_ROWS));

  /** The server's stage total (past five), every change request and every minutes to review. */
  readonly count = computed(() => {
    const answer = this.counts.awaiting();
    return answer.state === 'ready' ? awaitingTotal(answer.value) : 0;
  });

  private words(): AwaitingWords {
    return {
      t: (key, params) => this.translate.instant(key, params),
      bilingual: (en, ar) => this.language.bilingual(en, ar),
      number: (n) => this.format.number(n),
      duration: (ms) => this.format.duration(ms),
      relative: (since, now) => this.format.relative(since, now),
      day: (iso) => this.format.date(`${iso}T12:00:00.000Z`),
    };
  }
}
