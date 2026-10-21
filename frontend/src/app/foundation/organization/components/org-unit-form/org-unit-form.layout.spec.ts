import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { of } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { LookupService, LookupValueDto } from '../../../lookup/services/lookup.service';
import { OrgUnitDto, OrgUnitService } from '../../services/org-unit.service';
import { OrgUnitTreeComponent } from '../org-unit-tree/org-unit-tree.component';
import { SHELL_PHONE_BELOW_PX } from '../../../../layout/app-shell/app-shell.component';

// ACC-120 slice 11 — the Add / Edit unit dialog against the 420px body cap
// (ACC-111), measured in the REAL host: the tree page opens the real dialog
// shell, at its standard density, with the real theme, the actions in the
// footer. Three entry points (Add unit, Add sub-unit, Edit), both languages,
// at 1280 (the dialog's own 560) and 390 (the dialog is the screen's width).
//
// Gate (CC-125): the body needs at most 420px and keeps at least ROOM px of it
// spare. The drawing's own sums are 382 English, 402 Arabic at standard density
// (OS L636); the host declares compact (six field blocks, artboard 13).
//
// 390 is a PHONE: the shell's phone media query (SHELL_PHONE_BELOW_PX) is made
// to match, as a phone's would, and the dialog is given the phone's width (a
// Karma window cannot be 390 wide). On a phone the Code helper is read but not
// drawn (CC-125a): beside its counter it wrapped and took Arabic to 425.
//
// NON-VACUITY FIRST (ACC-120): a body that measured 0 would pass "<= 410"
// perfectly. The guard asserts the dialog is really laid out, with all six
// fields, before the cap means anything.

const CAP = 420;
const ROOM = 10;
const FLOOR = 250;
const WIDTHS = [1280, 390] as const;
const FIELDS = 6;

function unit(id: string, parentId: string | null, nameEn: string, nameAr: string, over: Partial<OrgUnitDto> = {}): OrgUnitDto {
  return {
    id,
    organizationId: 'org',
    nameEn,
    nameAr,
    code: id.toUpperCase().slice(0, 10),
    parentId,
    typeValueId: 'lv-section',
    typeValue: { id: 'lv-section', key: 'section', labelEn: 'Section', labelAr: 'قسم فرعي', isRetired: false },
    description: null,
    isActive: true,
    isCodeLocked: false,
    sortOrder: 0,
    children: [],
    ...over,
  } as unknown as OrgUnitDto;
}

// The drawing's tree, with its longest real names.
const UNITS: OrgUnitDto[] = [
  unit('root', null, 'Al Nakheel Specialist Hospital', 'مستشفى النخيل التخصصي'),
  unit('med', 'root', 'Medical Services', 'الخدمات الطبية'),
  unit('pharm', 'med', 'Pharmacy', 'الصيدلية', {
    code: 'PHARM',
    description: 'Dispensing, compounding and medication safety for inpatients and outpatients.',
  }),
  unit('pharm-ip', 'pharm', 'Inpatient Pharmacy', 'صيدلية المرضى المنومين'),
  unit('pharm-op', 'pharm', 'Outpatient Pharmacy', 'صيدلية العيادات الخارجية'),
  unit('pharm-cl', 'pharm', 'Clinical Pharmacy', 'الصيدلة السريرية'),
  unit('rad', 'med', 'Radiology', 'الأشعة'),
];
const TREE: OrgUnitDto[] = [{ ...UNITS[0], children: [] } as OrgUnitDto];

const TYPES: LookupValueDto[] = ['department', 'section', 'division', 'unit', 'ward', 'committee_office'].map(
  (key, i) =>
    ({
      id: `lv-${key}`,
      organizationId: null,
      categoryId: 'cat',
      key,
      labelEn: key[0].toUpperCase() + key.slice(1).replace('_', ' '),
      labelAr: 'نوع',
      layer: 'SYSTEM',
      attributes: null,
      isActive: true,
      isHidden: false,
      labelOverrideEn: null,
      labelOverrideAr: null,
      sortOrder: i,
      createdAt: '',
      updatedAt: '',
    }) as LookupValueDto,
);

type Mode = 'add' | 'add-sub' | 'edit' | 'edit-moved' | 'add-errors' | 'code-error';
const MODES: readonly Mode[] = ['add', 'add-sub', 'edit', 'edit-moved', 'add-errors', 'code-error'];
const PHONE_QUERY = `(max-width: ${SHELL_PHONE_BELOW_PX - 0.02}px)`;

