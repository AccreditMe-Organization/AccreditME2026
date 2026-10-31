import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PermissionGuard } from '../../common/guards/permission.guard';
import {
  COMMITTEE_TASKS_PERMISSIONS,
  COMMITTEES_PERMISSIONS,
  WORKFLOWS_PERMISSIONS,
} from '../../common/constants/permissions';
import { WorkflowTemplateController } from './workflow-template.controller';

// ACC-255 (Q-D, Ahmad, 22 Oct) — only whoever may edit a workflow may change
// what its stages allow. The stage rules ride the existing stage routes, so
// they carry the same check as every other workflow edit: workflows:manage.
// This uses the REAL PermissionGuard against the controller's REAL
// @Permissions() metadata (committees.permissions.spec.ts explains why a
// controller spec with a stubbed guard cannot prove this).
//
// The person refused here holds EVERY committee key, the committee task keys
// and workflows:view: running committees, and reading the workflow, are not
// changing it. Who can hold workflows:manage today is the plan's §16.1.

// ACC-271 PR 3 — who works a stage rides updateStage, and Keep this assignment
// is its own route: both are workflow edits, so both need workflows:manage.
type StageWrite = 'updateStage' | 'addStage' | 'removeStage' | 'keepStartingAssignment' | 'updateTransition' | 'addTransition';
const STAGE_WRITES: StageWrite[] = ['updateStage', 'addStage', 'removeStage', 'keepStartingAssignment', 'updateTransition', 'addTransition'];

const EVERY_COMMITTEE_KEY = [
  ...Object.values(COMMITTEES_PERMISSIONS),
  ...Object.values(COMMITTEE_TASKS_PERMISSIONS),
  WORKFLOWS_PERMISSIONS.VIEW,
];

function context(handler: StageWrite | 'getTemplateById', userPermissions: string[]): ExecutionContext {
  return {
    getHandler: () => (WorkflowTemplateController.prototype as unknown as Record<string, () => unknown>)[handler],
    getClass: () => WorkflowTemplateController,
    switchToHttp: () => ({ getRequest: () => ({ userPermissions }) }),
  } as unknown as ExecutionContext;
}

describe('WorkflowTemplateController — who may write stage rules (ACC-255)', () => {
  const guard = new PermissionGuard(new Reflector());

  it('the person under test really does hold every committee key', () => {
    expect(EVERY_COMMITTEE_KEY).toEqual(
      expect.arrayContaining(['committees:manage', 'committees:approve', 'committees:edit_details', 'committees:manage_tasks', 'workflows:view']),
    );
    expect(EVERY_COMMITTEE_KEY).not.toContain(WORKFLOWS_PERMISSIONS.MANAGE);
  });

  it.each(STAGE_WRITES)('%s refuses a non-admin holding every committee key', (handler) => {
    expect(() => guard.canActivate(context(handler, EVERY_COMMITTEE_KEY))).toThrow(ForbiddenException);
  });

  it.each(STAGE_WRITES)('%s admits workflows:manage — the same check as every workflow edit', (handler) => {
    expect(guard.canActivate(context(handler, [WORKFLOWS_PERMISSIONS.MANAGE]))).toBe(true);
  });

  it('reading the template (and its stage rules) needs workflows:view', () => {
    expect(guard.canActivate(context('getTemplateById', [WORKFLOWS_PERMISSIONS.VIEW]))).toBe(true);
    expect(() => guard.canActivate(context('getTemplateById', [...Object.values(COMMITTEES_PERMISSIONS)]))).toThrow(ForbiddenException);
  });
});
