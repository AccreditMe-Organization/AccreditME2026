import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { map, tap } from 'rxjs';
import { DataListComponent, DataListColumn, DataListScope } from '../../../../shared/components/data-list/data-list.component';
import { ListRowDirective } from '../../../../shared/components/data-list/list-row.directive';
import { DataListSource } from '../../../../shared/components/data-list/data-list.source';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { LanguageService } from '../../../../core/services/language.service';
import { FormatService } from '../../../../core/formatting';
import { MeetingService, type MeetingListItemDto, type MeetingListView, type MeetingSeriesDto } from '../../services/meeting.service';
import { isCancelled, isClosed, ownerGlyph, ownerLink, ownerName, stageName } from '../../meeting-display';
import { seriesSummary } from '../../meeting-series-text';

const PAGE = 25;

/**
 * ACC-316 PR 6 — /meetings: the saved views (Mine, Past, Minutes I record, All
 * meetings, Sub-units' meetings), searched by title, paged on the server. Which
 * meetings a person sees in each is the server's (the parent rule, plan §4.1);
 * "All meetings" is offered only where the list's answer says `canSeeAll`. Ordered by time, as the server orders each view: the headers are
 * plain text because the list takes no sort (a column the server cannot sort
 * by stays plain, ACC-234). Nothing polls.
 */
