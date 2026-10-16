import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideTranslateService, provideTranslateLoader, TranslateNoOpLoader } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';
import { CommitteeFormComponent } from './committee-form.component';
import { CommitteeDto, CommitteeListItemDto, CommitteeService } from '../../services/committee.service';
import { LookupService } from '../../../lookup/services/lookup.service';
import { OrgUnitService } from '../../../organization/services/org-unit.service';

// ACC-233 — the committee dialog leaves out what the server would refuse, says
// a refusal from its code under the field it is about, keeps what was typed,
// and clears a parent or reports-to for real on an edit.

const committee = (id: string, over: Partial<CommitteeListItemDto> = {}): CommitteeListItemDto => ({
  id,
  organizationId: 'org',
  nameEn: `Committee ${id}`,
  nameAr: null,
  typeValueId: 'type-1',
  purpose: null,
  quorumCount: 0,
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
  memberCount: 0,
  currentStageNameEn: null,
  currentStageNameAr: null,
  currentStageKey: null,
  isDissolving: false,
  ...over,
});

describe('CommitteeFormComponent (ACC-233)', () => {
  let fixture: ComponentFixture<CommitteeFormComponent>;
  let component: CommitteeFormComponent;
  let update: jasmine.Spy;

  const LIST = [
    committee('self', { parentCommitteeId: 'keeps' }),
    committee('keeps', { isDissolving: true }),
    committee('child', { parentCommitteeId: 'self' }),
    committee('reporter', { reportingToCommitteeId: 'self' }),
    committee('closing', { isDissolving: true }),
    committee('free'),
  ];

  function render(editing: CommitteeDto | null, failWith?: unknown): void {
    update = jasmine
      .createSpy('update')
      .and.callFake(() => (failWith ? throwError(() => failWith) : of(editing)));
    TestBed.configureTestingModule({
      imports: [CommitteeFormComponent],
      providers: [
        provideNoopAnimations(),
        provideTranslateService({ loader: provideTranslateLoader(TranslateNoOpLoader) }),
        { provide: CommitteeService, useValue: { listCommittees: () => of(LIST), update, create: update } },
        { provide: LookupService, useValue: { getValues: () => of([{ id: 'type-1', labelEn: 'Quality', labelAr: null }]) } },
        {
          provide: OrgUnitService,
          useValue: { getFlat: () => of([{ id: 'unit-root', nameEn: 'Root', nameAr: null, parentId: null, isActive: true }]) },
        },
      ],
    });
    fixture = TestBed.createComponent(CommitteeFormComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('committee', editing);
    fixture.detectChanges();
  }

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const part = (id: string) => (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${id}"]`);

  it('the parent picker leaves out the committee, its sub-committees and dissolving committees — and keeps the saved one', () => {
    render(LIST[0]!);
    expect(component.parentCommitteeOptions().map((c) => c.id).sort()).toEqual(['free', 'keeps', 'reporter']);
  });

  it('the reports-to picker follows its own chain', () => {
    render(LIST[0]!);
    expect(component.reportingToOptions().map((c) => c.id).sort()).toEqual(['child', 'free']);
  });

  it('a refusal is said under its field, the dialog stays open, and what was typed is kept', () => {
    render(
      LIST[0]!,
      new HttpErrorResponse({ status: 400, error: { statusCode: 400, code: 'COMMITTEE_PARENT_LOOP', message: 'English for a log' } }),
    );
    const saved = jasmine.createSpy('saved');
    component.saved.subscribe(saved);
    component.form.patchValue({ nameEn: 'Typed name', parentCommitteeId: 'free' });

    component.onSubmit();
    fixture.detectChanges();

    expect(part('refusal-parentCommitteeId')?.textContent?.trim()).toBe('committee.refusal.parentLoop');
    expect(text()).not.toContain('English for a log');
    expect(saved).not.toHaveBeenCalled();
    expect(component.form.controls.nameEn.value).toBe('Typed name');
    expect(component.form.controls.parentCommitteeId.value).toBe('free');
    expect(component.saving()).toBe(false);
  });

  it('a refusal about no single field is said at the foot of the form', () => {
    render(LIST[0]!, new HttpErrorResponse({ status: 500, error: { statusCode: 500, message: 'Internal server error' } }));
    component.onSubmit();
    fixture.detectChanges();
    expect(part('refusal-form')?.textContent?.trim()).toBe('committee.refusal.saveFailed');
  });

  it('the next Save clears the earlier refusal', () => {
    render(LIST[0]!, new HttpErrorResponse({ status: 400, error: { code: 'COMMITTEE_UNIT_NOT_FOUND' } }));
    component.onSubmit();
    expect(component.refusal()?.field).toBe('orgUnitId');
    update.and.returnValue(of(LIST[0]));
    component.onSubmit();
    expect(component.refusal()).toBeNull();
  });

  it('clearing the parent and reports-to on an EDIT sends null, which clears them', () => {
    render(committee('self', { parentCommitteeId: 'free', reportingToCommitteeId: 'free' }));
    component.form.patchValue({ parentCommitteeId: null, reportingToCommitteeId: null });

    component.onSubmit();

    const dto = update.calls.mostRecent().args[1];
    expect(dto.parentCommitteeId).toBeNull();
    expect(dto.reportingToCommitteeId).toBeNull();
  });

  it('on CREATE an empty parent and reports-to are simply left out', () => {
    render(null);
    component.form.patchValue({ nameEn: 'New', typeValueId: 'type-1' });

    component.onSubmit();

    const dto = update.calls.mostRecent().args[0];
    expect(dto.parentCommitteeId).toBeUndefined();
    expect(dto.reportingToCommitteeId).toBeUndefined();
  });
});
