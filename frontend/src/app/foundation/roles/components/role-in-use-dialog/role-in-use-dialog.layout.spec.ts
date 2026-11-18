import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
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
import { useLayoutFonts } from '../../../../../testing/layout-fonts';
import { RoleReferenceBlockerDto } from '../../services/role.service';
import { RoleInUseDialogComponent } from './role-in-use-dialog.component';

// ACC-154 — the "can't be deactivated yet" dialog against the 420px body cap
// (ACC-111), MEASURED in both languages, in the real theme and font, at 1280
// (the confirm's own 420) and on a 390 phone.
//
// The worst case is every category with the ten names the server sends at
// most, each long, and more beyond them ("Showing 10 of 37"). That cannot fit
// as plain text, so the list is an inner-scroll frame: the BODY must stay under
// the cap with room, the LIST must be what scrolls, and nothing else may. The
// small case (one category, one name) must not scroll at all.
// NON-VACUITY FIRST (ACC-120): a body that measured 0 would pass, and so would
// a list that never overflowed because nothing was in it.

const CAP = 420;
const ROOM = 20;
const FLOOR = 60;
const WIDTHS = [1280, 390] as const;

const TEN = {
  en: {
    users: [
      'Abdulrahman bin Khalid Al-Qahtani',
      'Dr. Nora bint Abdulrahman Al-Otaibi',
      'Mohammed Saleh Al-Ghamdi',
      'Fatimah Abdullah Al-Zahrani',
      'Sultan Ibrahim Al-Dosari',
      'Haya Nasser Al-Shammari',
      'Turki Fahad Al-Mutairi',
      'Reem Abdulaziz Al-Harbi',
      'Yousef Omar Al-Shehri',
      'Lamia Saad Al-Qurashi',
    ],
    positions: [
      'Head of Infection Prevention and Control',
      'Director of Quality and Patient Safety',
      'Head of Clinical Pharmacy Services',
      'Head of Biomedical Engineering',
      'Director of Nursing Education',
      'Head of Health Information Management',
      'Director of Facilities and Safety',
      'Head of Laboratory Medicine',
      'Head of Radiology and Imaging',
      'Director of Human Resources Development',
    ],
    stages: [
      'Committee lifecycle — Dissolution Pending',
      'Committee lifecycle — Terms Review',
      'Committee lifecycle — Formation',
      'Committee change request — Under review',
      'Meeting — Minutes review and approval',
      'Meeting — Agenda preparation',
      'Document request — Quality review',
      'Document — Final approval',
      'Corrective action — Effectiveness check',
      'Audit — Report review',
    ],
  },
  ar: {
    users: [
      'عبدالرحمن بن خالد القحطاني',
      'د. نورة بنت عبدالرحمن العتيبي',
      'محمد صالح الغامدي',
      'فاطمة عبدالله الزهراني',
      'سلطان إبراهيم الدوسري',
      'هيا ناصر الشمري',
      'تركي فهد المطيري',
      'ريم عبدالعزيز الحربي',
      'يوسف عمر الشهري',
      'لمياء سعد القرشي',
    ],
    positions: [
      'رئيس مكافحة العدوى والوقاية منها',
      'مدير الجودة وسلامة المرضى',
      'رئيس خدمات الصيدلة السريرية',
      'رئيس الهندسة الطبية الحيوية',
      'مدير التعليم التمريضي',
      'رئيس إدارة المعلومات الصحية',
      'مدير المرافق والسلامة',
      'رئيس طب المختبرات',
      'رئيس الأشعة والتصوير الطبي',
      'مدير تطوير الموارد البشرية',
    ],
    stages: [
      'دورة حياة اللجنة — بانتظار الحل',
      'دورة حياة اللجنة — مراجعة الشروط المرجعية',
      'دورة حياة اللجنة — التشكيل',
      'طلب تغيير اللجنة — قيد المراجعة',
      'الاجتماع — مراجعة المحضر واعتماده',
      'الاجتماع — إعداد جدول الأعمال',
      'طلب وثيقة — مراجعة الجودة',
      'الوثيقة — الاعتماد النهائي',
      'الإجراء التصحيحي — التحقق من الفعالية',
      'التدقيق — مراجعة التقرير',
    ],
  },
};

function worst(language: 'en' | 'ar'): RoleReferenceBlockerDto[] {
  const t = TEN[language];
  return [
    { category: 'USER_GRANTS', count: 37, names: t.users },
    { category: 'POSITION_GRANTS', count: 14, names: t.users.slice().reverse() },
    { category: 'POSITIONS', count: 12, names: t.positions },
    { category: 'STAGE_ESCALATIONS', count: 23, names: t.stages },
  ];
}

function small(language: 'en' | 'ar'): RoleReferenceBlockerDto[] {
  return [{ category: 'POSITIONS', count: 1, names: [TEN[language].positions[0]!] }];
}

@Component({
  standalone: true,
  imports: [RoleInUseDialogComponent],
  template: `<app-role-in-use-dialog [visible]="true" [roleName]="name" [blockers]="blockers()" />`,
})
class Host {
  readonly name = 'Clinical Quality Coordinator';
  readonly blockers = signal<RoleReferenceBlockerDto[]>([]);
}

