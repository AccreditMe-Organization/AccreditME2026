import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import en from '../../../../../assets/i18n/en.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { IOrgPositionDto } from '../../../org-position/services/org-position.service';
import { IOrgUnitHeadStatus } from '../../services/org-unit-head.service';
import { AppointSuccessorDialogComponent } from './appoint-successor-dialog.component';

// ACC-133 — Appoint successor (dialog C): POST /handover. Head access starts
// when it is SAVED, and the dialog says so in the header line, the button and
// the date's label. The position is the outgoing head's, read-only, because
// the endpoint takes none. Compact, declared.

const URL = `${environment.apiUrl}/organization/units/u1/head/handover`;
const FAHAD = {
  id: 'fahad',
  name: 'Dr. Fahad Al-Anazi',
  positionId: 'dir',
  positionNameEn: 'Director',
  positionNameAr: 'مدير',
  headSince: '2024-03-03T12:00:00.000Z' as string | null,
};
const STATUS = (headSince: string | null = FAHAD.headSince): IOrgUnitHeadStatus => ({
  holders: [{ ...FAHAD, headSince }],
  pendingHeadUserId: null,
  headHandoverEffectiveDate: null,
  actingHeadUserId: null,
  lastVacancy: null,
  pendingHeadAccessSince: null,
  cover: null,
  scheduledCover: null,
  recentlyEndedCovers: [],
});
const PEOPLE = [
  { id: 'fahad', name: 'Dr. Fahad Al-Anazi', positionId: 'dir' },
  { id: 'huda', name: 'Dr. Huda Zahrani', email: 'huda@example.com', positionId: 'pharmacist' },
  { id: 'omar', name: 'Dr. Omar Haddad', positionId: 'hos' }, // already holds a head position elsewhere
];
const HEAD_POSITIONS = [
  { id: 'dir', nameEn: 'Director', isUnitHeadPosition: true, isActive: true },
  { id: 'hos', nameEn: 'Head of Section', isUnitHeadPosition: true, isActive: true },
] as unknown as IOrgPositionDto[];

