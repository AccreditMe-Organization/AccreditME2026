import { Component, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { CappedPanelComponent, CAPPED_PANEL_ROWS } from '../../../../shared/components/capped-panel/capped-panel.component';
import { ListDialogComponent } from '../../../../shared/components/list-dialog/list-dialog.component';
import { SimpleListComponent, SimpleListQuery } from '../../../../shared/components/simple-list/simple-list.component';
import { CommitteeService, SubCommitteeRowDto } from '../../services/committee.service';

type PanelState = 'loading' | 'error' | 'ready';

/**
 * ACC-230 — a committee's SUB-COMMITTEES, capped at five, with "See all".
 *
 * Each row names the child (linked) and says what it is: its live workflow
 * stage and how many members it has — the server's, from the same read the
 * committees list uses. Ordered by name. No header action, as before.
 *
 * Replaces the page's own filter of the whole committees list: the panel
 * reads only this committee's children.
 */
@Component({
  selector: 'app-committee-sub-committees-panel',
  standalone: true,
  imports: [RouterLink, TranslatePipe, CappedPanelComponent, ListDialogComponent, SimpleListComponent],
  template: `
    <am-capped-panel
      [heading]="'committee.subCommittees' | translate"
      [state]="state()"
      [total]="total()"
      [shown]="rows().length"
      [loadingText]="'committee.subCommitteesLoading' | translate"
      [errorText]="'committee.subCommitteesError' | translate"
      [emptyText]="'committee.noSubCommittees' | translate"
      testIdPrefix="committee-subs"
      (retry)="load()"
      (seeAll)="popupOpen.set(true)"
    >
      @for (s of rows(); track s.id) {
        <li class="am-cp-row" [attr.data-sub-row]="s.id">
          <span class="am-cp-l1">
            <a class="am-csp__name am-cp-cut" [routerLink]="['/committees', s.id]">{{ name(s) }}</a>
          </span>
          <span class="am-cp-l2"><span class="am-cp-cut">{{ meta(s) }}</span></span>
        </li>
      }
    </am-capped-panel>

    <ng-template #subCells let-s>
      <a class="am-csp__name am-cp-cut" [routerLink]="['/committees', s.id]">{{ name(s) }}</a>
      <span class="am-cp-cut text-[var(--am-ink-700)]">{{ stage(s) || '—' }}</span>
      <span class="text-[var(--am-ink-700)] whitespace-nowrap">{{ format.count('committee.members', s.memberCount) }}</span>
    </ng-template>
    <ng-template #popupBody>
      <am-simple-list
        [load]="loadPage"
        [columns]="columns()"
        grid="minmax(220px,1.8fr) minmax(120px,1fr) 120px"
        [row]="subCells"
        defaultSort="name:asc"
        [searchLabel]="'committee.searchSubCommittees' | translate"
        [searchPlaceholder]="'committee.searchSubCommitteesPlaceholder' | translate"
        [emptyText]="'committee.noSubCommittees' | translate"
        [noMatchText]="'committee.noMatch' | translate: { q: popupList()?.q() ?? '' }"
        [countText]="countText"
      />
    </ng-template>
    <am-list-dialog
      size="compact"
      [visible]="popupOpen()"
      [heading]="'committee.subCommitteesPopupTitle' | translate: { committee: committeeName() }"
      [count]="format.number(total())"
      [closeLabel]="'committee.closeSubCommitteesPopup' | translate"
      [body]="popupBody"
      (closeRequested)="popupOpen.set(false)"
    />
  `,
  styles: [
    `
      :host{display:block;min-inline-size:0}
      .am-csp__name{font-weight:500;color:var(--am-primary-700);text-decoration:none}
      .am-csp__name:hover{text-decoration:underline}
      .am-csp__name:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
    `,
  ],
})
export class CommitteeSubCommitteesPanelComponent {
  private readonly committees = inject(CommitteeService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  protected readonly format = inject(FormatService);

  readonly committeeId = input.required<string>();
  readonly committeeName = input.required<string>();

  readonly state = signal<PanelState>('loading');
  readonly rows = signal<SubCommitteeRowDto[]>([]);
  readonly total = signal(0);
  readonly popupOpen = signal(false);
  protected readonly popupList = viewChild(SimpleListComponent);

  readonly columns = computed(() => {
    this.translate.currentLang();
    // ACC-234 — every column the server sorts by is a header you press.
    return [
      { label: this.translate.instant('committee.col.name'), sort: 'name' },
      { label: this.translate.instant('committee.col.status'), sort: 'status' },
      { label: this.translate.instant('committee.col.members'), sort: 'members' },
    ];
  });

  readonly loadPage = (query: SimpleListQuery) =>
    this.committees.subCommittees(this.committeeId(), { ...query, lang: this.language.isArabic() ? 'ar' : 'en' });

  readonly countText = (n: number, searching: boolean): string =>
    this.format.count(searching ? 'committee.subCommitteesMatch' : 'committee.subCommitteesCount', n);

  constructor() {
    effect(() => {
      this.committeeId();
      untracked(() => this.load());
    });
  }

  load(): void {
    const lang = this.language.isArabic() ? 'ar' : 'en';
    this.committees.subCommittees(this.committeeId(), { sort: 'name', dir: 'asc', take: CAPPED_PANEL_ROWS, lang }).subscribe({
      next: (page) => {
        this.rows.set(page.items);
        this.total.set(page.total);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }

  name(s: SubCommitteeRowDto): string {
    return this.language.bilingual(s.nameEn, s.nameAr);
  }

  stage(s: SubCommitteeRowDto): string {
    return s.stageNameEn ? this.language.bilingual(s.stageNameEn, s.stageNameAr) : '';
  }

  /** "Active · 6 members" — the stage only when there is one. */
  meta(s: SubCommitteeRowDto): string {
    this.translate.currentLang();
    const members = this.format.count('committee.members', s.memberCount);
    const stage = this.stage(s);
    return stage ? `${stage} · ${members}` : members;
  }
}
