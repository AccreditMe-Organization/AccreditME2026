import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import { PERMISSIONS_KEY } from '../../../common/decorators/permissions.decorator';
import { CommitteeChangeRequestsByCommitteeController, CommitteeChangeRequestsController } from './committee-change-request.controller';

// ACC-281 (Ahmad, 7 Nov) — the REAL PermissionGuard against the REAL route metadata.
//
// ACC-283 PR 2 — NO change request route carries a route permission any more.
// Reading, raising, editing, submitting and withdrawing: the service admits
// committees:view OR an active member (or, for reads, the committee's overseer).
// DECIDING (approve, return, reject), Approve now and the awaiting-decision list:
// the chain of authority decides who, in the service (committee-change-request.db-spec.ts
// and change-request-chain.db-spec.ts prove it on real rows). committees:approve
// decides nothing here.

type Ctl = typeof CommitteeChangeRequestsController | typeof CommitteeChangeRequestsByCommitteeController;

function context(controller: Ctl, handler: string, userPermissions: string[]): ExecutionContext {
  const fn = (controller.prototype as unknown as Record<string, () => unknown>)[handler];
  return {
    getHandler: () => fn,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ userPermissions }) }),
  } as unknown as ExecutionContext;
}

describe('Change request routes: who the guard admits (ACC-281)', () => {
  const guard = new PermissionGuard(new Reflector());
  const MEMBER_WITH_APPROVE = ['committees:approve', 'committees:edit_details'];

  it.each(['approve', 'returnForChanges', 'reject', 'approveNow', 'awaitingDecision'])(
    '%s: no route permission; the guard admits anyone, holder of committees:approve or not (the chain decides)',
    (handler) => {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, CommitteeChangeRequestsController.prototype[handler as 'approve'])).toBeUndefined();
      expect(guard.canActivate(context(CommitteeChangeRequestsController, handler, MEMBER_WITH_APPROVE))).toBe(true);
      expect(guard.canActivate(context(CommitteeChangeRequestsController, handler, []))).toBe(true);
    },
  );

  it.each([
    [CommitteeChangeRequestsByCommitteeController, 'list'],
    [CommitteeChangeRequestsByCommitteeController, 'open'],
    [CommitteeChangeRequestsByCommitteeController, 'preview'],
    [CommitteeChangeRequestsByCommitteeController, 'create'],
    [CommitteeChangeRequestsController, 'getOne'],
    [CommitteeChangeRequestsController, 'update'],
    [CommitteeChangeRequestsController, 'submit'],
    [CommitteeChangeRequestsController, 'withdraw'],
  ] as const)('%p.%s carries no route permission: the service decides view OR member', (controller, handler) => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, (controller.prototype as unknown as Record<string, () => unknown>)[handler]!)).toBeUndefined();
    expect(guard.canActivate(context(controller, handler, []))).toBe(true);
  });
});
