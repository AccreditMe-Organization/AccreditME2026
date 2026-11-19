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
import { AmConfirmService, type AmConfirmOptions } from '../../../../shared/components/confirm/am-confirm.service';
import { aMeeting, anAttendee } from '../../meeting-fixtures.testing';
import { MeetingService, type MeetingAgendaItemDto } from '../../services/meeting.service';
import { MeetingAgendaItemDialogComponent } from './meeting-agenda-item-dialog.component';

// ACC-316 PR 7 — Agenda item: what Save sends (an invitee or a person found by
// name as the presenter), an item's own values on Edit, Remove asking first,
// and a refusal said from its code.
describe('MeetingAgendaItemDialogComponent (ACC-316 PR 7)', () => {
  const ITEM: MeetingAgendaItemDto = { id: 'i-4', order: 4, title: 'Isolation rooms', description: 'Status.', durationMinutes: 10, standing: false, presenter: { attendeeId: 'a-1', name: 'Dr. Nora', kind: 'MEMBER' } };
  let add: jasmine.Spy;
  let update: jasmine.Spy;
  let remove: jasmine.Spy;
  let asked: AmConfirmOptions[];

  function create(item: MeetingAgendaItemDto | null = null) {
    add = jasmine.createSpy('add').and.returnValue(of([ITEM]));
    update = jasmine.createSpy('update').and.returnValue(of([ITEM]));
    remove = jasmine.createSpy('remove').and.returnValue(of([]));
    asked = [];
    TestBed.configureTestingModule({
      imports: [MeetingAgendaItemDialogComponent],
      providers: [
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({}),
        ConfirmationService,
        { provide: MeetingService, useValue: { addAgendaItem: add, updateAgendaItem: update, removeAgendaItem: remove, guestCandidates: () => of({ items: [], total: 0, matching: 0 }) } },
        { provide: AmConfirmService, useValue: { ask: (o: AmConfirmOptions) => asked.push(o) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    const fixture = TestBed.createComponent(MeetingAgendaItemDialogComponent);
    fixture.componentRef.setInput('meeting', aMeeting());
    fixture.componentRef.setInput('attendees', [anAttendee({ id: 'a-1', name: 'Dr. Nora' }), anAttendee({ id: 'a-2', name: 'Eng. Saad', kind: 'ORG_GUEST', seat: null })]);
    fixture.componentRef.setInput('item', item);
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    const saved: MeetingAgendaItemDto[][] = [];
    fixture.componentInstance.saved.subscribe((a) => saved.push(a));
    return { c: fixture.componentInstance, fixture, saved };
  }

  afterEach(() => document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove()));

  it('adds an item with an invitee presenting, trimmed, and hands back the agenda', () => {
    const { c, saved } = create();
    c.form.patchValue({ title: '  Isolation rooms  ', description: '  ', presenter: 'attendee:a-2', durationMinutes: 15 });
    c.submit();
    expect(add).toHaveBeenCalledWith('m-1', { title: 'Isolation rooms', description: null, durationMinutes: 15, presenter: { attendeeId: 'a-2' } });
    expect(saved).toEqual([[ITEM]]);
  });

  it('a person found by name presents by their user id, and the dialog says they become a guest', () => {
    const { c } = create();
    c.form.patchValue({ title: 'Item' });
    c.onPicked({ id: 'u-9', name: 'Eng. Khalid', unit: null, position: null });
    expect(c.presenterHint()).toBe('meeting.agendaItem.addedAsGuest');
    c.submit();
    expect(add.calls.mostRecent().args[1].presenter).toEqual({ userId: 'u-9' });
  });

  it('no presenter sends null, and an invitee presenter says nothing extra', () => {
    const { c } = create();
    c.form.patchValue({ title: 'Item', presenter: 'attendee:a-1' });
    expect(c.presenterHint()).toBe('');
    c.form.patchValue({ presenter: 'none' });
    c.submit();
    expect(add.calls.mostRecent().args[1].presenter).toBeNull();
  });

  it('a title of spaces is no title: nothing is sent', () => {
    const { c } = create();
    c.form.patchValue({ title: '   ' });
    c.submit();
    expect(add).not.toHaveBeenCalled();
    expect(c.showErrors()).toBeTrue();
  });

  it("Edit opens on the item's own values and sends ONLY what this person changed (P198)", () => {
    const { c } = create(ITEM);
    expect(c.form.getRawValue()).toEqual({ title: 'Isolation rooms', description: 'Status.', presenter: 'attendee:a-1', durationMinutes: 10 });
    c.form.patchValue({ title: 'Isolation rooms, phase 2' });
    c.submit();
    // Not the duration, the description or the presenter: someone else may have changed them since.
    expect(update).toHaveBeenCalledWith('m-1', 'i-4', { title: 'Isolation rooms, phase 2' });
    expect(add).not.toHaveBeenCalled();
  });

  it('an edit of the presenter and the duration sends those two; a cleared presenter is null', () => {
    const { c } = create(ITEM);
    c.form.patchValue({ presenter: 'none', durationMinutes: 20 });
    c.submit();
    expect(update).toHaveBeenCalledWith('m-1', 'i-4', { durationMinutes: 20, presenter: null });
  });

  it('Save with nothing changed sends nothing and closes', () => {
    const { c } = create(ITEM);
    const closed = jasmine.createSpy('closed');
    c.visibleChange.subscribe(closed);
    c.form.patchValue({ title: '  Isolation rooms  ' });
    c.submit();
    expect(update).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledWith(false);
  });

  for (const code of ['MEETING_AGENDA_ITEM_NOT_FOUND', 'MEETING_AGENDA_ORDER_MISMATCH', 'MEETING_AGENDA_CHANGED']) {
    it(`${code}: the dialog offers Reload, never Save again, which closes it and asks the page to read the meeting`, () => {
      const { c, fixture } = create(ITEM);
      const closed = jasmine.createSpy('closed');
      const reload = jasmine.createSpy('reload');
      c.visibleChange.subscribe(closed);
      c.reload.subscribe(reload);
      update.and.returnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { code } })));
      c.form.patchValue({ title: 'Changed' });
      c.submit();
      fixture.detectChanges();
      expect(document.querySelector('[data-testid="agenda-item-save"]')).toBeNull();
      const button = document.querySelector<HTMLElement>('[data-testid="agenda-item-reload"] button')!;
      expect(button.textContent?.trim()).toBe(en.meeting.agenda.reload);
      button.click();
      expect(closed).toHaveBeenCalledWith(false);
      expect(reload).toHaveBeenCalledTimes(1);
    });
  }

  it('any other refusal keeps Save, with no Reload', () => {
    const { c, fixture } = create(ITEM);
    update.and.returnValue(throwError(() => new HttpErrorResponse({ status: 404, error: { code: 'MEETING_PRESENTER_NOT_FOUND' } })));
    c.form.patchValue({ title: 'Changed' });
    c.submit();
    fixture.detectChanges();
    expect(document.querySelector('[data-testid="agenda-item-reload"]')).toBeNull();
    expect(document.querySelector('[data-testid="agenda-item-save"]')).not.toBeNull();
  });

  it('the search for a person is offered only to whoever may add guests; an invitee can still be picked', () => {
    const { fixture, c } = create();
    expect(document.querySelector('[data-testid="agenda-item-find-person"]')).not.toBeNull();
    fixture.componentRef.setInput('meeting', aMeeting({ may: { edit: true, reschedule: true, manageGuests: false, manageAgenda: true, answer: true } }));
    fixture.detectChanges();
    expect(document.querySelector('[data-testid="agenda-item-find-person"]')).toBeNull();
    expect(c.presenterOptions().map((o) => o.value)).toContain('attendee:a-2');
  });

  it('Remove asks first, naming the item, and removes only on Accept', () => {
    const { c, saved } = create(ITEM);
    c.askRemove();
    expect(remove).not.toHaveBeenCalled();
    expect(asked[0]!.message).toContain('Isolation rooms');
    expect(asked[0]!.tone).toBe('destructive');
    asked[0]!.accept();
    expect(remove).toHaveBeenCalledWith('m-1', 'i-4');
    expect(saved).toEqual([[]]);
  });

  it('a refusal is said from its code, and the dialog stays open', () => {
    const { c, fixture } = create();
    const closed = jasmine.createSpy('closed');
    c.visibleChange.subscribe(closed);
    add.and.returnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'MEETING_PRESENTER_NOT_FOUND', message: 'Presenter not found' } })));
    c.form.patchValue({ title: 'Item' });
    c.submit();
    fixture.detectChanges();
    expect(c.error()).toBe('meeting.refusal.presenterNotFound');
    expect(closed).not.toHaveBeenCalled();
  });
});
