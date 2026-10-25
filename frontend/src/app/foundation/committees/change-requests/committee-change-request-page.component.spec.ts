import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import { ConfirmationService } from 'primeng/api';
import { Observable, of, throwError } from 'rxjs';
import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';
import { FormatService } from '../../../core/formatting';
import { loadTranslationsForTest, provideFormatTesting } from '../../../core/formatting/testing';
import { AuthService } from '../../../core/services/auth.service';
import { AmConfirmOptions, AmConfirmService } from '../../../shared/components/confirm/am-confirm.service';
import { WorkflowService } from '../../workflow/services/workflow.service';
import { CommitteeDetailDto, CommitteeService } from '../services/committee.service';
import { CommitteeChangeRequestPageComponent } from './committee-change-request-page.component';
import { ChangeRequestActionsDto, ChangeRequestDto, ChangeRequestService } from './change-request.service';
import { REQUEST, fakePhone } from './change-request.testing';
import { preserveDocumentLanguage } from '../../../../testing/document-language';
import { ACTIVE_RULES } from '../testing';

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
  orgUnitId: 'unit-root',
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

const NONE: ChangeRequestActionsDto = { edit: false, submit: false, withdraw: false, approve: false, return: false, reject: false };
const BUTTONS = ['crp-edit', 'crp-submit', 'crp-approve', 'crp-return', 'crp-reject', 'crp-withdraw'] as const;
const FLAG: Record<(typeof BUTTONS)[number], keyof ChangeRequestActionsDto> = {
  'crp-edit': 'edit',
  'crp-submit': 'submit',
  'crp-approve': 'approve',
  'crp-return': 'return',
  'crp-reject': 'reject',
  'crp-withdraw': 'withdraw',
};

/** What each viewer's flags are in each stage, as the server answers them (policy §2). */
const MATRIX: Record<string, Record<'requester' | 'approver' | 'reader', Partial<ChangeRequestActionsDto>>> = {
  draft: { requester: { edit: true, submit: true, withdraw: true }, approver: { withdraw: true }, reader: {} },
  under_review: { requester: { withdraw: true }, approver: { approve: true, return: true, reject: true }, reader: {} },
  returned: { requester: { edit: true, submit: true, withdraw: true }, approver: { withdraw: true }, reader: {} },
  approved: { requester: {}, approver: {}, reader: {} },
  rejected: { requester: {}, approver: {}, reader: {} },
  withdrawn: { requester: {}, approver: {}, reader: {} },
};
const VIEWER_ID = { requester: 'u-nora', approver: 'u-hessa', reader: 'u-fahad' };

