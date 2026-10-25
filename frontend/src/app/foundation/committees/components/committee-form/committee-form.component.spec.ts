import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideTranslateService, provideTranslateLoader, TranslateNoOpLoader } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { Observable, of, throwError } from 'rxjs';
import { CommitteeFormComponent } from './committee-form.component';
import { CommitteeDetailDto, CommitteeListItemDto, CommitteeService } from '../../services/committee.service';
import { LookupService } from '../../../lookup/services/lookup.service';
import { OrgUnitService } from '../../../organization/services/org-unit.service';
import { provideFormatTesting } from '../../../../core/formatting/testing';
import { FORMATION_RULES } from '../../testing';

// ACC-233 — the committee dialog leaves out what the server would refuse, says
// a refusal from its code under the field it is about, keeps what was typed,
// and clears a parent or reports-to for real on an edit.
//
// ACC-238 — the three tabs and one Save; Save is never disabled for an
// invalid form and moves to the first tab with an error; the stale save is a
// footer line with Reload; Retry only when the server could not be reached;
// Reports to follows Parent.

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
  updatedAt: '2026-10-01T00:00:00.000Z',
  memberCount: 7,
  currentStageNameEn: null,
  currentStageNameAr: null,
  stageRules: FORMATION_RULES,
  isDissolving: false,
  typeValue: null,
  ...over,
});

const LOADED = '2026-10-18T09:00:00.123Z';
const FRESH = '2026-10-18T09:05:00.000Z';

