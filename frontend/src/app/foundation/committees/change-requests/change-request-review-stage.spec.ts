import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import { ConfirmationService } from 'primeng/api';
import { of } from 'rxjs';
import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';
import { FormatService } from '../../../core/formatting';
import { loadTranslationsForTest, provideFormatTesting } from '../../../core/formatting/testing';
import { AuthService } from '../../../core/services/auth.service';
import { AmConfirmOptions, AmConfirmService } from '../../../shared/components/confirm/am-confirm.service';
import { WorkflowInstanceDto, WorkflowService, WorkflowStageHistoryDto } from '../../workflow/services/workflow.service';
import { CommitteeDetailDto, CommitteeService } from '../services/committee.service';
import { ChangeRequestBannerComponent } from './change-request-banner.component';
import { ChangeRequestText, reviewStageOf } from './change-request-text';
import { ChangeRequestDto, ChangeRequestService } from './change-request.service';
import { CommitteeChangeRequestPageComponent } from './committee-change-request-page.component';
import { CommitteeChangeRequestsPanelComponent } from './committee-change-requests-panel.component';
import { REQUEST, fakePhone } from './change-request.testing';
import { preserveDocumentLanguage } from '../../../../testing/document-language';
import { ACTIVE_RULES } from '../testing';

/**
 * ACC-245 PR 3b — a request standing in an ADDED REVIEW STAGE (Committee Changes
 * §5). Its stage has no key (`status` null); the server names it in
 * `awaitingDecisionBy` (REVIEW_STAGE) for every reader, and that name is the
 * status everywhere: the page's chip, the requester's waiting line, the
 * committee's banner and Change requests panel. Never a reviewer's name.
 */

const LEGAL = { id: 'st-legal', nameEn: 'Legal review', nameAr: 'المراجعة القانونية' };
const IN_LEGAL = (over: Partial<ChangeRequestDto> = {}): ChangeRequestDto =>
  REQUEST({
    status: null,
    awaitingDecisionBy: { kind: 'REVIEW_STAGE', stage: LEGAL },
    changes: { quorumCount: 6 },
    fromValues: { quorumCount: 5 },
    submittedAt: '2026-10-15T09:20:00Z',
    ...over,
  });

const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

function configure(extra: unknown[] = []): void {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideNoopAnimations(), provideTranslateService({ lang: 'en' }), provideFormatTesting(), providePrimeNG({}), ...(extra as never[])],
  });
  loadTranslationsForTest({ en, ar });
  TestBed.inject(TranslateService).use('en');
}

