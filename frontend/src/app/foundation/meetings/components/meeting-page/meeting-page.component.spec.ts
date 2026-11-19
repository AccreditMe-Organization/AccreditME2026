import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { Observable, Subject, of, throwError } from 'rxjs';
import { By } from '@angular/platform-browser';
import { MeetingAttendanceComponent } from '../meeting-attendance/meeting-attendance.component';
import { MeetingItemMinutesComponent } from '../meeting-item-minutes/meeting-item-minutes.component';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { WorkflowService, type WorkflowMoveDto } from '../../../workflow/services/workflow.service';
import { aMeeting, aMinutes, aMinutesItem, anAttendee } from '../../meeting-fixtures.testing';
import { MeetingService, type MeetingAgendaItemDto, type MeetingAttendeeDto, type MeetingDto, type MeetingMinutesDto, type MeetingOpenActionsDto } from '../../services/meeting.service';
import { MeetingPageComponent } from './meeting-page.component';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';

// ACC-316 PR 6 — the meeting page renders the server's rules and adds none:
// each control is there exactly when the read's `may` says so, members are
// never offered for removal, a refusal is said from its code, and the moves'
// confirms follow what the server says about each move.
describe('MeetingPageComponent (ACC-316 PR 6)', () => {
  preserveDocumentLanguage();
  let meeting: () => Observable<MeetingDto>;
  let attendees: MeetingAttendeeDto[];
  let answer: jasmine.Spy;
  let removeGuest: jasmine.Spy;
  let attendeesRead: () => Observable<MeetingAttendeeDto[]>;
  let filesRead: () => Observable<{ attachments: never[]; papers: never[] }>;
  let gets: number;
  let minutesRead: () => Observable<MeetingMinutesDto>;
  let openActionsRead: () => Observable<MeetingOpenActionsDto>;
  let agendaRead: () => Observable<MeetingAgendaItemDto[]> = () => of([]);
  const writes = { attendance: new Subject<MeetingMinutesDto>(), discussion: new Subject<MeetingMinutesDto>() };

  function create() {
    TestBed.configureTestingModule({
      imports: [MeetingPageComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({}),
        ConfirmationService,
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'm-1' }) } } },
        {
          provide: MeetingService,
          useValue: {
            get: () => {
              gets++;
              return meeting();
            },
            attendees: () => attendeesRead(),
            agenda: () => agendaRead(),
            files: () => filesRead(),
            minutes: () => minutesRead(),
            openActions: () => openActionsRead(),
            recordAttendance: () => writes.attendance,
            saveDiscussion: () => writes.discussion,
            answer,
            removeGuest,
          },
        },
        { provide: WorkflowService, useValue: { getInstancesByObject: () => of([]) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    const fixture = TestBed.createComponent(MeetingPageComponent);
    fixture.detectChanges();
    return { fixture, c: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  beforeEach(() => {
    meeting = () => of(aMeeting());
    attendees = [
      anAttendee({ id: 'a-member' }),
      anAttendee({ id: 'a-guest', kind: 'ORG_GUEST', name: 'Eng. Saad Al-Dosari', seat: null }),
      anAttendee({ id: 'a-out', kind: 'OUTSIDE_GUEST', userId: null, name: 'Dr. Abdulrahman Al-Qahtani', seat: null, outsideOrganisation: 'Ministry of Health', outsideRole: 'Surveyor' }),
    ];
    answer = jasmine.createSpy('answer').and.returnValue(of(undefined));
    removeGuest = jasmine.createSpy('removeGuest').and.returnValue(of(undefined));
    attendeesRead = () => of(attendees);
    agendaRead = () => of([]);
    filesRead = () => of({ attachments: [], papers: [] });
    gets = 0;
    // Before the meeting is held the minutes aren't open: the server's 403.
    minutesRead = () => throwError(() => new HttpErrorResponse({ status: 403, error: { code: 'MEETING_MINUTES_NOT_OPEN' } }));
    openActionsRead = () => of({ mayRead: true, rows: [] });
  });

  const q = (el: HTMLElement, id: string) => el.querySelector(`[data-testid="${id}"]`);
  const removeButtons = (el: HTMLElement) => Array.from(el.querySelectorAll('[data-attendee] am-icon-button'));

  it('names the meeting, its stage, its owner and the answer summary in counted words', () => {
    const { el } = create();
    expect(el.querySelector('h1')?.textContent?.trim()).toBe(aMeeting().title);
    expect(el.querySelector('[data-meeting-stage]')?.textContent?.trim()).toBe('Planned');
    expect(el.textContent).toContain('Pharmacy and Therapeutics Committee');
    // Members only, said so (P189 b), so it reads against the invitee list.
    expect(q(el, 'meeting-answer-summary')?.textContent?.trim()).toBe("Members: 5 attending · 2 can't attend · 1 no answer · quorum 5");
  });

  describe('Reschedule follows may.reschedule', () => {
    it('shown when the server allows it', () => {
      expect(q(create().el, 'meeting-reschedule')).not.toBeNull();
    });
    it('absent when it does not', () => {
      meeting = () => of(aMeeting({ may: { ...aMeeting().may, reschedule: false } }));
      expect(q(create().el, 'meeting-reschedule')).toBeNull();
    });
  });

  describe('guests follow may.manageGuests', () => {
    it('Add a guest and each guest\'s remove are offered; a member is never removable', () => {
      const { el } = create();
      expect(q(el, 'meeting-add-guest')).not.toBeNull();
      expect(el.querySelector('[data-attendee="a-member"] am-icon-button')).withContext('a member').toBeNull();
      expect(el.querySelector('[data-attendee="a-guest"] am-icon-button')).not.toBeNull();
      expect(el.querySelector('[data-attendee="a-out"] am-icon-button')).not.toBeNull();
      expect(el.querySelector('[data-attendee="a-out"] [data-outside-chip]')).not.toBeNull();
    });
    it('neither is offered without it', () => {
      meeting = () => of(aMeeting({ may: { ...aMeeting().may, manageGuests: false } }));
      const { el } = create();
      expect(q(el, 'meeting-add-guest')).toBeNull();
      expect(removeButtons(el)).toEqual([]);
    });
    it('a refused removal is said from its code', () => {
      removeGuest.and.returnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'MEETING_GUEST_PRESENTS' } })));
      const { c, fixture, el } = create();
      c.removeGuest(attendees[1]!);
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="meeting-invitees"] [role="alert"]')?.textContent?.trim()).toBe(en.meeting.refusal.guestPresents);
    });
  });

  describe('P189 — the answer, the rows and the guest remove', () => {
    it('the pressed button is the answer given (aria-pressed); no line repeats it', () => {
      meeting = () => of(aMeeting({ myAnswer: { answer: 'CANT_ATTEND', note: null } }));
      const { el } = create();
      expect(q(el, 'meeting-my-answer')).toBeNull();
      expect(q(el, 'meeting-answer-cant')?.getAttribute('aria-pressed')).toBe('true');
      expect(q(el, 'meeting-answer-attending')?.getAttribute('aria-pressed')).toBe('false');
    });

    it("each invitee's row ends with their answer, and their note sits under it", () => {
      attendees = [
        anAttendee({ id: 'a-yes', answer: 'ATTENDING', answerNote: 'Joining from the clinic' }),
        anAttendee({ id: 'a-no', answer: 'CANT_ATTEND' }),
        anAttendee({ id: 'a-none', answer: null }),
      ];
      const { el } = create();
      const answerOf = (id: string) => el.querySelector(`[data-attendee="${id}"] [data-attendee-answer]`)?.textContent?.trim();
      expect([answerOf('a-yes'), answerOf('a-no'), answerOf('a-none')]).toEqual(['Attending', "Can't attend", 'No answer']);
      expect(el.querySelector('[data-attendee="a-yes"] [data-attendee-note]')?.textContent?.trim()).toBe('Joining from the clinic');
      expect(el.querySelector('[data-attendee="a-no"] [data-attendee-note]')).toBeNull();
    });

    it('in Arabic a row says a status, not the first-person answer buttons (P199)', () => {
      attendees = [anAttendee({ id: 'a-yes', answer: 'ATTENDING' }), anAttendee({ id: 'a-no', answer: 'CANT_ATTEND' }), anAttendee({ id: 'a-none', answer: null })];
      const { el, fixture } = create();
      TestBed.inject(TranslateService).use('ar');
      fixture.detectChanges();
      const answerOf = (id: string) => el.querySelector(`[data-attendee="${id}"] [data-attendee-answer]`)?.textContent?.trim();
      expect([answerOf('a-yes'), answerOf('a-no'), answerOf('a-none')]).toEqual(['حضور', 'اعتذار', 'بلا رد']);
      expect(q(el, 'meeting-answer-attending')?.textContent?.trim()).toBe('سأحضر');
    });

    it("a guest's remove is the muted row icon, named for the guest", () => {
      const { el } = create();
      const remove = el.querySelector('[data-attendee="a-guest"] am-icon-button button');
      expect(remove?.getAttribute('aria-label')).toBe('Remove Eng. Saad Al-Dosari');
      expect(el.querySelector('[data-attendee="a-guest"] p-button[severity="danger"]')).toBeNull();
    });
  });

  describe('the answer follows may.answer', () => {
    it('both answers and the note are offered, and the note is sent', () => {
      const { c, el } = create();
      expect(q(el, 'meeting-answer-attending')).not.toBeNull();
      expect(q(el, 'meeting-answer-cant')).not.toBeNull();
      c.answerNote = '  Joining from the clinic  ';
      c.answer('CANT_ATTEND');
      expect(answer).toHaveBeenCalledWith('m-1', { answer: 'CANT_ATTEND', note: 'Joining from the clinic' });
    });
    it('closed: the answer given is shown, and no button', () => {
      meeting = () => of(aMeeting({ may: { ...aMeeting().may, answer: false }, myAnswer: { answer: 'ATTENDING', note: null } }));
      const { el } = create();
      expect(q(el, 'meeting-answer-attending')).toBeNull();
      expect(q(el, 'meeting-my-answer')?.textContent?.trim()).toBe('Attending');
      expect(q(el, 'meeting-answer')?.textContent).toContain(en.meeting.answer.closed);
    });
    it('the stored note is filled in, kept on a reload, and sent with the next answer rather than cleared', () => {
      meeting = () => of(aMeeting({ myAnswer: { answer: 'ATTENDING', note: 'Joining from the clinic' } }));
      const { c } = create();
      expect(c.answerNote).toBe('Joining from the clinic');
      c.answer('CANT_ATTEND');
      expect(answer).toHaveBeenCalledWith('m-1', { answer: 'CANT_ATTEND', note: 'Joining from the clinic' });
      // The answer's reload reads the meeting again; the note stays as stored.
      expect(c.answerNote).toBe('Joining from the clinic');
    });

    it('not invited: no answer section at all', () => {
      meeting = () => of(aMeeting({ may: { ...aMeeting().may, answer: false }, myAnswer: null }));
      expect(q(create().el, 'meeting-answer')).toBeNull();
    });
    it('a refused answer is said from its code', () => {
      answer.and.returnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'MEETING_STARTED' } })));
      const { c, fixture, el } = create();
      c.answer('ATTENDING');
      fixture.detectChanges();
      expect(q(el, 'meeting-answer')?.querySelector('[role="alert"]')?.textContent?.trim()).toBe(en.meeting.refusal.started);
    });
  });

  describe('loading', () => {
    it('a meeting this person may not open reads as not found, for 404 and 403 alike', () => {
      for (const status of [404, 403]) {
        TestBed.resetTestingModule();
        meeting = () => throwError(() => new HttpErrorResponse({ status }));
        const { el } = create();
        expect(q(el, 'meeting-not-found')).withContext(String(status)).not.toBeNull();
        expect(q(el, 'meeting-page')).toBeNull();
      }
    });
    it('any other failure offers Retry, never the server\'s words', () => {
      meeting = () => throwError(() => new HttpErrorResponse({ status: 500, error: { message: 'Internal server error' } }));
      const { el } = create();
      expect(q(el, 'meeting-error')?.textContent).toContain(en.meeting.page.loadError);
      expect(q(el, 'meeting-error')?.textContent).not.toContain('Internal server error');
    });
  });

  describe('the moves\' confirms follow the server', () => {
    const move = (over: Partial<WorkflowMoveDto>): WorkflowMoveDto => ({ id: 't', labelEn: 'Go', labelAr: null, kind: 'ADVANCE', toStageId: 's', toStageNameEn: 'Next', toStageNameAr: null, ...over });
    it('a move that needs a reason is Cancel\'s', () => {
      expect(create().c.confirmFor(move({ needsReason: true }))?.titleKey).toBe('meeting.cancel.title');
    });
    it('a move into a stage flagged AGENDA_ISSUED is Issue Agenda\'s', () => {
      expect(create().c.confirmFor(move({ needsReason: false, toStageFlags: ['AGENDA_ISSUED'] }))?.titleKey).toBe('meeting.issue.title');
    });
    it('any other move is pressed at once', () => {
      expect(create().c.confirmFor(move({ needsReason: false, toStageFlags: [] }))).toBeNull();
    });
  });

  describe('after an agenda write (P198)', () => {
    it('invitees that fail to load again are said in the agenda panel, with Retry, which reads them again', () => {
      const { el, fixture, c } = create();
      let fail = true;
      attendeesRead = () => (fail ? throwError(() => new HttpErrorResponse({ status: 500 })) : of(attendees));
      c.onAgendaChange([]);
      fixture.detectChanges();
      expect(q(el, 'meeting-agenda-read-error')?.textContent).toContain(en.meeting.invitees.loadFailed);
      fail = false;
      el.querySelector<HTMLElement>('[data-testid="meeting-agenda-read-retry"] button')!.click();
      fixture.detectChanges();
      expect(q(el, 'meeting-agenda-read-error')).toBeNull();
    });

    it('files that fail to load again are said the same way', () => {
      const { el, fixture, c } = create();
      filesRead = () => throwError(() => new HttpErrorResponse({ status: 500 }));
      c.loadFiles();
      fixture.detectChanges();
      expect(q(el, 'meeting-agenda-read-error')?.textContent).toContain(en.meeting.files.loadFailed);
    });

    it("the panel's Reload reads the whole meeting again", () => {
      const { fixture } = create();
      expect(gets).toBe(1);
      fixture.debugElement.query((d) => d.name === 'am-meeting-agenda-panel').componentInstance.reload.emit();
      fixture.detectChanges();
      expect(gets).toBe(2);
    });
  });

  describe('the minutes (PR 7b)', () => {
    it('minutes not open to this person yet: the invitees, no attendance, no Distribute, and no error', () => {
      const { el } = create();
      expect(q(el, 'meeting-invitees')).not.toBeNull();
      expect(q(el, 'meeting-attendance')).toBeNull();
      expect(q(el, 'meeting-distribute')).toBeNull();
      expect(q(el, 'meeting-agenda-read-error')).toBeNull();
    });

    it("once the minutes are open, attendance takes the invitees' place, and Distribute follows may.distribute", () => {
      minutesRead = () => of(aMinutes());
      const { el } = create();
      expect(q(el, 'meeting-attendance')).not.toBeNull();
      expect(q(el, 'meeting-invitees')).toBeNull();
      expect(q(el, 'meeting-distribute')).not.toBeNull();
    });

    it('without may.distribute, no Distribute', () => {
      minutesRead = () => of(aMinutes({ may: { ...aMinutes().may, distribute: false } }));
      expect(q(create().el, 'meeting-distribute')).toBeNull();
    });

    it('a minutes read that fails for any other reason is said, with Retry, never swallowed', () => {
      minutesRead = () => throwError(() => new HttpErrorResponse({ status: 500 }));
      const { el } = create();
      expect(q(el, 'meeting-agenda-read-error')?.textContent).toContain(en.meeting.minutes.loadFailed);
    });

    it("the last meeting's open actions reach the agenda's fixed first section", () => {
      openActionsRead = () =>
        of({ mayRead: true, rows: [{ taskId: 't-1', title: 'Re-audit wards 4B and 6A', status: 'PENDING', dueAt: null, owner: null, fromMeetingId: 'm-0', note: null, mayOpen: false }] });
      const { el } = create();
      expect(q(el, 'meeting-open-actions')?.textContent).toContain('Re-audit wards 4B and 6A');
    });
  });

  describe('minutes writes answering out of order (P206)', () => {
    it('an older answer arriving last never puts back what the newest write changed', () => {
      writes.attendance = new Subject<MeetingMinutesDto>();
      writes.discussion = new Subject<MeetingMinutesDto>();
      minutesRead = () => of(aMinutes({ items: [aMinutesItem({ discussion: 'Before.' })] }));
      agendaRead = () => of([{ id: 'i-1', order: 1, title: 'Isolation room maintenance', description: null, durationMinutes: null, standing: false, presenter: null }]);
      const { fixture, c } = create();
      const attendance = fixture.debugElement.query(By.directive(MeetingAttendanceComponent)).componentInstance as MeetingAttendanceComponent;
      const item = fixture.debugElement.query(By.directive(MeetingItemMinutesComponent)).componentInstance as MeetingItemMinutesComponent;
      // First an attendance tap, then the discussion saved: two writes, in that order.
      attendance.record(aMinutes().attendance[0]!, 'PRESENT');
      item.discussion.set('After.');
      item.saveDiscussion();
      // The newer answers first: the discussion saved.
      writes.discussion.next(aMinutes({ items: [aMinutesItem({ discussion: 'After.' })] }));
      expect(c.minutes()!.items[0]!.discussion).toBe('After.');
      // Then the older one, read before the discussion was saved: dropped.
      writes.attendance.next(aMinutes({ items: [aMinutesItem({ discussion: 'Before.' })] }));
      expect(c.minutes()!.items[0]!.discussion).toBe('After.');
    });
  });
});
