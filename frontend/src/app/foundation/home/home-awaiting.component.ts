import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { forkJoin, of, catchError } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { FormatService } from '../../core/formatting';
import { LanguageService } from '../../core/services/language.service';
import { NavigationAccessService } from '../../core/services/navigation-access.service';
import { CardComponent } from '../../shared/components/card/card.component';
import { ChangeRequestDto, ChangeRequestService } from '../committees/change-requests/change-request.service';
import { TaskRequestForDecisionDto, TaskService } from '../tasks/services/task.service';

/** How many rows the card shows (Q-B). */
export const AWAITING_ROWS = 5;

export interface AwaitingRow {
  id: string;
  kind: 'change' | 'task';
  /** When it began waiting: a change request's Submit, a task request's ask. */
  since: string;
  title: string;
  meta: string;
  link: string[];
  query: Record<string, string> | null;
}

/**
 * ACC-240 — Home's "Awaiting my action" (plan §3.5, Q-B): change requests under
 * review the viewer may decide and task requests the viewer may decide, oldest
 * first, five rows, each opening its own page. Rendered only with at least one
 * row: no card while loading, when there is nothing, or when both reads fail
 * (Home fails quietly, ACC-70).
 *
 * The change requests are read only for holders of `committees:approve` — the
 * endpoint's own permission, so nobody else is sent a 403. Who may decide which
 * request is the server's: the read returns only what this viewer may decide.
 */
@Component({
  selector: 'app-home-awaiting',
  standalone: true,
  imports: [RouterLink, TranslatePipe, CardComponent],
  template: `
    @if (rows().length) {
      <app-card>
        <section aria-labelledby="home-awaiting-h" data-testid="home-awaiting">
          <div class="flex items-center justify-between mb-3 gap-3">
            <h3 id="home-awaiting-h" class="text-lg font-medium">{{ 'home.awaiting' | translate }}</h3>
            @if (hasTaskRequests()) {
              <a routerLink="/tasks" class="text-sm text-[var(--am-blue-primary)]" data-testid="home-awaiting-all">{{ 'home.awaitingSeeAll' | translate }}</a>
            }
          </div>
          <ul class="flex flex-col divide-y divide-[var(--am-border)]">
            @for (row of shown(); track row.kind + row.id) {
              <li class="py-2.5 flex flex-col gap-0.5 min-w-0" [attr.data-awaiting-kind]="row.kind">
                <a
                  class="am-aw__link"
                  [routerLink]="row.link"
                  [queryParams]="row.query"
                  data-testid="home-awaiting-row"
                  >{{ row.title }}</a
                >
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
      .am-aw__link{font-size:14px;font-weight:500;color:var(--am-primary-700);text-decoration:none;overflow-wrap:anywhere}
      .am-aw__link:hover{text-decoration:underline}
      .am-aw__link:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
    `,
  ],
})
export class HomeAwaitingComponent {
  private readonly tasks = inject(TaskService);
  private readonly changeRequests = inject(ChangeRequestService);
  private readonly access = inject(NavigationAccessService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly format = inject(FormatService);

  private readonly changes = signal<ChangeRequestDto[]>([]);
  private readonly taskRequests = signal<TaskRequestForDecisionDto[]>([]);

  /** Every row, oldest first. */
  readonly rows = computed<AwaitingRow[]>(() => {
    this.translate.currentLang();
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
      query: null,
    }));
    const taskRows = this.taskRequests().map((r): AwaitingRow => ({
      id: r.id,
      kind: 'task',
      since: r.createdAt,
      title: r.task.title,
      meta:
        r.type === 'ON_HOLD'
          ? this.translate.instant('task.request.askedHold', { name: r.requestedByName, date: this.format.date(r.holdUntil) })
          : this.translate.instant('task.request.askedExtension', { name: r.requestedByName, date: this.format.dateTime(r.requestedDueAt) }),
      // The row in My Tasks' "Waiting for your decision" (ACC-198's ?request=).
      link: ['/tasks'],
      query: { request: r.id },
    }));
    return [...changeRows, ...taskRows].sort((a, b) => a.since.localeCompare(b.since) || a.id.localeCompare(b.id));
  });

  readonly shown = computed(() => this.rows().slice(0, AWAITING_ROWS));
  readonly hasTaskRequests = computed(() => this.taskRequests().length > 0);

  constructor() {
    const changes$ = this.access.hasPermission('committees:approve')
      ? this.changeRequests.awaitingDecision().pipe(catchError(() => of<ChangeRequestDto[]>([])))
      : of<ChangeRequestDto[]>([]);
    const tasks$ = this.tasks.getAwaitingDecision().pipe(catchError(() => of<TaskRequestForDecisionDto[]>([])));
    forkJoin([changes$, tasks$]).subscribe(([changes, tasks]) => {
      this.changes.set(changes);
      this.taskRequests.set(tasks);
    });
  }
}
