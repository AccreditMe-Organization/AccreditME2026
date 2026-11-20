import { HttpErrorResponse } from '@angular/common/http';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { of, throwError } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { FormatService } from '../../../../core/formatting';
import { TestFormatContext } from '../../../../core/formatting/format-context';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { aMeeting, aSeries } from '../../meeting-fixtures.testing';
import { MeetingService, type MeetingClashDto, type MeetingDto } from '../../services/meeting.service';
import { MeetingScopeDialogComponent } from '../meeting-scope-dialog/meeting-scope-dialog.component';
import { By } from '@angular/platform-browser';
import { MeetingRescheduleDialogComponent } from './meeting-reschedule-dialog.component';

// ACC-316 PR 6 review (P184) — Reschedule opens on the meeting's date and time
// as the TENANT's clock reads them, and only an opening resets it.
describe('MeetingRescheduleDialogComponent (ACC-316 PR 6)', () => {
  const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tenant = browser === 'America/New_York' ? 'Asia/Tokyo' : 'America/New_York';
  let reschedule: jasmine.Spy;
  let clashes: jasmine.Spy;

  function create(overrides: Partial<MeetingDto> = {}, clash: MeetingClashDto[] = []) {
    reschedule = jasmine.createSpy('reschedule').and.returnValue(of(aMeeting()));
    clashes = jasmine.createSpy('clashes').and.returnValue(of(clash));
    TestBed.configureTestingModule({
      imports: [MeetingRescheduleDialogComponent],
      providers: [
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({}),
        ConfirmationService,
        { provide: MeetingService, useValue: { reschedule, clashes, scopePreview: () => of({ meetings: [], kept: [], clashes: [] }) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    TestBed.inject(TestFormatContext).zone.set(tenant);
    const fixture = TestBed.createComponent(MeetingRescheduleDialogComponent);
    fixture.componentRef.setInput('meeting', aMeeting({ scheduledAt: TestBed.inject(FormatService).instantAt({ year: 2027, month: 3, day: 18, hour: 10, minute: 0 }).toISOString(), ...overrides }));
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    return { fixture, c: fixture.componentInstance };
  }

  afterEach(() => document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove()));

  it("opens on the meeting's day and time in the tenant's zone", () => {
    const { c } = create();
    expect(c.form.controls.time.value).toBe('10:00');
    const day = c.day()!;
    expect([day.getFullYear(), day.getMonth(), day.getDate()]).toEqual([2027, 2, 18]);
    // Unchanged and sent back, it is the same instant.
    c.form.controls.reason.setValue('Moved');
    c.pickDay(new Date(2027, 2, 19));
    c.submit();
    const sent = new Date(reschedule.calls.mostRecent().args[1].scheduledAt);
    expect(TestBed.inject(FormatService).wallClock(sent)).toEqual({ year: 2027, month: 3, day: 19, hour: 10, minute: 0 });
  });

  it('a reload of the meeting while it is open keeps what the person typed', () => {
    const { fixture, c } = create();
    c.form.controls.reason.setValue('The chair is travelling');
    c.form.controls.time.setValue('14:30');
    fixture.componentRef.setInput('meeting', aMeeting({ updatedAt: '2027-03-02T08:00:00.000Z' }));
    fixture.detectChanges();
    expect(c.form.controls.reason.value).toBe('The chair is travelling');
    expect(c.form.controls.time.value).toBe('14:30');
  });

  // ── PR 8c ──────────────────────────────────────────────────────────────────

  const someoneBusy = (startsAt: string): MeetingClashDto => ({
    startsAt,
    invitees: 10,
    people: [
      { userId: 'u-1', name: 'Omar Haddad', meetings: [{ id: 'o-1', title: 'Antimicrobial Stewardship', startsAt, durationMinutes: 90 }] },
      { userId: 'u-2', name: 'Eng. Khalid Al-Shehri', meetings: [{ id: null, title: null, startsAt, durationMinutes: 60 }] },
    ],
  });
  const text = (id: string) => document.querySelector(`[data-testid="${id}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

  it('the clash line: asked for the new time with the meeting\'s own duration, and again as the time changes; rows in place', fakeAsync(() => {
    const { fixture, c } = create({}, [someoneBusy('x')]);
    tick(250);
    fixture.detectChanges();
    const first = clashes.calls.mostRecent().args[0];
    expect(first.meetingId).toBe('m-1');
    expect(first.times[0].durationMinutes).toBe(90);
    expect(TestBed.inject(FormatService).wallClock(new Date(first.times[0].startsAt))).toEqual({ year: 2027, month: 3, day: 18, hour: 10, minute: 0 });
    expect(Array.from(document.querySelectorAll('[data-testid="meeting-clash-line"] > *')).map((n) => n.textContent!.trim())).toEqual(['2 of 10 invitees have another meeting then', 'Show who']);
    (document.querySelector('[data-testid="meeting-clash-toggle"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    // In place, in the dialog's own body, and scrolling inside itself.
    const rows = document.querySelector('[data-testid="reschedule-when-block"] [data-testid="meeting-clash-rows"]')!;
    expect(rows.classList).toContain('am-clash__rows--capped');
    expect(rows.querySelectorAll('li').length).toBe(2);
    expect(text('meeting-clash-toggle')).toBe('Hide');

    c.form.controls.time.setValue('14:30');
    fixture.detectChanges();
    tick(250);
    fixture.detectChanges();
    expect(TestBed.inject(FormatService).wallClock(new Date(clashes.calls.mostRecent().args[0].times[0].startsAt))).toEqual({ year: 2027, month: 3, day: 18, hour: 14, minute: 30 });
    c.pickDay(new Date(2027, 2, 25));
    fixture.detectChanges();
    tick(250);
    expect(TestBed.inject(FormatService).wallClock(new Date(clashes.calls.mostRecent().args[0].times[0].startsAt))).toEqual({ year: 2027, month: 3, day: 25, hour: 14, minute: 30 });
    // Nobody busy: no line, and the rows fold.
    clashes.and.returnValue(of([{ startsAt: 'x', invitees: 10, people: [] }]));
    c.form.controls.time.setValue('16:00');
    fixture.detectChanges();
    tick(250);
    fixture.detectChanges();
    expect(document.querySelector('[data-testid="meeting-clash"]')).toBeNull();
    expect(c.showWho()).toBeFalse();
  }));

  it('a failed clash check says nothing, and Reschedule stays enabled', fakeAsync(() => {
    clashes = jasmine.createSpy();
    const { fixture } = create();
    clashes.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    tick(250);
    fixture.detectChanges();
    expect(document.querySelector('[data-testid="meeting-clash"]')).toBeNull();
    expect((document.querySelector('[data-testid="reschedule-submit"] button') as HTMLButtonElement).disabled).toBeFalse();
  }));

  it('one meeting: the button reads Reschedule and the write has no scope', () => {
    const { c } = create();
    expect(text('reschedule-submit')).toBe('Reschedule');
    c.form.controls.reason.setValue('Moved');
    c.submit();
    expect(reschedule).toHaveBeenCalledTimes(1);
    expect(reschedule.calls.mostRecent().args[1].scope).toBeUndefined();
  });

  it('in a series: Next, then "Which meetings change?", and Apply sends its scope', () => {
    const { fixture, c } = create({ series: aSeries() });
    fixture.detectChanges();
    expect(text('reschedule-submit')).toBe('Next');
    c.form.controls.time.setValue('14:00');
    c.form.controls.reason.setValue('The chair is travelling');
    c.submit();
    fixture.detectChanges();
    expect(reschedule).withContext('nothing is written before Apply').not.toHaveBeenCalled();
    expect(c.scopeOpen()).toBeTrue();
    const change = c.scopeChange()!;
    expect(change.change).toBe('RESCHEDULE');
    expect(TestBed.inject(FormatService).wallClock(new Date((change as { scheduledAt: string }).scheduledAt))).toEqual({ year: 2027, month: 3, day: 18, hour: 14, minute: 0 });
    const scope = fixture.debugElement.query(By.directive(MeetingScopeDialogComponent)).componentInstance as MeetingScopeDialogComponent;
    scope.applied.emit('THIS_AND_LATER');
    expect(reschedule).toHaveBeenCalledTimes(1);
    const [id, body] = reschedule.calls.mostRecent().args;
    expect(id).toBe('m-1');
    expect(body).toEqual(jasmine.objectContaining({ reason: 'The chair is travelling', scope: 'THIS_AND_LATER', expectedUpdatedAt: '2027-03-01T08:00:00.000Z' }));
    expect(body.scheduledAt).toBe((change as { scheduledAt: string }).scheduledAt);
    expect(c.scopeOpen()).withContext('both close on success').toBeFalse();
  });

  it('in a series: a refused Apply is said in the scope confirm, from its code', () => {
    const { fixture, c } = create({ series: aSeries() });
    reschedule.and.returnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'MEETING_CHANGED' } })));
    c.form.controls.reason.setValue('Moved');
    c.submit();
    fixture.detectChanges();
    c.send('THIS_ONLY');
    fixture.detectChanges();
    expect(c.scopeOpen()).toBeTrue();
    expect(c.scopeError()).toBe('meeting.refusal.changed');
    expect(c.error()).toBeNull();
  });

  it('a new opening starts again from the meeting', () => {
    const { fixture, c } = create();
    c.form.controls.reason.setValue('Typed');
    fixture.componentRef.setInput('visible', false);
    fixture.detectChanges();
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    expect(c.form.controls.reason.value).toBe('');
  });
});
