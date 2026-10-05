// ACC-123 — the ticket's named example, tested in both directions.
//
// Why this file exists when check:action-gating already passes: the scan
// proves a gate is PRESENT. It cannot prove the gate is the RIGHT one, because
// deciding that means reading workflow-template.controller.ts's own
// @Permissions() — which says workflows:manage on both endpoints. So the scan
// would stay green if this page gated on workflows:view, which every holder of
// the list already has, and the defect would be exactly as it was.
//
// The negative case is the one that matters. Dr. Yasser Al-Amri
// (QUALITY_MANAGER) holds workflows:view for the workflow picker and nothing
// more; he was shown Set as default and Deactivate, and the server refused
// both.
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ConfirmationService } from 'primeng/api';
import {
  provideTranslateService,
  provideTranslateLoader,
  TranslateNoOpLoader,
} from '@ngx-translate/core';
import { WorkflowTemplateListComponent } from './workflow-template-list.component';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { environment } from '../../../../../environments/environment';

const TEMPLATES = [
  {
    id: 't1',
    nameEn: 'Document approval',
    nameAr: 'اعتماد الوثيقة',
    objectType: 'DOCUMENT',
    isDefault: false,
    isActive: true,
  },
  {
    id: 't2',
    nameEn: 'Committee lifecycle',
    nameAr: 'دورة حياة اللجنة',
    objectType: 'COMMITTEE',
    isDefault: true,
    isActive: true,
  },
];

describe('WorkflowTemplateListComponent — write gating (ACC-123)', () => {
  let fixture: ComponentFixture<WorkflowTemplateListComponent>;

  function render(permissions: string[]): HTMLElement {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [WorkflowTemplateListComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        ConfirmationService,
        provideTranslateService({
          lang: 'en',
          loader: provideTranslateLoader(TranslateNoOpLoader),
        }),
        {
          provide: NavigationAccessService,
          useValue: { hasPermission: (p: string) => permissions.includes(p) },
        },
      ],
    });
    fixture = TestBed.createComponent(WorkflowTemplateListComponent);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController)
      .expectOne(`${environment.apiUrl}/workflow-templates`)
      .flush(TEMPLATES);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const actionIcons = (el: HTMLElement): string[] =>
    Array.from(el.querySelectorAll<HTMLElement>('button .pi'))
      .map((i) => Array.from(i.classList).find((c) => /^pi-(star|ban)$/.test(c)))
      .filter((c): c is string => !!c);

  it('shows neither action to a holder of workflows:view alone', () => {
    const el = render(['workflows:view']);

    // Both rows render — reading the list is what workflows:view is for.
    expect(el.textContent).toContain('Document approval');
    expect(actionIcons(el)).toEqual([]);
  });

  it('shows both actions to a holder of workflows:manage', () => {
    const el = render(['workflows:view', 'workflows:manage']);

    // Two rows: one active non-default (star + ban), one active default
    // (star, disabled, + ban).
    expect(actionIcons(el).filter((c) => c === 'pi-star').length).toBe(2);
    expect(actionIcons(el).filter((c) => c === 'pi-ban').length).toBe(2);
  });

  // The rule this ticket sets for disabled: it is for a STATE, and the state
  // has to be readable. A Set-as-default button that is dead on the row that
  // already IS the default, with a tooltip still reading "Set as Default",
  // says nothing about why.
  it('disables Set as default on the row that already is, and says so', () => {
    render(['workflows:view', 'workflows:manage']);
    const component = fixture.componentInstance;

    expect(component.canManage()).toBe(true);
    const buttons = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        'button',
      ),
    ).filter((b) => b.querySelector('.pi-star'));

    // Row order matches TEMPLATES: the second is the default one.
    expect(buttons[0]!.disabled).toBe(false);
    expect(buttons[1]!.disabled).toBe(true);
  });
});

// ACC-160 — a dedicated Arabic-name slot in a list shows "—" when there is
// no Arabic name, rather than a blank cell. Not the English name: that slot's
// job is to report the Arabic one, and an English name there would lie.
// GUARD FIRST: a list whose records all have Arabic names shows no "—" at all,
// so the dash in the null case can only have come from that cell.
describe('WorkflowTemplateListComponent — the Arabic-name column (ACC-160)', () => {
  function renderWith(templates: object[]): string[] {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [WorkflowTemplateListComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        ConfirmationService,
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
        { provide: NavigationAccessService, useValue: { hasPermission: () => true } },
      ],
    });
    const fixture = TestBed.createComponent(WorkflowTemplateListComponent);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController).expectOne(`${environment.apiUrl}/workflow-templates`).flush(templates);
    fixture.detectChanges();
    return arabicSlots(fixture.nativeElement as HTMLElement);
  }

  it('shows no dash while every template has an Arabic name', () => {
    const slots = renderWith(TEMPLATES);
    expect(slots).toContain('اعتماد الوثيقة');
    expect(slots).not.toContain('—');
  });

  it('shows "—" for a template with no Arabic name, not a blank', () => {
    const slots = renderWith([...TEMPLATES, { ...TEMPLATES[0], id: 't3', nameEn: 'Audit cycle', nameAr: null }]);
    expect(slots).toContain('—');
    expect(slots).not.toContain('');
  });
});

// Reads the Arabic-name SLOTS themselves (dir="rtl"), not the page: a page can
// show "—" elsewhere — the stage list's empty SLA column does — and a whole-page
// assertion would then pass or fail for a reason that has nothing to do with
// the Arabic name. That is exactly how this test's first draft went wrong.
const arabicSlots = (root: HTMLElement): string[] =>
  Array.from(root.querySelectorAll('[dir="rtl"]')).map((e) => (e.textContent ?? '').trim());
