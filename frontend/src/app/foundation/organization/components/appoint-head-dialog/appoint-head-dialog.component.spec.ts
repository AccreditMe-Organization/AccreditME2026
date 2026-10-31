import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import en from '../../../../../assets/i18n/en.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { IOrgPositionDto } from '../../../org-position/services/org-position.service';
import { AppointHeadDialogComponent } from './appoint-head-dialog.component';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';

// ACC-133 — Appoint head (dialog A, Horizon 1): POST /assign with the person and
// the position; From is read-only "Now, when you save"; no note field; the
// position slot's configurations; a choice is unsaved work.

const URL = `${environment.apiUrl}/organization/units/u1/head/assign`;
const PEOPLE = [
  { id: 'huda', name: 'Dr. Huda Zahrani', email: 'huda@example.com', positionId: 'pharmacist' },
  { id: 'omar', name: 'Dr. Omar Haddad', email: 'omar@example.com', positionId: null },
];
const position = (id: string, nameEn: string): IOrgPositionDto =>
  ({ id, nameEn, nameAr: null, isUnitHeadPosition: true, isActive: true }) as unknown as IOrgPositionDto;

describe('AppointHeadDialogComponent (ACC-133)', () => {
  let fixture: ComponentFixture<AppointHeadDialogComponent>;
  let http: HttpTestingController;
  let saved: number;
  let closed: boolean[];

  function open(positions: IOrgPositionDto[]): AppointHeadDialogComponent {
    TestBed.configureTestingModule({
      imports: [AppointHeadDialogComponent],
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
    fixture = TestBed.createComponent(AppointHeadDialogComponent);
    fixture.componentRef.setInput('orgUnitId', 'u1');
    fixture.componentRef.setInput('unitName', 'Pharmacy');
    fixture.componentRef.setInput('people', PEOPLE);
    fixture.componentRef.setInput('positions', positions);
    fixture.componentRef.setInput('visible', true);
    saved = 0;
    closed = [];
    fixture.componentInstance.saved.subscribe(() => saved++);
    fixture.componentInstance.visibleChange.subscribe((v) => closed.push(v));
    fixture.detectChanges();
    http = TestBed.inject(HttpTestingController);
    return fixture.componentInstance;
  }

  afterEach(() => {
    http.verify();
    document.querySelectorAll('.p-dialog').forEach((d) => d.remove());
  });

  const body = () => document.querySelector<HTMLElement>('.p-dialog')!;

  // ACC-172 — two people with one name are told apart by their position.
  describe('the person picker shows each position (ACC-172)', () => {
    preserveDocumentLanguage();

    /** The person picker's open list: [name, the quieter line under it]. */
    const openPersonOptions = (): [string, string][] => {
      const trigger = document.querySelector<HTMLElement>('app-overlay-select[formcontrolname="userId"] .am-overlay-select-trigger')!;
      trigger.click();
      fixture.detectChanges();
      return Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).map((o) => [
        (o.querySelector('.truncate')?.textContent ?? '').trim(),
        (o.querySelector('[data-person-meta]')?.textContent ?? '').trim(),
      ]);
    };

    afterEach(() => document.querySelectorAll('.cdk-overlay-container').forEach((c) => (c.innerHTML = '')));

    it('renders two same-name people as two options told apart by position; no position shows the email', () => {
      open([position('dir', 'Director')]);
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
      open([position('dir', 'Director')]);
      TestBed.inject(TranslateService).use('ar');
      fixture.componentRef.setInput('people', [
      { id: 'sara-1', name: 'Dr. Sara Al-Qahtani', email: 'sara.q@example.com', positionId: 'p-nurse', positionName: { nameEn: 'Nurse Manager', nameAr: 'مديرة التمريض' } },
      { id: 'sara-2', name: 'Dr. Sara Al-Qahtani', email: 'sara.a@example.com', positionId: 'p-pharm', positionName: { nameEn: 'Clinical Pharmacist', nameAr: null } },
      { id: 'noor', name: 'Noor Al-Dossary', email: 'noor@example.com', positionId: null, positionName: null },
    ]);
      fixture.detectChanges();
      expect(openPersonOptions().map(([, meta]) => meta)).toEqual(['مديرة التمريض', 'Clinical Pharmacist', 'noor@example.com']);
    });

    it("the hint under the field names the chosen person's position", () => {
      const dialog = open([position('dir', 'Director')]);
      fixture.componentRef.setInput('people', [
      { id: 'sara-1', name: 'Dr. Sara Al-Qahtani', email: 'sara.q@example.com', positionId: 'p-nurse', positionName: { nameEn: 'Nurse Manager', nameAr: 'مديرة التمريض' } },
      { id: 'sara-2', name: 'Dr. Sara Al-Qahtani', email: 'sara.a@example.com', positionId: 'p-pharm', positionName: { nameEn: 'Clinical Pharmacist', nameAr: null } },
      { id: 'noor', name: 'Noor Al-Dossary', email: 'noor@example.com', positionId: null, positionName: null },
    ]);
      fixture.detectChanges();
      dialog.form.controls.userId.setValue('sara-2');
      expect(dialog.personHint()).toBe('Clinical Pharmacist');
      dialog.form.controls.userId.setValue('noor');
      expect(dialog.personHint()).toBe('noor@example.com');
    });
  });

  it('titles itself by the unit, says it has no head, and From reads "Now, when you save"', () => {
    open([position('dir', 'Director')]);
    expect(body().querySelector('.p-dialog-title')!.textContent).toContain('Appoint head of Pharmacy');
    expect(body().textContent).toContain('Pharmacy has no head');
    expect(body().textContent).toContain('Now, when you save');
    expect(body().querySelector('textarea')).toBeNull(); // no note: assignHead takes none
    expect(body().querySelector('[data-testid="appoint-head-submit"]')!.textContent).toContain('Appoint now');
  });

  it('one head-conferring position: a read-only pair, filled in', () => {
    const dialog = open([position('dir', 'Director')]);
    expect(body().textContent).toContain('The only position that confers headship');
    expect(body().querySelector('app-overlay-select[formcontrolname="positionId"]')).toBeNull();
    expect(dialog.form.controls.positionId.value).toBe('dir');
  });

  it('two or more: a select, and nothing is chosen for the user', () => {
    const dialog = open([position('dir', 'Director'), position('hos', 'Head of Section')]);
    expect(body().querySelector('app-overlay-select[formcontrolname="positionId"]')).not.toBeNull();
    expect(dialog.form.controls.positionId.value).toBeNull();
  });

  it('posts /assign with the person and the position, then closes and reports the save', () => {
    const dialog = open([position('dir', 'Director')]);
    dialog.form.controls.userId.setValue('huda');
    dialog.submit();
    const req = http.expectOne(URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ userId: 'huda', positionId: 'dir' });
    req.flush(null);
    expect(saved).toBe(1);
    expect(closed).toEqual([false]);
  });

  it('sends nothing without a person, or without a position when there is a choice', () => {
    const dialog = open([position('dir', 'Director'), position('hos', 'Head of Section')]);
    dialog.submit();
    dialog.form.controls.userId.setValue('huda');
    dialog.submit();
    http.expectNone(URL);
    expect(dialog.showErrors()).toBeTrue();
  });

  it('is clean when opened, and a chosen person is unsaved work', () => {
    const dialog = open([position('dir', 'Director')]);
    expect(dialog.dirty()).toBeFalse();
    dialog.form.controls.userId.setValue('huda');
    expect(dialog.dirty()).toBeTrue();
  });

  it('a refusal stays in the dialog, which stays open', () => {
    const dialog = open([position('dir', 'Director')]);
    dialog.form.controls.userId.setValue('huda');
    dialog.submit();
    http.expectOne(URL).flush({ message: 'The user must already belong to this org unit' }, { status: 400, statusText: 'Bad Request' });
    expect(dialog.saveError()).toBe('The user must already belong to this org unit');
    expect(saved).toBe(0);
    expect(closed).toEqual([]);
  });
});
