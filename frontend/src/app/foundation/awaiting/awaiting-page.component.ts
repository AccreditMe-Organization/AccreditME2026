import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Subscription, forkJoin, of } from 'rxjs';
import { FormatService } from '../../core/formatting';
import { LanguageService } from '../../core/services/language.service';
import { NavigationAccessService } from '../../core/services/navigation-access.service';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { ChangeRequestDto, ChangeRequestService } from '../committees/change-requests/change-request.service';
import { WorkflowAwaitingRowDto, WorkflowService } from '../workflow/services/workflow.service';
import { AwaitingRow, AwaitingWords, changeRow, mergeAwaiting, stageRow } from './awaiting-rows';

/** Stage rows asked for per page (the server allows 1–50). */
export const AWAITING_PAGE = 50;

/**
 * ACC-120 — "Awaiting my action": every record waiting on the signed-in
 * person's decision, oldest first, the full list behind Home's panel.
 *
 * Two reads, both the server's answer, both self-scoped:
 * - GET /workflows/awaiting-me?skip=&take=50 — records at the person's stage,
 *   paged by the server (Load more asks the next 50).
 * - GET /committee-change-requests/awaiting-decision — every change request
 *   this person may decide (the server caps it at 200), asked only of
 *   committees:approve holders, as Home does, and only on the first load.
 *
 * They merge into one list by awaiting-rows.ts's rule, so Load more only
 * appends. Either read failing on the first load fails the page, with Retry
 * re-running both: a partial list is a wrong list. A failed Load more keeps
 * what is shown. Opening the page reads afresh; nothing polls.
 */
