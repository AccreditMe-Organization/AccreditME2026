import { HttpErrorResponse } from '@angular/common/http';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import { of, throwError } from 'rxjs';
import en from '../../../assets/i18n/en.json';
import ar from '../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../core/formatting/testing';
import { LanguageService } from '../../core/services/language.service';
import { NavigationAccessService } from '../../core/services/navigation-access.service';
import { AmConfirmOptions, AmConfirmService } from '../../shared/components/confirm/am-confirm.service';
import { preserveDocumentLanguage } from '../../../testing/document-language';
import { UserService } from '../user/services/user.service';
import { UserStatusActionsService } from '../user/services/user-status-actions.service';
import { TransferUserWizardComponent } from '../user/components/transfer-user-wizard/transfer-user-wizard.component';
import { OrgPositionService } from '../org-position/services/org-position.service';
import { PositionListComponent } from '../org-position/components/position-list/position-list.component';
import { PositionFormComponent } from '../org-position/components/position-form/position-form.component';
import { RoleService } from '../roles/services/role.service';
import { OrgUnitService } from './services/org-unit.service';
import { IOrgUnitHeadStatus, OrgUnitHeadService } from './services/org-unit-head.service';
import { HeadshipActionsComponent } from './components/headship-actions/headship-actions.component';
import { ROOT_UNIT_NEEDS_HEAD, rootUnitNeedsHeadMessage } from './root-unit-refusal';

// ACC-288 — "the root unit always has a head or an acting head". Every screen
// that can be refused says the sentence from the code, in the reader's
// language, in the dialog or row that made the call — never the server's
// English message.

const EN_SENTENCE = 'Al-Nakheel Hospital must always have a head or an acting head. Appoint a successor or an acting head first.';
const AR_SENTENCE = 'يجب أن يكون لمستشفى النخيل رئيس أو رئيس بالنيابة في كل وقت. عيّن خلفًا أو رئيسًا بالنيابة أولًا.';

const refusal = (unitNameAr: string | null = 'مستشفى النخيل') =>
  new HttpErrorResponse({
    status: 409,
    error: {
      statusCode: 409,
      code: ROOT_UNIT_NEEDS_HEAD,
      message: 'Al-Nakheel Hospital must always have a head or an acting head. Appoint a successor or an acting head first. (server English)',
      unitId: 'root-a',
      unitNameEn: 'Al-Nakheel Hospital',
      unitNameAr,
    },
  });