describe('CommitteeFormComponent', () => {
  let fixture: ComponentFixture<CommitteeFormComponent>;
  let component: CommitteeFormComponent;
  let update: jasmine.Spy;
  let create: jasmine.Spy;
  let getById: jasmine.Spy;

  const LIST = [
    committee('self', { parentCommitteeId: 'keeps', updatedAt: LOADED }),
    committee('keeps', { isDissolving: true }),
    committee('child', { parentCommitteeId: 'self' }),
    committee('reporter', { reportingToCommitteeId: 'self' }),
    committee('closing', { isDissolving: true }),
    committee('free'),
    committee('other'),
  ];

  function render(editing: CommitteeDetailDto | null, failWith?: unknown): void {
    const answer = (): Observable<unknown> => (failWith ? throwError(() => failWith) : of(editing));
    update = jasmine.createSpy('update').and.callFake(answer);
    create = jasmine.createSpy('create').and.callFake(answer);
    getById = jasmine.createSpy('getById').and.returnValue(of({ ...editing!, nameEn: 'Saved by someone else', updatedAt: FRESH }));
    TestBed.configureTestingModule({
      imports: [CommitteeFormComponent],
      providers: [
        provideNoopAnimations(),
        provideTranslateService({ loader: provideTranslateLoader(TranslateNoOpLoader) }),
        provideFormatTesting(),
        ConfirmationService,
        { provide: CommitteeService, useValue: { listCommittees: () => of(LIST), update, create, getById } },
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
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
  }

  const edit = (over: Partial<CommitteeListItemDto> = {}) => render(committee('self', { parentCommitteeId: 'keeps', updatedAt: LOADED, ...over }));
  const q = (selector: string) => document.querySelector<HTMLElement>(selector);
  const slot = (field: string) => q(`[data-cf-field="${field}"] .am-field__message`)?.textContent?.trim() ?? '';

  describe('the pickers leave out what the server refuses (ACC-233)', () => {
    it('the parent picker leaves out the committee, its sub-committees and dissolving committees — and keeps the saved one', () => {
      edit();
      expect(component.parentCommitteeOptions().map((c) => c.id).sort()).toEqual(['free', 'keeps', 'other', 'reporter']);
    });

    it('the reports-to picker follows its own chain', () => {
      edit();
      expect(component.reportingToOptions().map((c) => c.id).sort()).toEqual(['child', 'free', 'other']);
    });

    it('meeting frequencies are offered in words, never the raw value', () => {
      edit();
      expect(component.frequencyOptions().map((o) => o.label)).toContain('committee.frequency.as_needed');
    });
  });

  describe('three tabs, one Save (ACC-238)', () => {
    it('opens on Identity; every field sits on the tab the drawing puts it', () => {
      edit();
      expect(component.tab()).toBe('identity');
      const onTab = (tab: string) =>
        Array.from(document.querySelectorAll(`[data-cf-panel="${tab}"] [data-cf-field]`)).map((e) => e.getAttribute('data-cf-field'));
      expect(onTab('identity')).toEqual(['nameEn', 'nameAr', 'typeValueId', 'purpose']);
      expect(onTab('governance')).toEqual(['quorumCount', 'meetingFrequency']);
      expect(onTab('structure')).toEqual(['orgUnitId', 'parentCommitteeId', 'reportingToCommitteeId']);
    });

    it('Save is never disabled; pressing it with an error moves to that tab, marks it, and sends nothing', async () => {
      edit();
      component.form.controls.orgUnitId.setValue(null);
      fixture.detectChanges();
      const save = q('[data-cf-save] button')!;
      expect(save.hasAttribute('disabled')).toBe(false);

      save.click();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(update).not.toHaveBeenCalled();
      expect(component.tab()).toBe('structure');
      expect(q('[data-tab-errors="structure"]')?.textContent?.trim()).toBe('⚠ 1');
      expect(q('[data-tab-errors="identity"]')).toBeNull();
      expect(slot('orgUnitId')).toBe('committee.refusal.unitRequired');
    });

    it('the first tab with an error wins, in reading order', () => {
      edit();
      component.form.controls.nameEn.setValue('');
      component.form.controls.orgUnitId.setValue(null);
      component.submit();
      fixture.detectChanges();
      expect(component.tab()).toBe('identity');
      expect(component.tabErrors()).toEqual({ identity: 1, governance: 0, structure: 1 });
    });

    // The no-op loader answers with keys; the real sentences are in the layout spec.
    it('the quorum hint counts the members while editing, and says only "not set" on create', () => {
      edit();
      expect(component.quorumHint()).toBe('committee.quorumHint');
      TestBed.resetTestingModule();
      render(null);
      expect(component.quorumHint()).toBe('committee.form.quorumNotSet');
    });
  });

  describe('a refusal is said where it belongs', () => {
    it('a field refusal is said in its slot, on its tab; the dialog stays open and what was typed is kept', () => {
      edit();
      update.and.returnValue(
        throwError(
          () =>
            new HttpErrorResponse({ status: 400, error: { statusCode: 400, code: 'COMMITTEE_PARENT_LOOP', message: 'English for a log' } }),
        ),
      );
      const saved = jasmine.createSpy('saved');
      component.saved.subscribe(saved);
      component.form.patchValue({ nameEn: 'Typed name', parentCommitteeId: 'free' });

      component.submit();
      fixture.detectChanges();

      expect(component.tab()).toBe('structure');
      expect(slot('parentCommitteeId')).toBe('committee.refusal.parentLoop');
      expect(document.body.textContent).not.toContain('English for a log');
      expect(saved).not.toHaveBeenCalled();
      expect(component.form.controls.nameEn.value).toBe('Typed name');
      expect(component.form.controls.parentCommitteeId.value).toBe('free');
      expect(component.saving()).toBe(false);
    });

    it('the next Save asks the server again rather than keeping the old refusal', () => {
      edit();
      update.and.returnValue(throwError(() => new HttpErrorResponse({ status: 400, error: { code: 'COMMITTEE_UNIT_NOT_FOUND' } })));
      component.submit();
      expect(component.refusedField()?.field).toBe('orgUnitId');
      update.and.returnValue(of(LIST[0]));
      component.submit();
      expect(component.refusedField()).toBeNull();
      expect(update).toHaveBeenCalledTimes(2);
    });

    it('a failure about no field is a footer line with NO Retry (artboard 14, rule 5.5)', () => {
      edit();
      update.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500, error: { statusCode: 500, message: 'Internal' } })));
      component.submit();
      fixture.detectChanges();
      expect(q('[data-cf-footer-message]')?.textContent?.trim()).toBe('committee.refusal.saveFailed');
      expect(q('[data-cf-retry]')).toBeNull();
      expect(q('[data-cf-save]')).not.toBeNull();
    });

    it('an unreachable server offers Retry, which saves again', () => {
      edit();
      update.and.returnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
      component.submit();
      fixture.detectChanges();
      expect(q('[data-cf-footer-message]')?.textContent?.trim()).toBe('committee.form.unreachable');

      update.and.returnValue(of(LIST[0]));
      q('[data-cf-retry] button')!.click();
      expect(update).toHaveBeenCalledTimes(2);
    });
  });

  describe('someone else saved first (ACC-238)', () => {
    it('an edit sends the updatedAt the dialog loaded', () => {
      edit();
      component.submit();
      expect(update.calls.mostRecent().args[1].expectedUpdatedAt).toBe(LOADED);
    });

    it('409 COMMITTEE_CHANGED: the footer says so, Save becomes Reload, nothing typed is applied', () => {
      edit();
      update.and.returnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'COMMITTEE_CHANGED' } })));
      component.form.controls.nameEn.setValue('Mine');

      component.submit();
      fixture.detectChanges();

      expect(q('[data-cf-footer-message]')?.textContent?.trim()).toBe('committee.form.conflict');
      expect(q('[data-cf-reload]')).not.toBeNull();
      expect(q('[data-cf-save]')).toBeNull();
      expect(q('[data-cf-retry]')).toBeNull();
    });

    it('Reload reads the committee again, shows the saved values, and the next save sends the new updatedAt', () => {
      edit();
      update.and.returnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'COMMITTEE_CHANGED' } })));
      const reloaded = jasmine.createSpy('reloaded');
      component.reloaded.subscribe(reloaded);
      component.form.controls.nameEn.setValue('Mine');
      component.submit();
      fixture.detectChanges();

      q('[data-cf-reload] button')!.click();
      fixture.detectChanges();

      expect(getById).toHaveBeenCalledWith('self');
      expect(component.form.controls.nameEn.value).toBe('Saved by someone else');
      expect(component.footer()).toBeNull();
      expect(reloaded).toHaveBeenCalled();
      update.and.returnValue(of(LIST[0]));
      component.submit();
      expect(update.calls.mostRecent().args[1].expectedUpdatedAt).toBe(FRESH);
    });

    it('Add committee sends no updatedAt', () => {
      render(null);
      component.form.patchValue({ nameEn: 'New', typeValueId: 'type-1' });
      component.submit();
      expect(create).toHaveBeenCalled();
      expect(create.calls.mostRecent().args[0].expectedUpdatedAt).toBeUndefined();
    });
  });

  describe('Reports to follows Parent (ACC-238)', () => {
    it('choosing a parent fills an empty Reports to, with the line saying so', () => {
      edit({ parentCommitteeId: null });
      component.form.controls.parentCommitteeId.setValue('free');
      expect(component.form.controls.reportingToCommitteeId.value).toBe('free');
      expect(component.reportsToHint()).toBe('committee.form.reportsToFilledIn');
    });

    it('changing the parent again moves Reports to only while it still matched the old parent', () => {
      edit({ parentCommitteeId: null });
      component.form.controls.parentCommitteeId.setValue('free');
      component.form.controls.parentCommitteeId.setValue('other');
      expect(component.form.controls.reportingToCommitteeId.value).toBe('other');

      component.form.controls.reportingToCommitteeId.setValue('free'); // the person chose it
      component.form.controls.parentCommitteeId.setValue('reporter');
      expect(component.form.controls.reportingToCommitteeId.value).toBe('free');
      expect(component.reportsToHint()).not.toBe('committee.form.reportsToFilledIn');
    });

    it('never fills in a committee the reports-to list leaves out', () => {
      edit({ parentCommitteeId: null });
      // "reporter" reports to this committee, so it is a valid parent but not a valid reports-to.
      component.form.controls.parentCommitteeId.setValue('reporter');
      expect(component.form.controls.reportingToCommitteeId.value).toBeNull();
    });

    it('opening a saved committee does not move its Reports to', () => {
      edit({ parentCommitteeId: 'free', reportingToCommitteeId: null });
      expect(component.form.controls.reportingToCommitteeId.value).toBeNull();
      expect(component.form.pristine).toBe(true);
    });
  });

  describe('what a save sends (ACC-233)', () => {
    it('clearing the parent and reports-to on an EDIT sends null, which clears them', () => {
      edit({ parentCommitteeId: 'free', reportingToCommitteeId: 'free' });
      component.form.patchValue({ parentCommitteeId: null, reportingToCommitteeId: null });

      component.submit();

      const dto = update.calls.mostRecent().args[1];
      expect(dto.parentCommitteeId).toBeNull();
      expect(dto.reportingToCommitteeId).toBeNull();
    });

    it('on CREATE an empty parent and reports-to are simply left out, and the root unit is prefilled', () => {
      render(null);
      expect(component.form.controls.orgUnitId.value).toBe('unit-root');
      component.form.patchValue({ nameEn: 'New', typeValueId: 'type-1' });

      component.submit();

      const dto = create.calls.mostRecent().args[0];
      expect(dto.parentCommitteeId).toBeUndefined();
      expect(dto.reportingToCommitteeId).toBeUndefined();
    });
  });
});
