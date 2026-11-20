import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { Observable, Subject, of, throwError } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { TestFormatContext } from '../../../../core/formatting/format-context';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { aMeeting, aSeries } from '../../meeting-fixtures.testing';
import { MeetingService, type MeetingEndSeriesPreviewDto } from '../../services/meeting.service';
import { MeetingEndSeriesDialogComponent } from './meeting-end-series-dialog.component';

// ACC-316 PR 8d — "End the monthly series?": the meeting on screen is the last
// one kept (Q4); what End cancels is the SERVER's plan, never worked out here;
// End is never pressed blind and never disabled.

const at = (iso: string) => `${iso}T10:30:00.000Z`;
const LATER = ['2026-11-26', '2026-12-24', '2027-01-28', '2027-02-25', '2027-03-25', '2027-04-22', '2027-05-27'];

function aPreview(overrides: Partial<MeetingEndSeriesPreviewDto> = {}): MeetingEndSeriesPreviewDto {
  return {
    last: { id: 'm-5', startsAt: at('2026-10-22') },
    cancelled: LATER.map((d, i) => ({ id: `m-${i + 6}`, startsAt: at(d) })),
    held: 4,
    total: 12,
    ...overrides,
  };
}

const lost = () => throwError(() => new HttpErrorResponse({ status: 0 }));
const refused = (code: string, status = 409) => throwError(() => new HttpErrorResponse({ status, error: { code } }));

