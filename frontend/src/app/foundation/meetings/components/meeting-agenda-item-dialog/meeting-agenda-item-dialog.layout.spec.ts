import { Component, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { useLayoutFonts } from '../../../../../testing/layout-fonts';
import { CAP, DialogLayout, ROOM, WIDTHS } from '../../meeting-dialog-layout.testing';
import { aMeeting, anAttendee } from '../../meeting-fixtures.testing';
import type { MeetingAgendaItemDto } from '../../services/meeting.service';
import { MeetingAgendaItemDialogComponent } from './meeting-agenda-item-dialog.component';

// ACC-316 PR 7 — Agenda item against the 420px body cap (ACC-111), MEASURED in
// both languages, in the real theme and font, at 1280 (the form's 560) and on a
// 390 phone: added empty; pressed with no title (its error); filled with a long
// title and description and a presenter found by name (the "added as a guest"
// line under Presenter); refused (said in the footer, never the body); and an
// item edited. The design measured 301 / 322. Each body keeps 20px under the cap
// and scrolls nowhere but its description, and nothing runs sideways.
// NON-VACUITY FIRST (ACC-120): a body that measured 0 would pass.

const FILLED = {
  en: { title: 'Negative-pressure alarm in isolation room 3, Tower A: status, root cause and repair date', description: 'The alarm sounded twice in October. Facilities to report the sensor test results, the contractor\'s findings and the date the repair will be signed off.' },
  ar: { title: 'إنذار الضغط السلبي في غرفة العزل 3، البرج أ: الحالة والسبب الجذري وموعد الإصلاح', description: 'انطلق الإنذار مرتين في أكتوبر. تعرض إدارة المرافق نتائج اختبار الحساس وما توصل إليه المقاول وموعد اعتماد الإصلاح.' },
};
const ITEM: MeetingAgendaItemDto = { id: 'i-4', order: 4, title: 'Isolation room maintenance', description: 'Status and repair date.', durationMinutes: 10, standing: false, presenter: { attendeeId: 'a-1', name: 'Dr. Nora Al-Otaibi', kind: 'MEMBER' } };

@Component({
  standalone: true,
  imports: [MeetingAgendaItemDialogComponent],
  template: `<app-meeting-agenda-item-dialog [visible]="true" [meeting]="meeting" [item]="item()" [position]="item() ? 4 : 5" [attendees]="attendees" />`,
})
class Host {
  readonly meeting = aMeeting();
  readonly item = signal<MeetingAgendaItemDto | null>(null);
  readonly attendees = [anAttendee({ id: 'a-1', name: 'Dr. Nora Al-Otaibi' }), anAttendee({ id: 'a-2', name: 'Eng. Saad Al-Dosari', kind: 'ORG_GUEST', seat: null })];
}

describe('Agenda item dialog — layout, measured (ACC-316 PR 7)', () => {
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();
  const layout = new DialogLayout<Host>();
  let respond: () => Observable<MeetingAgendaItemDto[]>;

  afterAll(() => console.log(`ACC-316 agenda item dialog (cap ${CAP}, room ≥ ${ROOM}):\n  ${layout.measured.join('\n  ')}`));
  afterEach(() => layout.destroy());

  const dialog = (): MeetingAgendaItemDialogComponent => layout.fixture.debugElement.query(By.directive(MeetingAgendaItemDialogComponent)).componentInstance;
  const textarea = () => document.querySelector<HTMLTextAreaElement>('#agendaItemDescription')!;

  for (const language of ['en', 'ar'] as const) {
    for (const width of WIDTHS) {
      it(`[${language}, ${width}]: empty, with its error, filled with a new presenter, refused, and an item edited`, async () => {
        respond = () => of([ITEM]);
        const services = { addAgendaItem: () => respond(), updateAgendaItem: () => respond(), guestCandidates: () => of({ items: [], total: 0, matching: 0 }) };
        await layout.open(Host, language, width, services);
        // Non-vacuity: the meeting and the item's place are named, and the fields are there.
        expect(document.querySelector('.am-dialog__context')?.textContent).toContain(aMeeting().title);
        expect(document.querySelector('[data-testid="agenda-item-title"]')).not.toBeNull();
        layout.check('empty', language, width, 560);

        await layout.click('[data-testid="agenda-item-save"] button');
        expect(document.querySelector('.am-field__message--error')).withContext('the title error').not.toBeNull();
        layout.check('with its error', language, width, 560);

        dialog().form.patchValue({ title: FILLED[language].title, description: FILLED[language].description, durationMinutes: 10 });
        dialog().onPicked({ id: 'u-9', name: 'Eng. Khalid Al-Shehri', unit: { nameEn: 'Facilities', nameAr: 'المرافق' }, position: null });
        await layout.settle();
        expect(document.querySelector('.am-field__hint, .am-field__message')?.textContent ?? '').toBeTruthy();
        const filled = layout.check('filled, a new presenter', language, width, 560, [textarea()]);

        respond = () => throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'STAGE_ACTION_NOT_ALLOWED' } }));
        await layout.click('[data-testid="agenda-item-save"] button');
        expect(document.querySelector('[data-testid="agenda-item-error"]')).withContext('the refusal, in the footer').not.toBeNull();
        expect(layout.check('refused', language, width, 560, [textarea()])).withContext('the refusal never grows the body').toBe(filled);

        layout.fixture.componentInstance.item.set(ITEM);
        layout.destroy();
        await layout.open(Host, language, width, services, (h) => h.item.set(ITEM));
        expect(document.querySelector('[data-testid="agenda-item-remove"]')).withContext('Remove item, when editing').not.toBeNull();
        layout.check('an item edited', language, width, 560);
      }, 40_000);
    }
  }
});
