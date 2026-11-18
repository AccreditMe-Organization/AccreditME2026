import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { RoleReferenceBlockerDto, RoleReferenceCategory } from '../../services/role.service';
import { RoleInUseDialogComponent } from './role-in-use-dialog.component';

// ACC-154 — the dialog says each category from its code, through the plural
// objects, in both languages; never the server's English. Arabic is singular
// and gender-neutral: the role is the subject of every heading, never a person.

const CATEGORIES: RoleReferenceCategory[] = ['USER_GRANTS', 'POSITION_GRANTS', 'POSITIONS', 'STAGE_ESCALATIONS'];

describe('RoleInUseDialogComponent (ACC-154)', () => {
  preserveDocumentLanguage();
  let fixture: ComponentFixture<RoleInUseDialogComponent>;

  function setup(language: 'en' | 'ar', blockers: RoleReferenceBlockerDto[] = []): RoleInUseDialogComponent {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [RoleInUseDialogComponent],
      providers: [provideNoopAnimations(), provideTranslateService({ lang: 'en' }), provideFormatTesting(), providePrimeNG({}), ConfirmationService],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    fixture = TestBed.createComponent(RoleInUseDialogComponent);
    fixture.componentRef.setInput('roleName', 'Auditor');
    fixture.componentRef.setInput('blockers', blockers);
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  afterEach(() => {
    document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove());
    fixture?.destroy();
  });

  const heading = (c: RoleInUseDialogComponent, category: RoleReferenceCategory, count: number) =>
    c.headingOf({ category, count, names: [] });

  it('English: one and other for every category', () => {
    const c = setup('en');
    expect(CATEGORIES.map((k) => [heading(c, k, 1), heading(c, k, 12)])).toEqual([
      ['Given directly to 1 user', 'Given directly to 12 users'],
      ['Given to 1 user through a head position', 'Given to 12 users through a head position'],
      ['Set on 1 position', 'Set on 12 positions'],
      ['Named in the escalation of 1 workflow stage', 'Named in the escalation of 12 workflow stages'],
    ]);
  });

  it('Arabic: its own form for 1, 2, 3, 11 and 100 in every category, with Latin digits', () => {
    const c = setup('ar');
    const forms = CATEGORIES.map((k) => [1, 2, 3, 11, 100].map((n) => heading(c, k, n)));
    expect(forms).toEqual([
      ['مُسند مباشرة إلى مستخدم واحد', 'مُسند مباشرة إلى مستخدمَين', 'مُسند مباشرة إلى 3 مستخدمين', 'مُسند مباشرة إلى 11 مستخدمًا', 'مُسند مباشرة إلى 100 مستخدم'],
      [
        'مُسند عبر منصب رئاسة إلى مستخدم واحد',
        'مُسند عبر منصب رئاسة إلى مستخدمَين',
        'مُسند عبر منصب رئاسة إلى 3 مستخدمين',
        'مُسند عبر منصب رئاسة إلى 11 مستخدمًا',
        'مُسند عبر منصب رئاسة إلى 100 مستخدم',
      ],
      ['مرتبط بمنصب واحد', 'مرتبط بمنصبَين', 'مرتبط بـ3 مناصب', 'مرتبط بـ11 منصبًا', 'مرتبط بـ100 منصب'],
      [
        'مذكور في تصعيد مرحلة واحدة من مراحل سير العمل',
        'مذكور في تصعيد مرحلتَين من مراحل سير العمل',
        'مذكور في تصعيد 3 مراحل من مراحل سير العمل',
        'مذكور في تصعيد 11 مرحلةً من مراحل سير العمل',
        'مذكور في تصعيد 100 مرحلة من مراحل سير العمل',
      ],
    ]);
    // Five different sentences per category, so a missing form cannot hide behind "other".
    for (const row of forms) expect(new Set(row).size).toBe(5);
  });

  it('names the role in the title, lists the names with the language’s separator, and says how many are shown', () => {
    setup('ar', [{ category: 'USER_GRANTS', count: 12, names: ['نورة العتيبي', 'عمر صالح'] }]);
    const text = document.body.textContent!;
    expect(text).toContain('لا يمكن إلغاء تفعيل الدور «Auditor» بعد');
    expect(text).toContain('ما زال الدور قيد الاستخدام.');
    expect(text).toContain('نورة العتيبي، عمر صالح');
    expect(text).toContain('يظهر 2 من 12');
  });

  it('a category the reader may not see names of draws its count line alone', () => {
    setup('en', [
      { category: 'USER_GRANTS', count: 12, names: [] },
      { category: 'POSITIONS', count: 2, names: ['Head of Quality', 'Quality Lead'] },
    ]);
    const blocks = Array.from(document.querySelectorAll<HTMLElement>('[data-role-in-use-category]'));
    expect(blocks.map((b) => b.getAttribute('data-role-in-use-category'))).toEqual(['USER_GRANTS', 'POSITIONS']);
    const [users, positions] = blocks;
    expect(users!.textContent!.trim()).toBe('Given directly to 12 users');
    expect(users!.querySelector('[data-role-in-use-names]')).withContext('no empty names line').toBeNull();
    expect(users!.querySelector('[data-role-in-use-shown]')).withContext('no "Showing 0 of 12"').toBeNull();
    expect(positions!.querySelector('[data-role-in-use-names]')!.textContent).toBe('Head of Quality, Quality Lead');
  });

  it('Close emits closed', () => {
    const c = setup('en', [{ category: 'POSITIONS', count: 1, names: ['Head of Quality'] }]);
    let closed = 0;
    c.closed.subscribe(() => closed++);
    document.querySelector<HTMLButtonElement>('[data-role-in-use-close] button')!.click();
    expect(closed).toBe(1);
  });
});
