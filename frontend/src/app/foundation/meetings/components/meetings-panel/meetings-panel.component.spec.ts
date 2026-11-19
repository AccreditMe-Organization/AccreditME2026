import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { Observable, of, throwError } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { aMeeting } from '../../meeting-fixtures.testing';
import { MeetingService, type MeetingListDto } from '../../services/meeting.service';
import { MeetingsPanelComponent } from './meetings-panel.component';
import type { ScheduleOwner } from '../meeting-schedule-dialog/meeting-schedule-dialog.component';

// ACC-316 PR 6 — a committee's or a unit's Meetings panel: the next three
// meetings then the last two held, read from the server's views filtered to
// this owner; Schedule meeting only when the server says this person may.
describe('MeetingsPanelComponent (ACC-316 PR 6)', () => {
  let list: jasmine.Spy;
  let may: () => Observable<{ may: boolean }>;

  const UPCOMING = [aMeeting({ id: 'm-next', title: 'Next review' })];
  const HELD = [aMeeting({ id: 'm-held', title: 'Held review' }), aMeeting({ id: 'm-cancelled', title: 'Cancelled review', stage: { id: 's-c', nameEn: 'Cancelled', nameAr: 'ملغى', flags: ['MEETING_CANCELLED'] } })];

  function create(owner: ScheduleOwner) {
    TestBed.configureTestingModule({
      imports: [MeetingsPanelComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({}),
        ConfirmationService,
        { provide: MeetingService, useValue: { list, maySchedule: () => may(), formChoices: () => of({ types: [] }) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    const fixture = TestBed.createComponent(MeetingsPanelComponent);
    fixture.componentRef.setInput('owner', owner);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  beforeEach(() => {
    // The server's totals are larger than the rows asked for: the count is theirs.
    list = jasmine.createSpy('list').and.callFake((q: { view: string }): Observable<MeetingListDto> =>
      of(q.view === 'upcoming' ? { items: UPCOMING, total: 4, canSeeAll: false } : { items: HELD, total: 9, canSeeAll: false }),
    );
    may = () => of({ may: true });
  });

  const committee: ScheduleOwner = { kind: 'COMMITTEE', id: 'c-1', name: 'Pharmacy and Therapeutics Committee' };
  const unit: ScheduleOwner = { kind: 'UNIT', id: 'u-1', name: 'Quality Department' };

  it('reads the next three and the last two held, for this committee only, under the plain visibility rule (not Mine)', () => {
    create(committee);
    expect(list).toHaveBeenCalledWith({ view: 'upcoming', committeeId: 'c-1', take: 3 });
    expect(list).toHaveBeenCalledWith({ view: 'past', committeeId: 'c-1', take: 2 });
  });

  it('a unit reads by its unit', () => {
    create(unit);
    expect(list).toHaveBeenCalledWith({ view: 'upcoming', orgUnitId: 'u-1', take: 3 });
  });

  it('lists upcoming first, each linked to its page, a cancelled one struck through', () => {
    const { el } = create(committee);
    const rows = Array.from(el.querySelectorAll<HTMLElement>('[data-meeting-row]'));
    expect(rows.map((r) => r.dataset['meetingRow'])).toEqual(['m-next', 'm-held', 'm-cancelled']);
    expect(rows[0]!.querySelector('a')?.getAttribute('href')).toBe('/meetings/m-next');
    expect(rows[2]!.querySelector('a')?.classList.contains('line-through')).toBeTrue();
    expect(rows[1]!.querySelector('a')?.classList.contains('line-through')).toBeFalse();
  });

  it("counts every meeting the server says this person may see, not the rows drawn, and offers no See all", () => {
    const { fixture, el } = create(committee);
    expect(fixture.componentInstance.total()).toBe(13);
    expect(el.querySelectorAll('[data-meeting-row]').length).toBe(3);
    expect(el.querySelector('[data-testid="meetings-committee-count"]')?.textContent?.trim()).toBe('13');
    expect(el.querySelector('[data-testid$="-see-all"]')).toBeNull();
  });

  describe('Schedule meeting follows the server', () => {
    it('shown when the server says this person may schedule here', () => {
      expect(create(committee).el.querySelector('[data-testid="meetings-panel-schedule"]')).not.toBeNull();
    });
    it('absent when it says not', () => {
      may = () => of({ may: false });
      expect(create(committee).el.querySelector('[data-testid="meetings-panel-schedule"]')).toBeNull();
    });
    it('absent when the question fails', () => {
      may = () => throwError(() => new Error('down'));
      expect(create(committee).el.querySelector('[data-testid="meetings-panel-schedule"]')).toBeNull();
    });
  });

  it('a failed read says so, with Retry, and never shows "no meetings"', () => {
    list.and.returnValue(throwError(() => new Error('down')));
    const { el } = create(committee);
    expect(el.textContent).toContain(en.meeting.panel.error);
    expect(el.textContent).not.toContain(en.meeting.panel.empty);
  });
});
