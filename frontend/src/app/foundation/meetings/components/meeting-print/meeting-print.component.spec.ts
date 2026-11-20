import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import { Observable, of, throwError } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { aMeeting, aMinutes, aMinutesItem, anAttendanceRow, anAttendee } from '../../meeting-fixtures.testing';
import { MeetingService, type MeetingMinutesDto } from '../../services/meeting.service';
import { MeetingPrintComponent } from './meeting-print.component';
import { routes } from '../../../../app.routes';

// ACC-316 PR 7d-1 — the approved minutes on A4: what's printed, in which
// groups, the quorum line and marks, only once approved, and the print
// stylesheet's rules (Karma can't print, so the rules are read from the
// component's own styles).
describe('MeetingPrintComponent (ACC-316 PR 7d-1)', () => {
  preserveDocumentLanguage();
  let minutesRead: () => Observable<MeetingMinutesDto>;

  const APPROVED = (over: Partial<MeetingMinutesDto> = {}): MeetingMinutesDto =>
    aMinutes({
      phase: 'approved',
      attendance: [
        anAttendanceRow({ attendance: 'PRESENT' }),
        anAttendanceRow({ attendeeId: 'a-2', userId: 'u-2', name: 'Huda Al-Harbi', seat: { id: 'seat-sec', labelEn: 'Secretary', labelAr: 'أمين السر' }, attendance: 'PRESENT' }),
        anAttendanceRow({ attendeeId: 'a-4', userId: 'u-4', name: 'Tariq Suleiman', seat: null, attendance: 'APOLOGIES' }),
        anAttendanceRow({ attendeeId: 'a-5', userId: 'u-5', name: 'Hessa Al-Mutairi', seat: null, attendance: 'ABSENT' }),
        anAttendanceRow({ attendeeId: 'a-3', kind: 'ORG_GUEST', userId: 'u-3', name: 'Eng. Saad Al-Dosari', seat: null, attendance: 'PRESENT' }),
        anAttendanceRow({ attendeeId: 'a-6', kind: 'OUTSIDE_GUEST', userId: null, name: 'Dr. Lina Mansour', seat: null, attendance: 'PRESENT' }),
        anAttendanceRow({ attendeeId: 'a-7', kind: 'ORG_GUEST', userId: 'u-7', name: 'Absent Guest', seat: null, attendance: 'ABSENT' }),
      ],
      quorum: { quorum: 2, presentMembers: 2, met: true },
      items: [
        aMinutesItem({
          discussion: 'Room 3 is closed.',
          decisions: [{ id: 'd-1', order: 1, text: 'Use room 5.', votes: { for: 5, against: 1, abstain: 0 }, takenWithoutQuorum: false }],
          actionItems: [{ id: 'x-1', title: 'Replace the filter', owner: { id: 'u-2', name: 'Huda Al-Harbi' }, dueAt: '2027-04-15T09:00:00.000Z', task: { id: 't-1', status: 'PENDING' } }],
        }),
      ],
      distribute: null,
      approvedAt: '2027-04-06T09:00:00.000Z',
      approvedBy: { id: 'u-1', name: 'Dr. Nora Al-Otaibi', seat: { id: 'seat-chair', labelEn: 'Chairman', labelAr: 'رئيس اللجنة' } },
      ...over,
    });

  function create(language: 'en' | 'ar' = 'en') {
    TestBed.configureTestingModule({
      imports: [MeetingPrintComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({}),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'm-1' }) } } },
        { provide: NavigationAccessService, useValue: { tenantName: signal('Al Nakheel Specialist Hospital') } },
        {
          provide: MeetingService,
          useValue: {
            get: () => of(aMeeting()),
            minutes: () => minutesRead(),
            attendees: () => of([anAttendee({ id: 'a-6', kind: 'OUTSIDE_GUEST', userId: null, name: 'Dr. Lina Mansour', seat: null, outsideOrganisation: 'Al Waha Medical Laboratories', outsideRole: 'Consultant microbiologist' })]),
          },
        },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    const fixture = TestBed.createComponent(MeetingPrintComponent);
    fixture.detectChanges();
    return { fixture, c: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  const q = (el: HTMLElement, id: string) => el.querySelector(`[data-testid="${id}"]`);
  const text = (n: Element | null) => n?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  beforeEach(() => (minutesRead = () => of(APPROVED())));

  it('prints the organisation, the committee, the title, when and where, and the approval line', () => {
    const { el } = create();
    expect(text(q(el, 'meeting-print-org'))).toBe('Al Nakheel Specialist Hospital');
    expect(text(el.querySelector('.am-print__head'))).toContain('Pharmacy and Therapeutics Committee');
    expect(text(el.querySelector('h1'))).toBe(aMeeting().title);
    expect(text(q(el, 'meeting-print-when'))).toContain('–');
    expect(el.textContent).toContain('Board room, Tower B, floor 3');
    expect(text(q(el, 'meeting-print-approval'))).toMatch(/^Approved by Dr\. Nora Al-Otaibi \(Chairman\) on .+, after review by the 2 present members\.$/);
    // The approval line repeats at the end.
    expect(el.querySelectorAll('.am-print__approval').length).toBe(2);
  });

  it('attendance in five groups: members by attendance, then the guests who came, an outside guest with their organisation and mark', () => {
    const { el } = create();
    const label = (key: string) => text(el.querySelector(`[data-group="${key}"] dt`));
    const people = (key: string) => text(el.querySelector(`[data-group="${key}"] dd`));
    expect(Array.from(el.querySelectorAll('[data-group]')).map((g) => g.getAttribute('data-group'))).toEqual(['present', 'apologies', 'absent', 'guests', 'outside']);
    expect(label('present')).toBe('Present');
    expect(people('present')).toBe('Dr. Nora Al-Otaibi (Chairman), Huda Al-Harbi (Secretary)');
    expect(people('apologies')).toBe('Tariq Suleiman');
    expect(people('absent')).toBe('Hessa Al-Mutairi');
    expect(people('guests')).toBe('Eng. Saad Al-Dosari');
    expect(people('outside')).toBe('Dr. Lina Mansour, Al Waha Medical Laboratories, Consultant microbiologistOutside guest');
    expect(el.textContent).not.toContain('Absent Guest');
  });

  it("the quorum line, with guests not counted", () => {
    const { el } = create();
    expect(text(q(el, 'meeting-print-quorum'))).toBe("✓ Quorum met · 2 of 4 present, quorum 2. Guests don't count toward quorum.");
  });

  it('each item: its discussion, decision, vote and action items with owner and due date; no task status', () => {
    const { el } = create();
    const item = text(el.querySelector('[data-item="1"]'));
    expect(item).toContain('1 · Isolation room maintenance');
    expect(item).toContain('Discussion: Room 3 is closed.');
    expect(item).toContain('Decision: Use room 5.');
    expect(item).toContain('Vote: 5 for · 1 against · 0 abstain');
    expect(text(el.querySelector('[data-print-action]'))).toMatch(/^Replace the filter · Huda Al-Harbi · due \d/);
    expect(item).not.toContain('PENDING');
  });

  it('without quorum: the quorum line says so, and each decision carries "Taken without quorum"', () => {
    minutesRead = () =>
      of(
        APPROVED({
          quorum: { quorum: 5, presentMembers: 2, met: false },
          items: [aMinutesItem({ decisions: [{ id: 'd-1', order: 1, text: 'Use room 5.', votes: null, takenWithoutQuorum: true }] })],
        }),
      );
    const { el } = create();
    expect(text(q(el, 'meeting-print-quorum'))).toBe("✕ Quorum not met · 2 of 4 present, quorum 5. Guests don't count toward quorum.");
    expect(text(el.querySelector('[data-print-without-quorum]'))).toBe('Taken without quorum');
  });

  it('an approver with no seat (a unit meeting) is named alone', () => {
    minutesRead = () => of(APPROVED({ approvedBy: { id: 'u-9', name: 'Dr. Khalid Al-Mutairi', seat: null } }));
    const { el } = create();
    expect(text(q(el, 'meeting-print-approval'))).toMatch(/^Approved by Dr\. Khalid Al-Mutairi on /);
  });

  it('minutes not approved yet print nothing, and say so', () => {
    minutesRead = () => of(APPROVED({ phase: 'review', approvedAt: null, approvedBy: null }));
    const { el } = create();
    expect(q(el, 'meeting-print')).toBeNull();
    expect(text(q(el, 'meeting-print-not-approved'))).toContain("These minutes aren't approved yet");
  });

  it("minutes the server won't open yet are \"not approved\"; a meeting this person can't see is not found", () => {
    minutesRead = () => throwError(() => new HttpErrorResponse({ status: 403, error: { code: 'MEETING_MINUTES_NOT_OPEN' } }));
    expect(q(create().el, 'meeting-print-not-approved')).not.toBeNull();
    TestBed.resetTestingModule();
    minutesRead = () => throwError(() => new HttpErrorResponse({ status: 404, error: { message: 'Meeting not found' } }));
    expect(q(create().el, 'meeting-print-not-found')).not.toBeNull();
  });

  it('any other refusal to read the minutes (a 403 without that code) is the not-found state', () => {
    minutesRead = () => throwError(() => new HttpErrorResponse({ status: 403, error: { code: 'MEETING_NOT_ALLOWED' } }));
    const { el } = create();
    expect(q(el, 'meeting-print-not-found')).not.toBeNull();
    expect(q(el, 'meeting-print-not-approved')).toBeNull();
  });

  it("Print opens the browser's print", () => {
    const { el } = create();
    const print = spyOn(window, 'print');
    el.querySelector<HTMLElement>('[data-testid="meeting-print-print"] button')!.click();
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('in Arabic: the groups and lines in Arabic', () => {
    const { el } = create('ar');
    expect(text(el.querySelector('[data-group="present"] dt'))).toBe('حاضرون');
    // A noun phrase, no gendered verb about the approver (Arabic copy rule, ACC-279).
    expect(text(q(el, 'meeting-print-approval'))).toMatch(/^اعتماد: Dr\. Nora Al-Otaibi \(رئيس اللجنة\) في .+، بعد مراجعة الأعضاء الحاضرين: 2\.$/);
  });

  it('the print stylesheet: A4 portrait, 18mm margins, page numbers, and the on-screen bar hidden', () => {
    const styles = ((MeetingPrintComponent as unknown as { ɵcmp: { styles: string[] } }).ɵcmp.styles ?? []).join('\n').replace(/\s+/g, ' ');
    expect(styles).toContain('@page');
    expect(styles).toContain('size: A4 portrait');
    expect(styles).toContain('margin: 18mm');
    expect(styles).toContain('counter(pages)');
    expect(styles).toMatch(/@media print \{[^@]*\.am-print-bar \{ display: none !important; \}/);
  });

  it('its route is outside the app shell (no chrome), behind sign-in, and comes first', () => {
    const print = routes.findIndex((r) => r.path === 'meetings/:id/print');
    const shell = routes.findIndex((r) => r.path === '' && !!r.component);
    expect(print).toBeGreaterThanOrEqual(0);
    expect(print).toBeLessThan(shell);
    expect(routes[print]!.canActivate?.length).withContext('authGuard and permissionGuard, as /meetings/:id has').toBe(2);
  });
});
