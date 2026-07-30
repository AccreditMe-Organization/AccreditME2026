import {
  Body,
  Controller,
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
import { IRole } from './interfaces/role.interface';
import { IPermission } from './interfaces/permission.interface';

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

  // No @Permissions() — every authenticated user can read their own
  // permission set (PermissionGuard no-ops when no metadata is present).
  // The frontend navigation shell's one-stop source for "what can I do"
  // (ACC-13) — reuses RoleService.getUserPermissions(), built earlier but
  // never exposed via a controller until now.
  @Get('roles/my-permissions')
  getMyPermissions(
    @CurrentUser() userId: string,
    @CurrentTenant() tenantId: string,
  ): Promise<string[]> {
    return this.roleService.getUserPermissions(userId, tenantId);
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
}