describe('AppointSuccessorDialogComponent (ACC-133)', () => {
  let fixture: ComponentFixture<AppointSuccessorDialogComponent>;
  let http: HttpTestingController;
  let saved: number;

  function open(status = STATUS(), positions: IOrgPositionDto[] = HEAD_POSITIONS): AppointSuccessorDialogComponent {
    TestBed.configureTestingModule({
      imports: [AppointSuccessorDialogComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({}),
        ConfirmationService,
      ],
    });
    loadTranslationsForTest({ en });
    TestBed.inject(TranslateService).use('en');
    fixture = TestBed.createComponent(AppointSuccessorDialogComponent);
    fixture.componentRef.setInput('orgUnitId', 'u1');
    fixture.componentRef.setInput('unitName', 'Pharmacy');
    fixture.componentRef.setInput('status', status);
    fixture.componentRef.setInput('people', PEOPLE);
    fixture.componentRef.setInput('positions', positions);
    fixture.componentRef.setInput('visible', true);
    saved = 0;
    fixture.componentInstance.saved.subscribe(() => saved++);
    fixture.detectChanges();
    http = TestBed.inject(HttpTestingController);
    return fixture.componentInstance;
  }

  afterEach(() => {
    http.verify();
    document.querySelectorAll('.p-dialog').forEach((d) => d.remove());
  });

  const dialogEl = () => document.querySelector<HTMLElement>('.p-dialog')!;
  const inAMonth = () => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + 30);
    return d;
  };

  // ACC-172 — two people with one name are told apart by their position.
  describe('the person picker shows each position (ACC-172)', () => {

    /** The person picker's open list: [name, the quieter line under it]. */
    const openPersonOptions = (): [string, string][] => {
      const trigger = document.querySelector<HTMLElement>('app-overlay-select[formcontrolname="incomingUserId"] .am-overlay-select-trigger')!;
      trigger.click();
      fixture.detectChanges();
      return Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).map((o) => [
        (o.querySelector('.truncate')?.textContent ?? '').trim(),
        (o.querySelector('[data-person-meta]')?.textContent ?? '').trim(),
      ]);
    };

    afterEach(() => document.querySelectorAll('.cdk-overlay-container').forEach((c) => (c.innerHTML = '')));

    it('renders two same-name people as two options told apart by position; no position shows the email', () => {
      open();
      fixture.componentRef.setInput('people', [
      { id: 'sara-1', name: 'Dr. Sara Al-Qahtani', email: 'sara.q@example.com', positionId: 'p-nurse', positionName: { nameEn: 'Nurse Manager', nameAr: 'مديرة التمريض' } },
      { id: 'sara-2', name: 'Dr. Sara Al-Qahtani', email: 'sara.a@example.com', positionId: 'p-pharm', positionName: { nameEn: 'Clinical Pharmacist', nameAr: null } },
      { id: 'noor', name: 'Noor Al-Dossary', email: 'noor@example.com', positionId: null, positionName: null },
    ]);
      fixture.detectChanges();
      expect(openPersonOptions()).toEqual([
        ['Dr. Sara Al-Qahtani', 'Nurse Manager'],
        ['Dr. Sara Al-Qahtani', 'Clinical Pharmacist'],
        ['Noor Al-Dossary', 'noor@example.com'],
      ]);
    });

    it('shows the Arabic position name in Arabic, and the English one where there is none', () => {
      open();
      TestBed.inject(TranslateService).use('ar');
      fixture.componentRef.setInput('people', [
      { id: 'sara-1', name: 'Dr. Sara Al-Qahtani', email: 'sara.q@example.com', positionId: 'p-nurse', positionName: { nameEn: 'Nurse Manager', nameAr: 'مديرة التمريض' } },
      { id: 'sara-2', name: 'Dr. Sara Al-Qahtani', email: 'sara.a@example.com', positionId: 'p-pharm', positionName: { nameEn: 'Clinical Pharmacist', nameAr: null } },
      { id: 'noor', name: 'Noor Al-Dossary', email: 'noor@example.com', positionId: null, positionName: null },
    ]);
      fixture.detectChanges();
      expect(openPersonOptions().map(([, meta]) => meta)).toEqual(['مديرة التمريض', 'Clinical Pharmacist', 'noor@example.com']);
    });
  });

  it('says head access starts when it is saved: the header line, the button, the date label', () => {
    open();
    expect(dialogEl().querySelector('.p-dialog-title')!.textContent).toContain('Appoint the next head of Pharmacy');
    expect(dialogEl().querySelector('[data-testid="successor-access-warning"]')!.textContent).toContain(
      'Head access starts when you save, not on the date below',
    );
    expect(dialogEl().querySelector('[data-testid="appoint-successor-submit"]')!.textContent).toContain('Give head access now');
    expect(dialogEl().textContent).toContain('Sole head from');
    expect(dialogEl().textContent!.toLowerCase()).not.toContain('handover');
  });

  it('is declared compact: at standard density its body is 421 against the 420 cap', () => {
    open();
    const shell = fixture.debugElement.query(By.directive(EditDialogComponent)).componentInstance as EditDialogComponent;
    expect(shell.density()).toBe('compact');
  });

  it('the Replaces strip: position and start, or that the start is not recorded', () => {
    const dialog = open();
    expect(dialog.replacesMeta()).toBe('Director · since 3 Mar 2024');
    TestBed.resetTestingModule();
    expect(open(STATUS(null)).replacesMeta()).toBe('Director · start date not recorded');
  });

  it('the strip names the outgoing head’s last day once the date is chosen', () => {
    const dialog = open();
    expect(dialog.replacesMeta()).not.toContain('until');
    dialog.onPicked(inAMonth());
    expect(dialog.replacesMeta()).toMatch(/^Director · since 3 Mar 2024 · until \d{1,2} \w{3} \d{4}$/);
  });

  it('has no position field: the endpoint takes none, and the strip names it (CC-127b)', () => {
    const dialog = open();
    expect(dialogEl().querySelectorAll('am-field').length).toBe(3); // next head, sole head from, note
    expect(dialogEl().textContent).not.toContain('Position');
    expect(dialog.positionName()).toBe('Director');
    expect(dialog.replacesMeta()).toContain('Director');
  });

  it('offers neither the current head nor anyone already holding a head position', () => {
    const dialog = open();
    expect(dialog.personOptions().map((o) => o.value)).toEqual(['huda']);
  });

  it('posts /handover with the person, the date and the trimmed note', () => {
    const dialog = open();
    const sole = inAMonth();
    dialog.form.controls.incomingUserId.setValue('huda');
    dialog.onPicked(sole);
    dialog.form.controls.reason.setValue('  Retires at month end.  ');
    dialog.submit();
    const req = http.expectOne(URL);
    expect(req.request.body).toEqual({ incomingUserId: 'huda', effectiveDate: sole.toISOString(), reason: 'Retires at month end.' });
    req.flush(null);
    expect(saved).toBe(1);
  });

  it('an empty note is not sent', () => {
    const dialog = open();
    dialog.form.controls.incomingUserId.setValue('huda');
    dialog.onPicked(inAMonth());
    dialog.submit();
    expect(http.expectOne(URL).request.body.reason).toBeUndefined();
  });

  it('refuses a past date and sends nothing', () => {
    const dialog = open();
    dialog.form.controls.incomingUserId.setValue('huda');
    dialog.onPicked(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000));
    dialog.submit();
    http.expectNone(URL);
    expect(dialog.form.controls.effectiveDate.hasError('min')).toBeTrue();
  });

  it('a picked date alone is unsaved work', () => {
    const dialog = open();
    expect(dialog.dirty()).toBeFalse();
    dialog.onPicked(inAMonth());
    expect(dialog.dirty()).toBeTrue();
  });

  it('a part-typed date is unsaved work too', () => {
    const dialog = open();
    dialog.onTyped('15 No');
    expect(dialog.dirty()).toBeTrue();
  });
});
