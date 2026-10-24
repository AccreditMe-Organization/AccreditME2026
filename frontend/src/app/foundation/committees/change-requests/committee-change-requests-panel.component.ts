import { Component, TemplateRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { FormatService } from '../../../core/formatting';
import { CappedPanelComponent, CAPPED_PANEL_ROWS } from '../../../shared/components/capped-panel/capped-panel.component';
import { ListDialogComponent } from '../../../shared/components/list-dialog/list-dialog.component';
import { SimpleListComponent, SimpleListQuery } from '../../../shared/components/simple-list/simple-list.component';
import { ChangeRequestText, changedFields } from './change-request-text';
import { ChangeRequestDto, ChangeRequestService } from './change-request.service';

type PanelState = 'loading' | 'error' | 'ready';

/**
 * ACC-240 — a committee's CHANGE REQUESTS, capped at five, newest first, last
 * in the committee page's panel grid (plan §3.1). The server sorts by number,
 * which is the same thing as newest.
 *
 * A row names the request and what it changes, its status at the end, and who
 * and when by status. It links to the request page. No row ⋯ and no action
 * column (step 238, Q17). See all is `am-list-dialog` compact with
 * `am-simple-list`: Request, Status and Requested sort by header, and it opens
 * on Requested ▼.
 */
@Component({
  selector: 'am-committee-change-requests-panel',
  standalone: true,
  imports: [RouterLink, TranslatePipe, CappedPanelComponent, ListDialogComponent, SimpleListComponent],
  template: `
    <am-capped-panel
      [heading]="'committee.changeRequest.panel.title' | translate"
      [state]="state()"
      [total]="total()"
      [shown]="rows().length"
      [loadingText]="'committee.changeRequest.panel.loading' | translate"
      [errorText]="'committee.changeRequest.panel.error' | translate"
      [emptyText]="'committee.changeRequest.panel.empty' | translate"
      testIdPrefix="committee-crs"
      (retry)="load()"
      (seeAll)="popupOpen.set(true)"
    >
      @for (r of rows(); track r.id) {
        <li class="am-cp-row" [attr.data-cr-row]="r.id">
          <span class="am-cp-l1">
            <a class="am-ccr__name am-cp-cut" [routerLink]="link(r)" [title]="rowTitle(r)">{{ rowTitle(r) }}</a>
            <span class="am-ccr__status" [attr.data-status]="r.status">{{ text.status(r.status) }}</span>
          </span>
          <span class="am-cp-l2"><span class="am-cp-cut">{{ meta(r) }}</span></span>
        </li>
      }
    </am-capped-panel>

    <ng-template #crCells let-r let-phone="phone">
      <a class="am-ccr__name am-cp-cut" [routerLink]="link(r)">{{ 'committee.changeRequest.page.eyebrow' | translate: { n: format.number(r.number) } }}</a>
      <span class="am-cp-cut text-[var(--am-ink-700)]" [title]="fields(r)">{{ fields(r) }}</span>
      <span class="am-cp-cut text-[var(--am-ink-700)]">{{ text.status(r.status) }}</span>
      <span class="am-cp-cut text-[var(--am-ink-700)]" [title]="r.requestedBy.name">{{ r.requestedBy.name }}</span>
      <span class="text-[var(--am-ink-700)] whitespace-nowrap">{{ format.date(r.createdAt) }}</span>
    </ng-template>
    <ng-template #popupBody>
      <am-simple-list
        [load]="loadPage"
        [columns]="columns()"
        grid="140px minmax(160px,1.6fr) minmax(110px,1fr) minmax(120px,1fr) 110px"
        [row]="crCells"
        defaultSort="requested:desc"
        [searchLabel]="'committee.changeRequest.popup.search' | translate"
        [searchPlaceholder]="'committee.changeRequest.popup.searchPlaceholder' | translate"
        [emptyText]="'committee.changeRequest.panel.empty' | translate"
        [noMatchText]="'committee.changeRequest.popup.noMatch' | translate: { q: popupList()?.q() ?? '' }"
        [countText]="countText"
      />
    </ng-template>
    <am-list-dialog
      size="compact"
      [visible]="popupOpen()"
      [heading]="'committee.changeRequest.popup.title' | translate: { committee: committeeName() }"
      [count]="format.number(total())"
      [closeLabel]="'committee.changeRequest.popup.close' | translate"
      [body]="popupBody"
      (closeRequested)="popupOpen.set(false)"
    />
  `,
  styles: [
    `
      :host{display:block;min-inline-size:0}
      .am-ccr__name{font-weight:500;color:var(--am-primary-700);text-decoration:none;min-inline-size:0}
      .am-ccr__name:hover{text-decoration:underline}
      .am-ccr__name:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
      .am-ccr__status{flex:none;margin-inline-start:auto;padding-inline-start:var(--am-space-8);font-size:12px;color:var(--am-ink-700);white-space:nowrap}
    `,
  ],
})
export class CommitteeChangeRequestsPanelComponent {
  private readonly service = inject(ChangeRequestService);
  private readonly translate = inject(TranslateService);
  protected readonly text = inject(ChangeRequestText);
  protected readonly format = inject(FormatService);

  readonly committeeId = input.required<string>();
  readonly committeeName = input.required<string>();
  /** Bumped by the page after anything that may have changed the list. */
  readonly reloadKey = input(0);

  readonly state = signal<PanelState>('loading');
  readonly rows = signal<ChangeRequestDto[]>([]);
  readonly total = signal(0);
  readonly popupOpen = signal(false);
  protected readonly popupList = viewChild(SimpleListComponent);
  /** The See all body, read by the layout spec to measure it at 720 × 560 outside a dialog the test frame would shrink. */
  readonly popupBody = viewChild.required<TemplateRef<unknown>>('popupBody');

  readonly columns = computed(() => {
    this.translate.currentLang();
    // ACC-234 — every column the server sorts by is a header you press.
    return [
      { label: this.translate.instant('committee.changeRequest.popup.col.request'), sort: 'number' },
      { label: this.translate.instant('committee.changeRequest.popup.col.fields') },
      { label: this.translate.instant('committee.changeRequest.popup.col.status'), sort: 'status' },
      { label: this.translate.instant('committee.changeRequest.popup.col.requestedBy') },
      { label: this.translate.instant('committee.changeRequest.popup.col.requested'), sort: 'requested' },
    ];
  });

  readonly loadPage = (query: SimpleListQuery) => this.service.list(this.committeeId(), query);

  readonly countText = (n: number, searching: boolean): string =>
    this.format.count(searching ? 'committee.changeRequestsMatch' : 'committee.changeRequestsCount', n);

  constructor() {
    effect(() => {
      this.committeeId();
      this.reloadKey();
      untracked(() => this.load());
    });
  }

  load(): void {
    this.service.list(this.committeeId(), { sort: 'number', dir: 'desc', take: CAPPED_PANEL_ROWS }).subscribe({
      next: (page) => {
        this.rows.set(page.items);
        this.total.set(page.total);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }

  link(r: ChangeRequestDto): string[] {
    return ['/committees', r.committeeId, 'change-requests', r.id];
  }

  fields(r: ChangeRequestDto): string {
    this.translate.currentLang();
    return this.text.fieldList(changedFields(r.changes));
  }

  rowTitle(r: ChangeRequestDto): string {
    this.translate.currentLang();
    return this.translate.instant('committee.changeRequest.panel.rowTitle', { n: this.format.number(r.number), fields: this.fields(r) });
  }

  /** Who and when, by status (plan §9.3). */
  meta(r: ChangeRequestDto): string {
    this.translate.currentLang();
    const t = (key: string, params: Record<string, string>) => this.translate.instant(`committee.changeRequest.panel.${key}`, params);
    const name = r.requestedBy.name;
    switch (r.status) {
      case 'draft':
        return t('metaStarted', { name, date: this.format.date(r.createdAt) });
      case 'under_review':
        return t('metaSubmitted', { name, date: this.format.date(r.submittedAt) });
      case 'approved':
      case 'rejected':
        return r.submittedAt && r.decidedAt
          ? t('metaDecided', { name, from: this.format.date(r.submittedAt), to: this.format.date(r.decidedAt) })
          : t('metaOn', { name, date: this.format.date(r.decidedAt ?? r.createdAt) });
      case 'returned':
        return t('metaOn', { name, date: this.format.date(r.decidedAt ?? r.createdAt) });
      case 'withdrawn':
        return t('metaOn', { name, date: this.format.date(r.withdrawnAt ?? r.createdAt) });
      default:
        return t('metaOn', { name, date: this.format.date(r.createdAt) });
    }
  }
}