describe('MeetingEndSeriesDialogComponent (ACC-316 PR 8d)', () => {
  // Its Arabic test switches the language: <html> is put back after each test.
  preserveDocumentLanguage();
  let endSeriesPreview: jasmine.Spy;
  let endSeries: jasmine.Spy;

  function create(previews: Observable<MeetingEndSeriesPreviewDto>[] = [of(aPreview())], ended: Observable<{ cancelled: string[]; failed: string[] }> = of({ cancelled: ['m-6'], failed: [] })) {
    endSeriesPreview = jasmine.createSpy('endSeriesPreview').and.returnValues(...previews);
    endSeries = jasmine.createSpy('endSeries').and.returnValue(ended);
    TestBed.configureTestingModule({
      imports: [MeetingEndSeriesDialogComponent],
      providers: [
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({}),
        ConfirmationService,
        { provide: MeetingService, useValue: { endSeriesPreview, endSeries } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    TestBed.inject(TestFormatContext).zone.set('UTC');
    const fixture = TestBed.createComponent(MeetingEndSeriesDialogComponent);
    fixture.componentRef.setInput('meeting', aMeeting({ id: 'm-5', scheduledAt: at('2026-10-22'), series: aSeries({ id: 'series-1', index: 5, mayEnd: true }) }));
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    const visible: boolean[] = [];
    let endedCount = 0;
    fixture.componentInstance.visibleChange.subscribe((v) => visible.push(v));
    fixture.componentInstance.ended.subscribe(() => (endedCount += 1));
    const text = (id: string) => document.querySelector(`[data-testid="${id}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
    const type = (value: string) => {
      fixture.componentInstance.form.controls.reason.setValue(value);
      fixture.componentInstance.form.markAsDirty();
      fixture.detectChanges();
    };
    const press = () => {
      document.querySelector<HTMLButtonElement>('[data-testid="end-series-submit"] button')!.click();
      fixture.detectChanges();
    };
    return { fixture, c: fixture.componentInstance, visible, ended: () => endedCount, text, type, press };
  }

  afterEach(() => document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove()));

  it('asks the server what End would do, after THIS meeting, and says it: last meeting, what is cancelled, how many held', () => {
    const { c, text } = create();
    expect(endSeriesPreview).toHaveBeenCalledOnceWith('series-1', { lastMeetingId: 'm-5' });
    expect(c.title()).toBe('End the monthly series?');
    expect(c.context()).toBe('Pharmacy and Therapeutics Committee · 4 of 12 held');
    expect(text('end-series-last')).toBe('22 Oct 2026');
    expect(text('end-series-cancelled')).toBe('7 meetings, 26 Nov 2026 → 27 May 2027');
  });

  it('the title follows how often the series repeats, and one cancelled meeting is named alone', () => {
    const { fixture, c, text } = create([of(aPreview({ cancelled: [{ id: 'm-6', startsAt: at('2026-10-29') }] }))]);
    fixture.componentRef.setInput('meeting', aMeeting({ id: 'm-5', series: aSeries({ every: 'WEEK_1', mayEnd: true }) }));
    expect(c.title()).toBe('End the weekly series?');
    expect(text('end-series-cancelled')).toBe('1 meeting, 29 Oct 2026');
  });

  it('nothing left to cancel reads None', () => {
    const { text } = create([of(aPreview({ cancelled: [] }))]);
    expect(text('end-series-cancelled')).toBe('None');
  });

  it('an empty reason is never sent: its error shows and focus moves to it; End stays enabled', () => {
    const { c, press } = create();
    const button = document.querySelector<HTMLButtonElement>('[data-testid="end-series-submit"] button')!;
    expect(button.disabled).toBeFalse();
    press();
    expect(endSeries).not.toHaveBeenCalled();
    expect(c.showErrors()).toBeTrue();
    expect(document.activeElement?.id).toBe('endSeriesReason');
    expect(document.body.textContent).toContain('Give a reason.');
  });

  it('ends after this meeting with the reason trimmed, closes, and the page reads the meeting again', () => {
    const { visible, ended, type, press } = create();
    type('  Merged into the quality committee  ');
    press();
    expect(endSeries).toHaveBeenCalledOnceWith('series-1', { reason: 'Merged into the quality committee', lastMeetingId: 'm-5' });
    expect(visible).toEqual([false]);
    expect(ended()).toBe(1);
  });

  it('pressed while the plan loads, it waits, and ends once the plan is on screen', () => {
    const plan = new Subject<MeetingEndSeriesPreviewDto>();
    const { c, type, press } = create([plan]);
    type('Merged');
    press();
    expect(c.waiting()).toBeTrue();
    expect(endSeries).not.toHaveBeenCalled();
    plan.next(aPreview());
    expect(endSeries).toHaveBeenCalledTimes(1);
    expect(c.waiting()).toBeFalse();
  });

  it('a lost plan offers Retry; End asks again, and ends when it arrives', () => {
    const { c, text, type, press } = create([lost(), of(aPreview())]);
    expect(text('end-series-preview-error')).toContain("Couldn't work out which meetings would be cancelled.");
    expect(document.querySelector('[data-testid="end-series-preview-retry"]')).not.toBeNull();
    type('Merged');
    press();
    expect(endSeriesPreview).toHaveBeenCalledTimes(2);
    expect(endSeries).toHaveBeenCalledTimes(1);
    expect(c.previewState()).toBe('ready');
  });

  it('a refused plan is said from its code, with no Retry, and End does nothing', () => {
    const { text, type, press } = create([refused('MEETING_NOT_ALLOWED', 403)]);
    expect(text('end-series-preview-error')).toBe(en.meeting.refusal.notAllowed);
    expect(document.querySelector('[data-testid="end-series-preview-retry"]')).toBeNull();
    type('Merged');
    press();
    expect(endSeries).not.toHaveBeenCalled();
    expect(endSeriesPreview).toHaveBeenCalledTimes(1);
  });

  it("End's refusal is said from its code, and the dialog stays open", () => {
    const { visible, ended, text, type, press } = create([of(aPreview())], refused('MEETING_SERIES_CANNOT_CANCEL', 403));
    type('Merged');
    press();
    expect(text('end-series-error')).toBe(en.meeting.refusal.seriesCannotCancel);
    expect(visible).toEqual([]);
    expect(ended()).toBe(0);
  });

  it('some meetings left uncancelled: it stays open saying how many, asks the plan again, and the page reloads on close', () => {
    const { fixture, c, visible, ended, text, type, press } = create([of(aPreview()), of(aPreview({ cancelled: [{ id: 'm-8', startsAt: at('2027-01-28') }] }))], of({ cancelled: ['m-6', 'm-7'], failed: ['m-8', 'm-9'] }));
    type('Merged');
    press();
    expect(text('end-series-partial')).toBe("2 meetings couldn't be cancelled. End series again to finish.");
    expect(endSeriesPreview).toHaveBeenCalledTimes(2);
    expect(text('end-series-cancelled')).toBe('1 meeting, 28 Jan 2027');
    expect(visible).toEqual([]);
    expect(ended()).toBe(0);
    c.onVisible(false);
    fixture.detectChanges();
    expect(ended()).toBe(1);
  });

  it('every opening starts clean: no reason, no error, a fresh plan', () => {
    const { fixture, c, type, press } = create([of(aPreview()), of(aPreview())]);
    press();
    type('Half typed');
    fixture.componentRef.setInput('visible', false);
    fixture.detectChanges();
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    expect(c.form.getRawValue().reason).toBe('');
    expect(c.showErrors()).toBeFalse();
    expect(endSeriesPreview).toHaveBeenCalledTimes(2);
  });

  it('reads in Arabic', () => {
    const { fixture, c, text } = create();
    TestBed.inject(TranslateService).use('ar');
    fixture.detectChanges();
    expect(c.title()).toBe('إنهاء السلسلة الشهرية؟');
    expect(c.context()).toContain('عُقد 4 من 12');
    expect(text('end-series-cancelled')).toBe(`7 اجتماعات، ${c.format.date(at('2026-11-26'))} → ${c.format.date(at('2027-05-27'))}`);
  });
});
