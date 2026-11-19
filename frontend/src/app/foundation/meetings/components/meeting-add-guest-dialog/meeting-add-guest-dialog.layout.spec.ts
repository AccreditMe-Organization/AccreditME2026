import { Component, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { useLayoutFonts } from '../../../../../testing/layout-fonts';
import { CAP, DialogLayout, ROOM, WIDTHS } from '../../meeting-dialog-layout.testing';
import { aMeeting, anAttendee } from '../../meeting-fixtures.testing';
import type { MeetingAttendeeDto, MeetingDto } from '../../services/meeting.service';
import { MeetingAddGuestDialogComponent } from './meeting-add-guest-dialog.component';

// ACC-316 PR 6 — Add a guest against the 420px body cap (ACC-111), MEASURED in
// both languages, in the real theme and font, at 1280 and on a 390 phone.
//
// A person: empty, with its error, picked. An outside guest (the taller form):
// empty, with every error, filled with long realistic values, and refused. And
// once the agenda is issued, the outside guest's "emailed now" line. Each body
// keeps 20px under the cap and scrolls nowhere, and nothing runs sideways.
// NON-VACUITY FIRST (ACC-120): a body that measured 0 would pass.

const OUTSIDE = {
  en: { name: 'Dr. Abdulrahman bin Saleh Al-Qahtani', email: 'abdulrahman.alqahtani@moh-regional.example.gov.sa', organisation: 'Ministry of Health, Riyadh First Health Cluster', role: 'Regional accreditation surveyor' },
  ar: { name: 'د. عبدالرحمن بن صالح القحطاني', email: 'abdulrahman.alqahtani@moh-regional.example.gov.sa', organisation: 'وزارة الصحة، تجمع الرياض الصحي الأول', role: 'مقيّم اعتماد إقليمي' },
};

@Component({
  standalone: true,
  imports: [MeetingAddGuestDialogComponent],
  template: `<app-meeting-add-guest-dialog [visible]="true" [meeting]="meeting()" />`,
})
class Host {
  readonly meeting = signal<MeetingDto>(aMeeting());
}

describe('Add a guest dialog — layout, measured (ACC-316 PR 6)', () => {
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();
  const layout = new DialogLayout<Host>();
  let respond: () => Observable<MeetingAttendeeDto>;

  afterAll(() => console.log(`ACC-316 add a guest dialog (cap ${CAP}, room ≥ ${ROOM}):\n  ${layout.measured.join('\n  ')}`));
  afterEach(() => layout.destroy());

  const dialog = (): MeetingAddGuestDialogComponent => layout.fixture.debugElement.query(By.directive(MeetingAddGuestDialogComponent)).componentInstance;

  for (const language of ['en', 'ar'] as const) {
    for (const width of WIDTHS) {
      it(`[${language}, ${width}]: a person, then an outside guest, empty, with errors, filled, refused`, async () => {
        respond = () => of(anAttendee({ kind: 'ORG_GUEST' }));
        const services = { addGuest: () => respond(), guestCandidates: () => of({ items: [], total: 0, matching: 0 }) };
        await layout.open(Host, language, width, services);
        // Non-vacuity: the meeting is named, and the kind choice is there.
        expect(document.querySelector('.am-dialog__context')?.textContent).toContain(aMeeting().title);
        expect(document.querySelector('[data-testid="guest-kind-person"]')).not.toBeNull();
        layout.check('person, empty', language, width, 560);

        await layout.click('[data-testid="guest-submit"] button');
        expect(document.querySelector('.am-field__message--error')).withContext('the person error').not.toBeNull();
        layout.check('person, with its error', language, width, 560);

        dialog().onPicked({ id: 'u-9', name: 'Dr. Mohammed bin Abdullah Al-Shehri', unit: null, position: null });
        await layout.settle();
        layout.check('person, picked', language, width, 560);

        await layout.click('[data-testid="guest-kind-outside"]');
        expect(document.querySelector('[data-testid="guest-name"]')).withContext('the outside fields').not.toBeNull();
        layout.check('outside, empty', language, width, 560);

        dialog().form.controls.outsideEmail.setValue('not an email');
        await layout.click('[data-testid="guest-submit"] button');
        expect(document.querySelectorAll('.am-field__message--error').length).withContext('name and email errors').toBe(2);
        layout.check('outside, with every error', language, width, 560);

        const v = OUTSIDE[language];
        dialog().form.patchValue({ outsideName: v.name, outsideEmail: v.email, outsideOrganisation: v.organisation, outsideRole: v.role });
        await layout.settle();
        layout.check('outside, filled', language, width, 560);

        respond = () => throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'STAGE_ACTION_NOT_ALLOWED' } }));
        await layout.click('[data-testid="guest-submit"] button');
        expect(document.querySelector('[data-testid="guest-error"]')).withContext('the refusal').not.toBeNull();
        layout.check('outside, refused', language, width, 560);

        // Issued: the line says the invitation goes now.
        layout.fixture.componentInstance.meeting.set(aMeeting({ stage: { id: 's-issued', nameEn: 'Agenda Issued', nameAr: 'صدرت الأجندة', flags: ['AGENDA_ISSUED'] } }));
        await layout.settle();
        expect(document.querySelector('[data-testid="guest-outside-when"]')?.textContent?.trim().length).toBeGreaterThan(0);
        layout.check('outside, issued', language, width, 560);
      }, 40_000);
    }
  }
});
