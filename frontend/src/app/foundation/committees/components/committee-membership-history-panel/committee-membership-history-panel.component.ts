import { Component, computed, inject, input, signal, viewChild } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { CappedPanelComponent, CAPPED_PANEL_ROWS } from '../../../../shared/components/capped-panel/capped-panel.component';
import { ListDialogComponent } from '../../../../shared/components/list-dialog/list-dialog.component';
import { SimpleListComponent, SimpleListPage, SimpleListQuery } from '../../../../shared/components/simple-list/simple-list.component';
import { LookupValueDto } from '../../../lookup/services/lookup.service';
import { IUserDto } from '../../../user/services/user.service';
import { CommitteeMembershipEventDto } from '../../services/committee.service';

/**
 * A committee's MEMBERSHIP HISTORY, capped at five like Members (the drawing's
 * Compact List Panel), newest first, with "See all" for the rest.
 *
 * It replaced the page's older record panel, which neither filled its grid cell
 * nor matched the other panels' heading. A row names the person and when the
 * change took effect, then what happened, in which seat, and who authorised it
 * — the compliance trail. Everything comes from what the page already loaded
 * (the events, the people and the seats): this panel reads nothing.
 *
 * See all is `am-list-dialog` compact with `am-simple-list`, searched, sorted
 * and paged IN MEMORY: a committee's history is small and already here in full
 * (ACC-230's rule for small lists), so there is no second read.
 */
@Component({
  selector: 'app-committee-membership-history-panel',
  standalone: true,
  imports: [TranslatePipe, CappedPanelComponent, ListDialogComponent, SimpleListComponent],
  template: `
    <am-capped-panel
      [heading]="'committee.membershipHistory' | translate"
      state="ready"
      [total]="events().length"
      [shown]="rows().length"
      [emptyText]="'committee.noMembershipHistory' | translate"
      testIdPrefix="committee-history"
      (seeAll)="popupOpen.set(true)"
    >
      @for (e of rows(); track e.id) {
        <li class="am-cp-row" [attr.data-history-row]="e.id">
          <span class="am-cp-l1">
            <span class="am-cmh__dot" [style.background]="color(e.action)" aria-hidden="true"></span>
            <span class="am-cmh__name am-cp-cut">{{ name(e) }}</span>
            <span class="am-cmh__date" dir="ltr">{{ format.date(e.effectiveDate) }}</span>
          </span>
          <span class="am-cp-l2"><span class="am-cp-cut" [title]="detail(e)">{{ detail(e) }}</span></span>
        </li>
      }
    </am-capped-panel>

    <ng-template #historyCells let-e>
      <span class="flex items-center gap-2 min-w-0">
        <span class="am-cmh__dot" [style.background]="color(e.action)" aria-hidden="true"></span>
        <span class="am-cmh__name am-cp-cut">{{ name(e) }}</span>
      </span>
      <span class="am-cp-cut text-[var(--am-ink-700)]" [title]="detail(e)">{{ detail(e) }}</span>
      <span class="text-[var(--am-ink-700)] whitespace-nowrap" dir="ltr">{{ format.date(e.effectiveDate) }}</span>
    </ng-template>
    <ng-template #popupBody>
      <am-simple-list
        [load]="loadPage"
        [columns]="columns()"
        grid="minmax(180px,1.2fr) minmax(200px,1.6fr) 120px"
        [row]="historyCells"
        defaultSort="date:desc"
        [searchLabel]="'committee.historyPopup.search' | translate"
        [searchPlaceholder]="'committee.historyPopup.searchPlaceholder' | translate"
        [emptyText]="'committee.noMembershipHistory' | translate"
        [noMatchText]="'committee.noMatch' | translate: { q: popupList()?.q() ?? '' }"
        [countText]="countText"
      />
    </ng-template>
    <am-list-dialog
      size="compact"
      [visible]="popupOpen()"
      [heading]="'committee.historyPopup.title' | translate: { committee: committeeName() }"
      [count]="format.number(events().length)"
      [closeLabel]="'committee.historyPopup.close' | translate"
      [body]="popupBody"
      (closeRequested)="popupOpen.set(false)"
    />
  `,
  styles: [
    `
      :host{display:block;min-inline-size:0}
      .am-cmh__dot{flex:none;inline-size:7px;block-size:7px;border-radius:999px}
      .am-cmh__name{font-weight:500;color:var(--am-ink-900)}
      .am-cmh__date{flex:none;margin-inline-start:auto;padding-inline-start:var(--am-space-8);font-size:12px;color:var(--am-ink-700);white-space:nowrap;unicode-bidi:isolate}
    `,
  ],
})
export class CommitteeMembershipHistoryPanelComponent {
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  protected readonly format = inject(FormatService);

