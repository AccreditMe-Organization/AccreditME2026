import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import { CurrentTenant } from '../../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { CurrentUserPermissions } from '../../../common/decorators/current-user-permissions.decorator';
import { UserCommitteesService } from './user-committees.service';
import { IUserCommittees } from './user-committees.interface';

/**
 * ACC-216 — GET /users/:userId/committees, beside UserController under the same
 * prefix. ':id' on UserController matches one segment, so the two cannot clash.
 *
 * No @Permissions(), on purpose (GET /users/:id's precedent): the rule is TWO
 * permissions, one of them waived for yourself, so the service checks both,
 * before any read (assertMayReadUserCommittees()). Nothing is added to a guard.
 */
@Controller('users')
@UseGuards(TenantGuard, PermissionGuard)
export class UserCommitteesController {
  constructor(private readonly userCommittees: UserCommitteesService) {}

  @Get(':userId/committees')
  getUserCommittees(
    @Param('userId') userId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
    @CurrentUserPermissions() actorPermissions: string[],
  ): Promise<IUserCommittees> {
    return this.userCommittees.forUser(tenantId, { id: actorId, permissions: actorPermissions }, userId);
  }
}
