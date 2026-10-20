import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { LanguageService } from '../../../../core/services/language.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { IOrgPositionDto } from '../../../org-position/services/org-position.service';
import { IOrgUnitHeadStatus } from '../../services/org-unit-head.service';
import { AppointHeadDialogComponent } from '../appoint-head-dialog/appoint-head-dialog.component';
import { AppointSuccessorDialogComponent } from './appoint-successor-dialog.component';

// ACC-133 — both headship dialogs against the 420px body cap (ACC-111),
// measured in the real dialog shell with the real theme, the actions in the
// footer: English and Arabic, at 1280 (the dialog's own 560) and 390 (the
// dialog is the screen's width; a Karma window cannot be 390 wide, so the
// dialog is given that width).
//
// Gates: every body at most 420; dialog C in Arabic at 1280 with at least 10px
// spare (the drawing's own sum was 410, its tightest fit). Also the header line
// "Head access starts when you save…" never wraps to three lines in Arabic.
//
// NON-VACUITY FIRST (ACC-120): every case asserts its fields are really laid out
// before the cap is allowed to mean anything.

const CAP = 420;
const C_AR_SPARE = 10;
const FLOOR = 150;
const WIDTHS = [1280, 390] as const;

const PEOPLE = [
  { id: 'huda', name: 'Dr. Huda Zahrani', email: 'huda.zahrani@alnakheel-hospital.test', positionId: null },
  { id: 'omar', name: 'Dr. Omar Haddad', email: 'omar.haddad@alnakheel-hospital.test', positionId: null },
];
const POSITIONS = [
  { id: 'dir', nameEn: 'Director of Clinical Support Services', nameAr: 'مدير الخدمات الطبية المساندة', isUnitHeadPosition: true, isActive: true },
] as unknown as IOrgPositionDto[];
const TWO_POSITIONS = [
  ...POSITIONS,
  { id: 'hos', nameEn: 'Head of Section', nameAr: 'رئيس شعبة', isUnitHeadPosition: true, isActive: true },
] as unknown as IOrgPositionDto[];
const STATUS: IOrgUnitHeadStatus = {
  holders: [
    {
      id: 'fahad',
      name: 'Dr. Fahad Al-Anazi',
      positionId: 'dir',
      positionNameEn: 'Director of Clinical Support Services',
      positionNameAr: 'مدير الخدمات الطبية المساندة',
      headSince: '2024-03-03T12:00:00.000Z',
    },
  ],
  pendingHeadUserId: null,
  headHandoverEffectiveDate: null,
  actingHeadUserId: null,
  lastVacancy: null,
  pendingHeadAccessSince: null,
  cover: null,
  scheduledCover: null,
  recentlyEndedCovers: [],
};

type Mode = 'plain' | 'chosen' | 'errors' | 'two-positions';

describe('Headship dialogs against the 420px body cap (ACC-133)', () => {
  preserveDocumentLanguage();
  const measured: string[] = [];
  let fixture: ComponentFixture<AppointHeadDialogComponent | AppointSuccessorDialogComponent>;

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
  }

  async function dialogStill(): Promise<void> {
    const dialog = document.querySelector<HTMLElement>('.p-dialog')!;
    for (let i = 0; i < 100; i++) {
      if (Math.abs(dialog.getBoundingClientRect().width - dialog.offsetWidth) <= 0.01) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    fail('the dialog never stopped animating');
  }

  async function open(which: 'A' | 'C', language: 'en' | 'ar', width: (typeof WIDTHS)[number], mode: Mode): Promise<HTMLElement> {
    TestBed.resetTestingModule();
    document.querySelectorAll('.p-dialog').forEach((d) => d.remove());
    TestBed.configureTestingModule({
      imports: [AppointHeadDialogComponent, AppointSuccessorDialogComponent],
      providers: [
        provideNoopAnimations(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    document.documentElement.dir = TestBed.inject(LanguageService).isRtl() ? 'rtl' : 'ltr';

    fixture =
      which === 'A'
        ? TestBed.createComponent(AppointHeadDialogComponent)
        : TestBed.createComponent(AppointSuccessorDialogComponent);
    const ref = fixture.componentRef;
    ref.setInput('orgUnitId', 'u1');
    ref.setInput('unitName', language === 'en' ? 'Clinical Support Services' : 'الخدمات الطبية المساندة');
    ref.setInput('people', PEOPLE);
    ref.setInput('positions', mode === 'two-positions' ? TWO_POSITIONS : POSITIONS);
    if (which === 'C') ref.setInput('status', STATUS);
    ref.setInput('visible', true);
    await settle();

    const form = fixture.componentInstance;
    if (mode === 'chosen') {
      if (form instanceof AppointSuccessorDialogComponent) {
        form.form.controls.incomingUserId.setValue('huda');
        const d = new Date();
        d.setDate(d.getDate() + 40);
        form.onPicked(d);
        form.form.controls.reason.setValue('Retires at the end of the month; appointment approved by the Medical Director.');
      } else {
        form.form.controls.userId.setValue('huda');
      }
    }
    if (mode === 'errors') form.submit();
    await settle();

    if (width === 390) document.querySelector<HTMLElement>('.p-dialog')!.style.width = '390px';
    await settle();
    await dialogStill();
    return document.querySelector<HTMLElement>('.am-dialog__body')!;
  }

  afterAll(() => {
    document.querySelectorAll('.p-dialog').forEach((d) => d.remove());
    console.log(`ACC-133 headship dialog measurements\n${measured.join('\n')}`);
  });

  const cases: ['A' | 'C', Mode, number][] = [
    ['A', 'plain', 3],
    ['A', 'chosen', 3],
    ['A', 'errors', 3],
    ['A', 'two-positions', 3],
    ['C', 'plain', 3],
    ['C', 'chosen', 3],
    ['C', 'errors', 3],
  ];

  for (const language of ['en', 'ar'] as const) {
    for (const width of WIDTHS) {
      for (const [which, mode, fields] of cases) {
        it(`${which} ${mode} [${language}] at ${width}: the body fits under 420`, async () => {
          const body = await open(which, language, width, mode);
          expect(body).withContext('.am-dialog__body not found').not.toBeNull();
          expect(body.querySelectorAll('am-field').length).withContext('fields rendered').toBe(fields);
          expect(body.scrollHeight).withContext('laid out').toBeGreaterThan(FLOOR);
          expect(body.scrollWidth).withContext('no sideways scroll').toBeLessThanOrEqual(body.clientWidth);

          const need = body.scrollHeight;
          measured.push(`${which} ${mode} [${language}] at ${width}: body ${need}px, spare ${CAP - need}px`);
          expect(need).withContext(`${which} ${mode} [${language}] at ${width}: body ${need}px`).toBeLessThanOrEqual(CAP);
          if (which === 'C' && language === 'ar' && width === 1280) {
            expect(need + C_AR_SPARE).withContext(`C [ar] at 1280: ${need}px leaves less than ${C_AR_SPARE}px`).toBeLessThanOrEqual(CAP);
          }

          if (which === 'C') {
            const warn = document.querySelector<HTMLElement>('[data-testid="successor-access-warning"]')!;
            const lines = Math.round(warn.getBoundingClientRect().height / parseFloat(getComputedStyle(warn).lineHeight));
            measured.push(`  header line: ${lines} line(s)`);
            expect(lines).withContext(`the header line wraps to ${lines} lines`).toBeLessThanOrEqual(2);
          }
        });
      }
    }
  }
});
