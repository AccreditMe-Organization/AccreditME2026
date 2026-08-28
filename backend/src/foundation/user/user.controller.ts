import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { USERS_PERMISSIONS, ROLES_PERMISSIONS } from '../../common/constants/permissions';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUserPermissions } from '../../common/decorators/current-user-permissions.decorator';
import { UserService } from './user.service';
import { InviteUserDto } from './dto/invite-user.dto';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { UpdateOutOfOfficeDto } from './dto/update-out-of-office.dto';
import { AssignRoleDto } from '../roles/dto/assign-role.dto';
import { IUser } from './interfaces/user.interface';
import { IRole } from '../roles/interfaces/role.interface';

@Controller('users')
@UseGuards(TenantGuard, PermissionGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @Permissions(USERS_PERMISSIONS.VIEW)
  listUsers(
    @CurrentTenant() tenantId: string,
    @Query('status') status?: string,
    @Query('orgUnitId') orgUnitId?: string,
    @Query('search') search?: string,
  ): Promise<IUser[]> {
    return this.userService.listUsers(tenantId, { status, orgUnitId, search });
  }

  // ACC-43 — no @Permissions() decorator here on purpose, same reasoning
  // as updateProfile()/updateOutOfOffice() below: viewing your OWN profile
  // must never require users:view — every authenticated user already
  // self-edits this same record (name/language/MFA/out-of-office) with no
  // permission requirement at all, so gating the READ behind an admin-tier
  // permission was a genuine inconsistency, not a deliberate restriction.
  // The self-or-view check happens inside UserService.getByIdForViewer(),
  // not via the decorator — listUsers() above is unaffected and still
  // requires users:view, since browsing the full roster is a different,
  // genuinely admin-tier capability.
  @Get(':id')
  getById(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
    @CurrentUserPermissions() actorPermissions: string[],
  ): Promise<IUser> {
    return this.userService.getByIdForViewer(id, tenantId, actorId, actorPermissions);
  }

  @Post('invite')
  @Permissions(USERS_PERMISSIONS.INVITE)
  invite(
    @Body() dto: InviteUserDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<IUser> {
    return this.userService.invite(dto, tenantId, actorId);
  }

  // No @Permissions() decorator here on purpose — self-service edits are
  // allowed without users:manage. The self-or-admin check happens inside
  // UserService (Section 12, Discussion 3), not via the decorator.
  @Patch(':id/profile')
  updateProfile(
    @Param('id') id: string,
    @Body() dto: UpdateUserProfileDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
    @CurrentUserPermissions() actorPermissions: string[],
  ): Promise<IUser> {
    return this.userService.updateProfile(id, dto, tenantId, actorId, actorPermissions);
  }

  @Patch(':id/out-of-office')
  updateOutOfOffice(
    @Param('id') id: string,
    @Body() dto: UpdateOutOfOfficeDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
    @CurrentUserPermissions() actorPermissions: string[],
  ): Promise<IUser> {
    return this.userService.updateOutOfOffice(id, dto, tenantId, actorId, actorPermissions);
  }

  @Post(':id/deactivate')
  @Permissions(USERS_PERMISSIONS.DEACTIVATE)
  deactivate(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<{ reassignedCount: number; unassignedCount: number }> {
    return this.userService.deactivate(id, tenantId, actorId);
  }

  // ── Migrated from RoleController (Step 9) — same paths, same behavior ──

  @Get(':userId/roles')
  @Permissions(ROLES_PERMISSIONS.VIEW)
  getUserRoles(
    @Param('userId') userId: string,
    @CurrentTenant() tenantId: string,
  ): Promise<IRole[]> {
    return this.userService.getUserRoles(userId, tenantId);
  }

  @Post(':userId/roles')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions(ROLES_PERMISSIONS.MANAGE)
  assignRoleToUser(
    @Param('userId') userId: string,
    @Body() dto: AssignRoleDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<void> {
    return this.userService.assignRoleToUser(userId, dto, tenantId, actorId);
  }

  @Delete(':userId/roles/:roleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions(ROLES_PERMISSIONS.MANAGE)
  removeRoleFromUser(
    @Param('userId') userId: string,
    @Param('roleId') roleId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<void> {
    return this.userService.removeRoleFromUser(userId, roleId, tenantId, actorId);
  }
}
