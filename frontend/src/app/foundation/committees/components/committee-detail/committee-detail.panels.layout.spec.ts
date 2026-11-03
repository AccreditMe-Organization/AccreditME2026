import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { of } from 'rxjs';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { LanguageService } from '../../../../core/services/language.service';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { CommitteeDetailDto, CommitteeMembershipEventDto, CommitteeService } from '../../services/committee.service';
import { LookupService } from '../../../lookup/services/lookup.service';
import { UserService } from '../../../user/services/user.service';
import { WorkflowService } from '../../../workflow/services/workflow.service';
import { ACTIVE_RULES } from '../../testing';
import { CommitteeDetailComponent } from './committee-detail.component';

// The committee page's panel grid, MEASURED in the real theme, font and
// translations. Members, Tasks, Sub-committees and Change requests were on
// am-capped-panel; Meetings, Documents and Membership history were on the older
// app-record-panel, which did not fill its grid cell and headed in small
// capitals, so Meetings ended short in row 1 and Change requests ran taller
// than its row. All seven are am-capped-panel now, and the grid section is
// data-fill-panels.
//
//   - the panels in each grid row share their top AND bottom edges;
//   - no panel body scrolls (a capped list shows five and offers See all);
//   - Membership history shows five of eight, with "Showing 5 of 8 · See all";
//   - Meetings and Documents keep their two texts in the drawing's empty state.
//
// The widths are the page's content column in a 1280, 1440 and 1920 window
// (988, 1148, 1628) and a 390 phone less its 16px gutters (358), as the other
// committee layout specs measure.
//
// NON-VACUITY FIRST (ACC-120): seven panels exist and have real heights, and a
// wide row really holds more than one panel, before "they line up" may mean
// anything.

const WIDTHS = [
  { name: 'at 1280', width: 988 },
  { name: 'at 1440', width: 1148 },
  { name: 'at 1920', width: 1628 },
  { name: 'at 390', width: 358 },
] as const;

const COMMITTEE: CommitteeDetailDto = {
  id: 'c-1',
  organizationId: 'org',
  nameEn: 'Quality & Patient Safety Committee',
  nameAr: 'لجنة الجودة وسلامة المرضى',
  typeValueId: 'type-1',
  purpose: 'Oversees the hospital-wide quality management system.',
  quorumCount: 3,
  meetingFrequency: 'MONTHLY',
  parentCommitteeId: null,
  orgUnitId: 'unit-1',
  termsOfReferenceDocumentId: null,
  reportingToCommitteeId: null,
  formedAt: null,
  dissolvedAt: null,
  isActive: true,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  isDissolving: false,
  stageRules: ACTIVE_RULES,
  typeValue: { id: 'type-1', key: 'quality', labelEn: 'Quality Committee', labelAr: 'لجنة الجودة', offered: true },
  orgUnit: { id: 'unit-1', nameEn: 'Al Nakheel Specialist Hospital', nameAr: 'مستشفى النخيل التخصصي' },
};

const USERS = [
  { id: 'u-1', name: 'Dr. Hessa Al-Dosari' },
  { id: 'u-2', name: 'Faisal Al-Mutairi' },
  { id: 'u-3', name: 'Noura Al-Shehri' },
];
const SEATS = [
  { id: 'r-chair', labelEn: 'Chairman', labelAr: 'رئيس' },
  { id: 'r-member', labelEn: 'Member', labelAr: 'عضو' },
];

/** Eight events, newest first, so the panel shows five and offers See all. */
const EVENTS: CommitteeMembershipEventDto[] = Array.from({ length: 8 }, (_, i) => ({
  id: `ev-${i}`,
  organizationId: 'org',
  committeeId: 'c-1',
  userId: USERS[i % 3]!.id,
  roleValueId: i % 2 ? 'r-member' : 'r-chair',
  action: (['JOINED', 'ROLE_CHANGED', 'LEFT'] as const)[i % 3]!,
  effectiveDate: `2026-10-${String(20 - i).padStart(2, '0')}`,
  reason: null,
  approvedBy: i % 2 ? 'u-1' : null,
  createdAt: '2026-10-01T00:00:00Z',
}));

const MEMBER_ROWS = Array.from({ length: 7 }, (_, i) => ({
  id: `m-${i}`,
  userId: USERS[i % 3]!.id,
  name: USERS[i % 3]!.name,
  roleValueId: 'r-member',
  roleLabelEn: 'Member',
  roleLabelAr: 'عضو',
  joinedAt: '2026-09-01T00:00:00Z',
}));