describe('OrgUnitForm — the unit dialog against the 420px body cap (ACC-120 slice 11)', () => {
  preserveDocumentLanguage();

  let fixture: ComponentFixture<OrgUnitTreeComponent>;
  const measured: string[] = [];

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

  async function open(language: 'en' | 'ar', mode: Mode, width: (typeof WIDTHS)[number]): Promise<HTMLElement> {
    // Only the phone query is answered for the phone; every other query (the
    // dialog's own breakpoints) goes to the real window.
    const real = window.matchMedia.bind(window);
    spyOn(window, 'matchMedia').and.callFake((q: string) =>
      q === PHONE_QUERY ? ({ ...real(q), matches: width === 390, media: q, addEventListener: () => undefined, removeEventListener: () => undefined } as unknown as MediaQueryList) : real(q),
    );
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [OrgUnitTreeComponent],
      providers: [
        provideNoopAnimations(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        { provide: NavigationAccessService, useValue: { hasPermission: () => true } },
        {
          provide: OrgUnitService,
          // ACC-120 slice 11 PR C — the tree reads the structure; the dialog
          // still reads the flat list of units.
          useValue: {
            getTree: () => of(TREE),
            getStructure: () => of({ nodes: [], asOf: '2026-10-20T09:00:00.000Z' }),
            getFlat: () => of(UNITS),
            create: () => of(UNITS[3]),
            update: () => of(UNITS[2]),
          },
        },
        { provide: LookupService, useValue: { getValues: () => of(TYPES) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    document.documentElement.dir = TestBed.inject(LanguageService).isRtl() ? 'rtl' : 'ltr';
    fixture = TestBed.createComponent(OrgUnitTreeComponent);
    await settle();

    const tree = fixture.componentInstance;
    if (mode === 'add' || mode === 'add-errors') tree.onAdd();
    else if (mode === 'add-sub') tree.onAddChild(UNITS[2]);
    else tree.onEdit(UNITS[2]);
    await settle();

    const form = tree.unitFormRef()!;
    expect(form).withContext('the form handed the host its reference').toBeTruthy();
    if (mode === 'add-sub') {
      // The drawing's state: a name in both languages and a code typed.
      form.form.patchValue({ nameEn: 'Inpatient Pharmacy', nameAr: 'صيدلية المرضى المنومين', code: 'PHARM-IP', typeValueId: 'lv-section' });
    }
    if (mode === 'edit-moved') form.form.controls.parentId.setValue('rad');
    if (mode === 'code-error') {
      // Typed, as a person would: the rule shows the moment "_" goes in.
      const input = document.querySelector<HTMLInputElement>('.p-dialog #org-unit-code')!;
      input.value = 'PHARM_IP';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (mode === 'add-errors') form.onSubmit();
    await settle();

    if (width === 390) document.querySelector<HTMLElement>('.p-dialog')!.style.width = '390px';
    await settle();
    await dialogStill();
    return document.querySelector<HTMLElement>('.am-dialog__body')!;
  }

  afterAll(() => {
    // The numbers recorded in the PR and in step-120-11-organisation.md.
    console.log(`ACC-120 slice 11 unit dialog measurements\n${measured.join('\n')}`);
  });

  for (const language of ['en', 'ar'] as const) {
    for (const width of WIDTHS) {
      for (const mode of MODES) {
        it(`${mode} [${language}] at ${width}: the body fits under 420 with ${ROOM}px to spare`, async () => {
          const body = await open(language, mode, width);
          expect(body).withContext('.am-dialog__body not found — did the shell change?').not.toBeNull();

          // Non-vacuity: laid out, with every field rendered.
          const fields = body.querySelectorAll('am-field');
          expect(fields.length).withContext(`${mode} [${language}] ${width}: fields rendered`).toBe(FIELDS);
          expect(body.scrollHeight).withContext(`${mode} [${language}] ${width}: body is laid out`).toBeGreaterThan(FLOOR);

          // The footer is the dialog's, never the body's.
          expect(body.querySelector('[data-testid="org-unit-submit"]')).withContext('the actions are in the footer').toBeNull();
          expect(document.querySelector('.p-dialog-footer [data-testid="org-unit-submit"]')).not.toBeNull();

          if (mode === 'edit-moved') {
            expect(body.textContent).toContain(language === 'en' ? 'Moves Pharmacy and its 3 sub-units' : 'ينقل الصيدلية');
          }
          if (mode === 'code-error') {
            const code = body.querySelector<HTMLElement>('#org-unit-code')!.closest('am-field')!;
            const message = code.querySelector<HTMLElement>('.am-field__message')!;
            expect(message.classList).withContext('the rule is the error').toContain('am-field__message--error');
            expect(message.textContent).toContain(language === 'en' ? 'Only A–Z, 0–9 and -' : 'فقط \u2066A–Z\u2069 و\u20660–9\u2069 و-');
            // The "!" never covers the code's first letter (a left-to-right box
            // inside a right-to-left field starts where the glyph is drawn).
            const glyph = code.querySelector<HTMLElement>('.am-field__glyph')!.getBoundingClientRect();
            const box = body.querySelector<HTMLInputElement>('#org-unit-code')!;
            const pad = parseFloat(getComputedStyle(box).paddingLeft);
            const textStart = box.getBoundingClientRect().left + pad;
            expect(glyph.width).withContext('the glyph is drawn').toBeGreaterThan(0);
            if (language === 'ar') expect(glyph.right).withContext('glyph clear of the text').toBeLessThanOrEqual(textStart);
            else expect(glyph.left).withContext('glyph clear of the text').toBeGreaterThan(textStart + 60);
            const text = message.querySelector<HTMLElement>('.am-field__message-text')!;
            expect(text.classList).withContext('an error is always drawn').not.toContain('sr-only');
          }
          if (mode !== 'code-error' && mode !== 'add-errors') {
            // The helper: drawn on desktop, read-only (sr-only) on a phone, and
            // in aria-describedby at both widths.
            const input = body.querySelector<HTMLElement>('#org-unit-code')!;
            const text = input.closest('am-field')!.querySelector<HTMLElement>('.am-field__message-text')!;
            expect(text.classList.contains('sr-only')).withContext('helper hidden only on a phone').toBe(width === 390);
            expect(text.textContent?.trim()).toBe(language === 'en' ? 'Up to 10 · capitals, numbers, hyphens' : 'حتى 10 · أحرف كبيرة وأرقام وشرطات');
            const describedBy = (input.getAttribute('aria-describedby') ?? '').split(' ');
            expect(describedBy).withContext('the helper stays in aria-describedby').toContain(text.closest('.am-field__message')!.id);
            expect(input.closest('am-field')!.querySelector('[data-testid="field-counter"]')).withContext('the counter stays').not.toBeNull();
          }
          if (mode === 'add-errors') {
            expect(body.querySelectorAll('[aria-invalid="true"]').length).withContext('errors showing').toBeGreaterThan(0);
          }

          const need = body.scrollHeight;
          measured.push(`${mode} [${language}] at ${width}: body ${need}px (client ${body.clientHeight}px), spare ${CAP - need}px`);
          expect(need + ROOM).withContext(`${mode} [${language}] at ${width}: body ${need}px`).toBeLessThanOrEqual(CAP);
          expect(body.scrollWidth).withContext('no sideways scroll').toBeLessThanOrEqual(body.clientWidth);
        });
      }
    }

    it(`the name pair swaps in ${language === 'ar' ? 'Arabic' : 'English'}: the reader's own language comes first`, async () => {
      const body = await open(language, 'edit', 1280);
      const en = body.querySelector<HTMLElement>('#org-unit-name-en')!.getBoundingClientRect();
      const arBox = body.querySelector<HTMLElement>('#org-unit-name-ar')!.getBoundingClientRect();
      expect(en.width).toBeGreaterThan(100);
      expect(Math.abs(en.top - arBox.top)).withContext('one row').toBeLessThanOrEqual(1);
      // In an Arabic (right-to-left) session the first column is on the right.
      if (language === 'en') expect(en.left).toBeLessThan(arBox.left);
      else expect(arBox.left).toBeGreaterThan(en.left);
      // DOM order, so Tab order, follows the reader's language too.
      const inputs = Array.from(body.querySelectorAll('input')).map((i) => i.id);
      const first = language === 'en' ? 'org-unit-name-en' : 'org-unit-name-ar';
      expect(inputs[0]).toBe(first);
    });
  }
});
