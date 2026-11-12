import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import { Observable, Subject, of, throwError } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { UserService } from '../../services/user.service';
import { OrgUnitService } from '../../../organization/services/org-unit.service';
import { OrgUnitHeadService } from '../../../organization/services/org-unit-head.service';
import { CommitteeService, RemoveCommitteeMemberDto } from '../../../committees/services/committee.service';
import { TransferCommitteesDto, TransferCommitteesService } from '../../services/transfer-committees.service';
import { TransferUserWizardComponent } from './transfer-user-wizard.component';
import { transferSeatReason } from './transfer-seat-reason';
import { PERSON, SOURCE_UNIT, UNITS, UNITS_EN_ONLY, fakeUserService, seat, seats, walkToAfterManager } from './transfer-wizard.testing';

// ACC-296 — the Transfer wizard's Committees step: when it shows, what it
// offers, what Review says, and the removes after the transfer.

const REMOVE = 'committees:remove_member';
const MOVED_EN = 'Transferred from Pharmacy to Intensive Care.';
const SAME_EN = 'Moved to a new position in Pharmacy.';
const MOVED_AR = 'النقل من الصيدلية إلى العناية المركزة.';
const SAME_AR = 'الانتقال إلى مسمى وظيفي جديد في الصيدلية.';

const httpError = (status: number, body: unknown = null) => new HttpErrorResponse({ status, error: body });
const stageRefusal = () =>
  httpError(409, { code: 'STAGE_ACTION_NOT_ALLOWED', action: 'remove_member', stageNameEn: 'Dissolved', stageNameAr: 'منحلة' });
const stageSentence = (stage: string) => en.committee.refusal.membersNotAllowedInStage.replace('{{stage}}', stage);

