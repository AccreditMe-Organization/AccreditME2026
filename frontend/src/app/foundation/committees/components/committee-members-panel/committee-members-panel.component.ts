import { Component, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AmDatePipe, FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ROUTE_PERMISSIONS } from '../../../../core/navigation/nav-items';
import { CappedPanelComponent, CAPPED_PANEL_ROWS } from '../../../../shared/components/capped-panel/capped-panel.component';
import { ListDialogComponent } from '../../../../shared/components/list-dialog/list-dialog.component';
import { RowMenuComponent, RowMenuItem } from '../../../../shared/components/row-menu/row-menu.component';
import { SimpleListComponent, SimpleListQuery } from '../../../../shared/components/simple-list/simple-list.component';
import { CommitteeMemberRowDto, CommitteeService } from '../../services/committee.service';

type PanelState = 'loading' | 'error' | 'ready';

/**
 * ACC-230 — a committee's MEMBERS, capped at five (Record Tasks Panel §3, the
 * "Compact List Panel"), with "See all" for the rest.
 *
 * Ordered by seat — the tenant's own committee_member_role order: Chair,
 * Secretary, Member, … — then the longest-serving first; that order is the
 * server's. The name links to the user record where the viewer may open it
 * (their own, or anyone's with what the users route requires), else it is
 * plain.
 *
 * Change role and Remove leave the row for a worded ⋯ menu (Q12) — the same
 * permissions as before (committees:change_member_role,
 * committees:remove_member), an item the viewer cannot use is absent, and a
 * row with neither has no ⋯. The page owns the dialogs; this panel asks.
 */