// ACC-240 — the request page (plan §3.3).
describe('CommitteeChangeRequestPageComponent (ACC-240)', () => {
  preserveDocumentLanguage();

  let fixture: ComponentFixture<CommitteeChangeRequestPageComponent>;
  let format: FormatService;
  let request: ChangeRequestDto;
  let committee: CommitteeDetailDto;
  let me: string;
  let asked: AmConfirmOptions[];
  let get: () => Observable<ChangeRequestDto>;
  let calls: Record<string, jasmine.Spy>;
  let previews: number;

  beforeEach(() => {
    fakePhone(false);
    request = REQUEST();
    committee = LIVE;
    me = VIEWER_ID.reader;
    asked = [];
    previews = 0;
    get = () => of(request);
    const moved = (status: string) => () => of(REQUEST({ ...request, status, actions: NONE }));
    calls = {
      submit: jasmine.createSpy('submit').and.callFake(moved('under_review')),
      approve: jasmine.createSpy('approve').and.callFake(moved('approved')),
      withdraw: jasmine.createSpy('withdraw').and.callFake(moved('withdrawn')),
      returnForChanges: jasmine.createSpy('return').and.callFake(moved('returned')),
      reject: jasmine.createSpy('reject').and.callFake(moved('rejected')),
    };
    TestBed.configureTestingModule({
      imports: [CommitteeChangeRequestPageComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({}),
        ConfirmationService,
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'c-1', requestId: 'cr-1' }) } } },
        { provide: AuthService, useValue: { currentUser: () => ({ id: me, name: 'Me', email: 'me@x' }) } },
        { provide: AmConfirmService, useValue: { ask: (o: AmConfirmOptions) => asked.push(o) } },
        { provide: CommitteeService, useValue: { getById: () => of(committee) } },
        { provide: WorkflowService, useValue: { getInstancesByObject: () => of([]) } },
        {
          provide: ChangeRequestService,
          useValue: {
            get: () => get(),
            preview: () => {
              previews++;
              return of({ changedFields: ['quorumCount'], impacts: [{ code: 'QUORUM', from: 5, to: 6, inProgress: 2 }, { code: 'TERMS_TASK' }], labels: {} });
            },
            ...calls,
          },
        },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    format = TestBed.inject(FormatService);
  });

  function render(): HTMLElement {
    fixture = TestBed.createComponent(CommitteeChangeRequestPageComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const text = (e: Element | null) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const shown = (el: HTMLElement) => BUTTONS.filter((id) => el.querySelector(`[data-testid="${id}"]`));
  const press = (el: HTMLElement, id: string) => (el.querySelector(`[data-testid="${id}"] button`) as HTMLButtonElement).click();

  describe('each stage key × viewer renders exactly the buttons its flags allow', () => {
    for (const [status, viewers] of Object.entries(MATRIX)) {
      for (const [viewer, flags] of Object.entries(viewers)) {
        it(`${status}, ${viewer}`, () => {
          me = VIEWER_ID[viewer as keyof typeof VIEWER_ID];
          request = REQUEST({ status, actions: { ...NONE, ...flags }, decidedAt: '2026-10-19T09:00:00Z', decidedById: 'u-hessa', decidedBy: { id: 'u-hessa', name: 'Hessa' } });
          const el = render();
          const want = BUTTONS.filter((id) => flags[FLAG[id]]);
          expect(shown(el)).toEqual(want);
        });
      }
    }

    it('a flag alone decides: every flag true shows all six, whatever the stage', () => {
      request = REQUEST({ status: 'approved', actions: { edit: true, submit: true, withdraw: true, approve: true, return: true, reject: true } });
      expect(shown(render())).toEqual([...BUTTONS]);
    });
  });

  it('the header: eyebrow, title, the status chip and who and when', () => {
    const el = render();
    expect(text(el.querySelector('h1'))).toBe('Change request 3 · Quality Council');
    expect(text(el.querySelector('[data-testid="crp-status"]'))).toBe('Under review');
    expect(text(el.querySelector('[data-testid="crp-who"]'))).toBe(`Requested by Nora Al-Otaibi · ${format.date('2026-10-18T09:00:00Z')}`);
  });

  it('open: Current is the live value, and the impact lines are the preview', () => {
    const el = render();
    expect(text(el.querySelector('[data-crp-row="quorumCount"] [data-testid="crp-current"]'))).toBe('5');
    expect(text(el.querySelector('[data-crp-row="quorumCount"] [data-testid="crp-proposed"]'))).toBe('6');
    expect(previews).toBe(1);
    expect(el.querySelectorAll('[data-testid="crp-impact-line"]').length).toBe(2);
    expect(text(el.querySelector('[data-testid="crp-reason"]'))).toBe('Two new members joined.');
  });

  it('drift: a live value that moved since Submit is marked, with the drift banner', () => {
    committee = { ...LIVE, quorumCount: 4 };
    const el = render();
    expect(text(el.querySelector('[data-crp-row="quorumCount"] [data-testid="crp-current"]'))).toBe('4');
    expect(el.querySelector('[data-testid="crp-drift"]')).not.toBeNull();
    expect(text(el.querySelector('[data-testid="crp-banner-drift"]'))).toContain('The committee has changed since this request was submitted.');
  });

  it('no drift while the live value still matches what was submitted', () => {
    const el = render();
    expect(el.querySelector('[data-testid="crp-drift"]')).toBeNull();
    expect(el.querySelector('[data-testid="crp-banner-drift"]')).toBeNull();
  });

  it('applied: Current is the stored value, struck through; no preview; the Applied banner', () => {
    committee = { ...LIVE, quorumCount: 6 };
    request = REQUEST({ status: 'approved', appliedAt: '2026-10-20T09:00:00Z', decidedAt: '2026-10-20T09:00:00Z', decidedById: 'u-hessa', decidedBy: { id: 'u-hessa', name: 'Hessa' }, termsTaskId: 't-9' });
    const el = render();
    const current = el.querySelector('[data-crp-row="quorumCount"] [data-testid="crp-current"]')!;
    expect(text(current)).toBe('5');
    expect(current.classList).toContain('am-crc__v--struck');
    expect(previews).toBe(0);
    expect(el.querySelector('[data-testid="crp-impact"]')).toBeNull();
    expect(text(el.querySelector('[data-testid="crp-banner-applied"]'))).toContain(`Applied ${format.date('2026-10-20T09:00:00Z')}`);
    expect(text(el.querySelector('[data-testid="crp-who"]'))).toBe('Approved by Hessa');
  });

  describe('the terms task link: only for the requester and the decider (D6)', () => {
    beforeEach(() => {
      request = REQUEST({ status: 'approved', appliedAt: '2026-10-20T09:00:00Z', decidedById: 'u-hessa', decidedBy: { id: 'u-hessa', name: 'Hessa' }, termsTaskId: 't-9' });
    });
    for (const [viewer, linked] of [['requester', true], ['approver', true], ['reader', false]] as const) {
      it(viewer, () => {
        me = VIEWER_ID[viewer];
        const el = render();
        const link = el.querySelector('[data-testid="crp-open-task"]');
        if (linked) expect(link?.getAttribute('href')).toBe('/tasks/t-9');
        else expect(link).toBeNull();
        // The sentence is there for everyone.
        expect(text(el.querySelector('[data-testid="crp-banner-applied"]'))).toContain('A task to revise the terms of reference was created for Nora Al-Otaibi.');
      });
    }
  });

  it('rejected: who, when and the reason; Current from what was submitted; "What it asked to change"', () => {
    committee = { ...LIVE, quorumCount: 4 };
    request = REQUEST({ status: 'rejected', rejectionReason: 'Not now.', decidedAt: '2026-10-19T09:00:00Z', decidedBy: { id: 'u-hessa', name: 'Hessa' } });
    const el = render();
    expect(text(el.querySelector('[data-testid="crp-banner-rejected"] strong'))).toBe(`Rejected by Hessa on ${format.date('2026-10-19T09:00:00Z')}`);
    expect(text(el.querySelector('[data-testid="crp-banner-rejected"] span'))).toBe('“Not now.” Nothing was changed.');
    expect(text(el.querySelector('[data-crp-row="quorumCount"] [data-testid="crp-current"]'))).toBe('5');
    expect(text(el.querySelector('#crp-h-changes'))).toBe('What it asked to change');
  });

  it('withdrawn before it was submitted: Current is the live value', () => {
    committee = { ...LIVE, quorumCount: 4 };
    request = REQUEST({ status: 'withdrawn', submittedAt: null, fromValues: null, withdrawnAt: '2026-10-19T09:00:00Z', withdrawnBy: { id: 'u-nora', name: 'Nora Al-Otaibi' } });
    const el = render();
    expect(text(el.querySelector('[data-crp-row="quorumCount"] [data-testid="crp-current"]'))).toBe('4');
    expect(text(el.querySelector('[data-testid="crp-banner-withdrawn"]'))).toContain('Withdrawn by Nora Al-Otaibi');
  });

  it('returned: the note, who and when', () => {
    request = REQUEST({ status: 'returned', returnNote: 'Say which members.', decidedAt: '2026-10-19T09:00:00Z', decidedBy: { id: 'u-hessa', name: 'Hessa' } });
    const el = render();
    expect(text(el.querySelector('[data-testid="crp-banner-returned"] strong'))).toBe('Returned for changes');
    expect(text(el.querySelector('[data-testid="crp-banner-returned"] span'))).toBe(`“Say which members.” · Hessa, ${format.date('2026-10-19T09:00:00Z')}`);
  });

  it('dissolving: its banner while the request is open', () => {
    committee = { ...LIVE, isDissolving: true };
    expect(render().querySelector('[data-testid="crp-banner-dissolving"]')).not.toBeNull();
  });

  it('waiting: shown to the requester under review, and to nobody else', () => {
    me = VIEWER_ID.requester;
    expect(text(render().querySelector('[data-testid="crp-banner-waiting"]'))).toContain(`Waiting for a decision since ${format.date('2026-10-18T09:00:00Z')}`);
    TestBed.resetTestingModule();
  });

  it('a long purpose: two lines and an ellipsis, the whole text in a tooltip', () => {
    const long = 'A'.repeat(400);
    request = REQUEST({ changes: { purpose: long }, fromValues: { purpose: 'Oversees quality.' } });
    const el = render();
    const proposed = el.querySelector<HTMLElement>('[data-crp-row="purpose"] [data-testid="crp-proposed"]')!;
    expect(proposed.classList).toContain('am-crc__v--long');
    expect(proposed.getAttribute('title')).toBe(long);
  });

  describe('Approve', () => {
    beforeEach(() => {
      me = VIEWER_ID.approver;
      request = REQUEST({ changes: { quorumCount: 6, reportingToCommitteeId: 'c-8' }, fromValues: { quorumCount: 5, reportingToCommitteeId: 'c-9' }, actions: { ...NONE, approve: true, return: true, reject: true }, labels: { 'c-9': { en: 'Board', ar: null }, 'c-8': { en: 'Medical Executive Committee', ar: null } } });
    });

    it('asks through ask(), the changes listed in words, then the task it creates', () => {
      const el = render();
      press(el, 'crp-approve');
      expect(asked.length).toBe(1);
      expect(asked[0]).toEqual(
        jasmine.objectContaining({
          tone: 'neutral',
          header: 'Approve and apply these changes?',
          message: 'A task to revise the terms of reference will be created for Nora Al-Otaibi.',
          details: ['Quorum: 5 → 6', 'Reports to: Board → Medical Executive Committee'],
          acceptLabel: 'Approve',
        }),
      );
      asked[0].accept();
      fixture.detectChanges();
      expect(calls['approve']).toHaveBeenCalledWith('cr-1');
      expect(text(el.querySelector('[data-testid="crp-status"]'))).toBe('✓ Applied');
    });

    it('one change: the singular header', () => {
      request = { ...request, changes: { quorumCount: 6 } };
      press(render(), 'crp-approve');
      expect(asked[0].header).toBe('Approve and apply this change?');
    });

    it('more than six changes collapse to two and "n more"', () => {
      request = { ...request, changes: { nameEn: 'N', nameAr: 'ن', typeValueId: 't', purpose: 'p', quorumCount: 6, meetingFrequency: 'WEEKLY', orgUnitId: 'u' } };
      press(render(), 'crp-approve');
      expect(asked[0].details).toEqual(['Name (English), Name (Arabic) and 5 more']);
    });

    it('a refusal is said from its code on the page, without Retry', () => {
      calls['approve'].and.callFake(() => throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'CHANGE_REQUEST_COMMITTEE_CHANGED' } })));
      const el = render();
      press(el, 'crp-approve');
      asked[0].accept();
      fixture.detectChanges();
      expect(text(el.querySelector('[data-testid="crp-action-error"]'))).toBe(en.committee.changeRequest.refusal.CHANGE_REQUEST_COMMITTEE_CHANGED);
      expect(el.querySelector('[data-testid="crp-action-error"] button')).toBeNull();
    });

    it('unreachable: Retry, which asks again', () => {
      calls['approve'].and.callFake(() => throwError(() => new HttpErrorResponse({ status: 503 })));
      const el = render();
      press(el, 'crp-approve');
      asked[0].accept();
      fixture.detectChanges();
      (el.querySelector('[data-testid="crp-action-error"] button') as HTMLButtonElement).click();
      expect(asked.length).toBe(2);
    });

    it('Return… and Reject… open their dialogs', () => {
      const el = render();
      press(el, 'crp-return');
      fixture.detectChanges();
      expect(fixture.componentInstance.decision()).toBe('return');
      expect(el.querySelector('am-change-request-decision-dialog')).not.toBeNull();
    });
  });

  it('Withdraw asks through ask(), destructive, with Keep it', () => {
    me = VIEWER_ID.requester;
    request = REQUEST({ actions: { ...NONE, withdraw: true } });
    const el = render();
    press(el, 'crp-withdraw');
    expect(asked[0]).toEqual(
      jasmine.objectContaining({ tone: 'destructive', header: 'Withdraw change request 3?', acceptLabel: 'Withdraw', rejectLabel: 'Keep it' }),
    );
    asked[0].accept();
    expect(calls['withdraw']).toHaveBeenCalledWith('cr-1');
  });

  it('Submit for review calls submit, and the page shows the moved request', () => {
    me = VIEWER_ID.requester;
    request = REQUEST({ status: 'draft', actions: { ...NONE, submit: true, edit: true } });
    const el = render();
    press(el, 'crp-submit');
    fixture.detectChanges();
    expect(calls['submit']).toHaveBeenCalledWith('cr-1');
    expect(text(el.querySelector('[data-testid="crp-status"]'))).toBe('Under review');
  });

  it('Edit goes to the draft edit page', () => {
    request = REQUEST({ status: 'draft', actions: { ...NONE, edit: true } });
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    press(render(), 'crp-edit');
    expect(navigate).toHaveBeenCalledWith(['/committees', 'c-1', 'change-requests', 'cr-1', 'edit']);
  });

  describe('on a phone', () => {
    it('the actions sit in a bar named for the request, and not in the header', () => {
      fakePhone(true);
      request = REQUEST({ actions: { ...NONE, approve: true, return: true, reject: true } });
      const el = render();
      const bar = el.querySelector('[data-testid="crp-bar"]')!;
      expect(bar.getAttribute('role')).toBe('region');
      expect(bar.getAttribute('aria-label')).toBe('Actions for change request 3');
      expect(BUTTONS.filter((id) => bar.querySelector(`[data-testid="${id}"]`))).toEqual(['crp-approve', 'crp-return', 'crp-reject']);
      expect(el.querySelector('[data-testid="crp-actions"]')).toBeNull();
      expect(getComputedStyle(bar).position).toBe('sticky');
    });

    it('no bar when the viewer has nothing to do', () => {
      fakePhone(true);
      expect(render().querySelector('[data-testid="crp-bar"]')).toBeNull();
    });
  });

  it('not found: the same page for an invented id and for a request of another committee', () => {
    get = () => throwError(() => new HttpErrorResponse({ status: 404 }));
    expect(text(render().querySelector('[data-testid="crp-not-found"] h1'))).toBe('Change request not found');
    TestBed.resetTestingModule();
  });

  it('…a request whose committee is not the one in the address is not found too', () => {
    request = REQUEST({ committeeId: 'c-other' });
    expect(render().querySelector('[data-testid="crp-not-found"]')).not.toBeNull();
  });

  it('a failed read: the sentence and Retry', () => {
    let fail = true;
    get = () => (fail ? throwError(() => new HttpErrorResponse({ status: 500 })) : of(request));
    const el = render();
    expect(text(el.querySelector('[data-testid="crp-error"]'))).toContain("Couldn't load this change request.");
    fail = false;
    (el.querySelector('[data-testid="crp-error"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('h1')).not.toBeNull();
  });

  it('Arabic', () => {
    TestBed.inject(TranslateService).use('ar');
    const el = render();
    expect(text(el.querySelector('h1'))).toBe(ar.committee.changeRequest.page.title.replace('{{n}}', '3').replace('{{committee}}', 'مجلس الجودة'));
    expect(text(el.querySelector('[data-testid="crp-status"]'))).toBe(ar.committee.changeRequest.status.under_review);
  });
});
