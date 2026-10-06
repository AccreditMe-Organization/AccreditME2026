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
    // ACC-174 — "the creator" is the server's canManage now: the creator or
    // whoever acts for them, which the old createdById check missed.
    it("lets whoever manages the task — its creator or their cover — reassign it without tasks:reassign (Q4)", () => {
      const c = build([]);
      expect(c.canReassign(task({ status: 'REJECTED', createdById: OTHER, canManage: true, assignees: [] }))).toBe(true);
    });

    it('lets a tasks:reassign holder reassign a task someone else created', () => {
      const c = build(['tasks:reassign']);
      expect(c.canReassign(task({ createdById: OTHER }))).toBe(true);
    });

    it('offers nothing to someone who is neither', () => {
      const c = build(['tasks:view']);
      expect(c.canReassign(task({ status: 'REJECTED', createdById: OTHER, canManage: false }))).toBe(false);
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

  // ACC-174 — the creator's actions on the record's list.
  describe('edit, cancel and reopen — canManage says who, the status says which', () => {
    it('offers Edit and Cancel on an open task the viewer manages', () => {
      const c = build([]);
      const t = task({ canManage: true });
      expect(c.canEditTask(t)).toBe(true);
      expect(c.canCancelTask(t)).toBe(true);
      expect(c.canReopenTask(t)).toBe(false);
    });

    it('offers nothing where the viewer does not manage the task — whatever they hold', () => {
      const c = build(['tasks:reassign', 'tasks:create']);
      const t = task({ canManage: false });
      expect(c.canEditTask(t)).toBe(false);
      expect(c.canCancelTask(t)).toBe(false);
      expect(c.canReopenTask(task({ status: 'COMPLETED', canManage: false }))).toBe(false);
    });

    it("offers no Cancel on a workflow step's task", () => {
      const c = build([]);
      const t = task({ canManage: true, sourceStageId: 's1', workflowInstanceId: 'i1' });
      expect(c.canEditTask(t)).toBe(true);
      expect(c.canCancelTask(t)).toBe(false);
    });

    it('offers Reopen only on a completed task, and Edit on none that is closed', () => {
      const c = build([]);
      expect(c.canReopenTask(task({ status: 'COMPLETED', canManage: true }))).toBe(true);
      expect(c.canEditTask(task({ status: 'COMPLETED', canManage: true }))).toBe(false);
      expect(c.canEditTask(task({ status: 'CANCELLED', canManage: true }))).toBe(false);
      expect(c.canReopenTask(task({ status: 'CANCELLED', canManage: true }))).toBe(false);
    });

    it('names who cancelled it and why', () => {
      const c = build([]);
      TestBed.inject(TranslateService).setTranslation(
        'en',
        { task: { cancelTask: { line: 'Cancelled: {{reason}}', lineNamed: 'Cancelled by {{name}}: {{reason}}' } } },
        true,
      );
      expect(
        c.cancelledLine(task({ status: 'CANCELLED', cancelledReason: 'Postponed', cancelledBy: { id: 'u', name: 'Yasser' } })),
      ).toBe('Cancelled by Yasser: Postponed');
      expect(c.cancelledLine(task({ status: 'CANCELLED', cancelledReason: 'Postponed', cancelledBy: null }))).toBe(
        'Cancelled: Postponed',
      );
    });
  });
});
