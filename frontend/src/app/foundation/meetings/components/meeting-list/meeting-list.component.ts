import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { map } from 'rxjs';
import { DataListComponent, DataListColumn, DataListScope } from '../../../../shared/components/data-list/data-list.component';
import { ListRowDirective } from '../../../../shared/components/data-list/list-row.directive';
import { DataListSource } from '../../../../shared/components/data-list/data-list.source';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { LanguageService } from '../../../../core/services/language.service';
import { FormatService } from '../../../../core/formatting';
import { MeetingService, type MeetingListItemDto, type MeetingListView } from '../../services/meeting.service';
import { isCancelled, isClosed, ownerGlyph, ownerLink, ownerName, stageName } from '../../meeting-display';

const PAGE = 25;

/**
 * ACC-316 PR 6 — /meetings: the saved views (Mine, Past, Minutes I record, All
 * meetings, Sub-units' meetings), searched by title, paged on the server. Which
 * meetings a person sees in each is the server's (the parent rule, plan §4.1);
 * "All meetings" is offered only with meetings:view, which the server also
 * requires. Ordered by time, as the server orders each view: the headers are
 * plain text because the list takes no sort (a column the server cannot sort
 * by stays plain, ACC-234). Nothing polls.
 */
@Component({
  selector: 'app-meeting-list',
  standalone: true,
  imports: [TranslatePipe, RouterLink, DataListComponent, ListRowDirective, PageHeaderComponent],
  template: `
    <div class="flex flex-col gap-3 h-full min-h-0">
      <app-page-header [title]="'meeting.title' | translate" />
      <p class="m-0 text-meta text-[var(--am-ink-500)]" data-testid="meeting-list-order">{{ 'meeting.list.order' | translate }}</p>
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
          persistKey="meetings"
          [urlSync]="true"
        >
          <ng-template #listHeader let-h>
            @for (column of columns(); track column.key) {
              @if (h.visible(column.key)) {
                <span role="columnheader">{{ column.label }}</span>
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
              class="grid items-center gap-3 px-3 py-2 cursor-pointer"
              style="grid-template-columns: var(--am-list-cols)"
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
    </div>
  `,
})
export class MeetingListComponent {
  private readonly meetings = inject(MeetingService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly access = inject(NavigationAccessService);
  private readonly language = inject(LanguageService);
  readonly format = inject(FormatService);
  readonly pageSize = PAGE;

  /** The views; "All meetings" only with meetings:view (the server refuses it otherwise). */
  readonly scopes = computed<DataListScope[]>(() => {
    this.translate.currentLang();
    const views: MeetingListView[] = ['mine', 'past', 'minutes', ...(this.access.hasPermission('meetings:view') ? (['all'] as const) : []), 'subunits'];
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
    return this.meetings
      .list({ view: (query.scope as MeetingListView | undefined) ?? 'mine', q: query.search || undefined, skip: (page - 1) * pageSize, take: Math.min(pageSize, 50) })
      .pipe(map((r) => ({ data: r.items, total: r.total, page, pageSize })));
  };

  readonly trackById = (m: MeetingListItemDto): string => m.id;

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
