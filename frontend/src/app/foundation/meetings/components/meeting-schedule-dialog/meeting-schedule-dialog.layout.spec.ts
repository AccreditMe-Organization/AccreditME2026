import { Component, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { useLayoutFonts } from '../../../../../testing/layout-fonts';
import { CAP, DialogLayout, ROOM, WIDTHS, Width } from '../../meeting-dialog-layout.testing';
import type { MeetingDto } from '../../services/meeting.service';
import { MeetingScheduleDialogComponent, ScheduleOwner } from './meeting-schedule-dialog.component';

// ACC-316 PR 6 — Schedule meeting (step 1, one meeting) against the 420px body
// cap (ACC-111), MEASURED in both languages, in the real theme and font, at
// 1280 (the form dialog's 560) and on a 390 phone.
//
// For a committee (type and duration on one row) and for a unit (a third
// column, its own quorum): empty; pressed with nothing filled (every error
// showing, the place line in red); filled with realistic values; the calendar,
// which takes the body's place; and refused by the server (its sentence under
// the form). Each body keeps 20px under the cap and scrolls nowhere.
// NON-VACUITY FIRST (ACC-120): a body that measured 0 would pass.

const OWNERS: Record<'COMMITTEE' | 'UNIT', Record<'en' | 'ar', ScheduleOwner>> = {
  COMMITTEE: {
    en: { kind: 'COMMITTEE', id: 'c-1', name: 'Pharmacy and Therapeutics Committee' },
    ar: { kind: 'COMMITTEE', id: 'c-1', name: 'لجنة الصيدلة والعلاجات' },
  },
  UNIT: {
    en: { kind: 'UNIT', id: 'u-1', name: 'Quality and Patient Safety Department' },
    ar: { kind: 'UNIT', id: 'u-1', name: 'إدارة الجودة وسلامة المرضى' },
  },
};
const TYPES = [
  { id: 't-1', labelEn: 'Regular', labelAr: 'اعتيادي' },
  { id: 't-2', labelEn: 'Extraordinary', labelAr: 'استثنائي' },
  { id: 't-3', labelEn: 'Emergency', labelAr: 'طارئ' },
  { id: 't-4', labelEn: 'Annual review', labelAr: 'مراجعة سنوية' },
  { id: 't-5', labelEn: 'Workshop', labelAr: 'ورشة عمل' },
];
const FILLED = {
  en: { title: 'Quarterly review of high-alert medication incidents', location: 'Board room, Tower B, floor 3' },
  ar: { title: 'المراجعة الربعية لحوادث الأدوية عالية الخطورة', location: 'قاعة مجلس الإدارة، البرج ب، الطابق 3' },
};

@Component({
  standalone: true,
  imports: [MeetingScheduleDialogComponent],
  template: `<app-meeting-schedule-dialog [visible]="true" [owner]="owner()" />`,
})
class Host {
  readonly owner = signal<ScheduleOwner | null>(null);
}

describe('Schedule meeting dialog — layout, measured (ACC-316 PR 6)', () => {
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();
  const layout = new DialogLayout<Host>();
  let respond: () => Observable<MeetingDto>;

  afterAll(() => console.log(`ACC-316 schedule meeting dialog (cap ${CAP}, room ≥ ${ROOM}):\n  ${layout.measured.join('\n  ')}`));
  afterEach(() => layout.destroy());

  async function open(kind: 'COMMITTEE' | 'UNIT', language: 'en' | 'ar', width: Width): Promise<MeetingScheduleDialogComponent> {
    respond = () => of({ id: 'm-1' } as MeetingDto);
    await layout.open(Host, language, width, { formChoices: () => of({ types: TYPES }), schedule: () => respond() }, (h) => h.owner.set(OWNERS[kind][language]));
    return layout.fixture.debugElement.query(By.directive(MeetingScheduleDialogComponent)).componentInstance;
  }

  async function fill(dialog: MeetingScheduleDialogComponent, language: 'en' | 'ar'): Promise<void> {
    dialog.form.patchValue({ unitQuorum: dialog.owner()?.kind === 'UNIT' ? '5' : '', title: FILLED[language].title, typeValueId: 't-4', durationMinutes: 90, time: '13:30', location: FILLED[language].location, meetingUrl: 'https://teams.example.org/l/meetup-join/19%3ameeting_quarterly' });
    dialog.pickDay(new Date(2027, 2, 18));
    await layout.settle();
    await layout.still();
  }

  for (const kind of ['COMMITTEE', 'UNIT'] as const) {
    for (const language of ['en', 'ar'] as const) {
      for (const width of WIDTHS) {
        it(`${kind.toLowerCase()} [${language}, ${width}]: empty, with every error, filled, the calendar, refused`, async () => {
          const dialog = await open(kind, language, width);
          const label = kind.toLowerCase();
          // Non-vacuity: the owner is named in the header, and the fields are there.
          expect(document.querySelector('.am-dialog__context')?.textContent).toContain(OWNERS[kind][language].name);
          expect(document.querySelector('[data-testid="schedule-title"]')).not.toBeNull();
          expect(!!document.querySelector('[data-testid="schedule-quorum"]')).withContext('quorum only for a unit').toBe(kind === 'UNIT');
          layout.check(`${label}, empty`, language, width, 560);

          if (kind === 'UNIT') dialog.form.controls.unitQuorum.setValue('zero');
          await layout.click('[data-testid="schedule-submit"] button');
          expect(document.querySelectorAll('.am-field__message--error').length).withContext('subject, type and start errors').toBeGreaterThanOrEqual(kind === 'UNIT' ? 4 : 3);
          layout.check(`${label}, with every error`, language, width, 560);

          await fill(dialog, language);
          expect((document.querySelector<HTMLInputElement>('[data-testid="schedule-day"]')?.value ?? '').length).withContext('the day is shown').toBeGreaterThan(0);
          layout.check(`${label}, filled`, language, width, 560);

          await layout.click('.am-mw__calendar-button');
          expect(document.querySelector('[data-testid="schedule-date-view"]')).withContext('the calendar took the body').not.toBeNull();
          layout.check(`${label}, the calendar`, language, width, 560);
          await layout.click('[data-testid="schedule-date-view"] .am-backlink');

          respond = () => throwError(() => new HttpErrorResponse({ status: 400, error: { code: 'MEETING_TIME_IN_PAST' } }));
          await layout.click('[data-testid="schedule-submit"] button');
          expect(document.querySelector('[data-testid="schedule-error"]')?.textContent?.trim()).withContext('the refusal, in the footer').toBe(language === 'en' ? 'Choose a time in the future.' : 'اختر وقتًا في المستقبل.');
          layout.check(`${label}, refused`, language, width, 560);
        }, 40_000);
      }
    }
  }
});
