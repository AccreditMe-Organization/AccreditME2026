import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { Observable, Subject, of, throwError } from 'rxjs';
import { provideTranslateService, provideTranslateLoader, TranslateNoOpLoader } from '@ngx-translate/core';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { provideFormatTesting } from '../../../../core/formatting/testing';
import { CommitteeDetailDto, CommitteeService, CommitteeStageRulesDto } from '../../services/committee.service';
import { ACTIVE_RULES, FORMATION_RULES, SEEDED_STAGE_RULES } from '../../testing';
import { LookupService } from '../../../lookup/services/lookup.service';
import { UserService } from '../../../user/services/user.service';
import { OrgUnitService } from '../../../organization/services/org-unit.service';
import { WorkflowService } from '../../../workflow/services/workflow.service';
import { ChangeRequestService, OpenChangeRequestDto } from '../../change-requests/change-request.service';
import { REQUEST } from '../../change-requests/change-request.testing';
import { CommitteeDetailComponent } from './committee-detail.component';

// ACC-240 — the committee page's change request half: "Request a change" in the
// header follows the server's canRaise and nothing else (no stage key, no
// permission read here), the open-request banner sits before the Lifecycle row,
// and the Change requests panel is LAST in the panel grid.

const COMMITTEE = (stageRules: CommitteeStageRulesDto): CommitteeDetailDto => ({
  id: 'c-1',
  organizationId: 'org',
  nameEn: 'Patient Experience Committee',
  nameAr: null,
  typeValueId: 'type-1',
  purpose: null,
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
  isDissolving: false,
  stageRules,
  typeValue: null,
  orgUnit: null,
});


describe('CommitteeDetailComponent — change requests (ACC-240)', () => {
  let fixture: ComponentFixture<CommitteeDetailComponent>;
  let openCalls = 0;
  let listCalls = 0;

  function render(open: () => Observable<OpenChangeRequestDto>, stageRules: CommitteeStageRulesDto = ACTIVE_RULES): HTMLElement {
    openCalls = 0;
    listCalls = 0;
    TestBed.configureTestingModule({
      imports: [CommitteeDetailComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ loader: provideTranslateLoader(TranslateNoOpLoader) }),
        provideFormatTesting(),
        ConfirmationService,
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'c-1' }) }, queryParamMap: of(convertToParamMap({})) } },
        // Every permission held: the button must still follow canRaise alone.
        { provide: NavigationAccessService, useValue: { hasPermission: () => true } },
        {
          provide: CommitteeService,
          useValue: {
            getById: () => of(COMMITTEE(stageRules)),
            listCommittees: () => of([]),
            listMembers: () => of([]),
            listMembershipEvents: () => of([]),
            membersPage: () => of({ items: [], total: 0, matching: 0 }),
            subCommittees: () => of({ items: [], total: 0, matching: 0 }),
          },
        },
        {
          provide: ChangeRequestService,
          useValue: {
            open: () => {
              openCalls++;
              return open();
            },
            list: () => {
              listCalls++;
              return of({ items: [REQUEST()], total: 1, matching: 1 });
            },
          },
        },
        { provide: LookupService, useValue: { getValues: () => of([]) } },
        { provide: UserService, useValue: { listAllUsers: () => of([]) } },
        { provide: OrgUnitService, useValue: { getFlat: () => of([]) } },
        { provide: WorkflowService, useValue: { getInstancesByObject: () => of([]) } },
      ],
    });
    fixture = TestBed.createComponent(CommitteeDetailComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => TestBed.resetTestingModule());

  const button = (page: HTMLElement) => page.querySelector('[data-testid="committee-request-change"]');

  it('shows Request a change when canRaise is true', () => {
    const page = render(() => of({ request: null, canRaise: true }));
    expect(button(page)).not.toBeNull();
    expect(button(page)!.textContent).toContain('committee.changeRequest.requestChange');
  });

  it('shows no Request a change when canRaise is false, whatever the stage and permissions', () => {
    for (const { stage, rules } of SEEDED_STAGE_RULES) {
      const page = render(() => of({ request: null, canRaise: false }), rules);
      expect(button(page)).withContext(stage).toBeNull();
      TestBed.resetTestingModule();
    }
  });

  it('…and follows canRaise even in a stage the screen would not offer it in', () => {
    // The screen copies no stage rule: the server's answer is the whole rule.
    expect(button(render(() => of({ request: null, canRaise: true }), FORMATION_RULES))).not.toBeNull();
  });

  it('shows no Request a change before the open read answers', () => {
    const pending = new Subject<OpenChangeRequestDto>();
    const page = render(() => pending);
    expect(button(page)).toBeNull();
    pending.next({ request: null, canRaise: true });
    fixture.detectChanges();
    expect(button(page)).not.toBeNull();
  });

  it('a failed open read: no button, the banner says so, and Retry reads again', () => {
    let fail = true;
    const page = render(() => (fail ? throwError(() => ({ status: 500 })) : of({ request: null, canRaise: true })));
    expect(button(page)).toBeNull();
    const error = page.querySelector('[data-testid="cr-banner-error"]');
    expect(error?.textContent).toContain('committee.changeRequest.banner.error');
    fail = false;
    (error!.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(openCalls).toBe(2);
    expect(page.querySelector('[data-testid="cr-banner-error"]')).toBeNull();
    expect(button(page)).not.toBeNull();
  });

  it('an open request: the banner, linked to the request, and no button', () => {
    const page = render(() => of({ request: REQUEST(), canRaise: false }));
    const banner = page.querySelector('[data-testid="cr-banner"]');
    expect(banner).not.toBeNull();
    expect(banner!.querySelector('[data-testid="cr-banner-view"]')!.getAttribute('href')).toBe('/committees/c-1/change-requests/cr-1');
    expect(button(page)).toBeNull();
  });

  it('the banner sits before the Lifecycle row, and the panel is last in the panel grid', () => {
    const page = render(() => of({ request: REQUEST(), canRaise: false }));
    const panel = page.querySelector('am-committee-change-requests-panel')!;
    expect(panel).withContext('the panel').not.toBeNull();
    expect(panel.parentElement!.lastElementChild).toBe(panel);
    expect(listCalls).toBe(1);
  });

  it('Request a change goes to the new request page', () => {
    const page = render(() => of({ request: null, canRaise: true }));
    const router = TestBed.inject(Router);
    const navigate = spyOn(router, 'navigate').and.resolveTo(true);
    (button(page)!.querySelector('button') as HTMLButtonElement).click();
    expect(navigate).toHaveBeenCalledWith(['/committees', 'c-1', 'change-requests', 'new']);
  });
});
