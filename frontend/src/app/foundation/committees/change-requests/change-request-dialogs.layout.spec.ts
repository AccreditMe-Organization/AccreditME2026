import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import { ConfirmationService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';
import { AccreditMePreset } from '../../../core/theme/accreditme-preset';
import { loadTranslationsForTest, provideFormatTesting } from '../../../core/formatting/testing';
import { AuthService } from '../../../core/services/auth.service';
import { LanguageService } from '../../../core/services/language.service';
import { preserveDocumentLanguage } from '../../../../testing/document-language';
import { ConfirmHostComponent } from '../../../shared/components/confirm/confirm-host.component';
import { WorkflowService } from '../../workflow/services/workflow.service';
import { CommitteeDetailDto, CommitteeService } from '../services/committee.service';
import { CommitteeChangeRequestPageComponent } from './committee-change-request-page.component';
import { ChangeRequestDto, ChangeRequestService, ChangeValues } from './change-request.service';
import { REQUEST, fakePhone } from './change-request.testing';
import { ACTIVE_RULES } from '../testing';

// ACC-240 — the four dialogs, MEASURED in both languages, in the real theme and
// font, opened from the real request page (plan §3.4, §4):
//
//   - Approve (420 confirm, through ask() with details): the longest case —
//     six changed fields with long names, the most the list shows — the
//     collapsed seven, and a one-field typo fix;
//   - Withdraw (420 confirm);
//   - Return and Reject (560 forms): empty, with the field's error showing, and
//     with a refusal in the footer.
//
// Each body is under the 420px cap with AT LEAST 20px of room, and nothing in
// it scrolls. NON-VACUITY FIRST (ACC-120): a body that measured 0 would pass.

const CAP = 420;
const ROOM = 20;
const FLOOR = 30;

const LONG = {
  nameEn: 'Quality, Patient Safety and Clinical Governance Committee',
  nameAr: 'لجنة الجودة وسلامة المرضى والحوكمة السريرية',
  unit: 'Directorate of Nursing Services and Patient Experience',
  parent: 'Medical Executive and Clinical Governance Council',
  reportsTo: 'Board of Directors Quality and Safety Oversight Committee',
};

const LIVE: CommitteeDetailDto = {
  id: 'c-1',
  organizationId: 'org',
  nameEn: 'Quality Council',
  nameAr: 'مجلس الجودة',
  typeValueId: 'type-1',
  purpose: 'Oversees quality.',
  quorumCount: 5,
  meetingFrequency: 'MONTHLY',
  parentCommitteeId: null,
  orgUnitId: 'unit-1',
  termsOfReferenceDocumentId: null,
  reportingToCommitteeId: 'c-9',
  formedAt: null,
  dissolvedAt: null,
  isActive: true,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  stageRules: ACTIVE_RULES,
  isDissolving: false,
  typeValue: null,
};

const LABELS = {
  'type-1': { en: 'Quality', ar: 'الجودة' },
  'type-2': { en: 'Clinical Governance and Patient Safety', ar: 'الحوكمة السريرية وسلامة المرضى' },
  'unit-1': { en: 'Quality Department', ar: 'إدارة الجودة' },
  'unit-2': { en: LONG.unit, ar: 'مديرية خدمات التمريض وتجربة المرضى' },
  'c-7': { en: LONG.parent, ar: 'المجلس التنفيذي الطبي والحوكمة السريرية' },
  'c-9': { en: 'Board', ar: 'مجلس الإدارة' },
  'c-8': { en: LONG.reportsTo, ar: 'لجنة مجلس الإدارة للإشراف على الجودة والسلامة' },
};

const SIX: ChangeValues = { nameEn: LONG.nameEn, nameAr: LONG.nameAr, typeValueId: 'type-2', orgUnitId: 'unit-2', parentCommitteeId: 'c-7', reportingToCommitteeId: 'c-8' };
const SEVEN: ChangeValues = { ...SIX, quorumCount: 6 };
const TYPO: ChangeValues = { nameEn: 'Quality Councll' };

@Component({
  standalone: true,
  imports: [CommitteeChangeRequestPageComponent, ConfirmHostComponent],
  template: `<am-committee-change-request-page /><am-confirm-host />`,
})
class Host {}

describe('Change request dialogs — layout, measured (ACC-240)', () => {
  preserveDocumentLanguage();
  const measured: string[] = [];
  let fixture: ComponentFixture<Host>;
  let request: ChangeRequestDto;
  let decide: () => ReturnType<ChangeRequestService['reject']>;

  afterAll(() => console.log(`ACC-240 dialogs (cap ${CAP}, room ≥ ${ROOM}):\n  ${measured.join('\n  ')}`));

  afterEach(() => {
    document.querySelectorAll('.p-dialog-mask, .p-dialog, .p-confirmdialog').forEach((n) => n.remove());
    fixture?.destroy();
  });

  async function open(language: 'en' | 'ar', changes: ChangeValues, actions: Partial<ChangeRequestDto['actions']>): Promise<HTMLElement> {
    TestBed.resetTestingModule();
    fakePhone(false);
    request = REQUEST({
      changes,
      fromValues: { nameEn: LIVE.nameEn, nameAr: LIVE.nameAr, typeValueId: 'type-1', orgUnitId: 'unit-1', parentCommitteeId: null, reportingToCommitteeId: 'c-9', quorumCount: 5 },
      labels: LABELS,
      requestedBy: { id: 'u-nora', name: 'Dr. Nora bint Abdulrahman Al-Otaibi' },
      actions: { edit: false, submit: false, withdraw: false, approve: false, return: false, reject: false, ...actions },
    });
    decide = () => of(request);
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        ConfirmationService,
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'c-1', requestId: 'cr-1' }) } } },
        { provide: AuthService, useValue: { currentUser: () => ({ id: 'u-hessa', name: 'Hessa', email: 'h@x' }) } },
        { provide: CommitteeService, useValue: { getById: () => of(LIVE) } },
        { provide: WorkflowService, useValue: { getInstancesByObject: () => of([]) } },
        {
          provide: ChangeRequestService,
          useValue: {
            get: () => of(request),
            preview: () => of({ changedFields: [], impacts: [], labels: {} }),
            approve: () => of(request),
            withdraw: () => of(request),
            returnForChanges: () => decide(),
            reject: () => decide(),
          },
        },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    document.documentElement.dir = TestBed.inject(LanguageService).isRtl() ? 'rtl' : 'ltr';
    fixture = TestBed.createComponent(Host);
    document.body.appendChild(fixture.nativeElement);
    fixture.autoDetectChanges(true);
    await settle();
    return fixture.nativeElement as HTMLElement;
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }

  async function until(what: string, ok: () => boolean): Promise<void> {
    for (let turn = 0; !ok(); turn++) {
      if (turn > 100) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 20));
    }
    await settle();
  }

  /** Until the frame stops moving: PrimeNG's open motion runs on CSS time, not the test's. */
  async function still(frame: HTMLElement): Promise<void> {
    let last = '';
    let same = 0;
    for (let turn = 0; turn < 100; turn++) {
      const r = frame.getBoundingClientRect();
      const now = `${r.width}x${r.height}@${r.left},${r.top}`;
      same = now === last ? same + 1 : 0;
      if (same >= 3) return settle();
      last = now;
      await new Promise((res) => setTimeout(res, 50));
    }
    throw new Error('the dialog never stopped moving');
  }

  function press(root: HTMLElement, id: string): void {
    (root.querySelector(`[data-testid="${id}"] button`) as HTMLButtonElement).click();
  }

  /** A body: under the cap with the room, laid out, and scrolling nowhere. */
  function check(label: string, language: string, body: HTMLElement, frame: HTMLElement, width: number): void {
    expect(document.fonts.check('13px "IBM Plex Sans Arabic"')).withContext('measured in a fallback font').toBe(true);
    const height = body.scrollHeight;
    measured.push(`${label} [${language}]: body ${height}px, room ${CAP - height}px, width ${Math.round(frame.getBoundingClientRect().width)}`);
    expect(height).withContext(`${label} [${language}] not laid out`).toBeGreaterThan(FLOOR);
    expect(Math.round(frame.getBoundingClientRect().width)).withContext(`${label} width`).toBe(width);
    expect(CAP - height).withContext(`${label} [${language}] body ${height}px leaves under ${ROOM}px of room`).toBeGreaterThanOrEqual(ROOM);
    // Nothing INSIDE the body scrolls. The body itself is held to the cap
    // above: its own visible height here is the Karma frame's (about 333px
    // tall, far shorter than the 768px laptop the cap is sized for), so it
    // is measured by what it needs, never by what this frame gives it.
    const scrollers = Array.from(body.querySelectorAll<HTMLElement>('*')).filter(
      (n) => n.scrollHeight > n.clientHeight + 1 && ['auto', 'scroll'].includes(getComputedStyle(n).overflowY),
    );
    expect(scrollers.map((n) => `${n.tagName}.${n.className} ${n.scrollHeight}/${n.clientHeight}`)).withContext(`${label} [${language}] something scrolls`).toEqual([]);
  }

  async function confirmBody(): Promise<{ body: HTMLElement; frame: HTMLElement }> {
    await until('the confirm', () => !!document.querySelector('.p-confirmdialog .p-confirmdialog-accept-button, .p-confirmdialog button.am-confirm__accept, .p-confirmdialog .p-dialog-footer button'));
    const frame = document.querySelector<HTMLElement>('.p-confirmdialog')!;
    await still(frame);
    return { frame, body: frame.querySelector<HTMLElement>('.p-dialog-content')! };
  }

  async function formBody(): Promise<{ body: HTMLElement; frame: HTMLElement }> {
    await until('the form dialog', () => !!document.querySelector('[data-crd-body]'));
    const body = document.querySelector<HTMLElement>('.am-dialog__body')!;
    const frame = body.closest<HTMLElement>('.p-dialog')!;
    await still(frame);
    return { body, frame };
  }

  for (const language of ['en', 'ar'] as const) {
    describe(language === 'en' ? 'English' : 'Arabic', () => {
      for (const [label, changes, lines] of [
        ['Approve, six changes (the longest list)', SIX, 6],
        ['Approve, seven changes (collapsed)', SEVEN, 1],
        ['Approve, a typo fix', TYPO, 1],
      ] as const) {
        it(label, async () => {
          const root = await open(language, changes, { approve: true, return: true, reject: true });
          press(root, 'crp-approve');
          const { body, frame } = await confirmBody();
          // Non-vacuity: the details really are listed.
          expect(frame.querySelectorAll('[data-testid="confirm-details"] li').length).withContext('details listed').toBe(lines);
          check(label, language, body, frame, 420);
        }, 20_000);
      }

      it('Withdraw', async () => {
        const root = await open(language, SIX, { withdraw: true });
        press(root, 'crp-withdraw');
        const { body, frame } = await confirmBody();
        expect(frame.querySelector('[data-testid="confirm-details"]')).toBeNull();
        check('Withdraw', language, body, frame, 420);
      }, 20_000);

      for (const kind of ['return', 'reject'] as const) {
        it(`${kind === 'return' ? 'Return for changes' : 'Reject'}: empty, with its error, and with a refusal`, async () => {
          const root = await open(language, SIX, { approve: true, return: true, reject: true });
          press(root, `crp-${kind}`);
          let { body, frame } = await formBody();
          check(`${kind} empty`, language, body, frame, 560);
          // Pressed with nothing typed: the slot says what is missing (never disabled).
          const action = document.querySelector<HTMLButtonElement>('[data-testid="crd-decide"] button')!;
          expect(action.disabled).toBeFalse();
          action.click();
          await settle();
          await still(frame);
          expect(body.querySelector('.am-field--error')).withContext('the error is showing').not.toBeNull();
          check(`${kind} with its error`, language, body, frame, 560);
          // A refusal, in the footer.
          decide = () => throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'CHANGE_REQUEST_NOT_UNDER_REVIEW' } }));
          const area = body.querySelector<HTMLTextAreaElement>('textarea')!;
          area.value = 'The quorum change needs the new members named.';
          area.dispatchEvent(new Event('input'));
          action.click();
          await settle();
          ({ body, frame } = await formBody());
          expect(document.querySelector('[data-testid="crd-refusal"]')).withContext('the refusal').not.toBeNull();
          check(`${kind} with a refusal`, language, body, frame, 560);
        }, 30_000);
      }
    });
  }
});
