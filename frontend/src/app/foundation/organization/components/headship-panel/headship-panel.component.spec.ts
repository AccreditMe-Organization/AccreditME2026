import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import en from '../../../../../assets/i18n/en.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { AmConfirmOptions, AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { IOrgUnitHeadCover, IOrgUnitHeadStatus } from '../../services/org-unit-head.service';
import { HeadshipPanelComponent } from './headship-panel.component';

// ACC-133 — the panel as a viewer sees it: the state's actions and nothing
// else, the "not recorded" renderings, names withheld without users:view, the
// read-only view without org:manage, and each confirm's save path.

const API = environment.apiUrl;
const UNIT = 'u1';
const HEAD_URL = `${API}/organization/units/${UNIT}/head`;
const noon = (day: string) => `${day}T12:00:00.000Z`;

const HEAD = { id: 'fahad', name: 'Dr. Fahad Al-Anazi', positionId: 'pos', positionNameEn: 'Director', positionNameAr: 'مدير', headSince: null as string | null };
const INCOMING = { id: 'huda', name: 'Dr. Huda Zahrani', positionId: 'pos', positionNameEn: 'Director', positionNameAr: 'مدير', headSince: noon('2026-10-25') };
const COVER: IOrgUnitHeadCover = { userId: 'tariq', name: 'Dr. Tariq Suleiman', reason: 'ABSENCE', validFrom: noon('2026-09-25'), validTo: null };

function status(over: Partial<IOrgUnitHeadStatus> = {}): IOrgUnitHeadStatus {
  return {
    holders: [],
    pendingHeadUserId: null,
    headHandoverEffectiveDate: null,
    actingHeadUserId: null,
    lastVacancy: null,
    pendingHeadAccessSince: null,
    cover: null,
    scheduledCover: null,
    recentlyEndedCovers: [],
    ...over,
  };
}
const held = (headSince: string | null = null) => ({ holders: [{ ...HEAD, headSince }] });
const covered = (reason: 'VACANCY' | 'ABSENCE', validTo: string | null = null) => ({
  cover: { ...COVER, reason, validTo },
  actingHeadUserId: COVER.userId,
});
const successor = {
  holders: [HEAD, INCOMING],
  pendingHeadUserId: INCOMING.id,
  headHandoverEffectiveDate: noon('2026-11-01'),
  pendingHeadAccessSince: noon('2026-10-25'),
};

