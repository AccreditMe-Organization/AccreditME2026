import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import { PERMISSIONS_KEY } from '../../../common/decorators/permissions.decorator';
import { CommitteeChangeRequestsByCommitteeController, CommitteeChangeRequestsController } from './committee-change-request.controller';

// ACC-281 (Ahmad, 7 Nov) — the REAL PermissionGuard against the REAL route metadata.
//
// DECIDING a change request is NOT opened to members: approve, return, reject and
// the awaiting-decision list keep committees:view at the route, exactly as before.
// So a member who holds committees:approve but not committees:view is refused
// here, before the service is reached: the interim rule until ACC-283 gives the
// chain of authority the decision.
//
// Reading, raising, editing, submitting and withdrawing carry no route permission:
// the service admits committees:view OR an active member of the request's
// committee (committee-change-request.db-spec.ts proves it on real rows).

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

  it.each(['approve', 'returnForChanges', 'reject', 'awaitingDecision'])(
    '%s: a member holding committees:approve but not committees:view is refused; with committees:view the guard admits',
    (handler) => {
      expect(() => guard.canActivate(context(CommitteeChangeRequestsController, handler, MEMBER_WITH_APPROVE))).toThrow(
        new ForbiddenException('Required permission: committees:view'),
      );
      expect(guard.canActivate(context(CommitteeChangeRequestsController, handler, ['committees:view', 'committees:approve']))).toBe(true);
      expect(Reflect.getMetadata(PERMISSIONS_KEY, CommitteeChangeRequestsController.prototype[handler as 'approve'])).toEqual(['committees:view']);
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
