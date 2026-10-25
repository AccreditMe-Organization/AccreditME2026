import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { of, throwError } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { LanguageService } from '../../../../core/services/language.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { CommitteeDetailDto, CommitteeListItemDto, CommitteeService } from '../../services/committee.service';
import { LookupService } from '../../../lookup/services/lookup.service';
import { OrgUnitService } from '../../../organization/services/org-unit.service';
import { CommitteeFormComponent, CommitteeFormTab } from './committee-form.component';
import { FORMATION_RULES } from '../../testing';

// ACC-238 — the three-tab committee dialog against the 420px body cap
// (ACC-111), measured rather than assumed (ACC-120): each tab, in both
// languages, in the real dialog shell at compact density with the real theme,
// the tabs in the header and the actions in the footer.
//
// Two numbers per tab:
//   - the PANEL: that tab's own content height;
//   - the BODY: what the dialog body needs with that tab showing. Every panel
//     sits in one grid cell, so the body is the tallest panel on every tab —
//     the footer does not move as the reader switches.
// Each must keep at least ROOM px under the cap (Ahmad's standing rule: at
// least 20px of room in both languages).
//
// NON-VACUITY FIRST (ACC-120): a body that measured 0 would pass "<= 400"
// perfectly. The guard asserts the three panels are really laid out, at three
// DIFFERENT heights, before the cap means anything.

const CAP = 420;
const ROOM = 20;
/** The forms' pair gap (--am-space-12): the least room between two columns (ACC-243). */
const GAP = 12;
/** Sub-pixel layout leaves 11.9999 for a 12px gap; the defect this guards against measured -82. */
const SUBPIXEL = 0.1;
/** The dialog's width at 1280 (its own 560, untouched) and on a 390px phone, where it is the screen's width. */
const WIDTHS = [1280, 390] as const;
const FLOOR = 60;
const TABS: readonly CommitteeFormTab[] = ['identity', 'governance', 'structure'];

const ROW = (id: string, over: Partial<CommitteeListItemDto> = {}): CommitteeListItemDto => ({
  id,
  organizationId: 'org',
  nameEn: `Committee ${id}`,
  nameAr: null,
  typeValueId: 'type-1',
  purpose: null,
  quorumCount: 0,
  meetingFrequency: 'MONTHLY',
  parentCommitteeId: null,
  orgUnitId: 'unit-root',
  termsOfReferenceDocumentId: null,
  reportingToCommitteeId: null,
  formedAt: null,
  dissolvedAt: null,
  isActive: true,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  memberCount: 7,
  currentStageNameEn: 'Formation',
  currentStageNameAr: 'التشكيل',
  stageRules: FORMATION_RULES,
  isDissolving: false,
  typeValue: null,
  ...over,
});

// The drawing's committee, with the longest values a real one carries.
const EDITING: CommitteeDetailDto = {
  ...ROW('self', {
    nameEn: 'Patient Experience and Family Engagement Committee',
    nameAr: 'لجنة تجربة المريض وإشراك الأسرة',
    purpose:
      'Oversees how patients and families experience care: complaints, surveys and service recovery, and reports what it finds to the Quality and Patient Safety Council every quarter.',
    parentCommitteeId: 'council',
    reportingToCommitteeId: 'council',
  }),
};
const LIST = [
  EDITING,
  ROW('council', { nameEn: 'Quality & Patient Safety Council', nameAr: 'مجلس الجودة وسلامة المرضى' }),
  ROW('mec', { nameEn: 'Medical Executive Committee', nameAr: 'اللجنة التنفيذية الطبية' }),
];