describe('HeadshipPanelComponent (ACC-133)', () => {
  let fixture: ComponentFixture<HeadshipPanelComponent>;
  let http: HttpTestingController;
  let asked: AmConfirmOptions[];
  let permissions: string[];

  const DIRECTOR = [{ id: 'pos', nameEn: 'Director', nameAr: 'مدير', isUnitHeadPosition: true, isActive: true }];

  function render(
    s: IOrgUnitHeadStatus,
    perms = ['org:view', 'org:manage', 'users:view', 'positions:view'],
    positions: unknown[] = DIRECTOR,
    readOnly = false,
  ): HTMLElement {
    permissions = perms;
    asked = [];
    TestBed.configureTestingModule({
      imports: [HeadshipPanelComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({}),
        { provide: NavigationAccessService, useValue: { hasPermission: (p: string) => permissions.includes(p) } },
        { provide: AmConfirmService, useValue: { ask: (o: AmConfirmOptions) => asked.push(o) } },
      ],
    });
    loadTranslationsForTest({ en });
    TestBed.inject(TranslateService).use('en');
    fixture = TestBed.createComponent(HeadshipPanelComponent);
    fixture.componentRef.setInput('orgUnitId', UNIT);
    fixture.componentRef.setInput('unitName', 'Pharmacy');
    if (readOnly) fixture.componentRef.setInput('readOnly', true);
    fixture.detectChanges();
    http = TestBed.inject(HttpTestingController);
    http.expectOne(HEAD_URL).flush(s);
    if (perms.includes('org:manage')) {
      http.expectOne((r) => r.url === `${API}/users`).flush({ data: [], total: 0, page: 1, pageSize: 200 });
      http.expectOne(`${API}/org-positions`).flush(positions);
    }
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => http.verify());

  const actions = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('[data-testid="headship-actions"] p-button')).map((b) => b.getAttribute('data-action'));
  const meta = (el: HTMLElement, row: string) =>
    el.querySelector(`[data-row="${row}"] [data-testid="headship-meta"]`)?.textContent?.trim();
  const value = (el: HTMLElement, row: string) =>
    el.querySelector(`[data-row="${row}"] .am-hs__value`)?.textContent?.replace(/\s+/g, ' ').trim();

  // ── the matrix, as rendered ──────────────────────────────────────────────
  const states: [string, IOrgUnitHeadStatus, string[]][] = [
    ['1', status(), ['appointHead', 'arrangeCover']],
    ['2', status(covered('VACANCY', noon('2026-10-31'))), ['appointHead', 'endCover']],
    ['3', status(held()), ['appointSuccessor', 'arrangeCover', 'vacate']],
    ['4', status({ ...held(), ...covered('ABSENCE') }), ['endCover', 'appointSuccessor', 'vacate']],
    ['5', status(successor), ['startNewHeadToday', 'withdrawAppointment']],
    ['6', status({ ...successor, ...covered('ABSENCE') }), ['startNewHeadToday', 'withdrawAppointment', 'endCover']],
  ];
  for (const [n, s, expected] of states) {
    it(`state ${n} renders exactly its actions`, () => {
      const el = render(s);
      expect(el.querySelector('[data-testid="headship-panel"]')!.getAttribute('data-state')).toBe(n);
      expect(actions(el)).toEqual(expected);
    });
  }

  it('state 5 has no primary button: nothing renders as the default', () => {
    const el = render(status(successor));
    const buttons = Array.from(el.querySelectorAll('[data-testid="headship-actions"] button'));
    expect(buttons.length).toBe(2);
    for (const b of buttons) expect(b.classList).not.toContain('p-button-primary');
    expect(el.querySelector('[data-testid="headship-actions"] .p-button:not(.p-button-outlined):not(.p-button-text)')).toBeNull();
  });

  // ── a viewer without org:manage ──────────────────────────────────────────
  it('without org:manage: the panel shows, and no action does', () => {
    const el = render(status(held(noon('2024-03-03'))), ['org:view', 'users:view']);
    expect(el.querySelector('[data-row="head"]')).not.toBeNull();
    expect(meta(el, 'head')).toBe('Since 3 Mar 2024');
    expect(el.querySelector('[data-testid="headship-actions"]')).toBeNull();
    // Nor are the dialogs' choices fetched for someone who cannot use them.
    http.expectNone((r) => r.url === `${API}/users`);
    http.expectNone(`${API}/org-positions`);
  });

  // ACC-120 slice 11, PR D — a deactivated unit's record: the panel shows its
  // headship and offers nothing, whatever the viewer holds.
  it('readOnly: the panel shows, and no action does, even for org:manage', () => {
    const el = render(status(held(noon('2024-03-03'))), undefined, DIRECTOR, true);
    expect(el.querySelector('[data-row="head"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="headship-actions"]')).toBeNull();
  });

  // ── the empty ledger ─────────────────────────────────────────────────────
  it('vacant, no event: "No head recorded"', () => {
    expect(meta(render(status()), 'head')).toBe('No head recorded');
  });

  it('vacant, after a Vacate: when, and who recorded it', () => {
    const el = render(status({ lastVacancy: { at: noon('2026-09-01'), by: { userId: 'nora', name: 'Nora Al-Otaibi' } } }));
    expect(meta(el, 'head')).toBe('Vacated 1 Sep 2026 by Nora Al-Otaibi');
  });

  it('vacant, after a Vacate, with the name withheld: the date alone', () => {
    const el = render(status({ lastVacancy: { at: noon('2026-09-01'), by: { userId: 'nora', name: null } } }));
    expect(meta(el, 'head')).toBe('Vacated 1 Sep 2026');
  });

  it('held, no event: "Start date not recorded"; with one: "Since …"', () => {
    expect(meta(render(status(held())), 'head')).toBe('Start date not recorded');
    TestBed.resetTestingModule();
    expect(meta(render(status(held(noon('2024-03-03')))), 'head')).toBe('Since 3 Mar 2024');
  });

  // ── names withheld (D7) ──────────────────────────────────────────────────
  it('names withheld: "Head assigned" and "Cover arranged" where a name would go', () => {
    const el = render(
      status({
        holders: [{ ...HEAD, name: null }],
        cover: { ...COVER, name: null },
        actingHeadUserId: COVER.userId,
      }),
    );
    expect(value(el, 'head')).toBe('Head assigned · Director');
    expect(value(el, 'cover')).toBe('Cover arranged');
    expect(el.querySelector('[data-row="head"] a')).toBeNull();
  });

  // ── states 5 and 6: head access already granted ──────────────────────────
  it('states 5 and 6 say "Two heads until …", and the successor is "Also head · incoming"', () => {
    const el = render(status(successor));
    expect(el.querySelector('[data-testid="headship-pill"]')!.textContent!.trim()).toBe('⇆ Two heads until 1 Nov 2026');
    expect(el.querySelector('[data-row="incoming"] .am-hs__label')!.textContent!.trim()).toBe('Also head · incoming');
    expect(meta(el, 'incoming')).toBe('Head access since 25 Oct 2026 · sole head from 1 Nov 2026');
    expect(meta(el, 'head')).toBe('Head access until 31 Oct 2026');
    expect(el.textContent!.toLowerCase()).not.toContain('handover');
  });

  it('an open-ended cover for an absent head: the at-risk pill and the dashed bar', () => {
    const el = render(status({ ...held(), ...covered('ABSENCE') }));
    expect(el.querySelector('[data-testid="headship-pill"]')!.textContent!.trim()).toBe('▲ At risk from 24 Dec 2026');
    expect(el.querySelector('[data-row="cover"] .am-hs__track')).not.toBeNull();
    expect(meta(el, 'cover')).toBe('Covering for Dr. Fahad Al-Anazi · since 25 Sep 2026 · no end date');
  });

  it('no head-conferring position: Appoint head stays visible, disabled, with the reason', () => {
    const el = render(status(), undefined, [{ id: 'p', nameEn: 'Nurse', nameAr: null, isUnitHeadPosition: false, isActive: true }]);
    const appoint = el.querySelector('p-button[data-action="appointHead"] button') as HTMLButtonElement;
    expect(appoint).not.toBeNull();
    expect(appoint.disabled).toBeTrue();
    expect(el.querySelector('[data-testid="headship-blocked"]')!.textContent).toContain(
      'No position confers headship — flag one in Org positions',
    );
  });

  // ── save paths: the right endpoint, then the panel reads again ───────────
  function acceptAndExpect(path: string): void {
    expect(asked.length).withContext('one confirm').toBe(1);
    asked[0]!.accept();
    const req = http.expectOne(`${HEAD_URL}/${path}`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush(null);
    http.expectOne(HEAD_URL).flush(status());
  }
  const click = (el: HTMLElement, action: string) =>
    (el.querySelector(`p-button[data-action="${action}"] button`) as HTMLButtonElement).click();

  it('Vacate asks "Record departure", then posts /vacate and reloads', () => {
    const el = render(status(held()));
    click(el, 'vacate');
    expect(asked[0]!.acceptLabel).toBe('Record departure');
    expect(asked[0]!.header).toBe('Record that Dr. Fahad Al-Anazi has left Pharmacy?');
    acceptAndExpect('vacate');
  });

  it('Start new head today names the access already granted, then posts /handover/complete', () => {
    const el = render(status(successor));
    click(el, 'startNewHeadToday');
    expect(asked[0]!.message).toContain('Dr. Huda Zahrani already has head access.');
    expect(asked[0]!.acceptLabel).toBe('Make head today');
    acceptAndExpect('handover/complete');
  });

  it('in state 6, Start new head today says the cover continues (the server does not end it)', () => {
    const el = render(status({ ...successor, ...covered('ABSENCE') }));
    click(el, 'startNewHeadToday');
    expect(asked[0]!.message).toContain("Dr. Tariq Suleiman's cover continues until it is ended.");
    expect(asked[0]!.message).not.toContain('ends as well');
    acceptAndExpect('handover/complete');
  });

  it('Withdraw appointment names the access lost since declaration, then posts /handover/cancel', () => {
    const el = render(status(successor));
    click(el, 'withdrawAppointment');
    expect(asked[0]!.message).toContain('Dr. Huda Zahrani loses the head access they have had since 25 Oct 2026');
    expect(asked[0]!.acceptLabel).toBe('Cancel appointment');
    expect(asked[0]!.rejectLabel).toBe('Keep appointment');
    acceptAndExpect('handover/cancel');
  });

  it('End cover posts /acting-head/clear', () => {
    const el = render(status({ ...held(), ...covered('ABSENCE') }));
    click(el, 'endCover');
    expect(asked[0]!.acceptLabel).toBe('End cover');
    acceptAndExpect('acting-head/clear');
  });

  it('Appoint head, Appoint successor and Arrange cover open their dialogs, and ask nothing', () => {
    const el = render(status());
    // ACC-120 slice 11 — the dialogs live in am-headship-actions, shared with
    // the org tree; the panel reaches them through actions().
    click(el, 'appointHead');
    expect(fixture.componentInstance.actions().dialog()).toBe('appointHead');
    fixture.componentInstance.actions().dialog.set(null);
    click(el, 'arrangeCover');
    expect(fixture.componentInstance.actions().dialog()).toBe('arrangeCover');
    expect(asked.length).toBe(0);
  });
});
