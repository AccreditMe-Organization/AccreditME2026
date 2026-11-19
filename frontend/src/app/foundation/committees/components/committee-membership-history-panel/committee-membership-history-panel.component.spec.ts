import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { expectArabicDateInPageDirection } from '../../../../../testing/arabic-date';
import { CommitteeMembershipEventDto } from '../../services/committee.service';
import { CommitteeMembershipHistoryPanelComponent } from './committee-membership-history-panel.component';

/**
 * ACC-313 (CC-326) — a membership change's date, on the panel's row and in its
 * See all list, takes the page's direction. It sat in a dir="ltr" span, so an
 * Arabic date showed its day last («نوفمبر 2026 3»).
 */
describe('CommitteeMembershipHistoryPanelComponent — the date in Arabic (ACC-313)', () => {
  preserveDocumentLanguage();

  const EVENT: CommitteeMembershipEventDto = {
    id: 'e-1',
    organizationId: 'org-a',
    committeeId: 'c-1',
    userId: 'u-1',
    roleValueId: 'r-1',
    action: 'JOINED',
    effectiveDate: '2026-11-03T08:00:00.000Z',
    reason: null,
    approvedBy: null,
    createdAt: '2026-11-03T08:00:00.000Z',
    userName: 'Huda Al-Harbi',
    roleLabelEn: 'Secretary',
    roleLabelAr: 'أمين السر',
  };

  function render() {
    TestBed.configureTestingModule({
      imports: [CommitteeMembershipHistoryPanelComponent],
      providers: [provideNoopAnimations(), provideTranslateService({ lang: 'ar' }), provideFormatTesting(), providePrimeNG({})],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('ar');
    const fixture = TestBed.createComponent(CommitteeMembershipHistoryPanelComponent);
    fixture.componentRef.setInput('events', [EVENT]);
    fixture.componentRef.setInput('committeeName', 'لجنة الجودة');
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => {
    document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove());
    TestBed.resetTestingModule();
  });

  it('the panel row’s date reads day first, in the page direction', () => {
    const fixture = render();
    expectArabicDateInPageDirection((fixture.nativeElement as HTMLElement).querySelector('.am-cmh__date'), { day: '3', month: 'نوفمبر' });
  });

  it('the See all list’s date reads day first, in the page direction', async () => {
    const fixture = render();
    fixture.componentInstance.popupOpen.set(true);
    for (let i = 0; i < 6 && !document.querySelector('[data-history-date]'); i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
    expectArabicDateInPageDirection(document.querySelector('[data-history-date]'), { day: '3', month: 'نوفمبر' });
  });
});

/**
 * ACC-306 — a seat a deactivation ended says so, from the event's `cause`, in
 * both languages; never from a stored English reason. A cause this screen does
 * not know reads as a plain "Left".
 */
describe('CommitteeMembershipHistoryPanelComponent — a seat a deactivation ended (ACC-306)', () => {
  preserveDocumentLanguage();

  const LEFT: CommitteeMembershipEventDto = {
    id: 'e-2',
    organizationId: 'org-a',
    committeeId: 'c-1',
    userId: 'u-1',
    roleValueId: 'r-1',
    action: 'LEFT',
    effectiveDate: '2026-11-19T08:00:00.000Z',
    reason: 'An English reason that must never be shown',
    approvedBy: 'u-admin',
    createdAt: '2026-11-19T08:00:00.000Z',
    userName: 'Huda Al-Harbi',
    approvedByName: 'Sara Admin',
    roleLabelEn: 'Secretary',
    roleLabelAr: 'أمين السر',
  };

  function detailOf(lang: 'en' | 'ar', event: CommitteeMembershipEventDto): string {
    TestBed.configureTestingModule({
      imports: [CommitteeMembershipHistoryPanelComponent],
      providers: [provideNoopAnimations(), provideTranslateService({ lang }), provideFormatTesting(), providePrimeNG({})],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    const fixture = TestBed.createComponent(CommitteeMembershipHistoryPanelComponent);
    fixture.componentRef.setInput('events', [event]);
    fixture.componentRef.setInput('committeeName', 'Quality Council');
    fixture.detectChanges();
    const row = (fixture.nativeElement as HTMLElement).querySelector('[data-history-row] .am-cp-l2');
    return (row?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  afterEach(() => {
    document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove());
    TestBed.resetTestingModule();
  });

  it('English: "Left — account deactivated", the seat, and who deactivated', () => {
    expect(detailOf('en', { ...LEFT, cause: 'DEACTIVATION' })).toBe('Left — account deactivated · Secretary · by Sara Admin');
  });

  it('Arabic: the same, in Arabic', () => {
    expect(detailOf('ar', { ...LEFT, cause: 'DEACTIVATION' })).toBe('مغادرة — إلغاء تفعيل الحساب · أمين السر · بواسطة Sara Admin');
  });

  it('a cause it does not know reads as a plain "Left", and never the stored reason', () => {
    const text = detailOf('en', { ...LEFT, cause: 'SOMETHING_NEW' });
    expect(text).toBe('Left — Secretary · by Sara Admin');
    expect(text).not.toContain('English reason');
  });

  it('a cause it knows never shows the stored reason either', () => {
    expect(detailOf('en', { ...LEFT, cause: 'DEACTIVATION' })).not.toContain('English reason');
  });

  // ACC-301 — with NO cause, the row is a person's removal: the change still
  // reads as a plain "Left", and the reason they typed is shown beside it.
  it('no cause: the change reads as a plain "Left", and the reason is shown as the person typed it', () => {
    for (const cause of [null, undefined]) {
      const text = detailOf('en', { ...LEFT, cause, reason: 'Moved to the Pharmacy unit' });
      expect(text).toBe('Left — Secretary · by Sara Admin · Reason: Moved to the Pharmacy unit');
      TestBed.resetTestingModule();
    }
  });
});
