import { TestBed } from '@angular/core/testing';
import { ConfirmationService } from 'primeng/api';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { environment } from '../../../../../environments/environment';
import { LanguageService } from '../../../../core/services/language.service';
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

  function create(arabic: boolean): OrgUnitTreeComponent {
    TestBed.configureTestingModule({
      imports: [OrgUnitTreeComponent],
      providers: [
        provideHttpClient(),
        ConfirmationService,
        provideHttpClientTesting(),
        provideRouter([]),
        provideTranslateService({ lang: 'en' }),
        { provide: LanguageService, useValue: { isArabic: () => arabic } },
      ],
    });
    TestBed.inject(TranslateService).setTranslation('en', {
      orgUnitHead: { manageHead: 'Manage Head', manageHeadNamed: 'Manage Head — {{unit}}' },
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
});
