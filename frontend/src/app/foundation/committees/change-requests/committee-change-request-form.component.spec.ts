import { ComponentFixture, TestBed, discardPeriodicTasks, fakeAsync, flush, tick } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import { ConfirmationService } from 'primeng/api';
import { Observable, Subject, of, throwError } from 'rxjs';
import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../core/formatting/testing';
import { AuthService } from '../../../core/services/auth.service';
import { AmConfirmOptions, AmConfirmService } from '../../../shared/components/confirm/am-confirm.service';
import { LookupService } from '../../lookup/services/lookup.service';
import { OrgUnitService } from '../../organization/services/org-unit.service';
import { CommitteeDetailDto, CommitteeListItemDto, CommitteeService } from '../services/committee.service';
import { CommitteeChangeRequestFormComponent, diffChanges } from './committee-change-request-form.component';
import { ChangeRequestPreviewDto, ChangeRequestService, OpenChangeRequestDto } from './change-request.service';
import { REQUEST } from './change-request.testing';
import { preserveDocumentLanguage } from '../../../../testing/document-language';
import { ACTIVE_RULES } from '../testing';

const COMMITTEE: CommitteeDetailDto = {
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
  reportingToCommitteeId: 'c-9',
  formedAt: null,
  dissolvedAt: null,
  isActive: true,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  stageRules: ACTIVE_RULES,
  isDissolving: false,
  typeValue: { id: 'type-1', key: 'quality', labelEn: 'Quality', labelAr: 'الجودة', offered: true },
  orgUnit: null,
};

const LIST_ITEM = (id: string, nameEn: string, over: Partial<CommitteeListItemDto> = {}): CommitteeListItemDto => ({
  ...COMMITTEE,
  id,
  nameEn,
  parentCommitteeId: null,
  reportingToCommitteeId: null,
  memberCount: 7,
  currentStageNameEn: 'Active',
  currentStageNameAr: null,
  stageRules: ACTIVE_RULES,
  isDissolving: false,
  ...over,
});

const PREVIEW: ChangeRequestPreviewDto = {
  changedFields: ['quorumCount'],
  impacts: [{ code: 'QUORUM', from: 5, to: 6, inProgress: 0 }, { code: 'TERMS_TASK' }],
  labels: {},
};

