import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { Observable, of, throwError } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { WorkflowService, type WorkflowMoveDto } from '../../../workflow/services/workflow.service';
import { aMeeting, anAttendee } from '../../meeting-fixtures.testing';
import { MeetingService, type MeetingAttendeeDto, type MeetingDto } from '../../services/meeting.service';
import { MeetingPageComponent } from './meeting-page.component';

// ACC-316 PR 6 — the meeting page renders the server's rules and adds none:
// each control is there exactly when the read's `may` says so, members are
// never offered for removal, a refusal is said from its code, and the moves'
// confirms follow what the server says about each move.
describe('MeetingPageComponent (ACC-316 PR 6)', () => {
  let meeting: () => Observable<MeetingDto>;
  let attendees: MeetingAttendeeDto[];
  let answer: jasmine.Spy;
  let removeGuest: jasmine.Spy;

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
            get: () => meeting(),
            attendees: () => of(attendees),
            agenda: () => of([]),
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
  });

  const q = (el: HTMLElement, id: string) => el.querySelector(`[data-testid="${id}"]`);
  const removeButtons = (el: HTMLElement) => Array.from(el.querySelectorAll('[data-attendee] p-button'));

  it('names the meeting, its stage, its owner and the answer summary in counted words', () => {
    const { el } = create();
    expect(el.querySelector('h1')?.textContent?.trim()).toBe(aMeeting().title);
    expect(el.querySelector('[data-meeting-stage]')?.textContent?.trim()).toBe('Planned');
    expect(el.textContent).toContain('Pharmacy and Therapeutics Committee');
    expect(q(el, 'meeting-answer-summary')?.textContent?.trim()).toBe("5 attending · 2 can't attend · 1 no answer · quorum 5");
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
      expect(el.querySelector('[data-attendee="a-member"] p-button')).withContext('a member').toBeNull();
      expect(el.querySelector('[data-attendee="a-guest"] p-button')).not.toBeNull();
      expect(el.querySelector('[data-attendee="a-out"] p-button')).not.toBeNull();
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
});
