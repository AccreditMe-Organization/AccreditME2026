import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { Role as PrismaRole } from '../../../generated/prisma/client';
import { IRole } from './interfaces/role.interface';
import { IPermission } from './interfaces/permission.interface';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { AssignPermissionsDto } from './dto/assign-permissions.dto';
import { AssignRoleDto } from './dto/assign-role.dto';
import { ALL_PERMISSIONS } from './permission.seed';
import { SYSTEM_ROLE_SEED } from './role.seed';

// Stable key identifying the tenant-admin system role — see Business Rules,
// "Admin lockout protection" in the Step 4 plan.
const TENANT_ADMIN_KEY = 'TENANT_ADMIN';

@Injectable()
export class RoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  // ── Seed ─────────────────────────────────────────────────────────────────────

  async seedPermissions(): Promise<void> {
    for (const p of ALL_PERMISSIONS) {
      await this.prisma.permission.upsert({
        where: { module_action: { module: p.module, action: p.action } },
        update: { description: p.description },
        create: { module: p.module, action: p.action, description: p.description },
      });
    }
  }

  async seedSystemRoles(organizationId: string): Promise<void> {
    await this.seedPermissions();

    const allPermissions = await this.prisma.permission.findMany();
    const permissionIdByKey = new Map(
      allPermissions.map((p) => [`${p.module}:${p.action}`, p.id]),
    );

    for (const seedRole of SYSTEM_ROLE_SEED) {
      const role = await this.prisma.role.upsert({
        where: { organizationId_key: { organizationId, key: seedRole.key } },
        update: {
          nameEn: seedRole.nameEn,
          nameAr: seedRole.nameAr,
          description: seedRole.description,
          isSystem: true,
        },
        create: {
          organizationId,
          key: seedRole.key,
          nameEn: seedRole.nameEn,
          nameAr: seedRole.nameAr,
          description: seedRole.description,
          isSystem: true,
        },
      });

      const permissionIds = seedRole.permissions
        .map((key) => permissionIdByKey.get(key))
        .filter((id): id is string => Boolean(id));

      await this.prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      if (permissionIds.length > 0) {
        await this.prisma.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })),
        });
      }
    }
  }

  // ── Roles ────────────────────────────────────────────────────────────────────

  // PLATFORM_ADMIN is filtered out for every non-platform org (ACC-13,
  // step-12-admin-portal.md Section 12, Pending Discussion #1) — it's seeded
  // into every tenant's own Role table (SYSTEM_ROLE_SEED), but only ever
  // meaningful for the one designated platform org (PlatformGuard checks
  // Organization.isPlatformOrg, not just role possession). Filtering it here
  // stops it from even appearing as a selectable option in an ordinary
  // tenant's role-assignment UI — PlatformGuard already closes the actual
  // security gap; this just removes the confusing dead option.
  async getRoles(organizationId: string): Promise<IRole[]> {
    const [roles, org] = await Promise.all([
      this.prisma.role.findMany({
        where: { organizationId },
        orderBy: [{ isSystem: 'desc' }, { nameEn: 'asc' }],
      }),
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { isPlatformOrg: true },
      }),
    ]);

    const visibleRoles = org?.isPlatformOrg
      ? roles
      : roles.filter((r) => r.key !== 'PLATFORM_ADMIN');

    return visibleRoles.map((r) => this.mapRole(r));
  }

  async getRoleById(id: string, organizationId: string): Promise<IRole> {
    const role = await this.prisma.role.findFirst({ where: { id, organizationId } });
    if (!role) throw new NotFoundException('Role not found');
    return this.attachPermissions(role);
  }

  async createRole(
    dto: CreateRoleDto,
    organizationId: string,
    actorId: string,
  ): Promise<IRole> {
    const existing = await this.prisma.role.findFirst({
      where: { organizationId, nameEn: dto.nameEn },
    });
    if (existing) {
      throw new ConflictException(`A role named '${dto.nameEn}' already exists`);
    }

    const permissionIds = dto.permissionKeys
      ? await this.resolvePermissionIds(dto.permissionKeys)
      : [];

    const role = await this.prisma.role.create({
      data: {
        organizationId,
        key: null,
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        description: dto.description ?? null,
        isSystem: false,
        isActive: true,
        ...(permissionIds.length > 0 && {
          rolePermissions: {
            createMany: { data: permissionIds.map((permissionId) => ({ permissionId })) },
          },
        }),
      },
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'CREATE',
      objectType: 'Role',
      objectId: role.id,
      after: {
        nameEn: role.nameEn,
        nameAr: role.nameAr,
        description: role.description,
        permissions: dto.permissionKeys ?? [],
      },
    });

    return this.attachPermissions(role);
  }

  async updateRole(
    id: string,
    dto: UpdateRoleDto,
    organizationId: string,
    actorId: string,
  ): Promise<IRole> {
    const role = await this.prisma.role.findFirst({ where: { id, organizationId } });
    if (!role) throw new NotFoundException('Role not found');

    if (dto.nameEn !== undefined && dto.nameEn !== role.nameEn) {
      const duplicate = await this.prisma.role.findFirst({
        where: { organizationId, nameEn: dto.nameEn, NOT: { id } },
      });
      if (duplicate) {
        throw new ConflictException(`A role named '${dto.nameEn}' already exists`);
      }
    }

    const updated = await this.prisma.role.update({
      where: { id },
      data: {
        ...(dto.nameEn !== undefined && { nameEn: dto.nameEn }),
        ...(dto.nameAr !== undefined && { nameAr: dto.nameAr }),
        ...(dto.description !== undefined && { description: dto.description }),
      },
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'Role',
      objectId: role.id,
      before: { nameEn: role.nameEn, nameAr: role.nameAr, description: role.description },
      after: { nameEn: updated.nameEn, nameAr: updated.nameAr, description: updated.description },
    });

    return this.attachPermissions(updated);
  }

  async deactivateRole(id: string, organizationId: string, actorId: string): Promise<void> {
    const role = await this.prisma.role.findFirst({ where: { id, organizationId } });
    if (!role) throw new NotFoundException('Role not found');
    if (!role.isActive) return;

    if (role.key === TENANT_ADMIN_KEY) {
      const assignmentCount = await this.prisma.userRole.count({ where: { roleId: role.id } });
      if (assignmentCount > 0) {
        throw new ConflictException(
          "This is the organization's only administrator role with active assignments and cannot be deactivated",
        );
      }
    }

    await this.prisma.role.update({ where: { id }, data: { isActive: false } });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'Role',
      objectId: role.id,
      before: { isActive: true },
      after: { isActive: false },
    });
  }

  async reactivateRole(id: string, organizationId: string, actorId: string): Promise<void> {
    const role = await this.prisma.role.findFirst({ where: { id, organizationId } });
    if (!role) throw new NotFoundException('Role not found');
    if (role.isActive) return;

    await this.prisma.role.update({ where: { id }, data: { isActive: true } });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'Role',
      objectId: role.id,
      before: { isActive: false },
      after: { isActive: true },
    });
  }

  async assignPermissions(
    roleId: string,
    dto: AssignPermissionsDto,
    organizationId: string,
    actorId: string,
  ): Promise<IRole> {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, organizationId },
    });
    if (!role) throw new NotFoundException('Role not found');

    const permissionIds = await this.resolvePermissionIds(dto.permissionKeys);

    await this.prisma.rolePermission.deleteMany({ where: { roleId } });
    if (permissionIds.length > 0) {
      await this.prisma.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
      });
    }

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'RolePermission',
      objectId: roleId,
      after: { permissions: dto.permissionKeys },
    });

    return this.attachPermissions(role);
  }

  // ── Permission catalog ───────────────────────────────────────────────────────

  async listAllPermissions(): Promise<IPermission[]> {
    const permissions = await this.prisma.permission.findMany({
      orderBy: [{ module: 'asc' }, { action: 'asc' }],
    });
    return permissions.map((p) => ({
      id: p.id,
      module: p.module,
      action: p.action,
      description: p.description,
    }));
  }

  // ── User ↔ Role assignment ───────────────────────────────────────────────────

  async getUserRoles(userId: string, organizationId: string): Promise<IRole[]> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId, role: { organizationId } },
      include: { role: true },
    });
    return userRoles.map((ur) => this.mapRole(ur.role));
  }

  async assignRoleToUser(
    userId: string,
    dto: AssignRoleDto,
    organizationId: string,
    actorId: string,
  ): Promise<void> {
    const role = await this.prisma.role.findFirst({
      where: { id: dto.roleId, organizationId },
    });
    if (!role) throw new NotFoundException('Role not found');

    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId },
    });
    if (!user) throw new NotFoundException('User not found');

    const existing = await this.prisma.userRole.findFirst({
      where: { userId, roleId: role.id },
    });
    if (existing) {
      throw new ConflictException('User is already assigned to this role');
    }

    await this.prisma.userRole.create({ data: { userId, roleId: role.id } });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'CREATE',
      objectType: 'UserRole',
      objectId: role.id,
      metadata: { userId, roleId: role.id },
    });
  }

  async removeRoleFromUser(
    userId: string,
    roleId: string,
    organizationId: string,
    actorId: string,
  ): Promise<void> {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, organizationId },
    });
    if (!role) throw new NotFoundException('Role not found');

    const assignment = await this.prisma.userRole.findFirst({
      where: { userId, roleId },
    });
    if (!assignment) throw new NotFoundException('Role assignment not found');

    if (role.key === TENANT_ADMIN_KEY) {
      const assignmentCount = await this.prisma.userRole.count({ where: { roleId } });
      if (assignmentCount <= 1) {
        throw new ConflictException(
          "This is the user's only administrator role and cannot be removed while they are the organization's last administrator",
        );
      }
    }

    await this.prisma.userRole.delete({ where: { id: assignment.id } });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'DELETE',
      objectType: 'UserRole',
      objectId: roleId,
      metadata: { userId, roleId },
    });
  }

  // ── Permission resolution — consumed by TenantGuard via PERMISSION_RESOLVER ──

  async getUserPermissions(userId: string, organizationId: string): Promise<string[]> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId, role: { isActive: true, organizationId } },
      include: {
        role: {
          include: {
            rolePermissions: { include: { permission: true } },
          },
        },
      },
    });

    const permissionSet = new Set<string>();
    for (const ur of userRoles) {
      for (const rp of ur.role.rolePermissions) {
        permissionSet.add(`${rp.permission.module}:${rp.permission.action}`);
      }
    }
    return Array.from(permissionSet);
  }

  // ── Internal helpers ─────────────────────────────────────────────────────────

  private async resolvePermissionIds(permissionKeys: string[]): Promise<string[]> {
    const pairs = permissionKeys.map((k) => {
      const [module, action] = k.split(':') as [string, string];
      return { module, action };
    });

    const permissions = await this.prisma.permission.findMany({
      where: { OR: pairs.map((p) => ({ module: p.module, action: p.action })) },
    });

    const foundKeys = new Set(permissions.map((p) => `${p.module}:${p.action}`));
    const unknown = permissionKeys.filter((k) => !foundKeys.has(k));

    if (unknown.length > 0) {
      throw new NotFoundException(`Unknown permission key(s): ${unknown.join(', ')}`);
    }

    return permissions.map((p) => p.id);
  }

  private async attachPermissions(role: PrismaRole): Promise<IRole> {
    const rolePermissions = await this.prisma.rolePermission.findMany({
      where: { roleId: role.id },
      include: { permission: true },
    });

    return {
      ...this.mapRole(role),
      permissions: rolePermissions.map(
        (rp) => `${rp.permission.module}:${rp.permission.action}`,
      ),
    };
  }

  private mapRole(role: PrismaRole): IRole {
    return {
      id: role.id,
      organizationId: role.organizationId,
      key: role.key,
      nameEn: role.nameEn,
      nameAr: role.nameAr,
      description: role.description,
      isSystem: role.isSystem,
      isActive: role.isActive,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }
}
