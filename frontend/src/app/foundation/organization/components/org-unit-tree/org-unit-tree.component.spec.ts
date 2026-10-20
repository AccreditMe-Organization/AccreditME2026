import { TestBed } from '@angular/core/testing';
import { ConfirmationService } from 'primeng/api';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { environment } from '../../../../../environments/environment';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { pickBilingualName } from '../../../../shared/utils/bilingual-name.util';
import { OrgUnitDto } from '../../services/org-unit.service';
import { OrgUnitTreeComponent } from './org-unit-tree.component';

// ACC-82 — the head panel names its unit. A Setup health Fix opens it directly
// from a list of many units, and "Manage Head" alone did not say which.
describe('OrgUnitTreeComponent — head panel title (ACC-82)', () => {
  const UNIT = {
    id: 'unit-radiology',
    nameEn: 'Radiology',
    nameAr: 'الأشعة',
    isActive: true,
    children: [],
  } as unknown as OrgUnitDto;

  function create(arabic: boolean, canManage = true): OrgUnitTreeComponent {
    TestBed.configureTestingModule({
      imports: [OrgUnitTreeComponent],
      providers: [
        provideHttpClient(),
        ConfirmationService,
        provideHttpClientTesting(),
        provideRouter([]),
        provideTranslateService({ lang: 'en' }),
        {
          provide: LanguageService,
          useValue: {
            isArabic: () => arabic,
            bilingual: (en: string, ar: string | null | undefined) => pickBilingualName(en, ar, arabic),
          },
        },
        // ACC-133 — the panel's title depends on whether the viewer may change it.
        { provide: NavigationAccessService, useValue: { hasPermission: (p: string) => canManage && p === 'org:manage' } },
      ],
    });
    TestBed.inject(TranslateService).setTranslation('en', {
      headship: { title: 'Headship', titleNamed: 'Headship of {{unit}}' },
      orgUnitHead: { manageHead: 'Manage Head', manageHeadNamed: 'Manage Head — {{unit}}' },
      organization: { addUnit: 'Add unit', addSubUnitTo: 'Add sub-unit to {{parent}}', editUnitNamed: 'Edit {{unit}}' },
    });
    const fixture = TestBed.createComponent(OrgUnitTreeComponent);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController).expectOne(`${environment.apiUrl}/organization/units`).flush([UNIT]);
    return fixture.componentInstance;
  }

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('titles the panel with the unit it manages', () => {
    const tree = create(false);
    expect(tree.headPanelHeader()).toBe('Manage Head');

    tree.onManageHead(UNIT);

    expect(tree.headPanelHeader()).toBe('Manage Head — Radiology');
  });

  it('uses the unit’s Arabic name in an Arabic session', () => {
    const tree = create(true);

    tree.onManageHead(UNIT);

    expect(tree.headPanelHeader()).toBe('Manage Head — الأشعة');
  });

  // ACC-133 — the panel is a read for every viewer; a viewer who cannot change
  // the headship is not "managing" it.
  it('titles it "Headship of …" for a viewer without org:manage', () => {
    const tree = create(false, false);

    tree.onManageHead(UNIT);

    expect(tree.headPanelHeader()).toBe('Headship of Radiology');
  });
});

// ACC-120 slice 11 — one dialog, three titles (OS L634).
describe('OrgUnitTreeComponent — the unit dialog title (ACC-120 slice 11)', () => {
  const PHARMACY = {
    id: 'unit-pharmacy',
    nameEn: 'Pharmacy',
    nameAr: 'الصيدلية',
    parentId: 'unit-root',
    isActive: true,
    children: [],
  } as unknown as OrgUnitDto;

  function create(arabic: boolean): OrgUnitTreeComponent {
    TestBed.configureTestingModule({
      imports: [OrgUnitTreeComponent],
      providers: [
        provideHttpClient(),
        ConfirmationService,
        provideHttpClientTesting(),
        provideRouter([]),
        provideTranslateService({ lang: 'en' }),
        {
          provide: LanguageService,
          useValue: {
            isArabic: () => arabic,
            bilingual: (en: string, ar: string | null | undefined) => pickBilingualName(en, ar, arabic),
          },
        },
      ],
    });
    TestBed.inject(TranslateService).setTranslation('en', {
      organization: { addUnit: 'Add unit', addSubUnitTo: 'Add sub-unit to {{parent}}', editUnitNamed: 'Edit {{unit}}' },
    });
    const fixture = TestBed.createComponent(OrgUnitTreeComponent);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController).expectOne(`${environment.apiUrl}/organization/units`).flush([PHARMACY]);
    return fixture.componentInstance;
  }

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('"Add unit" from the header', () => {
    const tree = create(false);
    tree.onAdd();
    expect(tree.unitDialogHeader()).toBe('Add unit');
  });

  it('"Add sub-unit to {parent}" from a row', () => {
    const tree = create(false);
    tree.onAddChild(PHARMACY);
    expect(tree.unitDialogHeader()).toBe('Add sub-unit to Pharmacy');
    expect(tree.newUnitParentId()).toBe('unit-pharmacy');
  });

  it('"Edit {unit}", and Add after it forgets the unit', () => {
    const tree = create(false);
    tree.onEdit(PHARMACY);
    expect(tree.unitDialogHeader()).toBe('Edit Pharmacy');
    tree.onAdd();
    expect(tree.unitDialogHeader()).toBe('Add unit');
  });

  it('names the unit in Arabic in an Arabic session', () => {
    const tree = create(true);
    tree.onEdit(PHARMACY);
    expect(tree.unitDialogHeader()).toBe('Edit الصيدلية');
  });
});