describe('ROOT_UNIT_NEEDS_HEAD, said from the code (ACC-288)', () => {
  preserveDocumentLanguage();

  let asked: AmConfirmOptions[];
  const access = { hasPermission: (_p: string) => false, isPlatformAdmin: () => false };

  function configure(providers: unknown[] = [], imports: unknown[] = []): void {
    asked = [];
    TestBed.configureTestingModule({
      imports: imports as never[],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideNoopAnimations(),
        providePrimeNG({}),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        { provide: AmConfirmService, useValue: { ask: (o: AmConfirmOptions) => asked.push(o) } },
        { provide: NavigationAccessService, useValue: access },
        ...(providers as never[]),
      ],
    });
    loadTranslationsForTest({ en, ar });
  }
  const use = (lang: 'en' | 'ar') => TestBed.inject(TranslateService).use(lang);
  const sentence = (lang: 'en' | 'ar') => (lang === 'en' ? EN_SENTENCE : AR_SENTENCE);

  describe('rootUnitNeedsHeadMessage', () => {
    beforeEach(() => configure());
    const say = (err: unknown) =>
      rootUnitNeedsHeadMessage(err, TestBed.inject(TranslateService), TestBed.inject(LanguageService));

    it('names the root in English', () => {
      use('en');
      expect(say(refusal())).toBe(EN_SENTENCE);
    });

    it('names the root in Arabic, «لـ» joined to its Arabic name (ال → لل)', () => {
      use('ar');
      expect(say(refusal())).toBe(AR_SENTENCE);
    });

    it('an organisation with no Arabic name is named in English, «لـ» kept apart', () => {
      use('ar');
      expect(say(refusal(null))).toBe('يجب أن يكون لـ Al-Nakheel Hospital رئيس أو رئيس بالنيابة في كل وقت. عيّن خلفًا أو رئيسًا بالنيابة أولًا.');
    });

    it('answers null for any other refusal, so the caller keeps its own message', () => {
      use('en');
      expect(say(new HttpErrorResponse({ status: 409, error: { code: 'LAST_ACTIVE_ADMINISTRATOR' } }))).toBeNull();
      expect(say(new Error('boom'))).toBeNull();
    });
  });

  for (const lang of ['en', 'ar'] as const) {
    describe(lang === 'en' ? 'in English' : 'in Arabic', () => {
      it('deactivating a user: the refusal is the result the row shows', () => {
        configure([
          { provide: UserService, useValue: { deactivate: () => throwError(() => refusal()) } },
          { provide: RoleService, useValue: {} },
        ]);
        use(lang);
        const failed = jasmine.createSpy('failed');
        TestBed.inject(UserStatusActionsService).confirmDeactivate(
          { id: 'head-1', name: 'Dr. Fahad', status: 'ACTIVE' } as never,
          { succeeded: () => undefined, failed },
        );
        asked[0]!.accept!();
        expect(failed).toHaveBeenCalledOnceWith(sentence(lang));
      });

      it('the transfer wizard: the refusal is said in the wizard', () => {
        configure(
          [
            {
              provide: UserService,
              useValue: { getById: () => of({ id: 'head-1', name: 'Dr. Fahad' }), transferUser: () => throwError(() => refusal()) },
            },
            { provide: OrgUnitService, useValue: { getFlat: () => of([]) } },
            { provide: OrgUnitHeadService, useValue: {} },
          ],
          [TransferUserWizardComponent],
        );
        use(lang);
        const fixture = TestBed.createComponent(TransferUserWizardComponent);
        fixture.componentRef.setInput('userId', 'head-1');
        fixture.detectChanges();
        fixture.componentInstance.submit();
        fixture.detectChanges();
        expect(fixture.componentInstance.error()).toBe(sentence(lang));
        expect((fixture.nativeElement as HTMLElement).textContent).toContain(sentence(lang));
      });

      for (const [action, call] of [
        ['endCover', 'clearActingHead'],
        ['vacate', 'vacateHead'],
        ['startNewHeadToday', 'completeHandoverNow'],
      ] as const) {
        it(`the headship panel's ${action}: the refusal is the panel's action error`, () => {
          configure(
            [
              {
                provide: OrgUnitHeadService,
                useValue: { [call]: () => throwError(() => refusal()) },
              },
              { provide: UserService, useValue: {} },
              { provide: OrgPositionService, useValue: {} },
            ],
            [HeadshipActionsComponent],
          );
          use(lang);
          const fixture = TestBed.createComponent(HeadshipActionsComponent);
          fixture.componentRef.setInput('orgUnitId', 'root-a');
          fixture.componentRef.setInput('unitName', 'Al-Nakheel Hospital');
          fixture.componentRef.setInput('status', headStatus(action));
          fixture.detectChanges();
          fixture.componentInstance.run(action);
          asked[0]!.accept!();
          expect(fixture.componentInstance.actionError()).toBe(sentence(lang));
        });
      }

      it('deactivating a position: the refusal is the page error', () => {
        configure(
          [
            {
              provide: OrgPositionService,
              useValue: { listPositions: () => of([]), deactivate: () => throwError(() => refusal()) },
            },
            { provide: RoleService, useValue: { listAllRoles: () => of([]) } },
          ],
          [PositionListComponent],
        );
        use(lang);
        const fixture = TestBed.createComponent(PositionListComponent);
        fixture.detectChanges();
        fixture.componentInstance.onDeactivate({ id: 'pos-head', nameEn: 'Director', nameAr: 'مدير', isUnitHeadPosition: true } as never);
        asked[0]!.accept!();
        fixture.detectChanges();
        expect(fixture.componentInstance.error()).toBe(sentence(lang));
      });

      it('turning a head position’s head flag off: the refusal is said in the dialog', () => {
        configure(
          [
            { provide: OrgPositionService, useValue: { update: () => throwError(() => refusal()) } },
            { provide: RoleService, useValue: { listAllRoles: () => of([]) } },
          ],
          [PositionFormComponent],
        );
        use(lang);
        const fixture = TestBed.createComponent(PositionFormComponent);
        fixture.componentRef.setInput('position', {
          id: 'pos-head',
          organizationId: 'org',
          nameEn: 'Director',
          nameAr: 'مدير',
          grade: 10,
          isSingleAssignee: true,
          isUnitHeadPosition: true,
          roleId: null,
          isActive: true,
        });
        fixture.detectChanges();
        fixture.componentInstance.form.patchValue({ nameEn: 'Director', grade: 10, isUnitHeadPosition: false, isSingleAssignee: false });
        fixture.componentInstance.onSubmit();
        fixture.detectChanges();
        expect(fixture.componentInstance.saveError()).toBe(sentence(lang));
        expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="position-save-error"]')?.textContent).toContain(sentence(lang));
      });
    });
  }
});

/** A head status that offers `action`: a cover for End cover, a head for Vacate, a successor for Start today. */
function headStatus(action: 'endCover' | 'vacate' | 'startNewHeadToday'): IOrgUnitHeadStatus {
  const head = { id: 'fahad', name: 'Dr. Fahad', positionId: 'pos', positionNameEn: 'Director', positionNameAr: 'مدير', headSince: null };
  const base: IOrgUnitHeadStatus = {
    holders: [head],
    pendingHeadUserId: null,
    headHandoverEffectiveDate: null,
    actingHeadUserId: null,
    lastVacancy: null,
    pendingHeadAccessSince: null,
    cover: null,
    scheduledCover: null,
    recentlyEndedCovers: [],
  };
  if (action === 'endCover') {
    return {
      ...base,
      holders: [],
      actingHeadUserId: 'tariq',
      cover: { userId: 'tariq', name: 'Dr. Tariq', reason: 'VACANCY', validFrom: '2026-11-01T12:00:00.000Z', validTo: null },
    };
  }
  if (action === 'startNewHeadToday') {
    return {
      ...base,
      holders: [head, { ...head, id: 'huda', name: 'Dr. Huda', headSince: '2026-11-05T12:00:00.000Z' }],
      pendingHeadUserId: 'huda',
      headHandoverEffectiveDate: '2026-11-20T12:00:00.000Z',
      pendingHeadAccessSince: '2026-11-05T12:00:00.000Z',
    };
  }
  return base;
}