  /** Newest first, as the server sends them. */
  readonly events = input.required<CommitteeMembershipEventDto[]>();
  readonly users = input<IUserDto[]>([]);
  readonly memberRoles = input<LookupValueDto[]>([]);
  readonly committeeName = input.required<string>();

  readonly popupOpen = signal(false);
  protected readonly popupList = viewChild(SimpleListComponent);

  readonly rows = computed(() => this.events().slice(0, CAPPED_PANEL_ROWS));

  readonly columns = computed(() => {
    this.translate.currentLang();
    return [
      { label: this.translate.instant('committee.historyPopup.col.person'), sort: 'person' },
      { label: this.translate.instant('committee.historyPopup.col.change') },
      { label: this.translate.instant('committee.historyPopup.col.date'), sort: 'date' },
    ];
  });

  readonly countText = (n: number, searching: boolean): string =>
    this.format.count(searching ? 'committee.historyMatch' : 'committee.historyCount', n);

  /** In memory: the whole history is already on the page. */
  readonly loadPage = (query: SimpleListQuery) => {
    const all = this.events();
    const q = (query.q ?? '').trim().toLocaleLowerCase();
    const matching = q ? all.filter((e) => `${this.name(e)} ${this.detail(e)}`.toLocaleLowerCase().includes(q)) : all;
    const dir = query.dir === 'asc' ? 1 : -1;
    const sorted = [...matching].sort((a, b) =>
      query.sort === 'person'
        ? dir * this.name(a).localeCompare(this.name(b)) || b.effectiveDate.localeCompare(a.effectiveDate)
        : dir * a.effectiveDate.localeCompare(b.effectiveDate) || a.id.localeCompare(b.id),
    );
    const page: SimpleListPage<CommitteeMembershipEventDto> = {
      items: sorted.slice(query.skip, query.skip + query.take),
      total: all.length,
      matching: matching.length,
    };
    return of(page);
  };

  // ACC-281 — the read names its own people and seats, so a member without
  // users:view or lookups:view reads them; the lists are only a fallback.
  name(e: CommitteeMembershipEventDto): string {
    return e.userName ?? this.users().find((u) => u.id === e.userId)?.name ?? '—';
  }

  /** "Joined — Member · by {approver}": what happened, in which seat, and who authorised it. */
  detail(e: CommitteeMembershipEventDto): string {
    this.translate.currentLang();
    const action = this.translate.instant(`committee.action.${e.action.toLowerCase()}`) as string;
    const seat = e.roleLabelEn
      ? { labelEn: e.roleLabelEn, labelAr: e.roleLabelAr ?? null }
      : this.memberRoles().find((v) => v.id === e.roleValueId);
    const seatName = seat ? this.language.bilingual(seat.labelEn, seat.labelAr) : '—';
    const approver = e.approvedBy ? (e.approvedByName ?? this.users().find((u) => u.id === e.approvedBy)?.name) : undefined;
    const parts = [`${action} — ${seatName}`];
    if (approver) parts.push(this.translate.instant('committee.approvedBy', { name: approver }) as string);
    return parts.join(' · ');
  }

  // JOINED reads as gain, LEFT as loss, ROLE_CHANGED as neither — semantic
  // status tokens, never brand colours (CLAUDE.md, Brand Design Tokens).
  color(action: string): string {
    if (action === 'JOINED') return 'var(--am-status-approved)';
    if (action === 'LEFT') return 'var(--am-status-rejected)';
    return 'var(--am-blue-primary)';
  }
}
