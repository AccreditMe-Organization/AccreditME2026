import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { of } from 'rxjs';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { AuthService } from '../../../../core/services/auth.service';
import { FormatService } from '../../../../core/formatting';
import { CommitteeService } from '../../services/committee.service';
import { LookupService } from '../../../lookup/services/lookup.service';
import { UserService } from '../../../user/services/user.service';
import { OrgUnitService } from '../../../organization/services/org-unit.service';
import { TaskService, ITaskWithAssigneesDto } from '../../../tasks/services/task.service';
import { WorkflowService } from '../../../workflow/services/workflow.service';
import { CommitteeDetailComponent } from './committee-detail.component';

// ACC-163 — the committee record's task panel: who may reassign a task, when
// Complete is held back for evidence, and what a rejected task says.
//
// Built the way bilingual-name.screens.spec.ts builds this component: the
// template is emptied and no change detection runs, so nothing loads — what is
// tested is the real class's own rules, with the viewer's identity and
// permissions as the only inputs. The rendered half (the rejection line and
// the overdue badge in place) is checked in the browser pass.

const ME = 'user-me';
const OTHER = 'user-other';

function stubService(): unknown {
  const handler: ProxyHandler<() => unknown> = {
    get: (_t, prop) => (prop === 'then' || typeof prop === 'symbol' ? undefined : stubService()),
    apply: () => of([]),
  };
  return new Proxy(() => undefined, handler);
}

const task = (overrides: Partial<ITaskWithAssigneesDto>): ITaskWithAssigneesDto =>
  ({
    id: 'task-1',
    title: 'Collect the audit sample',
    status: 'PENDING',
    createdById: OTHER,
    requiresEvidence: false,
    evidenceCount: 0,
    rejectedReason: null,
    rejectedBy: null,
    assignees: [{ userId: ME, userName: 'Me', delegation: null }],
    ...overrides,
  }) as ITaskWithAssigneesDto;

function build(permissions: string[]): CommitteeDetailComponent {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideTranslateService({ lang: 'en' }),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'c-1' }) } } },
      { provide: ConfirmationService, useValue: { confirm: jasmine.createSpy('confirm') } },
      { provide: NavigationAccessService, useValue: { hasPermission: (p: string) => permissions.includes(p) } },
      { provide: AuthService, useValue: { currentUser: () => ({ id: ME }) } },
      ...[FormatService, CommitteeService, LookupService, UserService, OrgUnitService, TaskService, WorkflowService].map(
        (provide) => ({ provide, useValue: stubService() }),
      ),
    ],
  });
  TestBed.overrideComponent(CommitteeDetailComponent, { set: { template: '', imports: [] } });
  TestBed.inject(TranslateService).setTranslation(
    'en',
    { task: { rejectedByNamed: 'Rejected by {{name}}: {{reason}}', rejectedReasonOnly: 'Rejected: {{reason}}' } },
    true,
  );
  return TestBed.createComponent(CommitteeDetailComponent).componentInstance;
}

describe('CommitteeDetailComponent — tasks (ACC-163)', () => {
  afterEach(() => TestBed.resetTestingModule());

  describe('canReassign — the rule the server applies', () => {
    it("lets the task's creator reassign it without holding tasks:reassign (Q4)", () => {
      const c = build([]);
      expect(c.canReassign(task({ status: 'REJECTED', createdById: ME, assignees: [] }))).toBe(true);
    });

    it('lets a tasks:reassign holder reassign a task someone else created', () => {
      const c = build(['tasks:reassign']);
      expect(c.canReassign(task({ createdById: OTHER }))).toBe(true);
    });

    it('offers nothing to someone who is neither', () => {
      const c = build(['tasks:view']);
      expect(c.canReassign(task({ status: 'REJECTED', createdById: OTHER }))).toBe(false);
    });

    it('offers nothing on a closed task, even to the creator — the server refuses it', () => {
      const c = build(['tasks:reassign']);
      expect(c.canReassign(task({ status: 'COMPLETED', createdById: ME }))).toBe(false);
      expect(c.canReassign(task({ status: 'CANCELLED', createdById: ME }))).toBe(false);
    });
  });

  describe('Complete and required evidence', () => {
    it('holds Complete back while evidence is required and none has been added', () => {
      const c = build([]);
      expect(c.needsEvidence(task({ requiresEvidence: true, evidenceCount: 0 }))).toBe(true);
    });

    it('releases it once evidence exists, and never holds back a task that does not require it', () => {
      const c = build([]);
      expect(c.needsEvidence(task({ requiresEvidence: true, evidenceCount: 1 }))).toBe(false);
      expect(c.needsEvidence(task({ requiresEvidence: false, evidenceCount: 0 }))).toBe(false);
    });

    it('still offers Complete only to an active assignee on an open task', () => {
      const c = build([]);
      expect(c.canComplete(task({}))).toBe(true);
      expect(c.canComplete(task({ assignees: [{ userId: OTHER, userName: 'Other', delegation: null }] }))).toBe(false);
      expect(c.canComplete(task({ status: 'COMPLETED' }))).toBe(false);
    });
  });

  describe('a rejected task', () => {
    it('says who rejected it and why', () => {
      const c = build([]);
      expect(
        c.rejectionLine(task({ status: 'REJECTED', rejectedReason: 'Not my unit', rejectedBy: { id: OTHER, name: 'Sarah' } })),
      ).toBe('Rejected by Sarah: Not my unit');
    });

    it('still gives the reason when the rejecter no longer resolves', () => {
      const c = build([]);
      expect(c.rejectionLine(task({ status: 'REJECTED', rejectedReason: 'Not my unit', rejectedBy: null }))).toBe(
        'Rejected: Not my unit',
      );
    });

    it('hands the rejection to the reassign dialog, and nothing for a task that is not rejected', () => {
      const c = build([]);

      c.openReassign(task({ status: 'REJECTED', rejectedReason: 'Not my unit', rejectedBy: { id: OTHER, name: 'Sarah' } }));
      expect(c.reassignVisible()).toBe(true);
      expect(c.reassignRejection()).toEqual({ byName: 'Sarah', reason: 'Not my unit' });

      c.openReassign(task({ status: 'PENDING' }));
      expect(c.reassignRejection()).toBeNull();
    });

    it('labels its status Rejected, and a PENDING task Assigned', () => {
      const c = build([]);
      expect(c.statusLabel(task({ status: 'REJECTED' }))).toBe('task.status.rejected');
      expect(c.statusLabel(task({ status: 'PENDING' }))).toBe('task.status.pending');
    });
  });
});