@Component({
  standalone: true,
  imports: [CommitteeDetailComponent],
  template: `<div data-host [style.width.px]="width()"><app-committee-detail /></div>`,
})
class PageHost {
  readonly width = input(1148);
}

describe('CommitteeDetailComponent — every panel lines up in its grid row', () => {
  preserveDocumentLanguage();
  let fixture: ComponentFixture<PageHost>;

  async function render(width: number, lang: 'en' | 'ar'): Promise<HTMLElement> {
    TestBed.configureTestingModule({
      imports: [PageHost],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang }),
        provideFormatTesting(),
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        ConfirmationService,
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'c-1' }) }, queryParamMap: of(convertToParamMap({})) } },
        { provide: NavigationAccessService, useValue: { hasPermission: (p: string) => p === 'committees:view' || p === 'committees:add_member' } },
        {
          provide: CommitteeService,
          useValue: {
            getById: () => of(COMMITTEE),
            listCommittees: () => of([]),
            listMembers: () => of([]),
            listMembershipEvents: () => of(EVENTS),
            membersPage: () => of({ items: MEMBER_ROWS.slice(0, 5), total: MEMBER_ROWS.length, matching: MEMBER_ROWS.length }),
            subCommittees: () => of({ items: [], total: 0, matching: 0 }),
          },
        },
        { provide: LookupService, useValue: { getValues: () => of(SEATS) } },
        { provide: UserService, useValue: { listAllUsers: () => of(USERS) } },
        { provide: WorkflowService, useValue: { getInstancesByObject: () => of([]), getStageHistory: () => of(null), getMoves: () => of({ transitionIds: [] }) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    TestBed.inject(LanguageService).use(lang);
    fixture = TestBed.createComponent(PageHost);
    fixture.componentRef.setInput('width', width);
    fixture.detectChanges();
    await document.fonts.ready;
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      fixture.detectChanges();
    }
    return fixture.nativeElement.querySelector('[data-host]') as HTMLElement;
  }

  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  /** Each grid cell and the panel frame drawn inside it. */
  function cells(host: HTMLElement): { cell: HTMLElement; frame: HTMLElement }[] {
    const grid = host.querySelector<HTMLElement>('[data-committee-panels]')!;
    expect(grid).withContext('the panel grid').not.toBeNull();
    return Array.from(grid.children as HTMLCollectionOf<HTMLElement>).map((cell) => ({
      cell,
      frame: cell.querySelector<HTMLElement>('.am-cp')!,
    }));
  }

  for (const lang of ['en', 'ar'] as const) {
    for (const w of WIDTHS) {
      it(`${w.name} [${lang}]: the panels in each row share top and bottom edges, and no body scrolls`, async () => {
        const host = await render(w.width, lang);
        const all = cells(host);

        // ── Non-vacuity ──
        expect(all.length).withContext('seven panels').toBe(7);
        for (const { cell, frame } of all) {
          expect(frame).withContext(`${cell.tagName} draws an am-capped-panel frame`).not.toBeNull();
          expect(frame.getBoundingClientRect().height).withContext(`${cell.tagName} has a real height`).toBeGreaterThan(200);
        }
        expect(host.querySelector('[data-committee-panels] app-record-panel')).withContext('no older record panel in the grid').toBeNull();

        // ── Rows: group by top edge ──
        const rows = new Map<number, { cell: HTMLElement; frame: HTMLElement }[]>();
        for (const c of all) {
          const top = Math.round(c.cell.getBoundingClientRect().top);
          const key = [...rows.keys()].find((k) => Math.abs(k - top) <= 1) ?? top;
          rows.set(key, [...(rows.get(key) ?? []), c]);
        }
        if (w.width >= 900) expect([...rows.values()].some((r) => r.length > 1)).withContext('a wide row holds several panels').toBeTrue();
        if (w.width < 400) expect(rows.size).withContext('one panel per row on a phone').toBe(7);

        for (const row of rows.values()) {
          const boxes = row.map((c) => c.frame.getBoundingClientRect());
          const name = (i: number) => row[i]!.cell.tagName.toLowerCase() + (row[i]!.cell.getAttribute('testidprefix') ?? '');
          for (let i = 1; i < boxes.length; i++) {
            expect(Math.abs(boxes[i]!.top - boxes[0]!.top)).withContext(`${name(i)} top vs ${name(0)}`).toBeLessThanOrEqual(1);
            expect(Math.abs(boxes[i]!.bottom - boxes[0]!.bottom)).withContext(`${name(i)} bottom vs ${name(0)}`).toBeLessThanOrEqual(1);
          }
          // Each frame fills its cell.
          row.forEach((c, i) => {
            const cellBox = c.cell.getBoundingClientRect();
            expect(Math.abs(boxes[i]!.bottom - cellBox.bottom)).withContext(`${name(i)} fills its cell`).toBeLessThanOrEqual(1);
          });
        }

        // ── No panel body scrolls, and nothing spills out of a frame ──
        for (const { frame, cell } of all) {
          const scrollers = Array.from(frame.querySelectorAll<HTMLElement>('*')).filter((el) => {
            const oy = getComputedStyle(el).overflowY;
            return (oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1;
          });
          expect(scrollers.length).withContext(`${cell.tagName} has no scrolling body`).toBe(0);
          const body = frame.querySelector<HTMLElement>('.am-cp__body')!;
          expect(body.scrollHeight).withContext(`${cell.tagName} body holds its content`).toBeLessThanOrEqual(body.clientHeight + 1);
        }
      });
    }

    // The panels above line up because each has the same fixed height, which
    // would pass even if none filled its cell. Here one cell is made taller
    // than its panel: every panel in that row must still reach the row's
    // bottom, which only data-fill-panels makes true.
    it(`[${lang}] a row taller than its panels: every panel still fills its cell`, async () => {
      const host = await render(1148, lang);
      const all = cells(host);
      const first = all[0]!;
      first.cell.style.minBlockSize = `${Math.round(first.frame.getBoundingClientRect().height) + 120}px`;
      fixture.detectChanges();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const top = first.cell.getBoundingClientRect().top;
      const row = all.filter((c) => Math.abs(c.cell.getBoundingClientRect().top - top) <= 1);
      expect(row.length).withContext('non-vacuity: the row holds several panels').toBeGreaterThan(1);
      const bottom = first.cell.getBoundingClientRect().bottom;
      for (const c of row) {
        expect(Math.abs(c.frame.getBoundingClientRect().bottom - bottom))
          .withContext(`${c.cell.tagName} reaches the row's bottom`)
          .toBeLessThanOrEqual(1);
      }
    });

    it(`[${lang}] the moved panels keep their texts, head like the others, and Membership history caps at five`, async () => {
      const host = await render(1148, lang);
      const t = lang === 'en' ? en.committee : ar.committee;
      const text = (sel: string) => host.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim();

      // Meetings and Documents: the drawing's empty state, both texts kept.
      expect(text('[data-testid="committee-meetings-empty"] .am-cp__empty-title')).toBe(t.noMeetings);
      expect(text('[data-testid="committee-meetings-empty"] .am-cp__empty-body')).toBe(t.meetingsDescription);
      expect(text('[data-testid="committee-documents-empty"] .am-cp__empty-title')).toBe(t.noDocuments);
      expect(text('[data-testid="committee-documents-empty"] .am-cp__empty-body')).toBe(t.documentsDescription);

      // Every heading is the capped panel's: same size and weight, no small capitals.
      const titles = Array.from(host.querySelectorAll<HTMLElement>('[data-committee-panels] .am-cp__title'));
      expect(titles.length).toBe(7);
      const styles = titles.map((h) => {
        const cs = getComputedStyle(h);
        return `${cs.fontSize} ${cs.fontWeight} ${cs.textTransform} ${cs.fontVariantCaps}`;
      });
      expect(new Set(styles).size).withContext(`one heading style: ${[...new Set(styles)].join(' | ')}`).toBe(1);
      expect(styles[0]).not.toContain('uppercase');
      expect(styles[0]).not.toContain('small-caps');
      expect(titles.map((h) => h.textContent!.trim())).toContain(t.membershipHistory);

      // Membership history: five of eight, newest first, with See all.
      const rows = host.querySelectorAll('[data-history-row]');
      expect(rows.length).toBe(5);
      expect(rows[0]!.getAttribute('data-history-row')).toBe('ev-0');
      // The action as a verbal noun, so the Arabic is gender-neutral («انضمام», «مغادرة»).
      expect(text('[data-history-row="ev-0"] .am-cp-l2')).toContain(t.action.joined);
      expect(text('[data-history-row="ev-2"] .am-cp-l2')).toContain(t.action.left);
      expect(text('[data-testid="committee-history-count"]')).toBe('8');
      expect(host.querySelector('[data-testid="committee-history-see-all"]')).not.toBeNull();
    });
  }
});
