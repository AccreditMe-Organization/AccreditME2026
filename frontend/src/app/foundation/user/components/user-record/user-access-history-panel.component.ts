import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, input, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { FormatService } from '../../../../core/formatting';
import { AuthService } from '../../../../core/services/auth.service';
import { LanguageService } from '../../../../core/services/language.service';
import {
  CappedPanelComponent,
  CappedPanelState,
  CAPPED_PANEL_ROWS,
} from '../../../../shared/components/capped-panel/capped-panel.component';
import { ListDialogComponent } from '../../../../shared/components/list-dialog/list-dialog.component';
import { IAccessHistoryRowDto, UserService } from '../../services/user.service';
import { AccessHistoryTextDeps, accessHistoryWhat, accessHistoryWhen } from './access-history-text';

/** See all reads this many rows at a time (the server allows 1–50). */
export const ACCESS_HISTORY_POPUP_PAGE = 50;

interface AccessRow {
  id: string;
  what: string;
  when: string;
}

/**
 * ACC-216 part 2 — the Access history panel of the user record page: what was
 * changed about this person, and by whom, newest first, from
 * GET /users/:id/access-history.
 *
 * The HOST decides whether it exists: the record page renders it only for the
 * person themself or a viewer holding users:view, the endpoint's own rule. A
 * refused read (403 or 404) still leaves it ABSENT, its host hidden, so the grid
 * reflows as if it were never there: never an empty panel.
 *
 * Its own request, on am-capped-panel: five rows, a skeleton while loading, its
 * own error with Retry, and "No changes recorded" when there are none. See all
 * opens the whole history in am-list-dialog (compact), read fifty at a time.
 *
 * The words come from the server's kind (access-history-text.ts); dates through
 * the formatting layer; names through LanguageService.bilingual().
 */
@Component({
  selector: 'app-user-access-history-panel',
  standalone: true,
  imports: [TranslatePipe, CappedPanelComponent, ListDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block min-w-0',
    '[style.display]': 'denied() ? "none" : null',
    'data-panel': 'accessHistory',
  },
  template: `
    @if (!denied()) {
      <am-capped-panel
        [heading]="'userRecord.accessHistory.heading' | translate"
        [state]="state()"
        [total]="total()"
        [shown]="rows().length"
        [loadingText]="'userRecord.accessHistory.loading' | translate"
        [errorText]="'userRecord.accessHistory.loadError' | translate"
        [emptyText]="'userRecord.accessHistory.empty' | translate"
        testIdPrefix="access-history"
        (retry)="load()"
        (seeAll)="openPopup()"
      >
        @for (row of rows(); track row.id) {
          <li class="am-cp-row" [attr.data-access-row]="row.id">
            <span class="am-cp-l1"><span class="am-cp-cut am-ahp__what" [attr.title]="row.what">{{ row.what }}</span></span>
            <span class="am-cp-l2"><span class="am-cp-cut" [attr.title]="row.when">{{ row.when }}</span></span>
          </li>
        }
      </am-capped-panel>
    }

    <ng-template #popupBody>
      <div class="am-ahp__popup" data-testid="access-history-popup">
        <ul class="am-ahp__list" role="list">
          @for (row of popupRows(); track row.id) {
            <li class="am-ahp__item" [attr.data-access-row]="row.id">
              <span class="am-ahp__what">{{ row.what }}</span>
              <span class="am-ahp__when">{{ row.when }}</span>
            </li>
          }
        </ul>
        @if (popupState() === 'error') {
          <p class="am-ahp__note" role="alert" data-testid="access-history-more-error">
            {{ 'record.loadMoreFailed' | translate }}
            <button type="button" class="am-ahp__btn" (click)="loadMore()">{{ 'list.retry' | translate }}</button>
          </p>
        } @else if (popupState() === 'loading') {
          <p class="am-ahp__note" role="status">{{ 'record.loadingMore' | translate }}</p>
        } @else if (popupRows().length < popupTotal()) {
          <p class="am-ahp__note">
            <button type="button" class="am-ahp__btn" (click)="loadMore()" data-testid="access-history-more">
              {{ 'record.loadMore' | translate }}
            </button>
          </p>
        }
        <p class="am-ahp__note" aria-live="polite">
          {{ 'record.footShowing' | translate: { shown: format.number(popupRows().length), total: format.number(popupTotal()) } }}
        </p>
      </div>
    </ng-template>
    <am-list-dialog
      size="compact"
      [visible]="popupOpen()"
      [heading]="'userRecord.accessHistory.popupTitle' | translate: { name: personName() }"
      [count]="format.number(popupTotal())"
      [closeLabel]="'userRecord.accessHistory.close' | translate"
      [body]="popupBody"
      (closeRequested)="popupOpen.set(false)"
    />
  `,
  styles: [
    `
      .am-ahp__what{color:var(--am-ink-900)}
      .am-ahp__popup{display:flex;flex-direction:column;min-block-size:0;block-size:100%;overflow-y:auto}
      .am-ahp__list{list-style:none;margin:0;padding:0}
      .am-ahp__item{display:flex;flex-direction:column;gap:var(--am-space-2);padding:var(--am-space-8) var(--am-space-16);border-block-end:1px solid var(--am-border);font-size:var(--am-type-value-size);overflow-wrap:anywhere}
      .am-ahp__when{font-size:var(--am-type-meta-size);color:var(--am-ink-500)}
      .am-ahp__note{margin:0;padding:var(--am-space-8) var(--am-space-16);font-size:var(--am-type-meta-size);color:var(--am-ink-700)}
      .am-ahp__btn{font:inherit;padding:0;border:0;background:none;color:var(--am-primary-700);font-weight:600;cursor:pointer}
      .am-ahp__btn:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
    `,
  ],
})
export class UserAccessHistoryPanelComponent implements OnInit, OnDestroy {
  readonly userId = input.required<string>();
  /** The person's name, for the See all title. */
  readonly personName = input('');