describe('Role in use dialog — layout, measured (ACC-154)', () => {
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();
  const measured: string[] = [];
  let fixture: ComponentFixture<Host>;

  afterAll(() => console.log(`ACC-154 role in use dialog (cap ${CAP}, room ≥ ${ROOM}):\n  ${measured.join('\n  ')}`));

  afterEach(() => {
    document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove());
    fixture?.destroy();
  });

  async function open(language: 'en' | 'ar', width: (typeof WIDTHS)[number], blockers: RoleReferenceBlockerDto[]): Promise<void> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        ConfirmationService,
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    document.documentElement.dir = TestBed.inject(LanguageService).isRtl() ? 'rtl' : 'ltr';
    fixture = TestBed.createComponent(Host);
    fixture.componentInstance.blockers.set(blockers);
    document.body.appendChild(fixture.nativeElement);
    fixture.autoDetectChanges(true);
    await settle();
    if (width === 390) frame().style.width = '390px';
    await still();
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }

  const body = () => document.querySelector<HTMLElement>('.am-dialog__body')!;
  const frame = () => document.querySelector<HTMLElement>('.p-dialog')!;
  const list = () => document.querySelector<HTMLElement>('[data-role-in-use-list]')!;

  /** Boxes are read once PrimeNG's open motion has stopped (it scales the frame). */
  async function still(): Promise<void> {
    for (let i = 0; i < 100; i++) {
      const f = frame();
      if (f && Math.abs(f.getBoundingClientRect().width - f.offsetWidth) <= 0.01) return settle();
      await new Promise((r) => setTimeout(r, 20));
    }
    fail('the dialog never stopped animating');
  }

  /** What scrolls inside the body, other than the list when it is allowed to. */
  function scrollersBesides(allowed: HTMLElement | null): string[] {
    return Array.from(body().querySelectorAll<HTMLElement>('*'))
      .filter((n) => n !== allowed)
      .filter((n) => n.scrollHeight > n.clientHeight + 1 && ['auto', 'scroll'].includes(getComputedStyle(n).overflowY))
      .map((n) => `${n.tagName}.${n.className} ${n.scrollHeight}/${n.clientHeight}`);
  }

  function check(label: string, language: string, width: number, categories: number): number {
    const b = body();
    expect(b).withContext('.am-dialog__body not found — did the shell change?').not.toBeNull();
    const height = b.scrollHeight;
    const drawn = Math.round(frame().getBoundingClientRect().width);
    const l = list();
    measured.push(
      `${label} [${language}, ${width}]: body ${height}px, room ${CAP - height}px, list ${l.clientHeight}px showing of ${l.scrollHeight}px, dialog ${drawn}px wide`,
    );
    // Non-vacuity: laid out, at the confirm's width, with every category drawn.
    expect(height).withContext(`${label} [${language}, ${width}] not laid out`).toBeGreaterThan(FLOOR);
    expect(drawn).withContext(`${label} [${language}] dialog width`).toBe(width === 390 ? 390 : 420);
    const blocks = Array.from(l.querySelectorAll<HTMLElement>('[data-role-in-use-category]'));
    expect(blocks.length).withContext(`${label} categories drawn`).toBe(categories);
    for (const block of blocks) expect(block.getBoundingClientRect().height).withContext('a category laid out').toBeGreaterThan(20);
    // The claim.
    expect(CAP - height).withContext(`${label} [${language}, ${width}] body ${height}px leaves under ${ROOM}px`).toBeGreaterThanOrEqual(ROOM);
    return height;
  }

  for (const language of ['en', 'ar'] as const) {
    for (const width of WIDTHS) {
      describe(`${language === 'en' ? 'English' : 'Arabic'} at ${width}`, () => {
        it('every category with ten names: the body stays under the cap and only the list scrolls', async () => {
          await open(language, width, worst(language));
          check('worst case', language, width, 4);
          // The frame is genuinely needed here (not passing by being empty) …
          expect(list().scrollHeight).withContext('the worst case overflows the list').toBeGreaterThan(list().clientHeight + 1);
          // … every name was drawn, and "Showing 10 of …" under each category …
          expect(list().textContent).toContain(TEN[language].stages[9]!);
          expect(document.querySelectorAll('[data-role-in-use-shown]').length).toBe(4);
          // … a keyboard can reach it, and nothing else scrolls.
          expect(list().tabIndex).withContext('the list is focusable, to scroll it by keyboard').toBe(0);
          expect(scrollersBesides(list())).withContext('something besides the list scrolls').toEqual([]);
        });

        it('one category with one name: nothing scrolls', async () => {
          await open(language, width, small(language));
          check('small case', language, width, 1);
          expect(scrollersBesides(null)).withContext('something scrolls').toEqual([]);
          expect(document.querySelectorAll('[data-role-in-use-shown]').length).toBe(0);
        });
      });
    }
  }
});
