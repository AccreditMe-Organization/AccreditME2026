import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { of } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { FormatService } from '../../../../core/formatting';
import { TestFormatContext } from '../../../../core/formatting/format-context';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { aMeeting } from '../../meeting-fixtures.testing';
import { MeetingService } from '../../services/meeting.service';
import { MeetingRescheduleDialogComponent } from './meeting-reschedule-dialog.component';

// ACC-316 PR 6 review (P184) — Reschedule opens on the meeting's date and time
// as the TENANT's clock reads them, and only an opening resets it.
describe('MeetingRescheduleDialogComponent (ACC-316 PR 6)', () => {
  const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tenant = browser === 'America/New_York' ? 'Asia/Tokyo' : 'America/New_York';
  let reschedule: jasmine.Spy;

  function create() {
    reschedule = jasmine.createSpy('reschedule').and.returnValue(of(aMeeting()));
    TestBed.configureTestingModule({
      imports: [MeetingRescheduleDialogComponent],
      providers: [
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({}),
        ConfirmationService,
        { provide: MeetingService, useValue: { reschedule } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    TestBed.inject(TestFormatContext).zone.set(tenant);
    const fixture = TestBed.createComponent(MeetingRescheduleDialogComponent);
    fixture.componentRef.setInput('meeting', aMeeting({ scheduledAt: TestBed.inject(FormatService).instantAt({ year: 2027, month: 3, day: 18, hour: 10, minute: 0 }).toISOString() }));
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
