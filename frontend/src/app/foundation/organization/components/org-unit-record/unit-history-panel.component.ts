import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { CappedPanelComponent, CappedPanelState, CAPPED_PANEL_ROWS } from '../../../../shared/components/capped-panel/capped-panel.component';
import { ListDialogComponent } from '../../../../shared/components/list-dialog/list-dialog.component';
import { OrgUnitHistoryEntryDto, OrgUnitHistoryPageDto, OrgUnitService } from '../../services/org-unit.service';
import { HistoryTextDeps, historyWhat, historyWhen } from './unit-history-text';

/** The popup reads this many rows at a time. */
export const HISTORY_POPUP_PAGE = 20;

interface HistoryRow {
  id: string;
  what: string;
  when: string;
}

/**
 * ACC-120 slice 11, PR D — the unit's History panel (D8): its stored AuditLog
 * and OrgUnitHeadEvent rows, newest first, from `GET …/:id/history`.
 *
 * The page reads the first five with the rest of the record and hands them in
 * (`page`), because the deactivated header reads the same response. See all
 * opens the full list, read from the server twenty at a time.
 *
 * An empty history says what is true — nothing was recorded — in ACC-133's
 * "No head recorded" voice, never "never".
 */
@Component({
  selector: 'am-unit-history-panel',
  standalone: true,
  imports: [TranslatePipe, CappedPanelComponent, ListDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <am-capped-panel
      [heading]="'organization.history.title' | translate"
      [state]="state()"
      [total]="page()?.total ?? 0"
      [shown]="rows().length"
      [loadingText]="'organization.history.loading' | translate"
      [errorText]="'organization.history.loadFailed' | translate"
      [emptyText]="'organization.history.empty' | translate"
      testIdPrefix="unit-history"
      (retry)="retry.emit()"
      (seeAll)="openPopup()"
    >
      @for (row of rows(); track row.id) {
        <li class="am-cp-row" [attr.data-row]="row.id">
          <span class="am-cp-l1"><span class="am-cp-cut am-uhp__what" [attr.title]="row.what">{{ row.what }}</span></span>
          <span class="am-cp-l2"><span class="am-cp-cut" [attr.title]="row.when">{{ row.when }}</span></span>
        </li>
      }
    </am-capped-panel>

    <ng-template #popupBody>
      <div class="am-uhp__popup" data-testid="unit-history-popup">
        <ul class="am-uhp__list" role="list">
          @for (row of popupRows(); track row.id) {
            <li class="am-uhp__item" [attr.data-row]="row.id">
              <span class="am-uhp__what">{{ row.what }}</span>
              <span class="am-uhp__when">{{ row.when }}</span>
            </li>
          }
        </ul>
        @if (popupState() === 'error') {
          <p class="am-uhp__note" role="alert">
            {{ 'record.loadMoreFailed' | translate }}
            <button type="button" class="am-uhp__btn" (click)="loadMore()">{{ 'list.retry' | translate }}</button>
          </p>
        } @else if (popupState() === 'loading') {
          <p class="am-uhp__note" role="status">{{ 'record.loadingMore' | translate }}</p>
        } @else if (popupRows().length < popupTotal()) {
          <p class="am-uhp__note">
            <button type="button" class="am-uhp__btn" (click)="loadMore()" data-testid="unit-history-more">
              {{ 'record.loadMore' | translate }}
            </button>
          </p>
        }
        <p class="am-uhp__note" aria-live="polite">
          {{ 'record.footShowing' | translate: { shown: format.number(popupRows().length), total: format.number(popupTotal()) } }}
        </p>
      </div>
    </ng-template>
    <am-list-dialog
      size="compact"
      [visible]="popupOpen()"
      [heading]="'organization.history.popupTitle' | translate: { unit: unitName() }"
      [count]="format.number(page()?.total ?? 0)"
      [closeLabel]="'organization.history.close' | translate"
      [body]="popupBody"
      (closeRequested)="popupOpen.set(false)"
    />
  `,
  styles: [
    `
      :host{display:block;min-inline-size:0}
      .am-uhp__what{color:var(--am-ink-900)}
      .am-uhp__popup{display:flex;flex-direction:column;min-block-size:0;block-size:100%;overflow-y:auto}
      .am-uhp__list{list-style:none;margin:0;padding:0}
      .am-uhp__item{display:flex;flex-direction:column;gap:var(--am-space-2);padding:var(--am-space-8) var(--am-space-16);border-block-end:1px solid var(--am-border);font-size:var(--am-type-value-size);overflow-wrap:anywhere}
      .am-uhp__when{font-size:var(--am-type-meta-size);color:var(--am-ink-500)}
      .am-uhp__note{margin:0;padding:var(--am-space-8) var(--am-space-16);font-size:var(--am-type-meta-size);color:var(--am-ink-700)}
      .am-uhp__btn{font:inherit;padding:0;border:0;background:none;color:var(--am-primary-700);font-weight:600;cursor:pointer}
      .am-uhp__btn:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
    `,
  ],
})
export class UnitHistoryPanelComponent {
  private readonly orgUnits = inject(OrgUnitService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  protected readonly format = inject(FormatService);

  readonly unitId = input.required<string>();
  readonly unitName = input.required<string>();
  /** The first page, read by the record page. */
  readonly page = input<OrgUnitHistoryPageDto | null>(null);
  readonly state = input<CappedPanelState>('loading');
  readonly retry = output<void>();

  readonly popupOpen = signal(false);
  readonly popupEntries = signal<OrgUnitHistoryEntryDto[]>([]);
  readonly popupTotal = signal(0);
  readonly popupState = signal<'idle' | 'loading' | 'error'>('idle');

  private readonly deps = computed<HistoryTextDeps>(() => {
    this.translate.currentLang();
    return {
      t: (key, params) => this.translate.instant(key, params),
      bilingual: (en, ar) => this.language.bilingual(en, ar),
      date: (value) => this.format.date(value),
    };
  });

  private toRow(entry: OrgUnitHistoryEntryDto): HistoryRow {
    const deps = this.deps();
    return { id: entry.id, what: historyWhat(entry, deps), when: historyWhen(entry, deps) };
  }

  readonly rows = computed(() => (this.page()?.items ?? []).slice(0, CAPPED_PANEL_ROWS).map((e) => this.toRow(e)));
  readonly popupRows = computed(() => this.popupEntries().map((e) => this.toRow(e)));

  openPopup(): void {
    this.popupEntries.set([]);
    this.popupTotal.set(this.page()?.total ?? 0);
    this.popupOpen.set(true);
    this.loadMore();
  }

  loadMore(): void {
    this.popupState.set('loading');
    this.orgUnits.getHistory(this.unitId(), { skip: this.popupEntries().length, take: HISTORY_POPUP_PAGE }).subscribe({
      next: (page) => {
        this.popupEntries.set([...this.popupEntries(), ...page.items]);
        this.popupTotal.set(page.total);
        this.popupState.set('idle');
      },
      error: () => this.popupState.set('error'),
    });
  }
}