describe('CommitteeForm — three tabs against the 420px body cap (ACC-238)', () => {
  preserveDocumentLanguage();

  let fixture: ComponentFixture<CommitteeFormComponent>;
  const measured: string[] = [];

  async function open(
    language: 'en' | 'ar',
    update = () => of(EDITING) as never,
    editing: CommitteeDetailDto | null = EDITING,
  ): Promise<CommitteeFormComponent> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CommitteeFormComponent],
      providers: [
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        {
          provide: CommitteeService,
          useValue: {
            listCommittees: () => of(LIST),
            // ACC-255 (plan §10.5) — the dialog's types and units, in one read.
            formChoices: () =>
              of({
                committeeTypes: [{ id: 'type-1', labelEn: 'Standing committee', labelAr: 'لجنة دائمة' }],
                orgUnits: [{ id: 'unit-root', nameEn: 'Al Nakheel Specialist Hospital', nameAr: 'مستشفى النخيل التخصصي', parentId: null, isActive: true }],
              }),
            update,
            create: update,
            getById: () => of(EDITING),
          },
        },
        { provide: LookupService, useValue: { getValues: () => of([{ id: 'type-1', labelEn: 'Standing committee', labelAr: 'لجنة دائمة' }]) } },
        {
          provide: OrgUnitService,
          useValue: {
            getFlat: () => of([{ id: 'unit-root', nameEn: 'Al Nakheel Specialist Hospital', nameAr: 'مستشفى النخيل التخصصي', parentId: null, isActive: true }]),
          },
        },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    document.documentElement.dir = TestBed.inject(LanguageService).isRtl() ? 'rtl' : 'ltr';
    fixture = TestBed.createComponent(CommitteeFormComponent);
    fixture.componentRef.setInput('committee', editing);
    fixture.componentRef.setInput('visible', true);
    await settle();
    return fixture.componentInstance;
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
  }

  function body(): HTMLElement {
    const el = document.querySelector<HTMLElement>('.am-dialog__body');
    expect(el).withContext('.am-dialog__body not found — did the shell change?').not.toBeNull();
    return el!;
  }
  const panel = (tab: CommitteeFormTab) => document.querySelector<HTMLElement>(`[data-cf-panel="${tab}"]`)!;

  /** Each tab's own height, and the body's with each tab showing. */
  async function heights(f: CommitteeFormComponent): Promise<Record<CommitteeFormTab, { panel: number; body: number }>> {
    const out = {} as Record<CommitteeFormTab, { panel: number; body: number }>;
    for (const tab of TABS) {
      f.tab.set(tab);
      await settle();
      out[tab] = { panel: Math.round(panel(tab).getBoundingClientRect().height), body: body().scrollHeight };
    }
    return out;
  }

  function assertFits(label: string, language: string, h: Record<CommitteeFormTab, { panel: number; body: number }>): void {
    // Non-vacuity: laid out, and three different heights (one tab can't stand in for all).
    for (const tab of TABS) expect(h[tab].panel).withContext(`${label} ${tab} [${language}] is not laid out`).toBeGreaterThan(FLOOR);
    expect(new Set(TABS.map((t) => h[t].panel)).size).withContext(`${label} [${language}] three tabs, three heights`).toBe(3);

    const tallest = Math.max(...TABS.map((t) => h[t].panel));
    for (const tab of TABS) {
      measured.push(`${label} · ${tab} [${language}]: panel ${h[tab].panel}px, body ${h[tab].body}px`);
      expect(h[tab].panel + ROOM).withContext(`${label} ${tab} [${language}] panel ${h[tab].panel}px`).toBeLessThanOrEqual(CAP);
      expect(h[tab].body + ROOM).withContext(`${label} ${tab} [${language}] body ${h[tab].body}px`).toBeLessThanOrEqual(CAP);
      // The body holds the tallest tab: never shorter than it…
      expect(h[tab].body).withContext(`${label} ${tab} [${language}] body below the tallest tab`).toBeGreaterThanOrEqual(tallest);
    }
    // …and the same on every tab, so the footer does not move as the reader switches.
    expect(new Set(TABS.map((t) => h[t].body)).size).withContext(`${label} [${language}] one body height for all tabs`).toBe(1);
  }

  /**
   * ACC-243 — at 390 the dialog is the screen's width (PrimeNG's own
   * breakpoint), measured live. A Karma window cannot be 390 wide, so the
   * dialog is given that width; at 1280 it keeps its own 560.
   */
  async function atWidth(width: (typeof WIDTHS)[number]): Promise<void> {
    if (width === 390) document.querySelector<HTMLElement>('.p-dialog')!.style.width = '390px';
    await settle();
    await dialogStill();
  }

  /**
   * Boxes are read only once the dialog has stopped animating. PrimeNG opens it
   * with a scale transform, and a box read mid-way is that much smaller: the
   * 12px gap read as 11.16 (scale 0.93) before this wait. Heights are read with
   * scrollHeight, which a transform does not change.
   */
  async function dialogStill(): Promise<void> {
    const dialog = document.querySelector<HTMLElement>('.p-dialog')!;
    for (let i = 0; i < 100; i++) {
      // Its drawn width equals its laid-out width once no scale applies (a
      // resting transform may remain, so the transform itself is not read).
      if (Math.abs(dialog.getBoundingClientRect().width - dialog.offsetWidth) <= 0.01) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    fail('the dialog never stopped animating');
  }

  /**
   * Each visible field's CONTROL box: the union of the control area and every
   * control inside it — the inner input included. The field wrapper alone
   * cannot see the defect ACC-243 fixed: the wrapper fitted its column while
   * PrimeNG's number input inside it ran 94px out of it.
   */
  function controlBoxes(tab: CommitteeFormTab): { name: string; l: number; r: number; t: number; b: number }[] {
    return Array.from(panel(tab).querySelectorAll<HTMLElement>('[data-cf-field]')).map((field) => {
      const parts = [field.querySelector('.am-field__control'), ...Array.from(field.querySelectorAll('.am-field__control input, .am-field__control textarea, .am-field__control .p-inputnumber, .am-field__control .am-overlay-select-trigger'))]
        .filter((el): el is Element => !!el)
        .map((el) => el.getBoundingClientRect());
      return {
        name: field.getAttribute('data-cf-field')!,
        l: Math.min(...parts.map((r) => r.left)),
        r: Math.max(...parts.map((r) => r.right)),
        t: Math.min(...parts.map((r) => r.top)),
        b: Math.max(...parts.map((r) => r.bottom)),
      };
    });
  }

  /** No two fields' boxes overlap; two side by side keep at least the form gap; nothing leaves the body. */
  function assertNoOverlap(label: string, tab: CommitteeFormTab): number[] {
    const boxes = controlBoxes(tab);
    expect(boxes.length).withContext(`${label} ${tab}: fields found`).toBeGreaterThan(0);
    for (const box of boxes) expect(box.r - box.l).withContext(`${label} ${tab} ${box.name} is laid out`).toBeGreaterThan(40);
    const gaps: number[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const sameRow = a.t < b.b && b.t < a.b;
        if (!sameRow) continue;
        const gap = Math.max(b.l - a.r, a.l - b.r);
        gaps.push(Math.round(gap));
        expect(gap).withContext(`${label} ${tab}: ${a.name} and ${b.name} ${gap < 0 ? 'overlap' : 'gap'} ${Math.round(gap)}px`).toBeGreaterThanOrEqual(GAP - SUBPIXEL);
      }
    }
    const b = body();
    const inner = b.getBoundingClientRect();
    for (const box of boxes) {
      expect(box.l).withContext(`${label} ${tab} ${box.name} starts inside the body`).toBeGreaterThanOrEqual(Math.floor(inner.left));
      expect(box.r).withContext(`${label} ${tab} ${box.name} ends inside the body`).toBeLessThanOrEqual(Math.ceil(inner.right));
    }
    expect(b.scrollWidth).withContext(`${label} ${tab}: no sideways scroll`).toBeLessThanOrEqual(b.clientWidth);
    return gaps;
  }

  afterAll(() => {
    // The numbers recorded in step-238-committee-changes.md §11.
    console.log(`ACC-238 measurements\n${measured.join('\n')}`);
  });

  for (const language of ['en', 'ar'] as const) {
    describe(language, () => {
      it('every tab fits with room, and the body holds the tallest tab', async () => {
        const f = await open(language);
        assertFits('edit', language, await heights(f));
      });

      it('with every error showing after Save, every tab still fits (errors replace hints)', async () => {
        const f = await open(language);
        f.form.patchValue({ nameEn: '', typeValueId: null, orgUnitId: null });
        f.submit();
        await settle();
        assertFits('errors', language, await heights(f));
      });

      it('Reports to filled in from the parent still fits', async () => {
        const f = await open(language);
        f.form.patchValue({ parentCommitteeId: null, reportingToCommitteeId: null });
        f.form.controls.parentCommitteeId.setValue('mec');
        await settle();
        expect(f.reportsToPrefilled()).toBe(true);
        assertFits('reports-to filled in', language, await heights(f));
      });

      // ACC-243 — the two-column rows, on every tab, at both widths, for Edit
      // and for New committee (the same tabs). Heights are asserted again at
      // each width: the body never scrolls, holds one height, keeps its room.
      for (const width of WIDTHS) {
        for (const mode of ['edit', 'new'] as const) {
          it(`${mode} at ${width}: no two fields overlap, columns keep the form gap, and every tab still fits`, async () => {
            const f = await open(language, undefined, mode === 'edit' ? EDITING : null);
            await atWidth(width);
            const sideBySide: string[] = [];
            for (const tab of TABS) {
              f.tab.set(tab);
              await settle();
              const gaps = assertNoOverlap(`${mode} ${width}`, tab);
              if (gaps.length) sideBySide.push(`${tab} ${gaps.join('/')}px`);
            }
            // Non-vacuity: Identity (the names) and Governance (quorum and
            // frequency) each have a row of two, so the gap rule was exercised.
                    expect(sideBySide.length).withContext(`${mode} ${width} [${language}] side-by-side rows measured`).toBe(2);
            measured.push(`${mode} at ${width} [${language}] column gaps: ${sideBySide.join(', ')}`);
            const h = await heights(f);
            assertFits(`${mode} at ${width}`, language, h);
          });
        }
      }

      // ACC-243 — the ✕ is level with the title, and the tab underline spans
      // the header's full content width (it used to stop where the ✕'s
      // column began, and the ✕ sat 36px below the title).
      it('the ✕ is level with the title, and the tab strip spans the header', async () => {
        await open(language);
        await dialogStill();
        const header = document.querySelector<HTMLElement>('.p-dialog-header')!;
        const cs = getComputedStyle(header);
        const h = header.getBoundingClientRect();
        const contentLeft = h.left + parseFloat(cs.paddingLeft);
        const contentRight = h.right - parseFloat(cs.paddingRight);
        const title = document.querySelector('.p-dialog-title')!.getBoundingClientRect();
        const close = document.querySelector('.am-dialog__close')!.getBoundingClientRect();
        const strip = document.querySelector('[role="tablist"]')!.getBoundingClientRect();
        expect(title.height).withContext('the title is laid out').toBeGreaterThan(10);
        expect(Math.abs((close.top + close.bottom) / 2 - (title.top + title.bottom) / 2)).withContext('✕ centre against title centre').toBeLessThanOrEqual(1);
        expect(Math.abs(strip.left - contentLeft)).withContext('strip starts at the header content edge').toBeLessThanOrEqual(1);
        expect(Math.abs(strip.right - contentRight)).withContext('strip ends at the header content edge').toBeLessThanOrEqual(1);
        measured.push(`header [${language}]: title centre ${((title.top + title.bottom) / 2).toFixed(1)}, ✕ centre ${((close.top + close.bottom) / 2).toFixed(1)}; strip ${strip.left.toFixed(0)}–${strip.right.toFixed(0)} of ${contentLeft.toFixed(0)}–${contentRight.toFixed(0)}`);
      });

      it('someone else saved first: the footer line does not grow the body', async () => {
        const f = await open(language, () => throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'COMMITTEE_CHANGED' } })) as never);
        const before = body().scrollHeight;
        f.submit();
        await settle();
        expect(document.querySelector('[data-cf-reload]')).not.toBeNull();
        expect(body().scrollHeight).withContext(`[${language}] body before/after the conflict`).toBe(before);
        measured.push(`conflict [${language}]: body ${before}px before, ${body().scrollHeight}px after`);
      });
    });
  }
});
