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
import { MeetingService, type MeetingListItemDto, type MeetingListView } from '../../services/meeting.service';
import { isCancelled, isClosed, ownerGlyph, ownerLink, ownerName, stageName } from '../../meeting-display';

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
      <p class="m-0 text-meta text-[var(--am-ink-500)]" data-testid="meeting-list-order">{{ 'meeting.list.order' | translate }}</p>
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
          [searchPlaceholder]="'meeting.list.search' | translate"
          [emptyTitle]="'meeting.list.emptyTitle' | translate"
          [emptyMessage]="'meeting.list.emptyBody' | translate"
          [noResultsTitle]="'meeting.list.noMatchTitle' | translate"
          [noResultsMessage]="'meeting.list.noMatchBody' | translate"
          [hasDestination]="true"
          gridSuffix="0px"
          [persistKey]="ownerFilter() ? 'meetings-owner' : 'meetings'"
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
                  <span class="text-[13px] font-medium truncate" [class.line-through]="cancelled(m)" [title]="m.title">{{ m.title }}</span>
                  <span class="text-meta text-[var(--am-ink-500)] truncate">
                    <span aria-hidden="true">{{ glyph(m) }}</span>
                    <a [routerLink]="ownerLink(m)" (click)="$event.stopPropagation()" class="text-[var(--am-blue-primary)]">{{ owner(m) }}</a>
                  </span>
                </span>
              }
              @if (v('when')) {
                <span class="flex min-w-0 flex-col">
                  <span class="text-[13px]">{{ format.dateTime(m.scheduledAt) }}</span>
                  <span class="text-meta text-[var(--am-ink-500)] truncate">{{ format.hijri(m.scheduledAt) }} · {{ format.weekday(m.scheduledAt, 'short') }}</span>
                </span>
              }
              @if (v('stage')) {
                <span
                  class="justify-self-start text-[11.5px] font-medium px-2 py-px rounded-full border"
                  [class.text-[var(--am-ink-500)]]="closed(m)"
                  [class.border-[var(--am-border)]]="true"
                  data-meeting-stage
                  >{{ stage(m) }}</span
                >
              }
              <span></span>
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
       * they are hidden there.
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
        .am-ml__head {
          display: none;
        }
        .am-ml__row > span:empty {
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
  /** A new list for each owner, so its views, paging and search start again. */
  readonly listKey = computed(() => JSON.stringify(this.ownerFilter()));

  /** The views; "All meetings" only where the server says so, with no client copy of the rule. */
  readonly scopes = computed<DataListScope[]>(() => {
    this.translate.currentLang();
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

  // An ARROW PROPERTY (data-list reads it as an input). The page and its size become skip and take.
  readonly source: DataListSource<MeetingListItemDto> = (query) => {
    const pageSize = query.pageSize ?? PAGE;
    const page = query.page ?? 1;
    const owner = this.ownerFilter();
    return this.meetings
      .list({
        view: (query.scope as MeetingListView | undefined) ?? (owner ? 'upcoming' : 'mine'),
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
      const committeeId = params.get('committeeId');
      const orgUnitId = params.get('orgUnitId');
      const next = committeeId ? { committeeId } : orgUnitId ? { orgUnitId } : null;
      if (JSON.stringify(next) === JSON.stringify(this.ownerFilter())) return;
      this.ownerFilter.set(next);
      const state = (this.router.getCurrentNavigation()?.extras.state ?? history.state) as { ownerName?: unknown } | null;
      this.ownerName.set(next && typeof state?.ownerName === 'string' ? state.ownerName : null);
    });
  }

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