describe('Change request in an added review stage (ACC-245 PR 3b)', () => {
  preserveDocumentLanguage();

  beforeEach(() => fakePhone(false));

  describe('the words', () => {
    let words: ChangeRequestText;
    beforeEach(() => {
      configure();
      words = TestBed.inject(ChangeRequestText);
    });

    it('reviewStageOf reads only REVIEW_STAGE: the chain steps and a missing field are not a review stage', () => {
      expect(reviewStageOf(IN_LEGAL())).toEqual(LEGAL);
      expect(reviewStageOf(REQUEST())).toBeNull();
      expect(reviewStageOf(REQUEST({ awaitingDecisionBy: { kind: 'UNIT_HEAD', unit: { id: 'u', nameEn: 'Quality', nameAr: null } } }))).toBeNull();
      expect(reviewStageOf(null)).toBeNull();
    });

    it("the status is the stage's own name, in Under review's tone; a keyed stage keeps its word", () => {
      expect(words.stageOf(IN_LEGAL())).toBe('Legal review');
      expect(words.toneOf(IN_LEGAL())).toBe('under_review');
      expect(words.stageOf(REQUEST())).toBe('Under review');
      expect(words.stageOf(REQUEST({ status: 'returned' }))).toBe('Returned for changes');
      expect(words.toneOf(REQUEST({ status: 'returned' }))).toBe('returned');
      TestBed.inject(TranslateService).use('ar');
      expect(words.stageOf(IN_LEGAL())).toBe('المراجعة القانونية');
      // An Arabic name left empty falls back to English (ACC-160).
      expect(words.stageOf(IN_LEGAL({ awaitingDecisionBy: { kind: 'REVIEW_STAGE', stage: { ...LEGAL, nameAr: null } } }))).toBe('Legal review');
    });
  });

  describe("the committee's banner", () => {
    @Component({
      standalone: true,
      imports: [ChangeRequestBannerComponent],
      template: `<am-change-request-banner state="ready" [request]="request()" />`,
    })
    class HostComponent {
      readonly request = signal<ChangeRequestDto | null>(null);
    }

    it("names the stage in its title, and its body names the requester, never a reviewer (Q8)", () => {
      configure();
      const format = TestBed.inject(FormatService);
      const fixture = TestBed.createComponent(HostComponent);
      fixture.componentInstance.request.set(IN_LEGAL({ changes: { quorumCount: 6, reportingToCommitteeId: 'c-9' } }));
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(text(el.querySelector('.am-crb__title'))).toBe('Change request 3 is in Legal review: Quorum and Reports to');
      expect(text(el.querySelector('.am-crb__body'))).toBe(
        `Submitted by Nora Al-Otaibi on ${format.date('2026-10-15T09:20:00Z')}. Until it is decided, the committee carries on as it is.`,
      );
      TestBed.inject(TranslateService).use('ar');
      fixture.detectChanges();
      expect(text(el.querySelector('.am-crb__title'))).toContain('في مرحلة «المراجعة القانونية»');
    });
  });

  describe("the committee's Change requests panel", () => {
    it('Status reads the stage, and who and when reads as submitted', () => {
      configure([
        { provide: ChangeRequestService, useValue: { list: () => of({ items: [IN_LEGAL(), REQUEST({ id: 'cr-2', number: 2, status: 'approved' })], total: 2, matching: 2 }) } },
      ]);
      const format = TestBed.inject(FormatService);
      const fixture = TestBed.createComponent(CommitteeChangeRequestsPanelComponent);
      fixture.componentRef.setInput('committeeId', 'c-1');
      fixture.componentRef.setInput('committeeName', 'Quality Council');
      fixture.detectChanges();
      const rows = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('li.am-cp-row'));
      const status = rows[0]!.querySelector('.am-ccr__status');
      expect(text(status)).toBe('Legal review');
      expect(status?.getAttribute('data-status')).toBe('under_review');
      expect(text(rows[0]!.querySelector('.am-cp-l2'))).toBe(`Nora Al-Otaibi · submitted ${format.date('2026-10-15T09:20:00Z')}`);
      expect(text(rows[1]!.querySelector('.am-ccr__status'))).toBe('✓ Applied');
    });
  });

  describe('the request page', () => {
    let request: ChangeRequestDto;
    let me: string;
    let asked: AmConfirmOptions[];
    const instance: WorkflowInstanceDto = {
      id: 'wi-1',
      organizationId: 'org',
      workflowTemplateId: 'wt-cr',
      objectType: 'COMMITTEE_CHANGE_REQUEST',
      objectId: 'cr-1',
      status: 'ACTIVE',
      currentStageId: 'st-legal',
      createdAt: '2026-10-15T09:12:00Z',
      updatedAt: '2026-10-15T09:20:00Z',
      unassignedTaskWarnings: [],
    };
    const visit = (id: string, stageId: string, nameEn: string, enteredAt: string, exitedAt: string | null) => ({
      id,
      stageId,
      stageNameEn: nameEn,
      stageNameAr: null,
      enteredAt,
      exitedAt,
      outcome: exitedAt ? 'ADVANCED' : 'PENDING',
      actorId: 'u-nora',
      actorName: 'Nora Al-Otaibi',
      transitionLabelEn: null,
      transitionLabelAr: null,
      comment: null,
      isUnassigned: false,
      delegation: null,
    });
    const history: WorkflowStageHistoryDto = {
      instanceId: 'wi-1',
      stages: [
        { id: 'st-draft', nameEn: 'Draft', nameAr: 'مسودة', order: 10, visitCount: 1, isCurrent: false },
        { id: 'st-legal', nameEn: 'Legal review', nameAr: 'المراجعة القانونية', order: 11, visitCount: 1, isCurrent: true },
        { id: 'st-review', nameEn: 'Under review', nameAr: 'قيد المراجعة', order: 20, visitCount: 0, isCurrent: false },
      ],
      visits: [
        visit('v-1', 'st-draft', 'Draft', '2026-10-15T09:12:00Z', '2026-10-16T08:00:00Z'),
        // The open visit: when the request entered Legal review — not its Submit.
        visit('v-2', 'st-legal', 'Legal review', '2026-10-16T08:00:00Z', null),
      ],
    };
    const LIVE = {
      id: 'c-1',
      organizationId: 'org',
      nameEn: 'Quality Council',
      nameAr: null,
      typeValueId: 'type-1',
      purpose: 'Oversees quality.',
      quorumCount: 5,
      meetingFrequency: 'MONTHLY',
      parentCommitteeId: null,
      orgUnitId: 'unit-root',
      termsOfReferenceDocumentId: null,
      reportingToCommitteeId: null,
      formedAt: null,
      dissolvedAt: null,
      isActive: true,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
      stageRules: ACTIVE_RULES,
      isDissolving: false,
    } as unknown as CommitteeDetailDto;
    let live: CommitteeDetailDto;

    beforeEach(() => {
      request = IN_LEGAL({ actions: { edit: false, submit: false, withdraw: true, approve: false, return: false, reject: false } });
      me = 'u-nora';
      asked = [];
      live = LIVE;
      configure([
        ConfirmationService,
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'c-1', requestId: 'cr-1' }) } } },
        { provide: AuthService, useValue: { currentUser: () => ({ id: me, name: 'Me', email: 'me@x' }) } },
        { provide: AmConfirmService, useValue: { ask: (o: AmConfirmOptions) => asked.push(o) } },
        { provide: CommitteeService, useValue: { getById: () => of(live) } },
        { provide: WorkflowService, useValue: { getInstancesByObject: () => of([instance]), getStageHistory: () => of(history) } },
        { provide: ChangeRequestService, useValue: { get: () => of(request), preview: () => of({ changedFields: ['quorumCount'], impacts: [], labels: {} }) } },
      ]);
    });

    function render(): HTMLElement {
      const fixture: ComponentFixture<CommitteeChangeRequestPageComponent> = TestBed.createComponent(CommitteeChangeRequestPageComponent);
      fixture.detectChanges();
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    }

    it("the chip is the stage's own name in Under review's tone, never the \"Open\" fallback", () => {
      const chip = render().querySelector('[data-testid="crp-status"]');
      expect(text(chip)).toBe('Legal review');
      expect(chip?.getAttribute('data-status')).toBe('under_review');
    });

    it('the requester waits on the stage, since the request ENTERED it (the open visit), and may withdraw', () => {
      const format = TestBed.inject(FormatService);
      const el = render();
      expect(text(el.querySelector('[data-testid="crp-banner-waiting-stage"]'))).toBe(
        `Waiting for Legal review since ${format.date('2026-10-16T08:00:00Z')}. You can withdraw it until it's decided.`,
      );
      // Under review's own line is not shown here.
      expect(el.querySelector('[data-testid="crp-banner-waiting"]')).toBeNull();
      expect(el.querySelector('[data-testid="crp-withdraw"]')).not.toBeNull();
    });

    it('a reviewer (not the requester) sees no waiting line, and the buttons are the server\'s flags', () => {
      me = 'u-omar';
      request = IN_LEGAL({ actions: { edit: false, submit: false, withdraw: false, approve: true, return: true, reject: true } });
      const el = render();
      expect(el.querySelector('[data-testid="crp-banner-waiting-stage"]')).toBeNull();
      for (const id of ['crp-approve', 'crp-return', 'crp-reject']) expect(el.querySelector(`[data-testid="${id}"]`)).not.toBeNull();
      expect(el.querySelector('[data-testid="crp-withdraw"]')).toBeNull();
    });

    it('a committee changed since Submit is marked, as Under review marks it', () => {
      live = { ...LIVE, quorumCount: 4 };
      const el = render();
      expect(el.querySelector('[data-testid="crp-banner-drift"]')).not.toBeNull();
    });
  });
});