@Component({
  selector: 'app-awaiting-page',
  standalone: true,
  imports: [PageHeaderComponent, RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="am-aw-page" data-testid="awaiting-page">
      <app-page-header [title]="'home.awaiting' | translate">
        @if (state() === 'ready' && count() > 0) {
          <span pageMeta class="am-aw-page__count" data-testid="awaiting-count">{{ countText() }}</span>
        }
      </app-page-header>

      <div class="am-aw-page__card">
        @switch (state()) {
          @case ('loading') {
            <ul class="am-aw-page__list" aria-hidden="true" data-testid="awaiting-skeleton">
              @for (i of skeleton; track i) {
                <li class="am-aw-page__row">
                  <span class="am-skeleton-bar am-aw-page__bar1"></span>
                  <span class="am-skeleton-bar am-aw-page__bar2"></span>
                </li>
              }
            </ul>
          }
          @case ('error') {
            <p class="am-aw-page__state" role="alert" data-testid="awaiting-error">
              <span>{{ 'home.panel.awaitingFailed' | translate }}</span>
              <button type="button" class="am-aw-page__btn" (click)="load()" data-testid="awaiting-retry">{{ 'common.retry' | translate }}</button>
            </p>
          }
          @default {
            @if (rows().length === 0) {
              <p class="am-aw-page__state" data-testid="awaiting-empty">{{ 'home.nothingAwaiting' | translate }}</p>
            } @else {
              <ul class="am-aw-page__list" data-testid="awaiting-list">
                @for (row of rows(); track row.kind + row.id) {
                  <li class="am-aw-page__row" [attr.data-awaiting-kind]="row.kind" [attr.data-awaiting-id]="row.id">
                    @if (row.link) {
                      <a class="am-aw-page__title am-aw-page__link" [routerLink]="row.link" data-testid="awaiting-row">{{ row.title }}</a>
                    } @else {
                      <span class="am-aw-page__title" data-testid="awaiting-row">{{ row.title }}</span>
                    }
                    <span class="am-aw-page__meta">
                      <span class="am-aw-page__metatext">{{ row.meta }}</span>
                      <span aria-hidden="true">·</span>
                      <span class="am-aw-page__when" data-testid="awaiting-waiting">{{ row.waiting }}</span>
                    </span>
                  </li>
                }
              </ul>
              @if (more() === 'failed') {
                <p class="am-aw-page__foot" role="alert" data-testid="awaiting-more-failed">
                  <span>{{ 'home.panel.awaitingFailed' | translate }}</span>
                  <button type="button" class="am-aw-page__btn" (click)="loadMore()" data-testid="awaiting-more-retry">{{ 'common.retry' | translate }}</button>
                </p>
              } @else if (stagesRemain()) {
                <p class="am-aw-page__foot">
                  <button type="button" class="am-aw-page__btn" [disabled]="more() === 'loading'" (click)="loadMore()" data-testid="awaiting-more">
                    {{ (more() === 'loading' ? 'record.loadingMore' : 'record.loadMore') | translate }}
                  </button>
                </p>
              }
            }
          }
        }
      </div>
    </section>
  `,
  styles: [
    `
      .am-aw-page{display:flex;flex-direction:column;min-inline-size:0}
      .am-aw-page__count{font-size:var(--am-type-meta-size);line-height:var(--am-type-meta-line);color:var(--am-ink-500)}
      .am-aw-page__card{background:var(--am-surface-raised);border:1px solid var(--am-border);border-radius:var(--am-radius-card);min-inline-size:0}
      .am-aw-page__list{list-style:none;margin:0;padding:0}
      .am-aw-page__row{display:flex;flex-direction:column;gap:var(--am-space-2);padding:var(--am-space-12) var(--am-space-16);border-block-end:1px solid var(--am-border);min-inline-size:0}
      .am-aw-page__row:last-child{border-block-end:0}
      .am-aw-page__title{font-size:var(--am-type-value-size);line-height:var(--am-type-value-line);font-weight:500;color:var(--am-ink-900);overflow-wrap:anywhere}
      .am-aw-page__link{color:var(--am-primary-700);text-decoration:none}
      .am-aw-page__link:hover{text-decoration:underline}
      .am-aw-page__link:focus-visible,.am-aw-page__btn:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
      .am-aw-page__meta{display:flex;flex-wrap:wrap;gap:0 var(--am-space-6);font-size:var(--am-type-meta-size);line-height:var(--am-type-meta-line);color:var(--am-ink-500);min-inline-size:0}
      .am-aw-page__metatext{overflow-wrap:anywhere;min-inline-size:0}
      .am-aw-page__when{white-space:nowrap}
      .am-aw-page__bar1{inline-size:45%}
      .am-aw-page__bar2{inline-size:30%;margin-block-start:var(--am-space-6)}
      .am-aw-page__state,.am-aw-page__foot{display:flex;flex-wrap:wrap;align-items:center;gap:var(--am-space-8);margin:0;padding:var(--am-space-12) var(--am-space-16);font-size:var(--am-type-value-size);line-height:var(--am-type-value-line);color:var(--am-ink-700)}
      .am-aw-page__foot{border-block-start:1px solid var(--am-border)}
      .am-aw-page__btn{font:inherit;font-size:var(--am-type-meta-size);block-size:var(--am-control-height);padding:0 var(--am-space-12);border:1px solid var(--am-control-border);border-radius:var(--am-radius-button);background:var(--am-surface-raised);color:var(--am-ink-900);cursor:pointer}
    `,
  ],
})
export class AwaitingPageComponent {
  private readonly workflows = inject(WorkflowService);
  private readonly changeRequests = inject(ChangeRequestService);
  private readonly access = inject(NavigationAccessService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly format = inject(FormatService);

  protected readonly skeleton = [0, 1, 2, 3, 4, 5];

  readonly state = signal<'loading' | 'error' | 'ready'>('loading');
  /** Load more: idle, in flight, or failed (the rows shown stay). */
  readonly more = signal<'idle' | 'loading' | 'failed'>('idle');
  private readonly stageRows = signal<WorkflowAwaitingRowDto[]>([]);
  private readonly stageTotal = signal(0);
  private readonly changes = signal<ChangeRequestDto[]>([]);

  private request?: Subscription;
  private moreRequest?: Subscription;

  /** Stage rows the server still holds past those loaded. */
  readonly stagesRemain = computed(() => this.stageRows().length < this.stageTotal());

  /** Everything waiting: the stage total, plus every change request read. */
  readonly count = computed(() => this.stageTotal() + this.changes().length);
  readonly countText = computed(() => {
    this.translate.currentLang();
    return this.format.number(this.count());
  });

  readonly rows = computed<AwaitingRow[]>(() => {
    this.translate.currentLang();
    const now = new Date();
    const w = this.words();
    return mergeAwaiting(
      this.stageRows().map((r) => stageRow(r, w, now)),
      this.changes().map((r) => changeRow(r, w, now)),
      !this.stagesRemain(),
    );
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.request?.unsubscribe();
      this.moreRequest?.unsubscribe();
    });
    this.load();
  }

  /** The first page and the change requests, together; Retry runs both again. */
  load(): void {
    this.request?.unsubscribe();
    this.moreRequest?.unsubscribe();
    this.state.set('loading');
    this.more.set('idle');
    const changes$ = this.access.hasPermission('committees:approve') ? this.changeRequests.awaitingDecision() : of<ChangeRequestDto[]>([]);
    this.request = forkJoin({ stages: this.workflows.getAwaitingMe({ skip: 0, take: AWAITING_PAGE }), changes: changes$ }).subscribe({
      next: ({ stages, changes }) => {
        this.stageRows.set(stages.rows);
        this.stageTotal.set(stages.total);
        this.changes.set(changes);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }

  /** The next 50 stage rows; never the change requests again. Retry asks the same page. */
  loadMore(): void {
    if (this.more() === 'loading') return;
    this.more.set('loading');
    this.moreRequest?.unsubscribe();
    this.moreRequest = this.workflows.getAwaitingMe({ skip: this.stageRows().length, take: AWAITING_PAGE }).subscribe({
      next: (page) => {
        this.stageRows.update((rows) => [...rows, ...page.rows.filter((r) => !rows.some((x) => x.instanceStageId === r.instanceStageId))]);
        // An empty page means nothing is left, whatever the total said (records
        // decided since the first page): stop offering Load more.
        this.stageTotal.set(page.rows.length === 0 ? this.stageRows().length : page.total);
        this.more.set('idle');
      },
      error: () => this.more.set('failed'),
    });
  }

  private words(): AwaitingWords {
    return {
      t: (key, params) => this.translate.instant(key, params),
      bilingual: (en, ar) => this.language.bilingual(en, ar),
      number: (n) => this.format.number(n),
      duration: (ms) => this.format.duration(ms),
      relative: (since, now) => this.format.relative(since, now),
    };
  }
}
