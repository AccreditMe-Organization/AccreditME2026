import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ROLES_PERMISSIONS } from '../../common/constants/permissions';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RoleService } from './role.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { AssignPermissionsDto } from './dto/assign-permissions.dto';
import { AssignRoleDto } from './dto/assign-role.dto';
import { IRole } from './interfaces/role.interface';
import { IPermission } from './interfaces/permission.interface';

// No class-level route prefix — this controller serves both /roles and the
// temporary /users/:userId/roles* routes (see plan Commit 5 note: the latter
// live here only until Step 9's Users module exists to own them).
@Controller()
@UseGuards(TenantGuard, PermissionGuard)
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  // ── Roles ────────────────────────────────────────────────────────────────

  @Get('roles')
  @Permissions(ROLES_PERMISSIONS.VIEW)
  getRoles(@CurrentTenant() tenantId: string): Promise<IRole[]> {
    return this.roleService.getRoles(tenantId);
  }

  // Must be declared before 'roles/:id' — Nest matches routes in declaration
  // order and :id would otherwise swallow the literal 'permissions' segment.
  @Get('roles/permissions')
  @Permissions(ROLES_PERMISSIONS.VIEW)
  listAllPermissions(): Promise<IPermission[]> {
    return this.roleService.listAllPermissions();
  }

  @Get('roles/:id')
  @Permissions(ROLES_PERMISSIONS.VIEW)
  getRoleById(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
  ): Promise<IRole> {
    return this.roleService.getRoleById(id, tenantId);
  }

  @Post('roles')
  @Permissions(ROLES_PERMISSIONS.MANAGE)
  createRole(
    @Body() dto: CreateRoleDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<IRole> {
    return this.roleService.createRole(dto, tenantId, actorId);
  }

  @Patch('roles/:id')
  @Permissions(ROLES_PERMISSIONS.MANAGE)
  updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<IRole> {
    return this.roleService.updateRole(id, dto, tenantId, actorId);
  }

  @Patch('roles/:id/permissions')
  @Permissions(ROLES_PERMISSIONS.MANAGE)
  assignPermissions(
    @Param('id') id: string,
    @Body() dto: AssignPermissionsDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<IRole> {
    return this.roleService.assignPermissions(id, dto, tenantId, actorId);
  }

  @Post('roles/:id/deactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions(ROLES_PERMISSIONS.MANAGE)
  deactivateRole(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<void> {
    return this.roleService.deactivateRole(id, tenantId, actorId);
  }

  @Post('roles/:id/activate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions(ROLES_PERMISSIONS.MANAGE)
  reactivateRole(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<void> {
    return this.roleService.reactivateRole(id, tenantId, actorId);
  }

  // ── User ↔ Role assignment ─────────────────────────────────────────────────
  // Temporary home on RoleController — see note at the top of this file.

  @Get('users/:userId/roles')
  @Permissions(ROLES_PERMISSIONS.VIEW)
  getUserRoles(
    @Param('userId') userId: string,
    @CurrentTenant() tenantId: string,
  ): Promise<IRole[]> {
    return this.roleService.getUserRoles(userId, tenantId);
  }

  @Post('users/:userId/roles')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions(ROLES_PERMISSIONS.MANAGE)
  assignRoleToUser(
    @Param('userId') userId: string,
    @Body() dto: AssignRoleDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<void> {
    return this.roleService.assignRoleToUser(userId, dto, tenantId, actorId);
  }

  @Delete('users/:userId/roles/:roleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions(ROLES_PERMISSIONS.MANAGE)
  removeRoleFromUser(
    @Param('userId') userId: string,
    @Param('roleId') roleId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<void> {
    return this.roleService.removeRoleFromUser(userId, roleId, tenantId, actorId);
  }
}
