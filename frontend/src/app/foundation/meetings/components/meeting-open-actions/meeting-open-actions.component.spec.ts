import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import { of } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { aMinutes } from '../../meeting-fixtures.testing';
import { MeetingService, type MeetingOpenActionRowDto, type MeetingOpenActionsDto } from '../../services/meeting.service';
import { MeetingOpenActionsComponent } from './meeting-open-actions.component';

// ACC-316 PR 7b — "Open actions from the last meeting": drawn only when the
// server gives rows (mayRead), a title linked only where the task page would
// open it, the status the task's, and a note only for whoever records the minutes.
describe('MeetingOpenActionsComponent (ACC-316 PR 7b)', () => {
  const row = (over: Partial<MeetingOpenActionRowDto> = {}): MeetingOpenActionRowDto => ({
    taskId: 't-1',
    title: 'Re-audit wards 4B and 6A',
    status: 'IN_PROGRESS',
    dueAt: '2027-03-30T13:00:00.000Z',
    owner: { id: 'u-1', name: 'Huda Al-Harbi' },
    fromMeetingId: 'm-0',
    note: null,
    mayOpen: true,
    ...over,
  });
  let save: jasmine.Spy;

  function create(read: MeetingOpenActionsDto | null, canNote = false) {
    save = jasmine.createSpy('save').and.returnValue(of(aMinutes({ openActions: [{ ...row(), note: 'Chased on 2 Mar' }] })));
    TestBed.configureTestingModule({
      imports: [MeetingOpenActionsComponent],
      providers: [provideRouter([]), provideNoopAnimations(), provideTranslateService({ lang: 'en' }), provideFormatTesting(), providePrimeNG({}), { provide: MeetingService, useValue: { saveOpenActionNote: save } }],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    const fixture = TestBed.createComponent(MeetingOpenActionsComponent);
    fixture.componentRef.setInput('meetingId', 'm-1');
    fixture.componentRef.setInput('openActions', read);
    fixture.componentRef.setInput('canNote', canNote);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('is not drawn for someone who may not read the last minutes, nor when nothing is open', () => {
    // Whatever rows came with it, mayRead false draws nothing.
    expect(create({ mayRead: false, rows: [row()] }).el.querySelector('[data-testid="meeting-open-actions"]')).toBeNull();
    TestBed.resetTestingModule();
    expect(create({ mayRead: true, rows: [] }).el.querySelector('[data-testid="meeting-open-actions"]')).toBeNull();
  });

  it('a row: its title linked to the task, the owner, the due date and the task status', () => {
    const { el } = create({ mayRead: true, rows: [row()] });
    expect(el.querySelector('[data-testid="meeting-open-actions"] h3')?.textContent).toContain('Open actions from the last meeting');
    const link = el.querySelector<HTMLAnchorElement>('[data-open-action="t-1"] [data-open-action-link]')!;
    expect(link.getAttribute('href')).toBe('/tasks/t-1');
    expect(el.querySelector('[data-open-action="t-1"]')?.textContent).toContain('Huda Al-Harbi');
    expect(el.querySelector('[data-open-action="t-1"]')?.textContent).toContain('In progress');
  });

  it('a task the page would not open for this viewer is a title, not a link', () => {
    const { el } = create({ mayRead: true, rows: [row({ mayOpen: false })] });
    expect(el.querySelector('[data-open-action-link]')).toBeNull();
    expect(el.querySelector('[data-open-action-title]')?.textContent?.trim()).toBe('Re-audit wards 4B and 6A');
  });

  it('whoever records the minutes notes a row, trimmed, and the stored note is shown', () => {
    const { el, fixture } = create({ mayRead: true, rows: [row()] }, true);
    const input = el.querySelector<HTMLInputElement>('[data-open-action-note="t-1"]')!;
    input.value = '  Chased on 2 Mar  ';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    el.querySelector<HTMLElement>('[data-open-action-save="t-1"] button')!.click();
    fixture.detectChanges();
    expect(save).toHaveBeenCalledOnceWith('m-1', 't-1', 'Chased on 2 Mar');
    expect(el.querySelector('[data-open-action-save="t-1"]')).toBeNull();
  });

  it('anyone else reads the note, with no box', () => {
    const { el } = create({ mayRead: true, rows: [row({ note: 'Waiting for the vendor' })] }, false);
    expect(el.querySelector('[data-open-action-note]')).toBeNull();
    expect(el.querySelector('[data-open-action-note-text]')?.textContent).toContain('Waiting for the vendor');
  });

  it('a new read (the page reloaded) drops a note saved here: the read is the truth (P206)', () => {
    const { el, fixture } = create({ mayRead: true, rows: [row()] }, true);
    const input = el.querySelector<HTMLInputElement>('[data-open-action-note="t-1"]')!;
    input.value = 'Chased on 2 Mar';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    el.querySelector<HTMLElement>('[data-open-action-save="t-1"] button')!.click();
    fixture.detectChanges();
    fixture.componentRef.setInput('openActions', { mayRead: true, rows: [row({ note: 'Changed since' })] });
    fixture.detectChanges();
    expect(fixture.componentInstance.rows()[0]!.note).toBe('Changed since');
  });
});
