import { HttpErrorResponse } from '@angular/common/http';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { Subject, of, throwError } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { TestFormatContext } from '../../../../core/formatting/format-context';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { aMeeting, aSeries } from '../../meeting-fixtures.testing';
import { MeetingService, type MeetingClashDto, type MeetingScopePreviewDto, type MeetingScopePreviewRequest } from '../../services/meeting.service';
import { MeetingScopeDialogComponent } from './meeting-scope-dialog.component';

// ACC-316 PR 8c — "Which meetings change?" (artboards 10–11): its two choices,
// the range the SERVER works out, the kept lines, and each choice's own clash
// line. It writes nothing: Apply hands the scope back.

const at = (iso: string) => `${iso}T10:30:00.000Z`;
const clashAt = (startsAt: string, people: [string, string, string | null][]): MeetingClashDto => ({
  startsAt,
  invitees: 9,
  people: people.map(([userId, name, title]) => ({ userId, name, meetings: [{ id: title ? `o-${userId}` : null, title, startsAt, durationMinutes: 60 }] })),
});

function aPreview(overrides: Partial<MeetingScopePreviewDto> = {}): MeetingScopePreviewDto {
  const days = ['2027-03-18', '2027-04-22', '2027-05-27', '2027-06-24', '2027-07-22', '2027-08-26', '2027-09-23', '2027-10-28'];
  return {
    meetings: days.map((d, i) => ({ id: `m-${i + 4}`, title: `PTC · ${d}`, startsAt: at(d), durationMinutes: 90 })),
    kept: [],
    clashes: [],
    ...overrides,
  };
}

