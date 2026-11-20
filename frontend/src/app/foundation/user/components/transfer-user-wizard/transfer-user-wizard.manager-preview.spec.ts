import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import { of } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { UserService } from '../../services/user.service';
import { OrgUnitService } from '../../../organization/services/org-unit.service';
import { IOrgUnitHeadStatus, OrgUnitHeadService } from '../../../organization/services/org-unit-head.service';
import { TransferCommitteesService } from '../../services/transfer-committees.service';
import { TransferUserWizardComponent } from './transfer-user-wizard.component';
import { DESTINATION_UNIT, PERSON, UNITS, fakeUserService } from './transfer-wizard.testing';

/**
 * ACC-328 — a promotion's manager preview names the cover the SERVER will use.
 *
 * Since ACC-324 a promotion's parent manager is the parent's head holder, else
 * the acting cover in force whose person is ACTIVE. The preview used to read
 * the cached actingHeadUserId, which can name a deactivated person or a cover
 * that has not started. It now reads the head status's `activeCover`.
 */
describe('TransferUserWizard — the promotion manager preview (ACC-328)', () => {
  const ROOT_EN = 'Al-Nakheel Hospital';
  const STALE_ID = 'stale-acting-user';

  const status = (over: Partial<IOrgUnitHeadStatus> = {}): IOrgUnitHeadStatus => ({
    holders: [],
    pendingHeadUserId: null,
    headHandoverEffectiveDate: null,
    actingHeadUserId: null,
    lastVacancy: null,
    pendingHeadAccessSince: null,
    cover: null,
    activeCover: null,
    scheduledCover: null,
    recentlyEndedCovers: [],
    ...over,
  });

  let getByIdCalls: string[];
  let headStatusCalls: string[];

  /** Walks Destination → Position with a head position, and returns the preview. */
  function preview(headStatus: IOrgUnitHeadStatus): string | null {
    getByIdCalls = [];
    headStatusCalls = [];
    const base = fakeUserService();
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
          useValue: {
            ...base,
            getById: (id: string) => {
              getByIdCalls.push(id);
              return of(id === PERSON.id ? PERSON : { id, name: 'Stale Cached Person' });
            },
            getTransferContext: () =>
              of({
                hasActiveDirectReports: false,
                availablePositions: [{ id: 'p-head', nameEn: 'Director', nameAr: 'مدير', isUnitHeadPosition: true }],
                currentDestinationHead: null,
              }),
          },
        },
        { provide: OrgUnitService, useValue: { getFlat: () => of(UNITS) } },
        {
          provide: OrgUnitHeadService,
          useValue: {
            getHeadStatus: (unitId: string) => {
              headStatusCalls.push(unitId);
              return of(headStatus);
            },
          },
        },
        { provide: NavigationAccessService, useValue: { hasPermission: () => true } },
        { provide: TransferCommitteesService, useValue: { forUser: () => of({ total: 0, rows: [] }) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    const fixture = TestBed.createComponent(TransferUserWizardComponent);
    fixture.componentRef.setInput('userId', PERSON.id);
    fixture.detectChanges();
    const w = fixture.componentInstance;
    const activate = (value: number): void => w.currentStep.set(value);
    w.form.controls.destinationOrgUnitId.setValue(DESTINATION_UNIT.id);
    w.goFromDestination(activate);
    w.form.controls.newPositionId.setValue('p-head');
    w.goFromPosition(activate);
    fixture.detectChanges();
    // Non-vacuous: the promotion path ran and asked the PARENT unit's status.
    expect(w.isPromotion()).withContext('a head position is a promotion').toBeTrue();
    expect(headStatusCalls).toEqual([DESTINATION_UNIT.parentId!]);
    return w.derivedManagerText();
  }

  it('a cached actingHeadUserId with no active cover shows no acting manager, and looks nobody up', () => {
    expect(preview(status({ actingHeadUserId: STALE_ID, activeCover: null }))).toBeNull();
    expect(getByIdCalls).not.toContain(STALE_ID);
  });

  it('an active cover is named as the acting head of the parent unit', () => {
    const text = preview(
      status({ actingHeadUserId: STALE_ID, activeCover: { userId: 'cover-1', name: 'Dr. Tariq Suleiman' } }),
    );
    expect(text).toBe(`Will report to Dr. Tariq Suleiman (Acting Head of ${ROOT_EN}).`);
    expect(getByIdCalls).not.toContain(STALE_ID);
    expect(getByIdCalls).not.toContain('cover-1');
  });

  it("an active cover with no name (no users:view) uses the holder branch's fallback", () => {
    const text = preview(status({ activeCover: { userId: 'cover-1', name: null } }));
    expect(text).toBe(`Will report to ${en.headship.head.assigned} (Acting Head of ${ROOT_EN}).`);
  });

  it('a head holder still comes first, over an active cover', () => {
    const text = preview(
      status({
        holders: [{ id: 'h-1', name: 'Dr. Fahad Al-Anazi', positionId: 'p', positionNameEn: 'Director', positionNameAr: null, headSince: null }],
        activeCover: { userId: 'cover-1', name: 'Dr. Tariq Suleiman' },
      }),
    );
    expect(text).toBe(`Will report to Dr. Fahad Al-Anazi, Head of ${ROOT_EN}.`);
  });
});