// ACC-240 — Request a change, and its draft edit (plan §3.2).
describe('CommitteeChangeRequestFormComponent (ACC-240)', () => {
  preserveDocumentLanguage();

  let fixture: ComponentFixture<CommitteeChangeRequestFormComponent>;
  let page: CommitteeChangeRequestFormComponent;
  let navigate: jasmine.Spy;
  let previews: unknown[];
  let previewAnswer: () => Observable<ChangeRequestPreviewDto>;
  let open: () => Observable<OpenChangeRequestDto>;
  let create: jasmine.Spy;
  let update: jasmine.Spy;
  let submit: jasmine.Spy;
  let get: jasmine.Spy;
  let asked: AmConfirmOptions[];

  function configure(params: Record<string, string>): void {
    previews = [];
    asked = [];
    previewAnswer = () => of(PREVIEW);
    open = () => of({ request: null, canRaise: true });
    create = jasmine.createSpy('create').and.callFake(() => of(REQUEST({ id: 'cr-new' })));
    update = jasmine.createSpy('update').and.callFake(() => of(REQUEST({ status: 'draft' })));
    submit = jasmine.createSpy('submit').and.callFake(() => of(REQUEST()));
    get = jasmine.createSpy('get').and.callFake(() =>
      of(REQUEST({ status: 'draft', changes: { quorumCount: 6 }, reason: 'Two new members.', actions: { edit: true, submit: true, withdraw: true, approve: false, return: false, reject: false } })),
    );
    TestBed.configureTestingModule({
      imports: [CommitteeChangeRequestFormComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({}),
        ConfirmationService,
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap(params) } } },
        { provide: AuthService, useValue: { currentUser: () => ({ id: 'u-nora', name: 'Nora Al-Otaibi', email: 'n@x' }) } },
        { provide: AmConfirmService, useValue: { ask: (o: AmConfirmOptions) => asked.push(o) } },
        {
          provide: CommitteeService,
          useValue: {
            getById: () => of(COMMITTEE),
            listCommittees: () => of([LIST_ITEM('c-1', 'Quality Council'), LIST_ITEM('c-9', 'Board'), LIST_ITEM('c-8', 'Medical Executive Committee')]),
            // ACC-255 (plan §10.5) — Request a change's types and units, in one read.
            formChoices: () =>
              of({
                committeeTypes: [{ id: 'type-1', labelEn: 'Quality', labelAr: 'الجودة' }],
                orgUnits: [{ id: 'unit-root', nameEn: 'Hospital', nameAr: null, parentId: null, isActive: true }],
              }),
          },
        },
        { provide: LookupService, useValue: { getValues: () => of([{ id: 'type-1', labelEn: 'Quality', labelAr: 'الجودة' }]) } },
        { provide: OrgUnitService, useValue: { getFlat: () => of([{ id: 'unit-root', nameEn: 'Hospital', nameAr: null, parentId: null, isActive: true }]) } },
        {
          provide: ChangeRequestService,
          useValue: {
            open: () => open(),
            get,
            create,
            update,
            submit,
            preview: (_id: string, changes: unknown) => {
              previews.push(changes);
              return previewAnswer();
            },
          },
        },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
  }

  function render(): HTMLElement {
    fixture = TestBed.createComponent(CommitteeChangeRequestFormComponent);
    page = fixture.componentInstance;
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const text = (e: Element | null) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const field = (f: string) => el().querySelector(`[data-crf-field="${f}"]`)!;
  const settle = () => {
    fixture.detectChanges();
    tick(400);
    fixture.detectChanges();
  };
  const press = (id: string) => (el().querySelector(`[data-testid="${id}"] button`) as HTMLButtonElement).click();

  afterEach(() => TestBed.resetTestingModule());

  describe('a new request', () => {
    beforeEach(() => configure({ id: 'c-1' }));

    it('every field starts at the committee value, nothing marked and no summary', fakeAsync(() => {
      render();
      settle();
      expect(page.form.controls.quorumCount.value).toBe(5);
      expect(page.form.controls.reportingToCommitteeId.value).toBe('c-9');
      expect(el().querySelectorAll('[data-testid="crf-changed"]').length).toBe(0);
      expect(el().querySelector('[data-testid="crf-summary"]')).toBeNull();
      expect(text(field('quorumCount').querySelector('.am-field__message'))).toBe('Current · of 7 members');
      expect(previews).withContext('no preview with nothing changed').toEqual([]);
    }));

    it('a changed field is marked three ways, and the summary names it', fakeAsync(() => {
      render();
      settle();
      page.form.controls.quorumCount.setValue(6);
      page.form.controls.reportingToCommitteeId.setValue('c-8');
      settle();
      const quorum = field('quorumCount');
      expect(text(quorum.querySelector('[data-testid="crf-changed"]'))).toBe('✎ Changed');
      expect(quorum.classList).toContain('am-crf__f--changed');
      expect(text(quorum.querySelector('.am-field__message'))).toBe('was 5 · of 7 members');
      expect(text(field('reportingToCommitteeId').querySelector('.am-field__message'))).toBe('was Board');
      expect(text(el().querySelector('[data-testid="crf-summary"]'))).toBe('Changing: Quorum and Reports to');
      // Back to today's value: not a change any more.
      page.form.controls.quorumCount.setValue(5);
      settle();
      expect(field('quorumCount').querySelector('[data-testid="crf-changed"]')).toBeNull();
      expect(text(el().querySelector('[data-testid="crf-summary"]'))).toBe('Changing: Reports to');
    }));

    it('Save as draft and Submit are never disabled; with nothing changed they say so and call nothing', fakeAsync(() => {
      render();
      settle();
      for (const id of ['crf-save-draft', 'crf-submit']) {
        expect((el().querySelector(`[data-testid="${id}"] button`) as HTMLButtonElement).disabled).withContext(id).toBeFalse();
      }
      press('crf-submit');
      settle();
      flush();
      expect(text(el().querySelector('[data-testid="crf-no-changes"]'))).toBe('Change at least one field.');
      expect(document.activeElement).toBe(el().querySelector('[data-testid="crf-no-changes"]'));
      expect(create).not.toHaveBeenCalled();
    }));

    it('a missing reason fills its slot and takes focus; nothing is sent', fakeAsync(() => {
      render();
      settle();
      page.form.controls.quorumCount.setValue(6);
      settle();
      press('crf-save-draft');
      settle();
      flush();
      expect(text(field('reason').querySelector('.am-field__message'))).toBe('Say why this change is needed.');
      expect(document.activeElement).toBe(el().querySelector('#crf-reason'));
      expect(create).not.toHaveBeenCalled();
    }));

    it('the preview: working at once, asked 400 ms after the last change, the earlier one dropped', fakeAsync(() => {
      render();
      settle();
      page.form.controls.quorumCount.setValue(6);
      fixture.detectChanges();
      tick(200);
      fixture.detectChanges();
      expect(el().querySelector('[data-testid="crf-impact-loading"]')).withContext('working at once').not.toBeNull();
      page.form.controls.quorumCount.setValue(7);
      fixture.detectChanges();
      tick(399);
      expect(previews).withContext('before 400 ms').toEqual([]);
      tick(1);
      fixture.detectChanges();
      expect(previews).toEqual([{ quorumCount: 7 }]);
      const lines = Array.from(el().querySelectorAll('[data-testid="crf-impact-line"]')).map((l) => [text(l.querySelector('dt')), text(l.querySelector('dd'))]);
      expect(lines).toEqual([
        ['Quorum: 5 → 6', 'Approvals that start after this change need 6. None is in progress now.'],
        ['Terms of reference', 'A task to revise them is created for Nora Al-Otaibi on approval.'],
      ]);
    }));

    it('a failed preview says so, Retry asks again, and submitting is still allowed', fakeAsync(() => {
      render();
      settle();
      previewAnswer = () => throwError(() => new HttpErrorResponse({ status: 500 }));
      page.form.controls.quorumCount.setValue(6);
      settle();
      expect(text(el().querySelector('[data-testid="crf-impact-failed"]'))).toContain("Couldn't work out what this change does.");
      previewAnswer = () => of(PREVIEW);
      (el().querySelector('[data-testid="crf-impact-failed"] button') as HTMLButtonElement).click();
      settle();
      expect(previews.length).toBe(2);
      expect(el().querySelectorAll('[data-testid="crf-impact-line"]').length).toBe(2);
    }));

    it('a preview refused by a reference rule says it under that field', fakeAsync(() => {
      render();
      settle();
      previewAnswer = () => throwError(() => new HttpErrorResponse({ status: 400, error: { code: 'COMMITTEE_PARENT_LOOP' } }));
      page.form.controls.parentCommitteeId.setValue('c-8');
      settle();
      expect(text(field('parentCommitteeId').querySelector('.am-field__message'))).toBe(en.committee.refusal.parentLoop);
      expect(field('parentCommitteeId').querySelector('.am-field--error')).not.toBeNull();
      // The next answer that is not a refusal clears it.
      previewAnswer = () => of(PREVIEW);
      page.form.controls.parentCommitteeId.setValue(null);
      settle();
      expect(field('parentCommitteeId').querySelector('.am-field--error')).toBeNull();
    }));

    it('Submit for review sends only the changes, the reason and submit: true, then opens the request', fakeAsync(() => {
      render();
      settle();
      page.form.controls.quorumCount.setValue(6);
      page.form.controls.reason.setValue('  Two new members joined.  ');
      settle();
      press('crf-submit');
      settle();
      expect(create).toHaveBeenCalledWith('c-1', { changes: { quorumCount: 6 }, reason: 'Two new members joined.', submit: true });
      expect(navigate).toHaveBeenCalledWith(['/committees', 'c-1', 'change-requests', 'cr-new']);
    }));

    it('Save as draft sends submit: false', fakeAsync(() => {
      render();
      settle();
      page.form.controls.purpose.setValue('');
      page.form.controls.reason.setValue('No longer needed.');
      settle();
      press('crf-save-draft');
      settle();
      expect(create).toHaveBeenCalledWith('c-1', { changes: { purpose: null }, reason: 'No longer needed.', submit: false });
    }));

    describe('what Parent committee and Reports to are for (ACC-240)', () => {
      const HINT = {
        en: { parent: 'The committee this one is a sub-committee of.', reportsTo: 'Where its minutes and recommendations go for decisions.' },
        ar: { parent: 'اللجنة التي تتبع لها هذه اللجنة كلجنة فرعية.', reportsTo: 'اللجنة التي تُرفع إليها محاضرها وتوصياتها لاتخاذ القرار.' },
      };
      const slot = (f: string) => text(field(f).querySelector('.am-field__message'));

      for (const lang of ['en', 'ar'] as const) {
        it(`unchanged [${lang}]: the hint instead of "Current"; the other fields keep "Current"`, fakeAsync(() => {
          TestBed.inject(TranslateService).use(lang);
          render();
          settle();
          expect(slot('parentCommitteeId')).toBe(HINT[lang].parent);
          expect(slot('reportingToCommitteeId')).toBe(HINT[lang].reportsTo);
          expect(slot('nameEn')).toBe({ en, ar }[lang].committee.changeRequest.form.current);
        }));

        it(`changed [${lang}]: "was …" replaces the hint`, fakeAsync(() => {
          TestBed.inject(TranslateService).use(lang);
          render();
          settle();
          page.form.controls.reportingToCommitteeId.setValue('c-8');
          page.form.controls.parentCommitteeId.setValue('c-8');
          settle();
          const was = { en, ar }[lang].committee.changeRequest.form.was;
          expect(slot('reportingToCommitteeId')).toBe(was.replace('{{value}}', 'Board'));
          expect(slot('parentCommitteeId')).toBe(was.replace('{{value}}', { en: 'None', ar: ar.committee.changeRequest.page.none }[lang]));
        }));

        it(`a failed list [${lang}]: "Couldn't load the list." replaces the hint`, fakeAsync(() => {
          TestBed.inject(TranslateService).use(lang);
          (TestBed.inject(CommitteeService) as unknown as { listCommittees: () => unknown }).listCommittees = () =>
            throwError(() => new HttpErrorResponse({ status: 500 }));
          render();
          settle();
          const failed = { en, ar }[lang].committee.form.listFailed;
          for (const f of ['parentCommitteeId', 'reportingToCommitteeId']) {
            expect(slot(f).startsWith(failed)).withContext(`${f}: ${slot(f)}`).toBeTrue();
          }
        }));
      }
    });

    describe('someone else opened a request first (ALREADY_OPEN)', () => {
      const theirs = () => REQUEST({ id: 'cr-theirs', number: 7, requestedBy: { id: 'u-badr', name: 'Badr Al-Shammari' } });

      /** A has typed into the form; B's request now exists; A presses `button`. */
      function aPresses(button: 'crf-save-draft' | 'crf-submit'): void {
        render();
        settle();
        create.and.callFake(() => throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'CHANGE_REQUEST_ALREADY_OPEN' } })));
        open = () => of({ request: theirs(), canRaise: false });
        page.form.controls.quorumCount.setValue(6);
        page.form.controls.reason.setValue('Two new members joined.');
        page.form.markAsDirty();
        settle();
        press(button);
        settle();
      }

      for (const button of ['crf-save-draft', 'crf-submit'] as const) {
        it(`${button === 'crf-submit' ? 'Submit' : 'Save as draft'}: nothing of A's reaches B's request, A is told why with a link, and A's values stay`, fakeAsync(() => {
          aPresses(button);
          // Only a NEW request was ever asked for, once, with A's values; B's
          // request was never written to.
          expect(create).toHaveBeenCalledTimes(1);
          expect(create.calls.mostRecent().args[1].changes).toEqual({ quorumCount: 6 });
          expect(update).not.toHaveBeenCalled();
          expect(submit).not.toHaveBeenCalled();
          // A stays here: no navigation, the values on screen.
          expect(navigate).not.toHaveBeenCalled();
          expect(page.form.controls.quorumCount.value).toBe(6);
          expect(page.form.controls.reason.value).toBe('Two new members joined.');
          expect(field('quorumCount').querySelector('[data-testid="crf-changed"]')).not.toBeNull();
          // Told plainly, naming B's request, with a link to it.
          expect(text(el().querySelector('[data-testid="crf-footer-message"]'))).toContain(
            "Change request 7 was opened by Badr Al-Shammari first. Your changes weren't saved.",
          );
          const link = el().querySelector('[data-testid="crf-footer-link"]')!;
          expect(link.getAttribute('href')).toBe('/committees/c-1/change-requests/cr-theirs');
          expect(text(link)).toBe('View request');
        }));
      }

      it('the message stays while A keeps editing', fakeAsync(() => {
        aPresses('crf-submit');
        page.form.controls.quorumCount.setValue(7);
        settle();
        expect(text(el().querySelector('[data-testid="crf-footer-message"]'))).toContain('Change request 7 was opened by Badr Al-Shammari first.');
      }));

      it('leaving afterwards still asks Keep editing · Discard', fakeAsync(() => {
        aPresses('crf-submit');
        const answer = page.canLeave();
        expect(answer).withContext('the guard let A leave without asking').not.toBeTrue();
        expect(asked.length).toBe(1);
        expect(asked[0]).toEqual(jasmine.objectContaining({ header: 'Discard changes?', acceptLabel: 'Discard', rejectLabel: 'Keep editing' }));
        asked[0].reject!();
        let left: boolean | undefined;
        void (answer as Promise<boolean>).then((v) => (left = v));
        flush();
        expect(left).toBeFalse();
      }));

      it('if the open request cannot be read, the plain sentence, still no navigation', fakeAsync(() => {
        render();
        settle();
        create.and.callFake(() => throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'CHANGE_REQUEST_ALREADY_OPEN' } })));
        open = () => throwError(() => new HttpErrorResponse({ status: 500 }));
        page.form.controls.quorumCount.setValue(6);
        page.form.controls.reason.setValue('x');
        settle();
        press('crf-submit');
        settle();
        expect(text(el().querySelector('[data-testid="crf-footer-message"]'))).toBe(en.committee.changeRequest.refusal.CHANGE_REQUEST_ALREADY_OPEN);
        expect(el().querySelector('[data-testid="crf-footer-link"]')).toBeNull();
        expect(navigate).not.toHaveBeenCalled();
        expect(page.form.controls.quorumCount.value).toBe(6);
      }));

      it('Arabic', fakeAsync(() => {
        TestBed.inject(TranslateService).use('ar');
        aPresses('crf-save-draft');
        // The literal sentence, so a wording change is a decision this spec sees.
        // Neutral: the passive names nobody's gender (Ahmad, 22 Oct).
        expect(text(el().querySelector('[data-testid="crf-footer-message"]'))).toContain(
          'سبق أن فُتح طلب التغيير 7 بواسطة Badr Al-Shammari. لم تُحفظ تغييراتك.',
        );
        expect(text(el().querySelector('[data-testid="crf-footer-link"]'))).toBe(ar.committee.changeRequest.banner.view);
      }));
    });

    it('unreachable: the footer says so and offers Retry, which saves again', fakeAsync(() => {
      render();
      settle();
      create.and.callFake(() => throwError(() => new HttpErrorResponse({ status: 0 })));
      page.form.controls.quorumCount.setValue(6);
      page.form.controls.reason.setValue('x');
      settle();
      press('crf-save-draft');
      settle();
      expect(text(el().querySelector('[data-testid="crf-footer-message"]'))).toBe("Nothing was changed: the server couldn't be reached.");
      expect(el().querySelector('[data-testid="crf-save-draft"]')).toBeNull();
      create.and.callFake(() => of(REQUEST({ id: 'cr-new' })));
      press('crf-retry');
      settle();
      expect(create).toHaveBeenCalledTimes(2);
      expect(create.calls.mostRecent().args[1].submit).toBeFalse();
    }));

    it('a refusal that is not about reaching the server offers no Retry', fakeAsync(() => {
      render();
      settle();
      create.and.callFake(() => throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'CHANGE_REQUEST_STAGE_NOT_ALLOWED' } })));
      page.form.controls.quorumCount.setValue(6);
      page.form.controls.reason.setValue('x');
      settle();
      press('crf-submit');
      settle();
      expect(text(el().querySelector('[data-testid="crf-footer-message"]'))).toBe("A change can't be requested in this committee's current stage.");
      expect(el().querySelector('[data-testid="crf-retry"]')).toBeNull();
    }));

    it('a direct link with a request open lands on that request', fakeAsync(() => {
      open = () => of({ request: REQUEST({ id: 'cr-open' }), canRaise: false });
      render();
      settle();
      expect(navigate).toHaveBeenCalledWith(['/committees', 'c-1', 'change-requests', 'cr-open'], { replaceUrl: true });
      expect(el().querySelector('form')).toBeNull();
    }));

    it('without canRaise and nothing open, back to the committee', fakeAsync(() => {
      open = () => of({ request: null, canRaise: false });
      render();
      settle();
      expect(navigate).toHaveBeenCalledWith(['/committees', 'c-1'], { replaceUrl: true });
    }));

    it('the leave guard: nothing to lose leaves; unsaved work asks Keep editing · Discard', fakeAsync(() => {
      render();
      settle();
      expect(page.canLeave()).toBeTrue();
      page.form.controls.quorumCount.setValue(6);
      page.form.markAsDirty();
      const answer = page.canLeave() as Promise<boolean>;
      expect(asked.length).toBe(1);
      expect(asked[0]).toEqual(jasmine.objectContaining({ tone: 'destructive', header: 'Discard changes?', acceptLabel: 'Discard', rejectLabel: 'Keep editing' }));
      asked[0].reject!();
      let left: boolean | undefined;
      void answer.then((v) => (left = v));
      flush();
      expect(left).toBeFalse();
    }));

    it('loading, then a failed read with Retry', fakeAsync(() => {
      const pending = new Subject<OpenChangeRequestDto>();
      open = () => pending;
      render();
      expect(el().querySelector('[data-testid="crf-loading"]')).not.toBeNull();
      pending.error(new HttpErrorResponse({ status: 500 }));
      fixture.detectChanges();
      expect(text(el().querySelector('[data-testid="crf-error"]'))).toContain("Couldn't load this committee.");
      open = () => of({ request: null, canRaise: true });
      (el().querySelector('[data-testid="crf-error"] button') as HTMLButtonElement).click();
      settle();
      expect(el().querySelector('form')).not.toBeNull();
    }));

    it('Arabic', fakeAsync(() => {
      TestBed.inject(TranslateService).use('ar');
      render();
      settle();
      page.form.controls.quorumCount.setValue(6);
      page.form.controls.reportingToCommitteeId.setValue(null);
      settle();
      expect(text(el().querySelector('[data-testid="crf-summary"]'))).toBe(ar.committee.changeRequest.form.summary.replace('{{fields}}', 'النصاب وترفع تقاريرها إلى'));
      expect(text(field('quorumCount').querySelector('[data-testid="crf-changed"]'))).toBe(ar.committee.changeRequest.form.changed);
      expect(text(field('reportingToCommitteeId').querySelector('.am-field__message'))).toBe(ar.committee.changeRequest.form.was.replace('{{value}}', 'Board'));
    }));
  });

  describe('a draft edit', () => {
    beforeEach(() => configure({ id: 'c-1', requestId: 'cr-1' }));

    it('opens at the draft proposal and its reason', fakeAsync(() => {
      render();
      settle();
      expect(page.form.controls.quorumCount.value).toBe(6);
      expect(page.form.controls.reason.value).toBe('Two new members.');
      expect(text(el().querySelector('h1'))).toBe('Edit change request 3');
      expect(field('quorumCount').querySelector('[data-testid="crf-changed"]')).not.toBeNull();
    }));

    it('opens only with actions.edit; otherwise the request page', fakeAsync(() => {
      get.and.callFake(() => of(REQUEST()));
      render();
      settle();
      expect(navigate).toHaveBeenCalledWith(['/committees', 'c-1', 'change-requests', 'cr-1'], { replaceUrl: true });
    }));

    it('Submit saves the draft with expectedUpdatedAt, then submits it', fakeAsync(() => {
      render();
      settle();
      page.form.controls.meetingFrequency.setValue('WEEKLY');
      settle();
      press('crf-submit');
      settle();
      expect(update).toHaveBeenCalledWith('cr-1', {
        changes: { quorumCount: 6, meetingFrequency: 'WEEKLY' },
        reason: 'Two new members.',
        expectedUpdatedAt: '2026-10-18T09:00:00Z',
      });
      expect(submit).toHaveBeenCalledWith('cr-1');
      expect(update.calls.mostRecent().returnValue).toBeDefined();
    }));

    it('a field taken back to today is sent as today, so the draft stops proposing it', fakeAsync(() => {
      render();
      settle();
      page.form.controls.quorumCount.setValue(5);
      page.form.controls.purpose.setValue('New purpose');
      settle();
      press('crf-save-draft');
      settle();
      expect(update.calls.mostRecent().args[1].changes).toEqual({ purpose: 'New purpose', quorumCount: 5 });
      expect(submit).not.toHaveBeenCalled();
    }));

    it('CHANGE_REQUEST_CHANGED offers Reload, which reads the draft again', fakeAsync(() => {
      render();
      settle();
      update.and.callFake(() => throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'CHANGE_REQUEST_CHANGED' } })));
      page.form.controls.meetingFrequency.setValue('WEEKLY');
      settle();
      press('crf-save-draft');
      settle();
      expect(text(el().querySelector('[data-testid="crf-footer-message"]'))).toBe(
        'Change request 3 was changed by someone else since you opened it. Nothing was saved.',
      );
      press('crf-reload');
      settle();
      expect(get).toHaveBeenCalledTimes(2);
      expect(page.form.controls.meetingFrequency.value).toBe('MONTHLY');
      discardPeriodicTasks();
    }));
  });

  it('diffChanges: trimmed, emptied optional text is null, a required field emptied is not a change', () => {
    const c = { nameEn: 'A', nameAr: 'ب', purpose: 'p', quorumCount: 5, typeValueId: 't', meetingFrequency: 'MONTHLY', orgUnitId: 'u', parentCommitteeId: null, reportingToCommitteeId: null };
    expect(diffChanges({ ...c, nameEn: ' A ', nameAr: '', purpose: '  ', typeValueId: null }, c)).toEqual({ nameAr: null, purpose: null });
    expect(diffChanges({ ...c, nameEn: '', quorumCount: null }, c)).toEqual({});
    expect(diffChanges({ ...c, parentCommitteeId: 'p-1' }, c)).toEqual({ parentCommitteeId: 'p-1' });
  });
});

