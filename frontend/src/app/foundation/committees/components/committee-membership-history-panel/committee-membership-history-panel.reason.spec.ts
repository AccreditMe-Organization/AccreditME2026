import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import { firstValueFrom } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { CommitteeMembershipEventDto } from '../../services/committee.service';
import { CommitteeMembershipHistoryPanelComponent } from './committee-membership-history-panel.component';

/**
 * ACC-301 — a removal's reason (required since ACC-298) is shown on its LEFT
 * row, in the capped panel and in See all, from the history read itself. A
 * removal from before ACC-298 has no reason and shows nothing extra: no "—", no
 * empty line, no separator. A seat the app ended (ACC-306, a cause) and a JOINED
 * row never show a stored reason.
 */
describe('CommitteeMembershipHistoryPanelComponent — a removal’s reason (ACC-301)', () => {
  preserveDocumentLanguage();

  const REASON = 'Moved to the Pharmacy unit after the restructure';

  const LEFT: CommitteeMembershipEventDto = {
    id: 'e-left',
    organizationId: 'org-a',
    committeeId: 'c-1',
    userId: 'u-1',
    roleValueId: 'r-1',
    action: 'LEFT',
    effectiveDate: '2026-11-19T08:00:00.000Z',
    reason: REASON,
    approvedBy: 'u-admin',
    createdAt: '2026-11-19T08:00:00.000Z',
    userName: 'Huda Al-Harbi',
    approvedByName: 'Sara Admin',
    roleLabelEn: 'Secretary',
    roleLabelAr: 'أمين السر',
    cause: null,
  };

  function render(lang: 'en' | 'ar', events: CommitteeMembershipEventDto[]): ComponentFixture<CommitteeMembershipHistoryPanelComponent> {
    TestBed.configureTestingModule({
      imports: [CommitteeMembershipHistoryPanelComponent],
      providers: [provideNoopAnimations(), provideTranslateService({ lang }), provideFormatTesting(), providePrimeNG({})],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    const fixture = TestBed.createComponent(CommitteeMembershipHistoryPanelComponent);
    fixture.componentRef.setInput('events', events);
    fixture.componentRef.setInput('committeeName', 'Quality Council');
    fixture.detectChanges();
    return fixture;
  }

  const panelRow = (f: ComponentFixture<unknown>, id: string) =>
    (f.nativeElement as HTMLElement).querySelector<HTMLElement>(`[data-history-row="${id}"]`)!;
  const text = (n: Element | null) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim();

  async function openPopup(f: ComponentFixture<CommitteeMembershipHistoryPanelComponent>): Promise<HTMLElement[]> {
    f.componentInstance.popupOpen.set(true);
    for (let i = 0; i < 8 && !document.querySelector('[data-testid="simple-list-row"]'); i++) {
      f.detectChanges();
      await f.whenStable();
    }
    return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="simple-list-row"]'));
  }

  afterEach(() => {
    document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove());
    TestBed.resetTestingModule();
  });

  it('[en] the panel row shows the reason after the change, labelled, with the whole text in its tooltip', () => {
    const f = render('en', [LEFT]);
    const row = panelRow(f, 'e-left');
    const reason = row.querySelector<HTMLElement>('[data-history-reason]');
    expect(reason).withContext('reason shown').not.toBeNull();
    expect(text(reason)).toBe(`Reason: ${REASON}`);
    expect(reason!.getAttribute('title')).toBe(REASON);
    expect(reason!.classList).toContain('am-cp-cut');
    expect(reason!.parentElement!.classList).withContext('on line 2, never a line of its own').toContain('am-cp-l2');
    expect(text(row.querySelector('[data-history-detail]'))).toBe('Left — Secretary · by Sara Admin');
  });

  it('[ar] the label is Arabic, singular, and the reason is isolated as typed', () => {
    const f = render('ar', [{ ...LEFT, reason: 'انتقل إلى وحدة الصيدلة' }]);
    const reason = panelRow(f, 'e-left').querySelector<HTMLElement>('[data-history-reason]')!;
    expect(text(reason)).toBe('السبب: انتقل إلى وحدة الصيدلة');
    expect(reason.querySelector('bdi')?.textContent).toBe('انتقل إلى وحدة الصيدلة');
    expect(reason.getAttribute('title')).toBe('انتقل إلى وحدة الصيدلة');
  });

  it('a removal with no reason (before ACC-298) shows nothing extra: no reason, no separator, no "—"', () => {
    for (const reason of [null, '', '   ']) {
      const f = render('en', [{ ...LEFT, reason }]);
      const l2 = panelRow(f, 'e-left').querySelector<HTMLElement>('.am-cp-l2')!;
      expect(l2.querySelector('[data-history-reason]')).toBeNull();
      expect(l2.querySelector('.am-cmh__sep')).toBeNull();
      expect(text(l2)).toBe('Left — Secretary · by Sara Admin');
      expect(l2.querySelectorAll(':scope > *').length).withContext('one segment only').toBe(1);
      TestBed.resetTestingModule();
    }
  });

  it('a seat the app ended (any cause) and a JOINED row never show a stored reason', () => {
    const f = render('en', [
      { ...LEFT, id: 'e-cause', cause: 'DEACTIVATION' },
      { ...LEFT, id: 'e-unknown', cause: 'SOMETHING_NEW' },
      { ...LEFT, id: 'e-joined', action: 'JOINED', reason: 'Founding member' },
    ]);
    for (const id of ['e-cause', 'e-unknown', 'e-joined']) {
      expect(panelRow(f, id).querySelector('[data-history-reason]')).withContext(id).toBeNull();
    }
  });

  it('See all: the reason sits under the change, cut with its tooltip; a row without one has nothing', async () => {
    const f = render('en', [LEFT, { ...LEFT, id: 'e-old', reason: null }]);
    const rows = await openPopup(f);
    expect(rows.length).withContext('popup rows').toBe(2);
    const withReason = rows.find((r) => r.querySelector('[data-history-reason]'))!;
    const reason = withReason.querySelector<HTMLElement>('[data-history-reason]')!;
    expect(reason.getClientRects().length).withContext('the reason is drawn').toBeGreaterThan(0);
    expect(reason.getBoundingClientRect().width).withContext('the reason has a width').toBeGreaterThan(0);
    expect(text(reason)).toBe(`Reason: ${REASON}`);
    expect(reason.getAttribute('title')).toBe(REASON);
    expect(reason.classList).toContain('am-cp-cut');
    // Under the change: the same cell, after the change's own line.
    expect(reason.previousElementSibling?.hasAttribute('data-history-detail')).toBeTrue();
    expect(rows.filter((r) => r.querySelector('[data-history-reason]')).length).toBe(1);
  });

  it('See all’s search finds a row by its reason', async () => {
    const f = render('en', [LEFT, { ...LEFT, id: 'e-old', reason: null }]);
    const page = await firstValueFrom(f.componentInstance.loadPage({ q: 'pharmacy', skip: 0, take: 50, sort: 'date', dir: 'desc' }));
    expect(page.items.map((e) => e.id)).toEqual(['e-left']);
  });
});