@Component({
  selector: 'app-committee-members-panel',
  standalone: true,
  imports: [RouterLink, TranslatePipe, AmDatePipe, CappedPanelComponent, ListDialogComponent, RowMenuComponent, SimpleListComponent],
  template: `
    <am-capped-panel
      [heading]="'committee.members' | translate"
      [state]="state()"
      [total]="total()"
      [shown]="rows().length"
      [loadingText]="'committee.membersLoading' | translate"
      [errorText]="'committee.membersError' | translate"
      [emptyText]="'committee.noMembers' | translate"
      testIdPrefix="committee-members"
      (retry)="load()"
      (seeAll)="popupOpen.set(true)"
    >
      @if (canAddMember()) {
        <button amPanelActions type="button" class="am-cmp__add" (click)="addRequested.emit()" data-testid="committee-members-add">
          <i class="pi pi-plus" aria-hidden="true"></i>{{ 'committee.addMember' | translate }}
        </button>
      }
      @for (m of rows(); track m.id) {
        <li class="am-cp-row" [attr.data-member-row]="m.id">
          <span class="flex items-center gap-2.5 min-w-0">
            <span class="am-cmp__avatar" aria-hidden="true">{{ initials(m.name) }}</span>
            <span class="flex flex-col min-w-0 flex-1">
              <span class="am-cp-l1">
                <span class="am-cp-cut">
                  @if (canOpenUser(m.userId)) {
                    <a class="am-cmp__name" [routerLink]="['/users', m.userId]">{{ m.name }}</a>
                  } @else {
                    <span class="am-cmp__name">{{ m.name }}</span>
                  }
                </span>
              </span>
              <span class="am-cp-l2"><span class="am-cp-cut">{{ seatAndSince(m) }}</span></span>
            </span>
            @if (menuFor(m); as groups) {
              <am-row-menu [groups]="groups" [label]="'committee.memberActionsFor' | translate: { name: m.name }" (picked)="pick(m, $event)" />
            }
          </span>
        </li>
      }
    </am-capped-panel>

    <ng-template #memberCells let-m let-phone="phone">
      <span class="flex items-center gap-2.5 min-w-0">
        <span class="am-cmp__avatar" aria-hidden="true">{{ initials(m.name) }}</span>
        @if (canOpenUser(m.userId)) {
          <a class="am-cmp__name am-cp-cut" [routerLink]="['/users', m.userId]">{{ m.name }}</a>
        } @else {
          <span class="am-cmp__name am-cp-cut">{{ m.name }}</span>
        }
      </span>
      <span class="am-cp-cut text-[var(--am-ink-700)]">{{ seat(m) }}</span>
      <span class="text-[var(--am-ink-700)] whitespace-nowrap">{{ phone ? ('committee.sinceDate' | translate: { date: (m.joinedAt | amDate) }) : (m.joinedAt | amDate) }}</span>
      <span class="flex justify-end">
        @if (menuFor(m); as groups) {
          <am-row-menu [groups]="groups" [label]="'committee.memberActionsFor' | translate: { name: m.name }" (picked)="pick(m, $event)" />
        }
      </span>
    </ng-template>
    <ng-template #popupBody>
      <am-simple-list
        [load]="loadPage"
        [columns]="columns()"
        grid="minmax(200px,1.6fr) minmax(120px,1fr) 120px 32px"
        [row]="memberCells"
        defaultSort="seat:asc"
        [searchLabel]="'committee.searchMembers' | translate"
        [searchPlaceholder]="'committee.searchMembersPlaceholder' | translate"
        [emptyText]="'committee.noMembers' | translate"
        [noMatchText]="'committee.noMatch' | translate: { q: popupList()?.q() ?? '' }"
        [countText]="countText"
      />
    </ng-template>
    <am-list-dialog
      size="compact"
      [visible]="popupOpen()"
      [heading]="'committee.membersPopupTitle' | translate: { committee: committeeName() }"
      [count]="format.number(total())"
      [closeLabel]="'committee.closeMembersPopup' | translate"
      [body]="popupBody"
      (closeRequested)="popupOpen.set(false)"
    />
  `,
  styles: [
    `
      :host{display:block;min-inline-size:0}
      .am-cmp__add{flex:none;display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:12.5px;font-weight:600;block-size:28px;padding:0 10px;color:var(--am-primary-700);background:var(--am-surface-raised);border:1px solid var(--am-control-border);border-radius:var(--am-radius-button);cursor:pointer}
      .am-cmp__add:focus-visible,.am-cmp__name:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
      .am-cmp__avatar{flex:none;inline-size:28px;block-size:28px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;background:var(--am-primary-50);color:var(--am-primary-700)}
      .am-cmp__name{font-weight:500;color:var(--am-ink-900);text-decoration:none}
      a.am-cmp__name:hover{color:var(--am-primary-700);text-decoration:underline}
    `,
  ],
})
export class CommitteeMembersPanelComponent {
  private readonly committees = inject(CommitteeService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly access = inject(NavigationAccessService);
  private readonly auth = inject(AuthService);
  protected readonly format = inject(FormatService);

  readonly committeeId = input.required<string>();
  readonly committeeName = input.required<string>();
  readonly canAddMember = input(false);
  readonly canChangeRole = input(false);
  readonly canRemove = input(false);
  readonly addRequested = output<void>();
  readonly changeRoleRequested = output<CommitteeMemberRowDto>();
  readonly removeRequested = output<CommitteeMemberRowDto>();

  readonly state = signal<PanelState>('loading');
  readonly rows = signal<CommitteeMemberRowDto[]>([]);
  readonly total = signal(0);
  readonly popupOpen = signal(false);
  protected readonly popupList = viewChild(SimpleListComponent);

  readonly columns = computed(() => {
    this.translate.currentLang();
    // ACC-234 — every column the server sorts by is a header you press.
    return [
      { label: this.translate.instant('committee.col.member'), sort: 'name' },
      { label: this.translate.instant('committee.col.seat'), sort: 'seat' },
      { label: this.translate.instant('committee.col.since'), sort: 'since' },
      { label: '', srLabel: this.translate.instant('committee.col.actions') },
    ];
  });

  /** The users route's own requirement, from the nav model — never a copy. */
  private readonly userRecordPermissions = ROUTE_PERMISSIONS.get('users') ?? [];

  readonly loadPage = (query: SimpleListQuery) =>
    this.committees.membersPage(this.committeeId(), { ...query, lang: this.language.isArabic() ? 'ar' : 'en' });

  readonly countText = (n: number, searching: boolean): string =>
    this.format.count(searching ? 'committee.membersMatch' : 'committee.members', n);

  constructor() {
    effect(() => {
      this.committeeId();
      untracked(() => this.load());
    });
  }

  load(): void {
    this.committees
      .membersPage(this.committeeId(), { sort: 'seat', dir: 'asc', take: CAPPED_PANEL_ROWS })
      .subscribe({
        next: (page) => {
          this.rows.set(page.items);
          this.total.set(page.total);
          this.state.set('ready');
        },
        error: () => this.state.set('error'),
      });
  }

  /** After a member changed: the five, and the open list. */
  reload(): void {
    this.load();
    this.popupList()?.reload();
  }

  canOpenUser(userId: string): boolean {
    if (this.auth.currentUser()?.id === userId) return true;
    return this.userRecordPermissions.every((p) => this.access.hasPermission(p));
  }

  menuFor(m: CommitteeMemberRowDto): RowMenuItem[][] | null {
    const items: RowMenuItem[] = [];
    if (this.canChangeRole()) items.push({ id: 'changeRole', label: this.translate.instant('committee.changeRole') });
    if (this.canRemove()) items.push({ id: 'remove', label: this.translate.instant('committee.removeMember'), danger: true });
    return items.length ? [items] : null;
  }

  pick(m: CommitteeMemberRowDto, id: string): void {
    if (id === 'changeRole') this.changeRoleRequested.emit(m);
    if (id === 'remove') this.removeRequested.emit(m);
  }

  seat(m: CommitteeMemberRowDto): string {
    return m.roleLabelEn ? this.language.bilingual(m.roleLabelEn, m.roleLabelAr) : '—';
  }

  seatAndSince(m: CommitteeMemberRowDto): string {
    this.translate.currentLang();
    return `${this.seat(m)} · ${this.translate.instant('committee.sinceDate', { date: this.format.date(m.joinedAt) })}`;
  }

  // Two letters: the first and last word, past an honorific ("Dr. Fahad Al-Anazi" → FA).
  initials(name: string): string {
    const words = name.replace(/^(Dr\.?|Prof\.?|Mr\.?|Ms\.?|Mrs\.?)\s+/i, '').trim().split(/\s+/);
    const first = words[0]?.[0] ?? '';
    const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
    return (first + last).toUpperCase();
  }
}
