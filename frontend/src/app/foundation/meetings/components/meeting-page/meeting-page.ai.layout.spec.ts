import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { of } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';
import { LanguageService } from '../../../../core/services/language.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { useLayoutFonts } from '../../../../../testing/layout-fonts';
import { WorkflowService } from '../../../workflow/services/workflow.service';
import { aMeeting, aMinutes, aMinutesItem, anAi, anAiAction, anAttendanceRow } from '../../meeting-fixtures.testing';
import { MeetingService, type MeetingAiDto } from '../../services/meeting.service';
import { MeetingPageComponent } from './meeting-page.component';

// ACC-322 PR 2 — the minutes with Draft minutes' suggestions, MEASURED at 1280
// and on a 390 phone, in both languages: the Rough notes box and its trigger,
// an item's minutes suggestion (a vote flagged M6, the M5 line), three action
// suggestions (one complete, one with an outside guest, one with a date that
// has passed), the inline Edit row, and the Action items card. Nothing is
// wider than its column or cut, and on the phone every button is 44px tall.
// NON-VACUITY FIRST (ACC-120): every part measured is really drawn.

@Component({
  standalone: true,
  imports: [MeetingPageComponent],
  template: `<div class="am-test-frame"><app-meeting-page /></div>`,
  styles: [':host { display: block; } .am-test-frame { inline-size: var(--frame); background: #fff; }'],
})
class Host {}

const MINUTES = aMinutes({
  attendance: [
    anAttendanceRow({ attendance: 'PRESENT' }),
    anAttendanceRow({ attendeeId: 'a-2', userId: 'u-2', name: 'Huda Al-Harbi', seat: { id: 'seat-sec', labelEn: 'Secretary', labelAr: 'أمين السر' }, attendance: 'PRESENT' }),
    anAttendanceRow({ attendeeId: 'a-3', kind: 'ORG_GUEST', userId: 'u-3', name: 'Eng. Khalid Al-Shehri', seat: null, attendance: 'PRESENT' }),
  ],
  items: [
    aMinutesItem({
      title: 'Hand-hygiene compliance, Q3',
      discussion: 'Compliance rose to 84%.',
      actionItems: [{ id: 'act-1', title: 'Re-audit wards 4B and 6A', owner: { id: 'u-2', name: 'Huda Al-Harbi' }, dueAt: '2027-04-30T13:00:00.000Z', task: null }],
    }),
  ],
});

function aiFor(language: 'en' | 'ar'): MeetingAiDto {
  const ar_ = language === 'ar';
  return anAi({
    notes: ar_ ? 'البند ٢: ارتفع الامتثال إلى ٨٤٪ مقابل هدف ٩٠٪. التصويت ٥-٢-٠.' : 'Item 2: compliance up to 84% vs 90% target. Re-audit 4B and 6A in Nov. Vote 5-2-0.',
    presentMembers: 2,
    undecided: 4,
    suggestions: {
      minutes: [
        {
          id: 'ai-min-1',
          agendaItemId: 'i-1',
          language,
          nothing: false,
          discussion: ar_ ? 'ارتفع الامتثال إلى 84% مقابل هدف 90%. الجناحان 4B و6A دون 75%.' : 'Compliance rose to 84% against a 90% target. Wards 4B and 6A are below 75%.',
          decisions: [
            {
              text: ar_ ? 'إعادة تدقيق 4B و6A في نوفمبر. يقدّم مديرا الجناحين خطط العمل في اجتماع أكتوبر.' : 'Re-audit 4B and 6A in November. Ward managers present action plans at the October meeting.',
              votes: { for: 5, against: 2, abstain: 0 },
              abovePresent: true,
            },
          ],
          replaces: { discussion: true, decisions: false },
        },
      ],
      actions: [
        anAiAction({ id: 'ai-a1', title: ar_ ? 'إصلاح إنذار الضغط السلبي، الغرفة 3' : 'Repair negative-pressure alarm, room 3' }),
        anAiAction({ id: 'ai-a2', title: ar_ ? 'إرسال بيانات زمن إنجاز المختبر' : 'Send lab turnaround data', owner: null, ownerReason: { code: 'OUTSIDE_GUEST', name: ar_ ? 'د. لينا منصور' : 'Dr. Lina Mansour' }, dueAt: null }),
        anAiAction({ id: 'ai-a3', title: ar_ ? 'تحديث أداة تدقيق نظافة اليدين' : 'Update hand-hygiene audit tool', dueAt: null, dueReason: { code: 'DATE_PASSED', day: '2026-09-15' } }),
      ],
    },
  });
}

