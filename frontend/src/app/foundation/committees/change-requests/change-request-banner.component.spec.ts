import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';
import { FormatService } from '../../../core/formatting';
import { loadTranslationsForTest, provideFormatTesting } from '../../../core/formatting/testing';
import { ChangeRequestBannerComponent, ChangeRequestBannerState } from './change-request-banner.component';
import { ChangeRequestDto } from './change-request.service';
import { REQUEST, fakePhone } from './change-request.testing';

@Component({
  standalone: true,
  imports: [ChangeRequestBannerComponent],
  template: `<am-change-request-banner [state]="state()" [request]="request()" (retry)="retries = retries + 1" />`,
})
class HostComponent {
  readonly state = signal<ChangeRequestBannerState>('ready');
  readonly request = signal<ChangeRequestDto | null>(null);
  retries = 0;
}

// ACC-240 — the open-request banner: its title by stage KEY, who and when, View
// request; Error with Retry; Partial for a request naming no field the screen
// knows; nothing while loading or with no request open.
describe('ChangeRequestBannerComponent (ACC-240)', () => {
  let fixture: ComponentFixture<HostComponent>;
  let format: FormatService;

  beforeEach(() => {
    // The Karma frame is narrower than a desktop: pin the width per test.
    fakePhone(false);
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideRouter([]), provideTranslateService({ lang: 'en' }), provideFormatTesting()],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    format = TestBed.inject(FormatService);
    fixture = TestBed.createComponent(HostComponent);
  });

  function show(state: ChangeRequestBannerState, request: ChangeRequestDto | null): HTMLElement {
    fixture.componentInstance.state.set(state);
    fixture.componentInstance.request.set(request);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  it('under review: the fields, who submitted it and when, and View request', () => {
    const el = show('ready', REQUEST({ changes: { quorumCount: 6, reportingToCommitteeId: 'c-9' } }));
    expect(text(el.querySelector('.am-crb__title'))).toBe('Change request 3 is under review: Quorum and Reports to');
    expect(text(el.querySelector('.am-crb__body'))).toBe(
      `Submitted by Nora Al-Otaibi on ${format.date('2026-10-18T09:00:00Z')}. Until it is decided, the committee carries on as it is.`,
    );
    expect(el.querySelector('[data-testid="cr-banner-view"]')!.getAttribute('href')).toBe('/committees/c-1/change-requests/cr-1');
  });

  it('a draft: started by, on the day it was made', () => {
    const el = show('ready', REQUEST({ status: 'draft', submittedAt: null }));
    expect(text(el.querySelector('.am-crb__title'))).toBe('Change request 3 is a draft: Quorum');
    expect(text(el.querySelector('.am-crb__body'))).toBe(`Started by Nora Al-Otaibi on ${format.date('2026-10-17T09:00:00Z')} and not yet submitted.`);
  });

  it('returned: to whom, on the day it was returned', () => {
    const el = show('ready', REQUEST({ status: 'returned', decidedAt: '2026-10-19T09:00:00Z' }));
    expect(text(el.querySelector('.am-crb__title'))).toBe('Change request 3 was returned for changes: Quorum');
    expect(text(el.querySelector('.am-crb__body'))).toBe(`Returned to Nora Al-Otaibi on ${format.date('2026-10-19T09:00:00Z')} for changes.`);
  });

  it('a stage with no key: "is open"', () => {
    const el = show('ready', REQUEST({ status: null }));
    expect(text(el.querySelector('.am-crb__title'))).toBe('Change request 3 is open: Quorum');
  });

  it('Partial: a request naming no field the screen knows', () => {
    const el = show('ready', REQUEST({ changes: { somethingNew: 1 } as unknown as ChangeRequestDto['changes'] }));
    expect(el.querySelector('[data-testid="cr-banner-partial"]')).not.toBeNull();
    expect(text(el.querySelector('.am-crb__title'))).toBe('A change request is open.');
    expect(el.querySelector('.am-crb__body')).toBeNull();
    expect(el.querySelector('[data-testid="cr-banner-view"]')).not.toBeNull();
  });

  it('Error: the sentence, and Retry asks again', () => {
    const el = show('error', null);
    expect(text(el.querySelector('[data-testid="cr-banner-error"] span'))).toBe("Couldn't check for an open change request.");
    (el.querySelector('[data-testid="cr-banner-error"] button') as HTMLButtonElement).click();
    expect(fixture.componentInstance.retries).toBe(1);
  });

  it('nothing while loading, and nothing with no request open', () => {
    expect(show('loading', REQUEST()).querySelector('.am-crb')).toBeNull();
    expect(show('ready', null).querySelector('.am-crb')).toBeNull();
  });

  it('on a phone, the body is only who and when', () => {
    fakePhone(true);
    fixture = TestBed.createComponent(HostComponent);
    const el = show('ready', REQUEST());
    expect(text(el.querySelector('.am-crb__body'))).toBe(`Nora Al-Otaibi · ${format.date('2026-10-18T09:00:00Z')}`);
  });

  it('Arabic', () => {
    TestBed.inject(TranslateService).use('ar');
    const el = show('ready', REQUEST({ changes: { quorumCount: 6, reportingToCommitteeId: 'c-9' } }));
    expect(text(el.querySelector('.am-crb__title'))).toBe('طلب التغيير 3 قيد المراجعة: النصاب وترفع تقاريرها إلى');
    expect(text(el.querySelector('[data-testid="cr-banner-view"]'))).toBe(ar.committee.changeRequest.banner.view);
  });
});
