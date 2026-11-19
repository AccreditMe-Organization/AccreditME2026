import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import { CurrentTenant } from '../../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { CurrentUserPermissions } from '../../../common/decorators/current-user-permissions.decorator';
import { UserAccessHistoryService } from './user-access-history.service';
import { IUserAccessHistoryPage } from './user-access-history.interface';
import { UserAccessHistoryQueryDto } from '../dto/user-access-history-query.dto';

/**
 * ACC-216 part 2 — beside UserController under the same prefix, as
 * UserCommitteesController is. ':id' on UserController matches one segment, so
 * the two cannot clash.
 *
 * No @Permissions(), on purpose (GET /users/:id's precedent): yourself, or
 * users:view. The service checks it before any read (assertMayReadAccessHistory()).
 */
@Controller('users')
@UseGuards(TenantGuard, PermissionGuard)
export class UserAccessHistoryController {
  constructor(private readonly accessHistory: UserAccessHistoryService) {}

  @Get(':userId/access-history')
  getAccessHistory(
    @Param('userId') userId: string,
    @Query() query: UserAccessHistoryQueryDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
    @CurrentUserPermissions() actorPermissions: string[],
  ): Promise<IUserAccessHistoryPage> {
    return this.accessHistory.forUser(
      tenantId,
      { id: actorId, permissions: actorPermissions },
      userId,
      { skip: query.skip, take: query.take },
    );
  }
}