describe('MeetingScopeDialogComponent (ACC-316 PR 8c)', () => {
  // Its Arabic test switches the language: <html> is put back after each test.
  preserveDocumentLanguage();
  let scopePreview: jasmine.Spy;
  let clashes: jasmine.Spy;

  function create(change: MeetingScopePreviewRequest, preview: unknown = of(aPreview()), clash: MeetingClashDto[] = []) {
    scopePreview = jasmine.createSpy('scopePreview').and.returnValue(preview);
    clashes = jasmine.createSpy('clashes').and.returnValue(of(clash));
    TestBed.configureTestingModule({
      imports: [MeetingScopeDialogComponent],
      providers: [
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({}),
        ConfirmationService,
        { provide: MeetingService, useValue: { scopePreview, clashes } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    TestBed.inject(TestFormatContext).zone.set('UTC');
    const fixture = TestBed.createComponent(MeetingScopeDialogComponent);
    fixture.componentRef.setInput('meeting', aMeeting({ scheduledAt: at('2027-03-18'), series: aSeries() }));
    fixture.componentRef.setInput('change', change);
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    const applied: string[] = [];
    fixture.componentInstance.applied.subscribe((s) => applied.push(s));
    const text = (id: string) => document.querySelector(`[data-testid="${id}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
    return { fixture, c: fixture.componentInstance, applied, text };
  }

  afterEach(() => document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove()));
  /** The clash line's words, then its toggle's. */
  const line = () => Array.from(document.querySelectorAll('[data-testid="meeting-clash-line"] > *')).map((n) => n.textContent!.replace(/\s+/g, ' ').trim());

  it('opens on "This meeting only", says past meetings never change, and names the meeting and its new time', () => {
    const { c, text } = create({ change: 'RESCHEDULE', scheduledAt: '2027-03-18T14:00:00.000Z' });
    expect(c.scope()).toBe('THIS_ONLY');
    expect(document.body.textContent).toContain('Past meetings never change.');
    expect(c.context()).toBe('Quarterly review of high-alert medication incidents · 4 of 12 · new time 14:00');
    // The same day: the time alone. Another day: the date and time.
    expect(text('scope-THIS_ONLY-line')).toBe('18 Mar 2027 moves to 14:00');
  });

  it('a move to another day names the day; an edit names only the meeting', () => {
    const moved = create({ change: 'RESCHEDULE', scheduledAt: '2027-03-25T09:00:00.000Z' });
    expect(moved.text('scope-THIS_ONLY-line')).toBe('18 Mar 2027 moves to 25 Mar 2027, 09:00');
    TestBed.resetTestingModule();
    document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove());
    const edited = create({ change: 'EDIT', location: 'Room 4' });
    expect(edited.text('scope-THIS_ONLY-line')).toBe('18 Mar 2027 only');
    expect(edited.c.context()).toBe('Quarterly review of high-alert medication incidents · 4 of 12');
  });

  it('"This and all later meetings" reads the range the server worked out, never a guess', () => {
    const { text } = create({ change: 'RESCHEDULE', scheduledAt: '2027-03-18T14:00:00.000Z' });
    expect(scopePreview).toHaveBeenCalledOnceWith('m-1', { change: 'RESCHEDULE', scheduledAt: '2027-03-18T14:00:00.000Z' });
    expect(text('scope-THIS_AND_LATER-line')).toBe('8 meetings, 18 Mar 2027 → 28 Oct 2027');
  });

  it('one meeting reads as one date; while the server works, it says so', () => {
    const one = create({ change: 'EDIT', location: 'Room 4' }, of(aPreview({ meetings: [{ id: 'm-1', title: 'PTC', startsAt: at('2027-03-18'), durationMinutes: 90 }] })));
    expect(one.text('scope-THIS_AND_LATER-line')).toBe('1 meeting, 18 Mar 2027');
    TestBed.resetTestingModule();
    document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove());
    const pending = create({ change: 'EDIT', location: 'Room 4' }, new Subject());
    expect(pending.text('scope-THIS_AND_LATER-line')).toBe('Working out which meetings…');
  });

  it('a later meeting that kept its own edit is said as kept, with what it kept; beyond one, a count', () => {
    const kept = [
      { meetingId: 'm-6', title: 'PTC · May', fields: ['scheduledAt' as const], startsAt: '2027-05-27T07:00:00.000Z' },
      { meetingId: 'm-7', title: 'PTC · June', fields: ['meetingUrl' as const, 'location' as const], startsAt: at('2027-06-24') },
      { meetingId: 'm-8', title: 'PTC · July', fields: ['durationMinutes' as const], startsAt: at('2027-07-22') },
    ];
    const { fixture } = create({ change: 'RESCHEDULE', scheduledAt: '2027-03-18T14:00:00.000Z' }, of(aPreview({ kept })));
    fixture.detectChanges();
    const lines = Array.from(document.querySelectorAll('[data-testid="scope-kept"]')).map((n) => n.textContent!.trim());
    expect(lines).toEqual(['Kept its own edit: 27 May 2027 (its own time, 07:00)']);
    expect(document.querySelector('[data-testid="scope-kept-more"]')!.textContent!.trim()).toBe('and 2 more kept their own edits');
  });

  it("each choice has its own clash line: this meeting's people, or the later meetings that have one", () => {
    const later = [clashAt(at('2027-05-27'), [['u-1', 'Omar Haddad', 'Antimicrobial Stewardship']]), clashAt(at('2027-09-23'), [['u-2', 'Dr. Huda Zahrani', null]])];
    const mine = clashAt('2027-03-18T14:00:00.000Z', [['u-3', 'Fahad Al-Anazi', 'Infection Control']]);
    const { fixture, c, text } = create({ change: 'RESCHEDULE', scheduledAt: '2027-03-18T14:00:00.000Z' }, of(aPreview({ clashes: later })), [mine]);
    // This meeting alone, at its new time, with the meeting's own duration.
    expect(clashes).toHaveBeenCalledOnceWith({ meetingId: 'm-1', times: [{ startsAt: '2027-03-18T14:00:00.000Z', durationMinutes: 90 }] });
    fixture.detectChanges();
    expect(line()).toEqual(['1 of 9 invitees has another meeting then', 'Show who']);

    c.choose('THIS_AND_LATER');
    fixture.detectChanges();
    expect(line()).toEqual(['2 of the 8 meetings have a clash', 'Show which']);
    expect(document.querySelector('[data-testid="meeting-clash-rows"]')).toBeNull();
    (document.querySelector('[data-testid="meeting-clash-toggle"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="meeting-clash-rows"] li')).map((n) => n.innerText.replace(/\s+/g, ' ').trim());
    expect(rows).toEqual(['Thu 27 May 2027 Omar Haddad · Antimicrobial Stewardship 10:30–11:30', 'Thu 23 Sep 2027 Dr. Huda Zahrani · another meeting 10:30–11:30']);
    // The rows scroll inside a fixed height, and say what they are.
    expect(document.querySelector('[data-testid="meeting-clash-rows"]')!.getAttribute('aria-label')).toBe('Other meetings at that time');
    // Changing the choice folds them again.
    c.choose('THIS_ONLY');
    fixture.detectChanges();
    expect(document.querySelector('[data-testid="meeting-clash-rows"]')).toBeNull();
  });

  it('an edit that moves no time asks no clash; a new duration does, at the meeting\'s own start', () => {
    create({ change: 'EDIT', location: 'Room 4' });
    expect(clashes).not.toHaveBeenCalled();
    TestBed.resetTestingModule();
    document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove());
    create({ change: 'EDIT', durationMinutes: 120 });
    expect(clashes).toHaveBeenCalledOnceWith({ meetingId: 'm-1', times: [{ startsAt: '2027-03-18T10:30:00.000Z', durationMinutes: 120 }] });
  });

  it('Apply hands back the choice, and writes nothing itself', () => {
    const { c, applied } = create({ change: 'EDIT', location: 'Room 4' });
    c.apply();
    c.choose('THIS_AND_LATER');
    c.apply();
    expect(applied).toEqual(['THIS_ONLY', 'THIS_AND_LATER']);
  });

  it('"This and all later" pressed before its range is known waits for it, then applies', fakeAsync(() => {
    const answer = new Subject<MeetingScopePreviewDto>();
    const { c, applied } = create({ change: 'EDIT', location: 'Room 4' }, answer);
    c.choose('THIS_AND_LATER');
    c.apply();
    expect(applied).withContext('never applied blind').toEqual([]);
    expect(c.waiting()).toBeTrue();
    answer.next(aPreview());
    tick();
    expect(applied).toEqual(['THIS_AND_LATER']);
    expect(c.waiting()).toBeFalse();
  }));

  it('a refused preview is said from its code, with no Retry; a lost one offers Retry', () => {
    const refused = create({ change: 'RESCHEDULE', scheduledAt: '2027-03-18T14:00:00.000Z' }, throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'MEETING_NOT_IN_SERIES' } })));
    refused.fixture.detectChanges();
    expect(refused.text('scope-preview-error')).toBe("This meeting isn't part of a series any more.");
    expect(document.querySelector('[data-testid="scope-preview-retry"]')).toBeNull();
    expect(refused.text('scope-THIS_AND_LATER-line')).toBe("Couldn't work out which meetings");
    TestBed.resetTestingModule();
    document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove());
    const lost = create({ change: 'RESCHEDULE', scheduledAt: '2027-03-18T14:00:00.000Z' }, throwError(() => new HttpErrorResponse({ status: 0 })));
    lost.fixture.detectChanges();
    expect(lost.text('scope-preview-error')).toContain("Couldn't work out which meetings change.");
    scopePreview.and.returnValue(of(aPreview()));
    (document.querySelector('[data-testid="scope-preview-retry"] button') as HTMLButtonElement).click();
    lost.fixture.detectChanges();
    expect(lost.text('scope-THIS_AND_LATER-line')).toBe('8 meetings, 18 Mar 2027 → 28 Oct 2027');
  });

  it('every opening starts again from "This meeting only", and asks again', () => {
    const { fixture, c } = create({ change: 'EDIT', location: 'Room 4' });
    c.choose('THIS_AND_LATER');
    fixture.componentRef.setInput('visible', false);
    fixture.detectChanges();
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    expect(c.scope()).toBe('THIS_ONLY');
    expect(scopePreview).toHaveBeenCalledTimes(2);
  });

  it('in Arabic: the lines, the count and the kept line read in Arabic', () => {
    const { fixture, text } = create(
      { change: 'RESCHEDULE', scheduledAt: '2027-03-18T14:00:00.000Z' },
      of(aPreview({ kept: [{ meetingId: 'm-6', title: 'x', fields: ['scheduledAt'], startsAt: '2027-05-27T07:00:00.000Z' }] })),
    );
    TestBed.inject(TranslateService).use('ar');
    fixture.detectChanges();
    expect(text('scope-THIS_AND_LATER-line')).toContain('8 اجتماعات، ');
    expect(text('scope-kept')).toContain('احتفظ بتعديله الخاص');
    expect(text('scope-kept')).toContain('وقته الخاص، 07:00');
  });
});
