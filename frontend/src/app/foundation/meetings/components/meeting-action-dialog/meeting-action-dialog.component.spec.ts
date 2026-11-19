import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { of, throwError } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { FormatService } from '../../../../core/formatting';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { aMinutes, anAttendanceRow } from '../../meeting-fixtures.testing';
import { MeetingService, type MeetingMinutesDto } from '../../services/meeting.service';
import { MeetingActionDialogComponent } from './meeting-action-dialog.component';

// ACC-316 PR 7b — Raise action item: an owner from the organisation's people
// among the invitees (never an outside guest), a due date and time on the
// tenant's wall clock, and a refusal said from its code.
describe('MeetingActionDialogComponent (ACC-316 PR 7b)', () => {
  let add: jasmine.Spy;

  function create() {
    add = jasmine.createSpy('add').and.returnValue(of(aMinutes()));
    TestBed.configureTestingModule({
      imports: [MeetingActionDialogComponent],
      providers: [provideNoopAnimations(), provideTranslateService({ lang: 'en' }), provideFormatTesting(), providePrimeNG({}), ConfirmationService, { provide: MeetingService, useValue: { addAction: add } }],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    const fixture = TestBed.createComponent(MeetingActionDialogComponent);
    fixture.componentRef.setInput('meetingId', 'm-1');
    fixture.componentRef.setInput('item', { id: 'i-4', order: 4, title: 'Isolation room maintenance' });
    fixture.componentRef.setInput('attendance', [
      anAttendanceRow(),
      anAttendanceRow({ attendeeId: 'a-3', kind: 'ORG_GUEST', userId: 'u-3', name: 'Eng. Khalid Al-Shehri', seat: null }),
      anAttendanceRow({ attendeeId: 'a-9', kind: 'OUTSIDE_GUEST', userId: null, name: 'Dr. Lina Mansour', seat: null }),
    ]);
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    const saved: MeetingMinutesDto[] = [];
    fixture.componentInstance.saved.subscribe((m) => saved.push(m));
    return { fixture, c: fixture.componentInstance, saved };
  }

  afterEach(() => document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove()));

  it('offers the invitees who are people of the organisation as owners; never an outside guest', () => {
    const { c } = create();
    expect(c.ownerOptions().map((o) => o.value)).toEqual(['u-1', 'u-3']);
  });

  it('names the item it comes from', () => {
    const { c } = create();
    expect(c.context()).toBe('From item 4 · Isolation room maintenance');
  });

  it('adds the draft with the title trimmed, the owner, and the due date and time on the tenant clock', () => {
    const { c, saved } = create();
    c.form.patchValue({ title: '  Repair negative-pressure alarm  ', ownerUserId: 'u-3', time: '13:00' });
    c.pickDay(new Date(2027, 2, 30));
    c.submit();
    expect(add).toHaveBeenCalledOnceWith('m-1', 'i-4', { title: 'Repair negative-pressure alarm', ownerUserId: 'u-3', dueAt: jasmine.any(String) });
    const dueAt = add.calls.mostRecent().args[2].dueAt as string;
    // Read back on the tenant's wall clock (the formatting layer's zone), it is the day and time picked.
    expect(TestBed.inject(FormatService).wallClock(dueAt)).toEqual({ year: 2027, month: 3, day: 30, hour: 13, minute: 0 });
    expect(saved.length).toBe(1);
  });

  it('with no title, owner or due date, nothing is sent', () => {
    const { c } = create();
    c.submit();
    expect(add).not.toHaveBeenCalled();
    expect(c.showErrors()).toBeTrue();
  });

  it('a refusal is said from its code, and the dialog stays open', () => {
    const { c, fixture } = create();
    const closed = jasmine.createSpy('closed');
    c.visibleChange.subscribe(closed);
    add.and.returnValue(throwError(() => new HttpErrorResponse({ status: 400, error: { code: 'MEETING_ACTION_DUE_IN_PAST' } })));
    c.form.patchValue({ title: 'Repair', ownerUserId: 'u-1', time: '09:00' });
    c.pickDay(new Date(2027, 2, 30));
    c.submit();
    fixture.detectChanges();
    expect(c.error()).toBe('meeting.refusal.actionDueInPast');
    expect(closed).not.toHaveBeenCalled();
  });
});