@Component({
  selector: 'app-meeting-list',
  standalone: true,
  imports: [TranslatePipe, RouterLink, DataListComponent, ListRowDirective, PageHeaderComponent],
  template: `
    <div class="am-ml flex flex-col gap-3 h-full min-h-0" data-testid="meeting-list-page">
      <app-page-header [title]="'meeting.title' | translate" />
      <p class="m-0 text-meta text-[var(--am-ink-500)]" data-testid="meeting-list-order">{{ (seriesFilter() ? 'meeting.list.seriesOrder' : 'meeting.list.order') | translate }}</p>
      <!--
        PR 8b — the whole series (?seriesId=, the meeting header's "Whole
        series"): its owner and its pattern, then its meetings by the same views
        an owner's list has. A cancelled one reads Cancelled (A9).
        P240 — one list, by date (view=series), as drawn.
      -->
      @if (seriesFilter()) {
        <section class="flex flex-col gap-1" data-testid="meeting-list-series">
          <h2 class="m-0 text-heading font-semibold" data-testid="meeting-list-series-title">{{ 'meeting.list.seriesTitle' | translate: { owner: seriesOwnerLabel() } }}</h2>
          @if (seriesText()) {
            <p class="m-0 text-value" data-testid="meeting-list-series-line"><bdi>{{ seriesText() }}</bdi></p>
          }
          <a routerLink="/meetings" class="text-value text-[var(--am-blue-primary)] self-start" data-testid="meeting-list-series-clear">{{ 'meeting.list.clearOwner' | translate }}</a>
        </section>
      }
      <!-- ACC-316 PR 7 — opened from a committee's or unit's Meetings panel (See all). -->
      @if (ownerFilter()) {
        <p class="m-0 flex flex-wrap items-center gap-2 text-[13px]" data-testid="meeting-list-owner">
          <span>{{ 'meeting.list.ownerFilter' | translate: { owner: ownerLabel() } }}</span>
          <a routerLink="/meetings" class="text-[var(--am-blue-primary)]" data-testid="meeting-list-owner-clear">{{ 'meeting.list.clearOwner' | translate }}</a>
        </p>
      }
      @for (k of [listKey()]; track k) {
      <div class="rounded-lg border border-[var(--am-border)] bg-[var(--am-card)] overflow-hidden flex flex-col min-h-0">
        <app-data-list
          #list
          variant="page"
          [source]="source"
          [trackBy]="trackById"
          [columns]="columns()"
          [scopes]="scopes()"
          [pageSize]="pageSize"
          [showPager]="!seriesFilter()"
          [searchPlaceholder]="'meeting.list.search' | translate"
          [emptyTitle]="'meeting.list.emptyTitle' | translate"
          [emptyMessage]="'meeting.list.emptyBody' | translate"
          [noResultsTitle]="'meeting.list.noMatchTitle' | translate"
          [noResultsMessage]="'meeting.list.noMatchBody' | translate"
          [hasDestination]="true"
          gridSuffix="0px"
          [persistKey]="seriesFilter() ? 'meetings-series' : ownerFilter() ? 'meetings-owner' : 'meetings'"
          [urlSync]="true"
        >
          <ng-template #listHeader let-h>
            @for (column of columns(); track column.key) {
              @if (h.visible(column.key)) {
                <span class="am-ml__head" role="columnheader">{{ column.label }}</span>
              }
            }
            <span></span>
          </ng-template>

          <ng-template #listRow let-m let-i="index" let-v="visible">
            <div
              amListRow
              [amListRowKey]="m.id"
              [amListRowIndex]="i"
              (rowOpen)="open(m)"
              (click)="open(m)"
              class="am-ml__row grid items-center gap-3 px-3 py-2 cursor-pointer"
              [attr.data-meeting-row]="m.id"
            >
              @if (v('meeting')) {
                <span class="flex min-w-0 flex-col">
                  <span class="text-value font-medium truncate" [class.line-through]="cancelled(m)" [title]="m.title">{{ m.title }}</span>
                  <span class="text-meta text-[var(--am-ink-500)] truncate">
                    <span aria-hidden="true">{{ glyph(m) }}</span>
                    <a [routerLink]="ownerLink(m)" (click)="$event.stopPropagation()" class="text-[var(--am-blue-primary)]">{{ owner(m) }}</a>
                  </span>
                </span>
              }
              @if (v('when')) {
                <span class="flex min-w-0 flex-col" data-meeting-when>
                  <!-- P233 — each cell names its column, so a phone card (no headers) still reads "When …". -->
                  <span class="sr-only">{{ columnLabel('when') }}</span>
                  <span class="text-value">{{ format.dateTime(m.scheduledAt) }}</span>
                  <span class="text-meta text-[var(--am-ink-500)] truncate">{{ format.hijri(m.scheduledAt) }} · {{ format.weekday(m.scheduledAt, 'short') }}</span>
                  <!-- P240 — the series view's note, from the meeting's stored reschedule only. -->
                  @if (m.movedFrom) {
                    <span class="text-meta text-[var(--am-ink-500)]" data-meeting-moved-from>{{ 'meeting.list.movedFrom' | translate: { date: format.date(m.movedFrom) } }}</span>
                  }
                </span>
              }
              @if (v('stage')) {
                <span class="sr-only" data-meeting-stage-name>{{ columnLabel('stage') }}</span>
                <span
                  class="justify-self-start text-[11.5px] font-medium px-2 py-px rounded-full border"
                  [class.text-[var(--am-ink-500)]]="closed(m)"
                  [class.border-[var(--am-border)]]="true"
                  data-meeting-stage
                  >{{ stage(m) }}</span
                >
              }
              <span class="am-ml__trail"></span>
            </div>
          </ng-template>
        </app-data-list>
      </div>
      }
    </div>
  `,
  styles: [
    `
      /*
       * PR 7d-2 — on a phone (artboard 14) each row is a card: the title and
       * owner, when with Hijri, then the stage chip, one under another. A
       * CONTAINER query on the page's own width, so a 390px layout spec can
       * measure it. The column headers name columns a card no longer has, so
       * the whole header row is hidden there (its padding and border with it,
       * P233), and each cell names its column for a screen reader instead.
       */
      .am-ml {
        container: meeting-list / inline-size;
      }
      .am-ml__row {
        grid-template-columns: var(--am-list-cols);
      }
      @container meeting-list (max-width: 559.98px) {
        .am-ml__row {
          grid-template-columns: minmax(0, 1fr);
          gap: var(--am-space-4);
        }
        .am-ml__head,
        .am-ml ::ng-deep .am-dl__head {
          display: none;
        }
        .am-ml__trail {
          display: none;
        }
      }
    `,
  ],
})
export class MeetingListComponent {
  private readonly meetings = inject(MeetingService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  readonly format = inject(FormatService);
  readonly pageSize = PAGE;

  /** Whether the server offers All meetings to this person (its `canSeeAll`, from every list answer). */
  readonly canSeeAll = signal(false);

  /**
   * ACC-316 PR 7 — one committee's or unit's meetings (?committeeId= or
   * ?orgUnitId=, from its panel's See all): its Upcoming and Past, under the
   * plain visibility rule, as the panel lists them. Named from the panel's
   * navigation state, else from the first row.
   */
  readonly ownerFilter = signal<{ committeeId?: string; orgUnitId?: string } | null>(null);
  readonly ownerName = signal<string | null>(null);
  readonly ownerLabel = computed(() => this.ownerName() ?? this.translate.instant('meeting.list.oneOwner'));
  /**
   * PR 8b — one series' meetings (?seriesId=, from a meeting's "Whole series"):
   * ONE list by date (view=series, P240), every meeting of it this person may
   * open, cancelled ones included, in one answer the server caps at a series'
   * most (its SERIES_LIST_CAP; no copy here: the page is the answer's own
   * length, and there is no pager). Shown in the server's order, never sorted
   * here. Its owner and pattern come from the link's navigation state, else
   * from the first row's meeting (one read, only then).
   */
  readonly seriesFilter = signal<string | null>(null);
  readonly series = signal<MeetingSeriesDto | null>(null);
  readonly seriesOwner = signal<string | null>(null);
  readonly seriesOwnerLabel = computed(() => this.seriesOwner() ?? this.translate.instant('meeting.list.oneSeries'));
  readonly seriesText = computed(() => {
    const s = this.series();
    return s ? seriesSummary(s, this.translate, this.format) : '';
  });

  /** A new list for each owner or series, so its views, paging and search start again. */
  readonly listKey = computed(() => JSON.stringify([this.ownerFilter(), this.seriesFilter()]));

  /** The views; "All meetings" only where the server says so, with no client copy of the rule. */
  readonly scopes = computed<DataListScope[]>(() => {
    this.translate.currentLang();
    if (this.seriesFilter()) return [];
    const views: MeetingListView[] = this.ownerFilter()
      ? ['upcoming', 'past']
      : ['mine', 'past', 'minutes', ...(this.canSeeAll() ? (['all'] as const) : []), 'subunits'];
    return views.map((key) => ({ key, label: this.translate.instant(`meeting.list.view.${key}`) }));
  });

  readonly columns = computed<DataListColumn[]>(() => {
    this.translate.currentLang();
    return [
      { key: 'meeting', label: this.translate.instant('meeting.list.col.meeting'), alwaysVisible: true, width: '2fr' },
      { key: 'when', label: this.translate.instant('meeting.list.col.when'), width: '1.2fr' },
      { key: 'stage', label: this.translate.instant('meeting.list.col.stage'), width: '1fr' },
    ];
  });

  /** A column's name, for the screen-reader text each cell carries (P233). */
  columnLabel(key: string): string {
    return this.columns().find((c) => c.key === key)?.label ?? '';
  }

  // An ARROW PROPERTY (data-list reads it as an input). The page and its size become skip and take.
  readonly source: DataListSource<MeetingListItemDto> = (query) => {
    const pageSize = query.pageSize ?? PAGE;
    const page = query.page ?? 1;
    const owner = this.ownerFilter();
    const seriesId = this.seriesFilter();
    if (seriesId) {
      // The whole series is one answer, never paged: the server's view=series.
      return this.meetings.list({ view: 'series', seriesId, q: query.search || undefined }).pipe(
        tap((r) => {
          if (r.items[0]) this.nameSeries(seriesId, r.items[0]);
        }),
        map((r) => ({ data: r.items, total: r.items.length, page: 1, pageSize: Math.max(r.items.length, 1) })),
      );
    }
    return this.meetings
      .list({
        view: (query.scope as MeetingListView | undefined) ?? (owner || seriesId ? 'upcoming' : 'mine'),
        q: query.search || undefined,
        ...(owner ?? {}),
        skip: (page - 1) * pageSize,
        take: Math.min(pageSize, 50),
      })
      .pipe(
        tap((r) => {
          this.canSeeAll.set(r.canSeeAll);
          if (owner && !this.ownerName() && r.items[0]) this.ownerName.set(ownerName(r.items[0].owner, this.language));
        }),
        map((r) => ({ data: r.items, total: r.total, page, pageSize })),
      );
  };

  readonly trackById = (m: MeetingListItemDto): string => m.id;

  constructor() {
    const route = inject(ActivatedRoute);
    route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const seriesId = params.get('seriesId');
      if (seriesId !== this.seriesFilter()) {
        this.seriesFilter.set(seriesId);
        this.seriesRead = false;
        const state = (this.router.getCurrentNavigation()?.extras.state ?? history.state) as { series?: MeetingSeriesDto; ownerName?: unknown } | null;
        const named = seriesId && state?.series?.id === seriesId;
        this.series.set(named ? state!.series! : null);
        this.seriesOwner.set(named && typeof state?.ownerName === 'string' ? state.ownerName : null);
      }
      const committeeId = params.get('committeeId');
      const orgUnitId = params.get('orgUnitId');
      const next = committeeId ? { committeeId } : orgUnitId ? { orgUnitId } : null;
      if (JSON.stringify(next) === JSON.stringify(this.ownerFilter())) return;
      this.ownerFilter.set(next);
      const state = (this.router.getCurrentNavigation()?.extras.state ?? history.state) as { ownerName?: unknown } | null;
      this.ownerName.set(next && typeof state?.ownerName === 'string' ? state.ownerName : null);
    });
  }

  /** The series' owner from a row, and its pattern from that row's meeting when the link carried none. */
  private nameSeries(seriesId: string, first: MeetingListItemDto): void {
    if (!this.seriesOwner()) this.seriesOwner.set(ownerName(first.owner, this.language));
    if (this.series() || this.seriesRead) return;
    this.seriesRead = true;
    this.meetings.get(first.id).subscribe({
      next: (m) => {
        if (m.series?.id === seriesId && this.seriesFilter() === seriesId) this.series.set(m.series);
      },
      // The line is the header's extra: without it the title still names the series' owner.
      error: () => undefined,
    });
  }
  private seriesRead = false;

  open(m: MeetingListItemDto): void {
    void this.router.navigate(['/meetings', m.id]);
  }

  glyph = (m: MeetingListItemDto) => ownerGlyph(m.owner);
  owner = (m: MeetingListItemDto) => ownerName(m.owner, this.language);
  ownerLink = (m: MeetingListItemDto) => ownerLink(m.owner);
  stage = (m: MeetingListItemDto) => stageName(m.stage, this.language);
  cancelled = (m: MeetingListItemDto) => isCancelled(m.stage);
  closed = (m: MeetingListItemDto) => isClosed(m.stage);
}