describe('Meeting page — Draft minutes suggestions, measured (ACC-322 PR 2)', () => {
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();
  const measured: string[] = [];
  let current: ComponentFixture<Host> | null = null;
  afterAll(() => console.log(`ACC-322 minutes AI on the meeting page:\n  ${measured.join('\n  ')}`));

  async function open(language: 'en' | 'ar', width: number): Promise<HTMLElement> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        ConfirmationService,
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'm-1' }) } } },
        {
          provide: MeetingService,
          useValue: {
            get: () => of(aMeeting({ stage: { id: 's-draft', nameEn: 'Minutes Draft', nameAr: 'مسودة المحضر', flags: [] } })),
            attendees: () => of([]),
            agenda: () => of([{ id: 'i-1', order: 1, title: MINUTES.items[0]!.title, description: null, durationMinutes: null, standing: false, presenter: null }]),
            files: () => of({ attachments: [], papers: [] }),
            minutes: () => of(MINUTES),
            openActions: () => of({ mayRead: true, rows: [] }),
            ai: () => of(aiFor(language)),
          },
        },
        { provide: WorkflowService, useValue: { getInstancesByObject: () => of([]) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    document.documentElement.dir = TestBed.inject(LanguageService).isRtl() ? 'rtl' : 'ltr';
    const fixture = TestBed.createComponent(Host);
    current = fixture;
    const host = fixture.nativeElement as HTMLElement;
    host.style.setProperty('--frame', `${width}px`);
    document.body.appendChild(host);
    await render(fixture);
    return host;
  }

  async function render(fixture: ComponentFixture<Host>): Promise<void> {
    // Not whenStable(): the page keeps a timer (attendance opens at the start time).
    for (let i = 0; i < 4; i++) {
      fixture.detectChanges();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    await document.fonts.ready;
    fixture.detectChanges();
  }

  afterEach(() => {
    const el = current?.nativeElement as HTMLElement | undefined;
    current?.destroy();
    el?.remove();
    current = null;
  });

  const box = (el: Element | null) => el!.getBoundingClientRect();

  /** Nothing inside wider than its own box: no text or control cut off or run sideways. */
  function overflowing(root: Element): string[] {
    return Array.from(root.querySelectorAll<HTMLElement>('*'))
      .filter((e) => e.offsetParent !== null && getComputedStyle(e).overflowX !== 'visible' && e.scrollWidth > e.clientWidth + 1)
      .map((e) => `${e.tagName.toLowerCase()}.${e.className}`.slice(0, 80));
  }

  for (const language of ['en', 'ar'] as const) {
    for (const width of [1280, 390] as const) {
      it(`[${language}, ${width}]: the notes, the suggestions, the inline Edit and the Action items card fit, nothing cut`, async () => {
        const host = await open(language, width);
        const page = host.querySelector('[data-testid="meeting-page"]')!;
        const notes = host.querySelector('[data-testid="meeting-rough-notes"]');
        const trigger = host.querySelector('[data-testid="meeting-ai-draft"] .am-ai__trigger');
        const minutes = host.querySelector('[data-ai-minutes] .am-ai__result');
        const actions = host.querySelector('[data-ai-actions] .am-ai__result');
        const card = host.querySelector('[data-testid="meeting-action-items"]');
        const count = host.querySelector('[data-testid="meeting-agenda-ai-count"]');
        // Non-vacuity: every part is drawn, with a size.
        for (const [name, el] of [['notes', notes], ['trigger', trigger], ['minutes suggestion', minutes], ['action suggestions', actions], ['action items card', card], ['header count', count]] as const) {
          expect(el).withContext(`${name} drawn`).not.toBeNull();
          expect(box(el).width).withContext(`${name} width`).toBeGreaterThan(0);
          expect(box(el).height).withContext(`${name} height`).toBeGreaterThan(0);
        }
        expect(host.querySelectorAll('[data-ai-action]').length).withContext('three action rows').toBe(3);
        expect(host.querySelector('[data-ai-votes-above]')).withContext('the M6 flag').not.toBeNull();
        expect(host.querySelector('[data-ai-replaces]')).withContext('the M5 line').not.toBeNull();

        expect(page.scrollWidth).withContext('nothing wider than the page').toBeLessThanOrEqual(box(page).width + 0.5);
        for (const part of [notes!, minutes!, actions!, card!]) {
          expect(box(part).right).withContext('inside the page').toBeLessThanOrEqual(box(page).right + 0.5);
          expect(box(part).left).withContext('inside the page').toBeGreaterThanOrEqual(box(page).left - 0.5);
          expect(overflowing(part)).withContext('nothing cut').toEqual([]);
        }
        if (width === 390) {
          const buttons = Array.from(host.querySelectorAll<HTMLElement>('[data-testid="meeting-rough-notes"] button, [data-ai-suggestion] button')).filter((b) => b.offsetParent !== null);
          expect(buttons.length).withContext('buttons to measure').toBeGreaterThan(4);
          for (const b of buttons) expect(box(b).height).withContext(`"${b.textContent?.trim()}" height`).toBeGreaterThanOrEqual(44 - 0.5);
        }

        // The inline Edit row, opened on the outside-guest suggestion (Owner and Due to choose).
        host.querySelector<HTMLButtonElement>('[data-ai-action="ai-a2"] [data-ai-edit] button')!.click();
        await render(current!);
        const row = host.querySelector('[data-ai-edit-row]');
        expect(row).withContext('the inline Edit row').not.toBeNull();
        expect(box(row).width).toBeGreaterThan(0);
        expect(box(row).right).withContext('the Edit row inside the page').toBeLessThanOrEqual(box(page).right + 0.5);
        expect(overflowing(row!)).withContext('nothing cut in the Edit row').toEqual([]);
        expect(page.scrollWidth).withContext('nothing wider than the page, editing').toBeLessThanOrEqual(box(page).width + 0.5);

        measured.push(
          `[${language}, ${width}] notes ${Math.round(box(notes).height)}px, minutes suggestion ${Math.round(box(minutes).height)}px, ` +
            `actions ${Math.round(box(actions).height)}px, Edit row ${Math.round(box(row).height)}px, card ${Math.round(box(card).height)}px; widest column ${Math.round(box(page).width)}px`,
        );
      }, 60_000);
    }
  }
});