  private readonly userService = inject(UserService);
  private readonly auth = inject(AuthService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  protected readonly format = inject(FormatService);

  readonly state = signal<CappedPanelState>('loading');
  /** A refused read: the panel is absent, not empty. */
  readonly denied = signal(false);
  readonly total = signal(0);
  private readonly entries = signal<IAccessHistoryRowDto[]>([]);

  readonly popupOpen = signal(false);
  readonly popupEntries = signal<IAccessHistoryRowDto[]>([]);
  readonly popupTotal = signal(0);
  readonly popupState = signal<'idle' | 'loading' | 'error'>('idle');

  private firstRead: Subscription | null = null;
  private moreRead: Subscription | null = null;

  private readonly deps = computed<AccessHistoryTextDeps>(() => {
    this.translate.currentLang();
    return {
      t: (key, params) => this.translate.instant(key, params),
      bilingual: (en, ar) => this.language.bilingual(en, ar),
      dateTime: (value) => this.format.dateTime(value),
      count: (key, n) => this.format.count(key, n),
      viewerId: this.auth.currentUser()?.id ?? null,
    };
  });

  private toRow(entry: IAccessHistoryRowDto): AccessRow {
    const deps = this.deps();
    return { id: entry.id, what: accessHistoryWhat(entry, deps), when: accessHistoryWhen(entry, deps) };
  }

  readonly rows = computed(() => this.entries().slice(0, CAPPED_PANEL_ROWS).map((e) => this.toRow(e)));
  readonly popupRows = computed(() => this.popupEntries().map((e) => this.toRow(e)));

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.firstRead?.unsubscribe();
    this.moreRead?.unsubscribe();
  }

  /** The first five, and Retry. */
  load(): void {
    this.firstRead?.unsubscribe();
    this.state.set('loading');
    this.firstRead = this.userService.getAccessHistory(this.userId(), { skip: 0, take: CAPPED_PANEL_ROWS }).subscribe({
      next: (page) => {
        this.entries.set(page.rows);
        this.total.set(page.total);
        this.state.set('ready');
      },
      error: (err: unknown) => {
        if (err instanceof HttpErrorResponse && (err.status === 403 || err.status === 404)) this.denied.set(true);
        else this.state.set('error');
      },
    });
  }

  openPopup(): void {
    this.moreRead?.unsubscribe();
    this.popupEntries.set([]);
    this.popupTotal.set(this.total());
    this.popupOpen.set(true);
    this.loadMore();
  }

  loadMore(): void {
    this.moreRead?.unsubscribe();
    this.popupState.set('loading');
    this.moreRead = this.userService
      .getAccessHistory(this.userId(), { skip: this.popupEntries().length, take: ACCESS_HISTORY_POPUP_PAGE })
      .subscribe({
        next: (page) => {
          this.popupEntries.set([...this.popupEntries(), ...page.rows]);
          this.popupTotal.set(page.total);
          this.popupState.set('idle');
        },
        error: () => this.popupState.set('error'),
      });
  }
}
