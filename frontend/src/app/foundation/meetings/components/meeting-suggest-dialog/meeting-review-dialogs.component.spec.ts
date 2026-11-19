import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { of, throwError } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { aMinutes, aMinutesItem, anAttendanceRow } from '../../meeting-fixtures.testing';
import { MeetingService, type MeetingSuggestionDto } from '../../services/meeting.service';
import { MeetingSuggestDialogComponent } from './meeting-suggest-dialog.component';
import { MeetingDeclineDialogComponent } from '../meeting-decline-dialog/meeting-decline-dialog.component';
import { MeetingReturnDialogComponent } from '../meeting-return-dialog/meeting-return-dialog.component';

// ACC-316 PR 7c-1 — the review dialogs: Suggest a correction (an item or the
// whole minutes), Decline (the reply required, P212) and Return for Correction
// (an optional reason, who is told).
describe('The review dialogs (ACC-316 PR 7c-1)', () => {
  let svc: Record<string, jasmine.Spy>;

  function setup() {
    svc = {
      suggest: jasmine.createSpy('suggest').and.returnValue(of({ id: 's-9' })),
      declineSuggestion: jasmine.createSpy('declineSuggestion').and.returnValue(of(undefined)),
      returnMinutes: jasmine.createSpy('returnMinutes').and.returnValue(of(undefined)),
    };
    TestBed.configureTestingModule({
      providers: [provideNoopAnimations(), provideTranslateService({ lang: 'en' }), provideFormatTesting(), providePrimeNG({}), ConfirmationService, { provide: MeetingService, useValue: svc }],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
  }

  afterEach(() => document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove()));

  const SUGGESTION: MeetingSuggestionDto = {
    id: 's-1',
    round: 1,
    agendaItemId: 'i-4',
    author: { id: 'u-3', name: 'Dr. Sara Al-Qahtani' },
    text: 'Say where patients needing isolation go while room 3 is closed.',
    status: 'OPEN',
    reply: null,
    createdAt: '2027-03-19T08:00:00.000Z',
    decidedAt: null,
  };

  describe('Suggest a correction', () => {
    function create() {
      setup();
      const fixture = TestBed.createComponent(MeetingSuggestDialogComponent);
      fixture.componentRef.setInput('meetingId', 'm-1');
      fixture.componentRef.setInput('items', [aMinutesItem({ id: 'i-4', order: 4, title: 'Isolation room maintenance' })]);
      fixture.componentRef.setInput('visible', true);
      fixture.detectChanges();
      return { c: fixture.componentInstance, fixture };
    }

    it('opens on the minutes as a whole, which sends no item; the text trimmed', () => {
      const { c } = create();
      expect(c.form.getRawValue().about).toBe('whole');
      c.form.patchValue({ text: '  Add the apologies.  ' });
      c.submit();
      expect(svc['suggest']).toHaveBeenCalledOnceWith('m-1', { agendaItemId: null, text: 'Add the apologies.' });
    });

    it('about an item (chosen in About) sends its id', () => {
      const { c } = create();
      c.form.patchValue({ about: 'i-4', text: 'Name room 5.' });
      c.submit();
      expect(svc['suggest']).toHaveBeenCalledOnceWith('m-1', { agendaItemId: 'i-4', text: 'Name room 5.' });
    });

    it('no text, nothing sent; a refusal said from its code', () => {
      const { c } = create();
      c.submit();
      expect(svc['suggest']).not.toHaveBeenCalled();
      svc['suggest']!.and.returnValue(throwError(() => new HttpErrorResponse({ status: 403, error: { code: 'MEETING_NOT_REVIEWER' } })));
      c.form.patchValue({ text: 'X' });
      c.submit();
      expect(c.error()).toBe('meeting.refusal.notReviewer');
      expect(c.needsReload()).toBeFalse();
    });

    it('a stale refusal offers Reload in place of Send, which closes and asks the page to read the meeting (P220)', () => {
      const { c, fixture } = create();
      const reload = jasmine.createSpy('reload');
      const visible = jasmine.createSpy('visible');
      c.reload.subscribe(reload);
      c.visibleChange.subscribe(visible);
      svc['suggest']!.and.returnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'MEETING_CHANGED' } })));
      c.form.patchValue({ text: 'X' });
      c.submit();
      fixture.detectChanges();
      expect(document.querySelector('[data-testid="suggest-submit"]')).toBeNull();
      document.querySelector<HTMLElement>('[data-testid="suggest-reload"] button')!.click();
      expect(visible).toHaveBeenCalledWith(false);
      expect(reload).toHaveBeenCalledTimes(1);
    });
  });

  describe('Decline', () => {
    function create() {
      setup();
      const fixture = TestBed.createComponent(MeetingDeclineDialogComponent);
      fixture.componentRef.setInput('meetingId', 'm-1');
      fixture.componentRef.setInput('suggestion', SUGGESTION);
      fixture.componentRef.setInput('itemOrder', 4);
      fixture.componentRef.setInput('visible', true);
      fixture.detectChanges();
      return Object.assign(fixture.componentInstance, { fixture });
    }

    it('a reply is required: an empty or blank one sends nothing (the server refuses one too)', () => {
      const c = create();
      c.submit();
      c.form.patchValue({ reply: '   ' });
      c.submit();
      expect(svc['declineSuggestion']).not.toHaveBeenCalled();
      expect(c.showErrors()).toBeTrue();
    });

    it('sends the reply trimmed, and names the item and author', () => {
      const c = create();
      expect(c.context()).toBe('Item 4 · from Dr. Sara Al-Qahtani');
      c.form.patchValue({ reply: '  Room 5 is the standing alternative.  ' });
      c.submit();
      expect(svc['declineSuggestion']).toHaveBeenCalledOnceWith('m-1', 's-1', 'Room 5 is the standing alternative.');
    });

    it('the server refusing an empty reply is said from its code', () => {
      const c = create();
      svc['declineSuggestion']!.and.returnValue(throwError(() => new HttpErrorResponse({ status: 400, error: { code: 'MEETING_SUGGESTION_REPLY_REQUIRED' } })));
      c.form.patchValue({ reply: 'x' });
      c.submit();
      expect(c.error()).toBe('meeting.refusal.suggestionReplyRequired');
    });

    it('keeps its suggestion while it closes, so the quote and context do not blank (P220)', () => {
      const c = create();
      // The page clears its suggestion as the dialog starts to close.
      c.fixture.componentRef.setInput('visible', false);
      c.fixture.componentRef.setInput('suggestion', null);
      c.fixture.componentRef.setInput('itemOrder', null);
      c.fixture.detectChanges();
      expect(c.shown().suggestion?.id).toBe('s-1');
      expect(c.context()).toBe('Item 4 · from Dr. Sara Al-Qahtani');
    });

    it('a stale refusal offers Reload in place of Decline (P220)', () => {
      const c = create();
      const reload = jasmine.createSpy('reload');
      c.reload.subscribe(reload);
      svc['declineSuggestion']!.and.returnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'MEETING_SUGGESTION_DECIDED' } })));
      c.form.patchValue({ reply: 'No.' });
      c.submit();
      c.fixture.detectChanges();
      expect(c.error()).toBe('meeting.refusal.suggestionDecided');
      expect(document.querySelector('[data-testid="decline-submit"]')).toBeNull();
      document.querySelector<HTMLElement>('[data-testid="decline-reload"] button')!.click();
      expect(reload).toHaveBeenCalledTimes(1);
    });
  });

  describe('Return for Correction', () => {
    function create() {
      setup();
      const fixture = TestBed.createComponent(MeetingReturnDialogComponent);
      fixture.componentRef.setInput('meetingId', 'm-1');
      fixture.componentRef.setInput(
        'minutes',
        aMinutes({
          phase: 'review',
          attendance: [anAttendanceRow({ attendance: 'PRESENT' }), anAttendanceRow({ attendeeId: 'a-2', userId: 'u-2', attendance: 'PRESENT' }), anAttendanceRow({ attendeeId: 'a-3', userId: 'u-3', attendance: 'ABSENT' })],
          review: { round: 1, reviewBy: '2027-03-25', datePassed: false, closed: false, reviewers: [{ userId: 'u-1', name: 'N', answered: true }], suggestions: [SUGGESTION], changes: [], mine: null },
        }),
      );
      fixture.componentRef.setInput('visible', true);
      fixture.detectChanges();
      return Object.assign(fixture.componentInstance, { fixture });
    }

    it('says who is told (the present members) and the answers so far', () => {
      const c = create();
      expect(c.told()).toBe('2 present members');
      expect(c.answers()).toBe('1 answered · 1 suggestion open');
    });

    it('the reason is optional: none sends null; one is sent trimmed', () => {
      const c = create();
      c.submit();
      expect(svc['returnMinutes']).toHaveBeenCalledWith('m-1', null);
      c.form.patchValue({ reason: '  Item 2 needs the Q3 figures.  ' });
      c.submit();
      expect(svc['returnMinutes']).toHaveBeenCalledWith('m-1', 'Item 2 needs the Q3 figures.');
    });

    it('a refusal is said in the footer, as in Suggest and Decline (P220)', () => {
      const c = create();
      svc['returnMinutes']!.and.returnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'STAGE_ACTION_NOT_ALLOWED' } })));
      c.submit();
      c.fixture.detectChanges();
      const error = document.querySelector('[data-testid="return-error"]');
      expect(error).not.toBeNull();
      expect(error!.closest('form')).toBeNull();
      expect(error!.closest('.p-dialog-footer')).not.toBeNull();
      expect(document.querySelector('[data-testid="return-reload"]')).toBeNull();
    });

    it('a stale refusal offers Reload in place of Return (P220)', () => {
      const c = create();
      const reload = jasmine.createSpy('reload');
      c.reload.subscribe(reload);
      svc['returnMinutes']!.and.returnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'MEETING_CHANGED' } })));
      c.submit();
      c.fixture.detectChanges();
      expect(document.querySelector('[data-testid="return-submit"]')).toBeNull();
      document.querySelector<HTMLElement>('[data-testid="return-reload"] button')!.click();
      expect(reload).toHaveBeenCalledTimes(1);
    });
  });
});
