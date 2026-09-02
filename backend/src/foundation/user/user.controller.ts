import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { USERS_PERMISSIONS, ROLES_PERMISSIONS } from '../../common/constants/permissions';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUserPermissions } from '../../common/decorators/current-user-permissions.decorator';
import { UserService, toSafeUser } from './user.service';
import { InviteUserDto } from './dto/invite-user.dto';
import { ValidateTransferReplacementDto } from './dto/validate-transfer-replacement.dto';
import { ValidateTransferPositionDto } from './dto/validate-transfer-position.dto';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { UpdateOutOfOfficeDto } from './dto/update-out-of-office.dto';
import { AssignRoleDto } from '../roles/dto/assign-role.dto';
import { IUser } from './interfaces/user.interface';
import { IRole } from '../roles/interfaces/role.interface';
import { ITransferContext } from './interfaces/transfer-context.interface';

@Controller('users')
@UseGuards(TenantGuard, PermissionGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @Permissions(USERS_PERMISSIONS.VIEW)
  async listUsers(
    @CurrentTenant() tenantId: string,
    @Query('status') status?: string,
    @Query('orgUnitId') orgUnitId?: string,
    @Query('search') search?: string,
  ): Promise<IUser[]> {
    // ACC-45 — mapped via toSafeUser() at this HTTP boundary; see its own
    // comment in user.service.ts for why this isn't baked into
    // UserService.listUsers() itself.
    const users = await this.userService.listUsers(tenantId, { status, orgUnitId, search });
    return users.map(toSafeUser);
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
  async getById(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
    @CurrentUserPermissions() actorPermissions: string[],
  ): Promise<IUser> {
    // ACC-45 — see listUsers() above.
    const user = await this.userService.getByIdForViewer(id, tenantId, actorId, actorPermissions);
    return toSafeUser(user);
  }

  @Post('invite')
  @Permissions(USERS_PERMISSIONS.INVITE)
  async invite(
    @Body() dto: InviteUserDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<IUser> {
    // ACC-45 — see listUsers() above. This is the endpoint the ticket was
    // originally filed against: invite()'s response previously included
    // the raw invitationToken needed to activate the invited account.
    const user = await this.userService.invite(dto, tenantId, actorId);
    return toSafeUser(user);
  }

  // No @Permissions() decorator here on purpose — self-service edits are
  // allowed without users:manage. The self-or-admin check happens inside
  // UserService (Section 12, Discussion 3), not via the decorator.
  @Patch(':id/profile')
  async updateProfile(
    @Param('id') id: string,
    @Body() dto: UpdateUserProfileDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
    @CurrentUserPermissions() actorPermissions: string[],
  ): Promise<IUser> {
    // ACC-45 — see listUsers() above. Confirmed, during the original ACC-45
    // audit, to have the same leak shape as invite()/listUsers()/getById()
    // (returns the raw prisma.user.update() result) — fixed here in the
    // same pass rather than left as a follow-up.
    const user = await this.userService.updateProfile(id, dto, tenantId, actorId, actorPermissions);
    return toSafeUser(user);
  }

  @Patch(':id/out-of-office')
  async updateOutOfOffice(
    @Param('id') id: string,
    @Body() dto: UpdateOutOfOfficeDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
    @CurrentUserPermissions() actorPermissions: string[],
  ): Promise<IUser> {
    // ACC-45 — see updateProfile() above.
    const user = await this.userService.updateOutOfOffice(id, dto, tenantId, actorId, actorPermissions);
    return toSafeUser(user);
  }

  // ACC-46 Section 2.6.b Step 2 — gated by users:transfer (not users:view):
  // this is wizard-specific pre-submission context (available positions,
  // current destination head), not a general viewing capability — only
  // someone who can actually perform a transfer needs it.
  @Get(':id/transfer/context')
  @Permissions(USERS_PERMISSIONS.TRANSFER)
  getTransferContext(
    @Param('id') id: string,
    @Query('destinationOrgUnitId') destinationOrgUnitId: string,
    @CurrentTenant() tenantId: string,
  ): Promise<ITransferContext> {
    return this.userService.getTransferContext(id, destinationOrgUnitId, tenantId);
  }

  // ACC-46 Section 2.6.b Step 3 — live gate before the wizard advances
  // past the conditional replacement step. 204 on success (a pure
  // pass/fail check, no body needed), or the specific ConflictException
  // thrown by UserService.validateTransferReplacement()/
  // validatePositionAssignment().
  @Post(':id/transfer/validate-replacement')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions(USERS_PERMISSIONS.TRANSFER)
  validateTransferReplacement(
    @Param('id') id: string,
    @Body() dto: ValidateTransferReplacementDto,
    @CurrentTenant() tenantId: string,
  ): Promise<void> {
    return this.userService.validateTransferReplacement(id, dto, tenantId);
  }

  // ACC-46 Section 2.6.b Step 4 — live gate before the wizard advances
  // past the (always-shown) destination position step. 204 on success, or
  // the specific ConflictException validatePositionAssignment() throws.
  @Post(':id/transfer/validate-position')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions(USERS_PERMISSIONS.TRANSFER)
  validateTransferPosition(
    @Param('id') id: string,
    @Body() dto: ValidateTransferPositionDto,
    @CurrentTenant() tenantId: string,
  ): Promise<void> {
    return this.userService.validateTransferPosition(id, dto, tenantId);
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
