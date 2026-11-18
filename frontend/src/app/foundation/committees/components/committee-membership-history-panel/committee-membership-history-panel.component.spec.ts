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
