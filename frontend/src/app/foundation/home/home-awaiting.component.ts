import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { forkJoin, of, catchError, map } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { FormatService } from '../../core/formatting';
import { LanguageService } from '../../core/services/language.service';
import { NavigationAccessService } from '../../core/services/navigation-access.service';
import { CardComponent } from '../../shared/components/card/card.component';
import { recordPageLink } from '../../shared/utils/record-link.util';
import { ChangeRequestDto, ChangeRequestService } from '../committees/change-requests/change-request.service';
import { WorkflowAwaitingMeDto, WorkflowService } from '../workflow/services/workflow.service';

/** How many rows the card shows (Q-B). */
export const AWAITING_ROWS = 5;

export interface AwaitingRow {
  id: string;
  kind: 'stage' | 'change';
  /** When it began waiting: entering the stage, or a change request's Submit. */
  since: string;
  title: string;
  meta: string;
  /** The record's page; null for a record with no page yet, named without a link. */
  link: string[] | null;
}

const NOTHING: WorkflowAwaitingMeDto = { total: 0, rows: [] };

/**
 * Home's "Awaiting my action": RECORDS to approve or return (approved drawing,
 * Task Screens §10). Task-request decisions are task work and live in the My
 * tasks panel instead (decision 7 there), so they are not read here.
 *
 * - **Stage approvals** — GET /workflows/awaiting-me (ACC-271): the records
 *   whose current stage this person works and decides at. The server applies
 *   every rule; this card only lays the rows out.
 * - **Change requests** under review that this person may decide (ACC-240),
 *   read only for holders of `committees:approve` — the endpoint's own
 *   permission, so nobody else is sent a 403.
 *
 * Merged oldest first, five rows. The badge counts both (the server's stage
 * total, so it counts past five). Rendered only with at least one row: no card
 * while loading, with nothing waiting, or when both reads fail (Home fails
 * quietly, ACC-70).
 */
@Component({
  selector: 'app-home-awaiting',
  standalone: true,
  imports: [RouterLink, TranslatePipe, CardComponent],
  template: `
    @if (rows().length) {
      <app-card>
        <section aria-labelledby="home-awaiting-h" data-testid="home-awaiting">
          <div class="am-aw__head">
            <span class="am-aw__title-row">
              <h3 id="home-awaiting-h" class="text-lg font-medium">{{ 'home.awaiting' | translate }}</h3>
              <span class="am-aw__count" data-testid="home-awaiting-count">{{ countLabel() }}</span>
            </span>
            <span class="am-aw__sub" data-testid="home-awaiting-sub">{{ subtitle() }}</span>
          </div>
          <ul class="flex flex-col divide-y divide-[var(--am-border)]">
            @for (row of shown(); track row.kind + row.id) {
              <li class="py-2.5 flex flex-col gap-0.5 min-w-0" [attr.data-awaiting-kind]="row.kind">
                @if (row.link) {
                  <a class="am-aw__link" [routerLink]="row.link" data-testid="home-awaiting-row">{{ row.title }}</a>
                } @else {
                  <span class="am-aw__name" data-testid="home-awaiting-row">{{ row.title }}</span>
                }
                <span class="text-xs text-[var(--am-text-secondary)]">{{ row.meta }}</span>
              </li>
            }
          </ul>
        </section>
      </app-card>
    }
  `,
  styles: [
    `
      .am-aw__head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--am-space-4) var(--am-space-12);margin-block-end:var(--am-space-12)}
      .am-aw__title-row{display:flex;align-items:center;gap:var(--am-space-8);min-inline-size:0}
      .am-aw__count{flex:none;font-size:12px;font-weight:600;color:var(--am-ink-700);background:var(--am-surface);border:1px solid var(--am-border);border-radius:var(--am-radius-pill);padding:0 8px}
      .am-aw__sub{font-size:var(--am-type-meta-size);line-height:var(--am-type-meta-line);color:var(--am-ink-500)}
      .am-aw__link,.am-aw__name{font-size:14px;font-weight:500;overflow-wrap:anywhere}
      .am-aw__link{color:var(--am-primary-700);text-decoration:none}
      .am-aw__name{color:var(--am-ink-900)}
      .am-aw__link:hover{text-decoration:underline}
      .am-aw__link:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
    `,
  ],
})
export class HomeAwaitingComponent {
  private readonly workflows = inject(WorkflowService);
  private readonly changeRequests = inject(ChangeRequestService);
  private readonly access = inject(NavigationAccessService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly format = inject(FormatService);

  private readonly stages = signal<WorkflowAwaitingMeDto>(NOTHING);
  private readonly changes = signal<ChangeRequestDto[]>([]);

  /** Every row, oldest first. */
  readonly rows = computed<AwaitingRow[]>(() => {
    this.translate.currentLang();
    const stageRows = this.stages().rows.map((r): AwaitingRow => ({
      id: r.instanceStageId,
      kind: 'stage',
      since: r.since,
      title: this.language.bilingual(r.record.nameEn, r.record.nameAr),
      meta: this.translate.instant('home.awaitingStageMeta', {
        type: this.translate.instant(`workflow.objectTypeName.${r.record.type}`),
        stage: this.language.bilingual(r.stage.nameEn, r.stage.nameAr),
        position: this.format.number(r.stage.position),
        count: this.format.number(r.stage.stageCount),
        date: this.format.date(r.since),
      }),
      link: recordPageLink(r.record.type, r.record.id),
    }));
    const changeRows = this.changes().map((r): AwaitingRow => ({
      id: r.id,
      kind: 'change',
      since: r.submittedAt ?? r.createdAt,
      title: this.translate.instant('home.awaitingChange', {
        n: this.format.number(r.number),
        committee: this.language.bilingual(r.committeeNameEn, r.committeeNameAr),
      }),
      meta: this.translate.instant('home.awaitingChangeMeta', { name: r.requestedBy.name, date: this.format.date(r.submittedAt ?? r.createdAt) }),
      link: ['/committees', r.committeeId, 'change-requests', r.id],
    }));
    return [...stageRows, ...changeRows].sort((a, b) => a.since.localeCompare(b.since) || a.id.localeCompare(b.id));
  });

  readonly shown = computed(() => this.rows().slice(0, AWAITING_ROWS));

  /** The server's stage total (past five) plus every change request read. */
  readonly count = computed(() => this.stages().total + this.changes().length);
  readonly countLabel = computed(() => this.format.number(this.count()));
  readonly subtitle = computed(() => {
    this.translate.currentLang();
    return this.format.count('home.awaitingRecords', this.count());
  });

  constructor() {
    const stages$ = this.workflows.getAwaitingMe().pipe(
      map((answer) => answer ?? NOTHING),
      catchError(() => of(NOTHING)),
    );
    const changes$ = this.access.hasPermission('committees:approve')
      ? this.changeRequests.awaitingDecision().pipe(catchError(() => of<ChangeRequestDto[]>([])))
      : of<ChangeRequestDto[]>([]);
    forkJoin([stages$, changes$]).subscribe(([stages, changes]) => {
      this.stages.set(stages);
      this.changes.set(changes);
    });
  }
}
