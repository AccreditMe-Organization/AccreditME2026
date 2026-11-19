import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { Subject, of, throwError } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { aMeeting, anAttendee } from '../../meeting-fixtures.testing';
import { MeetingService, type MeetingAgendaItemDto } from '../../services/meeting.service';
import { MeetingAgendaPanelComponent } from './meeting-agenda-panel.component';

// ACC-316 PR 7 — the Agenda panel: the editor only for whoever may manage the
// agenda, reordering by the handle's arrow keys (the server's order shown
// after), the planned minutes, each item's presenter line, and its papers.
describe('MeetingAgendaPanelComponent (ACC-316 PR 7)', () => {
  const item = (id: string, order: number, over: Partial<MeetingAgendaItemDto> = {}): MeetingAgendaItemDto => ({ id, order, title: `Item ${order}`, description: null, durationMinutes: null, standing: false, presenter: null, ...over });
  const ITEMS = [item('i-1', 1, { durationMinutes: 10, standing: true }), item('i-2', 2, { durationMinutes: 30, presenter: { attendeeId: 'a-1', name: 'Dr. Nora Al-Otaibi', kind: 'MEMBER' } }), item('i-3', 3)];
  let order: jasmine.Spy;

  function create(canManage: boolean, items = ITEMS) {
    order = jasmine.createSpy('order').and.callFake((_id: string, ids: string[]) => of(ids.map((id, i) => ({ ...ITEMS.find((x) => x.id === id)!, order: i + 1 }))));
    TestBed.configureTestingModule({
      imports: [MeetingAgendaPanelComponent],
      providers: [
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({}),
        ConfirmationService,
        { provide: MeetingService, useValue: { orderAgenda: order, guestCandidates: () => of({ items: [], total: 0, matching: 0 }) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    const fixture = TestBed.createComponent(MeetingAgendaPanelComponent);
    fixture.componentRef.setInput('meeting', aMeeting({ durationMinutes: 90 }));
    fixture.componentRef.setInput('items', items);
    fixture.componentRef.setInput('attendees', [anAttendee({ id: 'a-1', name: 'Dr. Nora Al-Otaibi' })]);
    fixture.componentRef.setInput('papers', [{ id: 'f-1', agendaItemId: 'i-2', name: 'October incidents.pdf', mimeType: 'application/pdf', sizeBytes: 1000, uploadedAt: '2027-03-01T08:00:00Z' }]);
    fixture.componentRef.setInput('canManage', canManage);
    fixture.detectChanges();
    const changes: MeetingAgendaItemDto[][] = [];
    fixture.componentInstance.itemsChange.subscribe((a) => changes.push(a));
    return { fixture, c: fixture.componentInstance, el: fixture.nativeElement as HTMLElement, changes };
  }

  afterEach(() => document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove()));

  it('says how much of the meeting is planned, and each item who presents, their seat and how long', () => {
    const { el } = create(false);
    expect(el.querySelector('[data-testid="meeting-agenda-planned"]')?.textContent?.trim()).toBe('40 of 90 min planned');
    expect(el.querySelector('[data-agenda-item="i-2"]')?.textContent).toContain('Dr. Nora Al-Otaibi · Chairman · 30 min');
    expect(el.querySelector('[data-agenda-item="i-2"] [data-file="f-1"]')?.textContent).toContain('October incidents.pdf');
  });

  it('offers no add, edit, handle or paper button to someone who may not manage the agenda', () => {
    const { el } = create(false);
    expect(el.querySelector('[data-testid="meeting-agenda-add"]')).toBeNull();
    expect(el.querySelector('[data-testid="meeting-agenda-handle"]')).toBeNull();
    expect(el.querySelector('[data-testid="meeting-agenda-edit-i-1"]')).toBeNull();
    expect(el.querySelector('[data-testid="meeting-papers-i-1-add"]')).toBeNull();
  });

  it('offers them all to whoever may', () => {
    const { el } = create(true);
    expect(el.querySelector('[data-testid="meeting-agenda-add"]')).not.toBeNull();
    expect(el.querySelectorAll('[data-testid="meeting-agenda-handle"]').length).toBe(3);
    expect(el.querySelector('[data-testid="meeting-agenda-edit-i-1"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="meeting-papers-i-1-add"]')).not.toBeNull();
  });

  it("ArrowDown on an item's handle moves it one place, and the server's order is shown", () => {
    const { el, changes } = create(true);
    const handle = el.querySelector<HTMLButtonElement>('[data-agenda-item="i-1"] [data-testid="meeting-agenda-handle"]')!;
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    // With the order the person saw, so a reorder made meanwhile is refused, never undone.
    expect(order).toHaveBeenCalledWith('m-1', ['i-2', 'i-1', 'i-3'], ['i-1', 'i-2', 'i-3']);
    expect(changes[0]!.map((i) => i.id)).toEqual(['i-2', 'i-1', 'i-3']);
  });

  it('ArrowUp on the first item, or another key, moves nothing', () => {
    const { el } = create(true);
    const handle = el.querySelector<HTMLButtonElement>('[data-agenda-item="i-1"] [data-testid="meeting-agenda-handle"]')!;
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(order).not.toHaveBeenCalled();
  });

  it('a refused reorder is said from its code', () => {
    const { el, fixture, changes } = create(true);
    order.and.returnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'MEETING_PRESENTER_NOT_FOUND' } })));
    el.querySelector<HTMLButtonElement>('[data-agenda-item="i-2"] [data-testid="meeting-agenda-handle"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="meeting-agenda-error"]')?.textContent?.trim()).toBe(en.meeting.refusal.presenterNotFound);
    expect(el.querySelector('[data-testid="meeting-agenda-reload"]')).toBeNull();
    expect(changes).toEqual([]);
  });

  for (const [code, key] of [
    ['MEETING_AGENDA_CHANGED', 'agendaChanged'],
    ['MEETING_AGENDA_ORDER_MISMATCH', 'agendaOrderMismatch'],
    ['MEETING_AGENDA_ITEM_NOT_FOUND', 'agendaItemNotFound'],
  ] as const) {
    it(`${code}: said, with Reload the meeting, which asks the page to read it again (P198)`, () => {
      const { el, fixture, c } = create(true);
      const reload = jasmine.createSpy('reload');
      c.reload.subscribe(reload);
      order.and.returnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { code } })));
      el.querySelector<HTMLButtonElement>('[data-agenda-item="i-2"] [data-testid="meeting-agenda-handle"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="meeting-agenda-error"]')?.textContent).toContain(en.meeting.refusal[key]);
      const button = el.querySelector<HTMLElement>('[data-testid="meeting-agenda-reload"] button')!;
      expect(button.textContent?.trim()).toBe(en.meeting.agenda.reload);
      button.click();
      expect(reload).toHaveBeenCalledTimes(1);
    });
  }

  it("a re-read the page could not make is said in the panel, with Retry (P198)", () => {
    const { el, fixture, c } = create(true);
    const retry = jasmine.createSpy('retry');
    c.retryRead.subscribe(retry);
    expect(el.querySelector('[data-testid="meeting-agenda-read-error"]')).toBeNull();
    fixture.componentRef.setInput('readError', 'meeting.files.loadFailed');
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="meeting-agenda-read-error"]')?.textContent).toContain(en.meeting.files.loadFailed);
    el.querySelector<HTMLElement>('[data-testid="meeting-agenda-read-retry"] button')!.click();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  for (const [key, id, expected] of [
    ['ArrowUp', 'i-3', ['i-1', 'i-3', 'i-2']],
    ['ArrowUp', 'i-2', ['i-2', 'i-1', 'i-3']],
    ['ArrowDown', 'i-2', ['i-1', 'i-3', 'i-2']],
  ] as const) {
    it(`${key} on ${id}: focus is back on that item's handle once its row is redrawn in its new place (P198)`, () => {
      const { el, fixture, changes } = create(true);
      document.body.appendChild(el);
      try {
        const handleOf = (x: string) => el.querySelector<HTMLButtonElement>(`[data-agenda-item="${x}"] [data-testid="meeting-agenda-handle"]`)!;
        handleOf(id).focus();
        document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        fixture.componentRef.setInput('items', changes[0]!);
        fixture.detectChanges();
        expect(changes[0]!.map((i) => i.id)).toEqual([...expected]);
        expect(document.activeElement).toBe(handleOf(id));
      } finally {
        el.remove();
      }
    });
  }

  it('the handle keeps focus while a move saves and after it, so a second ArrowDown moves the item again (P198)', () => {
    const { el, fixture, changes } = create(true);
    document.body.appendChild(el);
    try {
      const pending = new Subject<MeetingAgendaItemDto[]>();
      order.and.returnValue(pending);
      const handleOf = (id: string) => el.querySelector<HTMLButtonElement>(`[data-agenda-item="${id}"] [data-testid="meeting-agenda-handle"]`)!;
      handleOf('i-1').focus();
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      fixture.detectChanges();
      // Saving: the handle says it is unavailable, but is never disabled, so the browser keeps focus on it.
      expect(handleOf('i-1').disabled).toBeFalse();
      expect(handleOf('i-1').getAttribute('aria-disabled')).toBe('true');
      expect(document.activeElement).toBe(handleOf('i-1'));
      // A key while saving is ignored.
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      expect(order).toHaveBeenCalledTimes(1);

      pending.next([ITEMS[1]!, ITEMS[0]!, ITEMS[2]!].map((x, i) => ({ ...x, order: i + 1 })));
      pending.complete();
      fixture.componentRef.setInput('items', changes[0]!);
      fixture.detectChanges();
      expect(document.activeElement).toBe(handleOf('i-1'));

      order.and.callFake((_id: string, ids: string[]) => of(ids.map((id, i) => ({ ...ITEMS.find((x) => x.id === id)!, order: i + 1 }))));
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      expect(order).toHaveBeenCalledTimes(2);
      expect(order.calls.mostRecent().args).toEqual(['m-1', ['i-2', 'i-3', 'i-1'], ['i-2', 'i-1', 'i-3']]);
    } finally {
      el.remove();
    }
  });

  it('with no meeting length, no planned line; with no items, the empty sentence', () => {
    const { fixture, el } = create(false, []);
    fixture.componentRef.setInput('meeting', aMeeting({ durationMinutes: null }));
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="meeting-agenda-planned"]')).toBeNull();
    expect(el.textContent).toContain(en.meeting.agenda.empty);
  });
});