describe('TransferUserWizard — the Committees step (ACC-296)', () => {
  preserveDocumentLanguage();

  let fixture: ComponentFixture<TransferUserWizardComponent>;
  let wizard: TransferUserWizardComponent;
  let log: string[];
  let removeCalls: { committeeId: string; memberId: string; dto: RemoveCommitteeMemberDto }[];
  let committeesReads: number;

  interface Options {
    committees?: () => Observable<TransferCommitteesDto>;
    permissions?: string[];
    reports?: boolean;
    transfer?: () => Observable<unknown>;
    /** memberId → what its DELETE answers; absent = success. Each call takes the next answer. */
    removes?: Record<string, (() => Observable<void>)[]>;
    position?: { nameEn: string; nameAr: string | null };
    units?: typeof UNITS_EN_ONLY;
  }

  function render(opts: Options = {}): HTMLElement {
    log = [];
    removeCalls = [];
    committeesReads = 0;
    const answers = Object.fromEntries(Object.entries(opts.removes ?? {}).map(([k, v]) => [k, [...v]]));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [TransferUserWizardComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        providePrimeNG({}),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        {
          provide: UserService,
          useValue: fakeUserService({ reports: opts.reports, transfer: opts.transfer, log, position: opts.position }),
        },
        { provide: OrgUnitService, useValue: { getFlat: () => of(opts.units ?? UNITS) } },
        { provide: OrgUnitHeadService, useValue: {} },
        {
          provide: NavigationAccessService,
          useValue: { hasPermission: (p: string) => (opts.permissions ?? [REMOVE]).includes(p) },
        },
        {
          provide: TransferCommitteesService,
          useValue: {
            forUser: () => {
              committeesReads++;
              return opts.committees ? opts.committees() : of(seats(2));
            },
          },
        },
        {
          provide: CommitteeService,
          useValue: {
            removeMember: (committeeId: string, memberId: string, dto: RemoveCommitteeMemberDto) => {
              removeCalls.push({ committeeId, memberId, dto });
              log.push(`remove:${memberId}`);
              const next = answers[memberId]?.shift();
              return next ? next() : of(undefined);
            },
          },
        },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    fixture = TestBed.createComponent(TransferUserWizardComponent);
    fixture.componentRef.setInput('userId', PERSON.id);
    fixture.detectChanges();
    wizard = fixture.componentInstance;
    return fixture.nativeElement as HTMLElement;
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const text = (node: Element | null) => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const steps = () => Array.from(el().querySelectorAll('p-step')).map((s) => text(s));
  const go = (opts: { reports?: boolean; destination?: string } = {}) => {
    walkToAfterManager(wizard, opts);
    fixture.detectChanges();
  };
  const seatRow = (memberId: string) => el().querySelector(`[data-seat="${memberId}"]`);
  const choose = (memberId: string, choice: 'keep' | 'remove') => {
    wizard.setSeatChoice(memberId, choice);
    fixture.detectChanges();
  };
  const toReview = () => {
    wizard.currentStep.set(wizard.stepValues().review);
    fixture.detectChanges();
  };
  const submit = () => {
    wizard.submit();
    fixture.detectChanges();
  };

  describe('when the step shows', () => {
    it('with rows: a step after Manager, numbered 4 and Review 5 without Replacement', () => {
      render();
      go();
      expect(wizard.stepValues()).toEqual(jasmine.objectContaining({ manager: 3, committees: 4, review: 5 }));
      expect(steps().map((s) => s.replace(/^\d+\s*/, ''))).toEqual(['Destination', 'Position', 'Manager', 'Committees', 'Review']);
      expect(steps().map((s) => s.match(/^\d+/)?.[0])).toEqual(['1', '2', '3', '4', '5']);
      expect(wizard.currentStep()).withContext('Next from Manager lands on Committees').toBe(4);
      expect(el().querySelector('[data-testid="transfer-committees"]')).not.toBeNull();
    });

    it('with Replacement too: Committees 5 and Review 6, numbered without a gap', () => {
      render({ reports: true });
      go({ reports: true });
      expect(wizard.stepValues()).toEqual(jasmine.objectContaining({ manager: 4, committees: 5, review: 6 }));
      expect(steps().map((s) => s.match(/^\d+/)?.[0])).toEqual(['1', '2', '3', '4', '5', '6']);
      expect(wizard.currentStep()).toBe(5);
    });

    it('0 rows: absent, and Next from Manager goes to Review', () => {
      render({ committees: () => of({ total: 0, rows: [] }) });
      go();
      expect(wizard.showsCommittees()).toBeFalse();
      expect(steps().length).toBe(4);
      expect(wizard.currentStep()).toBe(wizard.stepValues().review);
      expect(wizard.stepValues().review).toBe(4);
    });

    it('403: absent, and nothing is said anywhere', () => {
      render({ committees: () => throwError(() => httpError(403)) });
      go();
      expect(wizard.showsCommittees()).toBeFalse();
      expect(steps().length).toBe(4);
      expect(el().querySelector('[data-testid="transfer-committees-failed"]')).toBeNull();
      expect(el().querySelector('p-message')).toBeNull();
    });

    it('500: present with the failure line and Try again; Next still goes on to Review', () => {
      let calls = 0;
      render({
        committees: () => (++calls === 1 ? throwError(() => httpError(500)) : of(seats(1))),
      });
      go();
      expect(wizard.showsCommittees()).toBeTrue();
      expect(text(el().querySelector('[data-testid="transfer-committees-failed"]'))).toBe("Couldn't load this person's committees.");
      // Try again reads once more and shows the seats.
      (el().querySelector('[data-testid="transfer-committees-retry"] button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(committeesReads).toBe(2);
      expect(seatRow('m-1')).not.toBeNull();
    });

    it('500 and never retried: Next from the step reaches Review, and Review has no Committees line', () => {
      render({ committees: () => throwError(() => httpError(500)) });
      go();
      toReview();
      expect(wizard.reviewCommittees()).toBeNull();
      expect(el().querySelector('[data-testid="transfer-review-committees"]')).toBeNull();
    });

    it('reads the seats ONCE, when the wizard opens', () => {
      render();
      go();
      toReview();
      expect(committeesReads).toBe(1);
    });

    it('Manager’s Next waits for a read still loading, then lands on Committees', () => {
      const pending = new Subject<TransferCommitteesDto>();
      render({ committees: () => pending });
      go();
      expect(wizard.currentStep()).withContext('still on Manager while the read loads').toBe(wizard.stepValues().manager);
      expect(wizard.loading()).toBeTrue();
      pending.next(seats(2));
      pending.complete();
      fixture.detectChanges();
      expect(wizard.loading()).toBeFalse();
      expect(wizard.currentStep()).toBe(wizard.stepValues().committees);
    });
  });

  describe('each row', () => {
    it('names the committee, the seat and the stage, with a line above saying the seats stay', () => {
      render();
      go();
      expect(text(el().querySelector('[data-testid="transfer-committees-intro"]'))).toBe(
        'Huda Al-Harbi keeps these seats unless you choose Remove.',
      );
      expect(text(seatRow('m-1')!.querySelector('[data-seat-name]'))).toBe('Committee 1');
      expect(text(seatRow('m-1')!.querySelector('[data-seat-meta]'))).toBe('Member · Active');
    });

    it('defaults to Keep, and offers Remove with mayRemove and committees:remove_member', () => {
      render();
      go();
      expect(seatRow('m-1')!.getAttribute('data-offer')).toBe('choice');
      expect(seatRow('m-1')!.querySelector('[data-seat-choice]')).not.toBeNull();
      expect(wizard.seatRows()[0]!.choice).toBe('keep');
      expect(wizard.seatsToRemove()).toEqual([]);
    });

    it('a stage that does not allow it: no choice, and the committee screens’ own sentence', () => {
      render({ committees: () => of({ total: 2, rows: [seat(1), seat(2, { mayRemove: false, stage: { nameEn: 'Dissolution Pending', nameAr: 'قيد الحل' } })] }) });
      go();
      const blocked = seatRow('m-2')!;
      expect(blocked.getAttribute('data-offer')).toBe('stage');
      expect(blocked.querySelector('[data-seat-choice]')).toBeNull();
      expect(text(blocked.querySelector('[data-seat-why="stage"]'))).toBe(stageSentence('Dissolution Pending'));
    });

    it('without committees:remove_member: no choice on any row, and the role sentence', () => {
      render({ permissions: [] });
      go();
      for (const id of ['m-1', 'm-2']) {
        expect(seatRow(id)!.getAttribute('data-offer')).toBe('permission');
        expect(seatRow(id)!.querySelector('[data-seat-choice]')).toBeNull();
        expect(text(seatRow(id)!.querySelector('[data-seat-why="permission"]'))).toBe("Your role can't remove committee members.");
      }
    });

    it('a choice cannot reach the removes on a row that offered none', () => {
      render({ committees: () => of({ total: 1, rows: [seat(1, { mayRemove: false })] }) });
      go();
      choose('m-1', 'remove');
      expect(wizard.seatsToRemove()).toEqual([]);
    });

    it('more seats than the read returned: "Showing 100 of 140…"', () => {
      render({ committees: () => of(seats(100, 140)) });
      go();
      expect(text(el().querySelector('[data-testid="transfer-seats-over-cap"]'))).toBe(
        "Showing 100 of 140. Remove the others from each committee's page.",
      );
    });

    it('no over-cap line when every seat is shown', () => {
      render({ committees: () => of(seats(5)) });
      go();
      expect(el().querySelector('[data-testid="transfer-seats-over-cap"]')).toBeNull();
    });

    it('the list is a focusable region named for what it holds', () => {
      render();
      go();
      const list = el().querySelector('[data-testid="transfer-seats-list"]')!;
      expect(list.getAttribute('role')).toBe('region');
      expect(list.getAttribute('tabindex')).toBe('0');
      expect(list.getAttribute('aria-label')).toBe('Committee seats');
    });
  });

  describe('Review', () => {
    it('says "Keep 1 · Remove 1" and names the committee being left', () => {
      render();
      go();
      choose('m-2', 'remove');
      toReview();
      const line = el().querySelector('[data-testid="transfer-review-committees"]')!;
      expect(text(line.querySelector('span:first-child'))).toBe('Committees');
      expect(text(line.querySelector('span:last-child'))).toBe('Keep 1 · Remove 1');
      expect(text(el().querySelector('[data-testid="transfer-review-removed"]'))).toBe('Committee 2');
    });

    it('counts the seats beyond the first 100 as kept', () => {
      render({ committees: () => of(seats(100, 140)) });
      go();
      choose('m-1', 'remove');
      toReview();
      expect(wizard.reviewCommittees()?.counts).toBe('Keep 139 · Remove 1');
    });

    it('no Committees line when the step was absent', () => {
      render({ committees: () => of({ total: 0, rows: [] }) });
      go();
      toReview();
      expect(el().querySelector('[data-testid="transfer-review-committees"]')).toBeNull();
    });
  });

  describe("names in the reader's language", () => {
    afterEach(() => TestBed.inject(TranslateService).use('en'));

    it('in Arabic, the position picker and Review name the unit and position in Arabic', () => {
      render({ position: { nameEn: 'Clinical Pharmacist', nameAr: 'صيدلي سريري' } });
      TestBed.inject(TranslateService).use('ar');
      go();
      expect(wizard.positionOptions()).toEqual([{ id: 'p-1', label: 'صيدلي سريري' }]);
      toReview();
      expect(text(el().querySelector('[data-testid="transfer-review-unit"]'))).toBe('العناية المركزة');
      expect(text(el().querySelector('[data-testid="transfer-review-position"]'))).toBe('صيدلي سريري');
    });

    it('Review follows a language switch made after Manager', () => {
      render({ position: { nameEn: 'Clinical Pharmacist', nameAr: 'صيدلي سريري' } });
      go();
      toReview();
      expect(text(el().querySelector('[data-testid="transfer-review-position"]'))).toBe('Clinical Pharmacist');
      TestBed.inject(TranslateService).use('ar');
      fixture.detectChanges();
      expect(text(el().querySelector('[data-testid="transfer-review-unit"]'))).toBe('العناية المركزة');
      expect(text(el().querySelector('[data-testid="transfer-review-position"]'))).toBe('صيدلي سريري');
    });

    it('the success message names the unit in Arabic', () => {
      render();
      TestBed.inject(TranslateService).use('ar');
      go();
      submit();
      expect(wizard.submitResult()?.message).toContain('العناية المركزة');
      expect(wizard.submitResult()?.message).not.toContain('Intensive Care');
    });

    it('with no Arabic names, Arabic falls back to the English ones, never blank', () => {
      render({ position: { nameEn: 'Clinical Pharmacist', nameAr: null }, units: UNITS_EN_ONLY });
      TestBed.inject(TranslateService).use('ar');
      go();
      expect(wizard.positionOptions()).toEqual([{ id: 'p-1', label: 'Clinical Pharmacist' }]);
      toReview();
      expect(text(el().querySelector('[data-testid="transfer-review-unit"]'))).toBe('Intensive Care');
      expect(text(el().querySelector('[data-testid="transfer-review-position"]'))).toBe('Clinical Pharmacist');
    });
  });

  describe('Arabic wording (gender-neutral)', () => {
    const c = ar.user.transfer.committees;
    const pc = ar.plural.user.transfer.committees;

    it('the intro asks no one to choose: «ما لم تُحدَّد «إزالة».»', () => {
      expect(c.intro).toBe('تبقى هذه المقاعد باسم {{name}} ما لم تُحدَّد «إزالة».');
    });

    it('the over-cap line in every form: «يمكن إزالة البقية…»', () => {
      for (const form of ['zero', 'one', 'two', 'few', 'many', 'other'] as const) {
        expect(pc.overCap[form]).withContext(form).toBe('يُعرض {{shown}} من {{count}}. يمكن إزالة البقية من صفحة كل لجنة.');
      }
    });

    it('"Removed from n committees", many: the accusative «لجنةً»', () => {
      expect(pc.removedAll.many).toBe('تمت الإزالة من {{count}} لجنةً.');
    });
  });

  describe('after Submit', () => {
    it('removes nothing when the transfer fails', () => {
      render({ transfer: () => throwError(() => httpError(409, { message: 'No' })) });
      go();
      choose('m-1', 'remove');
      submit();
      expect(removeCalls).toEqual([]);
      expect(wizard.seatRemoval()).toBeNull();
    });

    it('removes the chosen seats only after the transfer returned, with the reason', () => {
      render();
      go();
      choose('m-1', 'remove');
      choose('m-2', 'remove');
      submit();
      expect(log).toEqual(['transfer', 'remove:m-1', 'remove:m-2']);
      expect(removeCalls.map((c) => c.dto)).toEqual([{ reason: MOVED_EN }, { reason: MOVED_EN }]);
      expect(text(el().querySelector('[data-testid="transfer-seats-done"]'))).toContain('Removed from 2 committees.');
    });

    it('removes after a promotion that only partly completed too', () => {
      render({ transfer: () => of({ promotionCompleted: false, promotionError: 'Head not assigned' }) });
      go();
      choose('m-1', 'remove');
      submit();
      expect(log).toEqual(['transfer', 'remove:m-1']);
    });

    it('keeps going after a failure: 409 stage, 404 and 500 each said on its row, the success counted', () => {
      render({
        committees: () => of(seats(4)),
        removes: {
          'm-1': [() => throwError(() => stageRefusal())],
          'm-2': [() => throwError(() => httpError(404))],
          'm-3': [() => throwError(() => httpError(500, { message: 'Database unavailable' }))],
        },
      });
      go();
      for (const id of ['m-1', 'm-2', 'm-3', 'm-4']) choose(id, 'remove');
      submit();
      expect(removeCalls.map((c) => c.memberId)).withContext('every remove attempted').toEqual(['m-1', 'm-2', 'm-3', 'm-4']);
      const failed = el().querySelector('[data-testid="transfer-seats-failed"]')!;
      expect(text(failed.querySelector('p-message'))).toBe("3 seats weren't removed:");
      expect(text(failed.querySelector('[data-failed-seat="m-1"]'))).toBe(`Committee 1: ${stageSentence('Dissolved')}`);
      expect(text(failed.querySelector('[data-failed-seat="m-2"]'))).toBe('Committee 2: Not a member any more.');
      expect(text(failed.querySelector('[data-failed-seat="m-3"]'))).toBe('Committee 3: Database unavailable');
      expect(wizard.seatRemoval()!.removed).toBe(1);
      expect(el().querySelector('[data-testid="transfer-seats-done"]')).toBeNull();
    });

    it('Try again retries ONLY the failed rows, with the same reason, and updates the lines', () => {
      render({
        committees: () => of(seats(3)),
        removes: {
          'm-1': [() => throwError(() => httpError(500, { message: 'Busy' })), () => of(undefined)],
          'm-3': [() => throwError(() => httpError(500, { message: 'Busy' })), () => throwError(() => httpError(404))],
        },
      });
      go();
      for (const id of ['m-1', 'm-2', 'm-3']) choose(id, 'remove');
      submit();
      expect(removeCalls.length).toBe(3);
      (el().querySelector('[data-testid="transfer-seats-retry"] button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(removeCalls.slice(3).map((c) => c.memberId)).toEqual(['m-1', 'm-3']);
      expect(el().querySelector('[data-failed-seat="m-1"]')).toBeNull();
      expect(text(el().querySelector('[data-failed-seat="m-3"]'))).toBe('Committee 3: Not a member any more.');
      expect(wizard.seatRemoval()!.removed).toBe(2);
    });

    it('Try again after a language switch still sends the reason written at Submit', () => {
      render({ removes: { 'm-1': [() => throwError(() => httpError(500, { message: 'Busy' })), () => of(undefined)] } });
      go();
      choose('m-1', 'remove');
      submit();
      TestBed.inject(TranslateService).use('ar');
      fixture.detectChanges();
      (el().querySelector('[data-testid="transfer-seats-retry"] button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(removeCalls.map((c) => c.dto.reason)).toEqual([MOVED_EN, MOVED_EN]);
      TestBed.inject(TranslateService).use('en');
    });

    it('the same unit picks the second sentence', () => {
      render();
      go({ destination: SOURCE_UNIT.id });
      choose('m-1', 'remove');
      submit();
      expect(removeCalls[0]!.dto).toEqual({ reason: SAME_EN });
    });

    it('in Arabic, the reason is written in Arabic', () => {
      render();
      TestBed.inject(TranslateService).use('ar');
      go();
      choose('m-1', 'remove');
      submit();
      expect(removeCalls[0]!.dto).toEqual({ reason: MOVED_AR });
      TestBed.inject(TranslateService).use('en');
    });

    it('no remove chosen: no DELETE at all, and no removal lines', () => {
      render();
      go();
      submit();
      expect(removeCalls).toEqual([]);
      expect(el().querySelector('[data-testid="transfer-seats-done"]')).toBeNull();
    });
  });
});

describe('transferSeatReason (ACC-296)', () => {
  preserveDocumentLanguage();

  function translate(lang: 'en' | 'ar'): TranslateService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideTranslateService({ lang: 'en' }), provideFormatTesting()] });
    loadTranslationsForTest({ en, ar });
    const service = TestBed.inject(TranslateService);
    service.use(lang);
    return service;
  }

  it('another unit, in English and Arabic', () => {
    expect(transferSeatReason(translate('en'), { from: 'Pharmacy', to: 'Intensive Care', sameUnit: false })).toBe(MOVED_EN);
    expect(transferSeatReason(translate('ar'), { from: 'الصيدلية', to: 'العناية المركزة', sameUnit: false })).toBe(MOVED_AR);
  });

  it('the same unit, in English and Arabic', () => {
    expect(transferSeatReason(translate('en'), { from: 'Pharmacy', to: 'Pharmacy', sameUnit: true })).toBe(SAME_EN);
    expect(transferSeatReason(translate('ar'), { from: 'الصيدلية', to: 'الصيدلية', sameUnit: true })).toBe(SAME_AR);
  });
});
