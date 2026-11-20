import { Component } from '@angular/core';
import { By } from '@angular/platform-browser';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { useLayoutFonts } from '../../../../../testing/layout-fonts';
import { CAP, DialogLayout, ROOM, WIDTHS } from '../../meeting-dialog-layout.testing';
import { aMeeting } from '../../meeting-fixtures.testing';
import type { MeetingDto } from '../../services/meeting.service';
import { MeetingEditDialogComponent } from './meeting-edit-dialog.component';

// ACC-316 PR 8c (Q3) — Edit details against the 420px body cap (ACC-111),
// MEASURED in both languages, in the real theme and font, at 1280 and on a 390
// phone: a committee meeting (type and duration side by side) and a unit
// meeting (with its quorum, three across); with no place or link (the place
// line turns red); with long realistic values; and refused by the server (the
// refusal sits in the footer). Each body keeps 20px under the cap.
// NON-VACUITY FIRST (ACC-120): a body that measured 0 would pass.

const TYPES = [
  { id: 't-1', labelEn: 'Regular', labelAr: 'اعتيادي' },
  { id: 't-2', labelEn: 'Extraordinary', labelAr: 'استثنائي' },
];
const LONG = {
  en: { location: 'Board room, Tower B, floor 3, King Fahad Medical City main campus', link: 'https://teams.microsoft.example/l/meetup-join/19%3ameeting_quarterly-review' },
  ar: { location: 'قاعة الاجتماعات، البرج ب، الطابق الثالث، الحرم الرئيسي لمدينة الملك فهد الطبية', link: 'https://teams.microsoft.example/l/meetup-join/19%3ameeting_quarterly-review' },
};

@Component({
  standalone: true,
  imports: [MeetingEditDialogComponent],
  template: `<app-meeting-edit-dialog [visible]="true" [meeting]="meeting" />`,
})
class Host {
  meeting = aMeeting();
}

describe('Edit details dialog — layout, measured (ACC-316 PR 8c)', () => {
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();
  const layout = new DialogLayout<Host>();
  let respond: () => Observable<MeetingDto>;

  afterAll(() => console.log(`ACC-316 edit details dialog (cap ${CAP}, room ≥ ${ROOM}):\n  ${layout.measured.join('\n  ')}`));
  afterEach(() => layout.destroy());

  const dialog = (): MeetingEditDialogComponent => layout.fixture.debugElement.query(By.directive(MeetingEditDialogComponent)).componentInstance;

  for (const language of ['en', 'ar'] as const) {
    for (const width of WIDTHS) {
      for (const kind of ['COMMITTEE', 'UNIT'] as const) {
        it(`[${language}, ${width}, ${kind}]: opened, with no place, long values, refused`, async () => {
          respond = () => of(aMeeting());
          const services = { update: () => respond(), formChoices: () => of({ types: TYPES }) };
          await layout.open(Host, language, width, services, (h) => {
            if (kind === 'UNIT') h.meeting = aMeeting({ owner: { kind: 'UNIT', id: 'u-1', nameEn: 'Pharmacy', nameAr: 'الصيدلة' }, unitQuorum: 4 });
          });
          // Non-vacuity: the meeting is named, its place is filled, and a unit has its quorum.
          expect(document.querySelector('.am-dialog__context')?.textContent).toContain(aMeeting().title);
          expect(document.querySelector<HTMLInputElement>('[data-testid="edit-location"]')?.value).toBe(aMeeting().location!);
          expect(!!document.querySelector('[data-testid="edit-quorum"]')).toBe(kind === 'UNIT');
          layout.check(`${kind}, opened`, language, width, 560);

          dialog().form.patchValue({ location: '', meetingUrl: '' });
          await layout.click('[data-testid="edit-submit"] button');
          expect(document.querySelector('[data-testid="edit-place-hint"]')?.className).toContain('danger');
          layout.check(`${kind}, no place`, language, width, 560);

          dialog().form.patchValue({ location: LONG[language].location, meetingUrl: LONG[language].link });
          await layout.settle();
          layout.check(`${kind}, long values`, language, width, 560);

          respond = () => throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'MEETING_CHANGED' } }));
          await layout.click('[data-testid="edit-submit"] button');
          expect(document.querySelector('[data-testid="edit-error"]')).withContext('the refusal').not.toBeNull();
          layout.check(`${kind}, refused`, language, width, 560);
        }, 40_000);
      }
    }
  }
});
