import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  IPaginatedResponse,
  paginated,
} from '../../common/interfaces/paginated-response.interface';
import { SortWhitelist, toSkipTake } from '../../common/utils/sort-whitelist';
import { AuditLogService } from '../../common/services/audit-log.service';
import { Role as PrismaRole } from '../../../generated/prisma/client';
import { IRole } from './interfaces/role.interface';
import {
  IUserRoleGrant,
  resolveGrantSource,
} from './interfaces/user-role-grant.interface';
import { IPermission } from './interfaces/permission.interface';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { AssignPermissionsDto } from './dto/assign-permissions.dto';
import { AssignRoleDto } from './dto/assign-role.dto';
import { ALL_PERMISSIONS } from './permission.seed';
import { SYSTEM_ROLE_SEED } from './role.seed';
import {
  TENANT_ADMIN_KEY,
  assertTenantRetainsAnActiveAdministrator,
  captureAdministratorBaseline,
} from './tenant-administrator.invariant';

export interface ListRolesFilters {
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

// ACC-78 — the role list's sortable columns.
//
// BOTH bilingual names are sortable rather than one synthetic "name": the
// frontend picks nameEn or nameAr from the active language, so the sort matches
// what the reader is actually looking at. Collapsing them into one column would
// mean an Arabic user sorting by the English name.
//
// The fallback is COMPOUND — system roles first, then alphabetical — which is
// the existing behaviour and a real UX property, not an accident. A
// single-column fallback would have dropped the grouping silently.
//
// ACC-160 — nameAr can be NULL now that Arabic names are optional, and a role
// with no Arabic name sorts LAST in both directions (see SortWhitelist).
const ROLE_SORT = new SortWhitelist(
  ['nameEn', 'nameAr', 'key', 'isSystem', 'createdAt'] as const,
  { compound: [{ isSystem: 'desc' }, { nameEn: 'asc' }] },
  { nullsLast: ['nameAr'] },
);

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
  async getRoles(
    organizationId: string,
    filters?: ListRolesFilters,
  ): Promise<IPaginatedResponse<IRole>> {
    const { skip, take, page, pageSize } = toSkipTake(filters?.page, filters?.pageSize);

    // ACC-78 — the org lookup now runs FIRST rather than in parallel with the
    // roles query, because its answer has to go into the where clause.
    //
    // WHY THAT MATTERS, and it is a correctness bug pagination introduces
    // rather than a tidy-up: PLATFORM_ADMIN used to be excluded in application
    // code, AFTER the query. Under pagination that breaks twice over — a page
    // of 25 would return 24 rows whenever PLATFORM_ADMIN fell inside it, and
    // count() would include a role the caller can never see, so the paginator's
    // total and page count would both be wrong. A post-query filter and a
    // database-side count cannot agree. The exclusion has to be in the where.
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { isPlatformOrg: true },
    });

    // ACC-123 — both clauses go in `AND`, and that is not stylistic.
    //
    // They are each a disjunction, and a plain object can hold ONE `OR` key:
    // written as two spreads, the search clause silently REPLACES the
    // platform-role exclusion, so typing anything into the search box would
    // put PLATFORM_ADMIN back in an ordinary tenant's list. Two entries in
    // `AND` keep both conditions, and keep them independent.
    const where = {
      organizationId,
      AND: [
        // PLATFORM_ADMIN is visible only inside the platform org (ACC-13):
        // it is seeded into every tenant's Role table but is meaningful only
        // where PlatformGuard's isPlatformOrg check can pass. Expressed in the
        // where clause rather than after the query so findMany() and count()
        // cannot disagree about the total (ACC-78).
        //
        // THE `key: null` BRANCH IS LOAD-BEARING, and `{ key: { not: … } }`
        // alone was a real bug. A custom role has no key, and in SQL
        // `key <> 'PLATFORM_ADMIN'` is NULL rather than true for a NULL key,
        // so the row is not returned. Prisma does not add the null check for
        // you: both `key: { not: X }` and `NOT: { key: X }` were measured
        // against the dev database, and each returned the six system roles and
        // neither of the two custom ones.
        //
        // The effect was that EVERY tenant-created role was invisible on the
        // Roles screen — it read "1-6 of 6" for a tenant that had eight. It
        // arrived with the move into the where clause; the post-query filter
        // it replaced handled null correctly by accident.
        //
        // Found while verifying that a tenant can grant admin:access to a
        // custom role, which is this ticket's own decision 4 and was not
        // reachable through the UI at all.
        ...(org?.isPlatformOrg
          ? []
          : [{ OR: [{ key: null }, { key: { not: 'PLATFORM_ADMIN' } }] }]),
        // Bilingual search: BOTH names, because a role's Arabic name is not a
        // translation of a search term, it is the name an Arabic-speaking admin
        // knows it by. Searching only nameEn would make the Arabic UI's search
        // box quietly useless.
        ...(filters?.search
          ? [
              {
                OR: [
                  { nameEn: { contains: filters.search, mode: 'insensitive' as const } },
                  { nameAr: { contains: filters.search, mode: 'insensitive' as const } },
                ],
              },
            ]
          : []),
      ],
    };

    const [visibleRoles, total] = await Promise.all([
      this.prisma.role.findMany({
        where,
        orderBy: ROLE_SORT.resolve(filters?.sortBy, filters?.sortDir),
        skip,
        take,
      }),
      this.prisma.role.count({ where }),
    ]);

    // ACC-74 — ONE grouped query for every role's count, not one query per
    // role. attachPermissions() already exists and would have been the
    // shorter route, but it is the wrong shape twice over: it is an N+1
    // (one findMany per role), and it returns the full permission set when
    // the list renders only a number — 70 strings for Organization
    // Administrator to display "70".
    //
    // The N+1 would be invisible at today's 7 roles, which is exactly when a
    // bad shape gets established and copied. Grouped is the same information
    // in one round trip regardless of role count.
    //
    // Scoped implicitly but safely: roleId is drawn from visibleRoles, which
    // is already filtered by organizationId above, so this cannot count a
    // RolePermission belonging to another tenant's role.
    //
    // ACC-78 — now counts for ONE PAGE of roles rather than all of them, which
    // is strictly less work; the grouped shape is what makes that automatic.
    // An empty page skips the query entirely: `roleId: { in: [] }` is a
    // guaranteed-empty result that still costs a round trip.
    const counts =
      visibleRoles.length > 0
        ? await this.prisma.rolePermission.groupBy({
            by: ['roleId'],
            where: { roleId: { in: visibleRoles.map((r) => r.id) } },
            _count: { roleId: true },
          })
        : [];
    const countByRoleId = new Map(counts.map((c) => [c.roleId, c._count.roleId]));

    // ACC-120 — how many people hold each role AND can actually sign in.
    //
    // Same grouped shape as the permission count above, and added for the same
    // reason: a screen needs a number, so the number is what the list sends.
    // What needs it is the Manage roles dialog, which must render the root
    // role's row as locked for its LAST ACTIVE HOLDER rather than offering a
    // checkbox whose save the server will refuse — the dead-Next-button shape.
    //
    // ACTIVE, with the join, matching countActiveAdministrators() exactly. A
    // raw assignment count here would tell the dialog a deactivated user still
    // covers the tenant, and the dialog would then offer the one removal that
    // locks everyone out.
    const holderCounts =
      visibleRoles.length > 0
        ? await this.prisma.userRole.groupBy({
            by: ['roleId'],
            where: {
              roleId: { in: visibleRoles.map((r) => r.id) },
              user: { organizationId, status: 'ACTIVE' },
            },
            _count: { roleId: true },
          })
        : [];
    const holdersByRoleId = new Map(holderCounts.map((c) => [c.roleId, c._count.roleId]));

    const data = visibleRoles.map((r) => ({
      ...this.mapRole(r),
      // 0 rather than undefined: a role with no permissions is a real answer,
      // and the frontend must be able to tell it from "not loaded".
      permissionCount: countByRoleId.get(r.id) ?? 0,
      activeHolderCount: holdersByRoleId.get(r.id) ?? 0,
    }));

    return paginated(data, total, page, pageSize);
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

    // ACC-120 — the local assignment count that stood here is gone. It asked
    // `userRole.count({ roleId })` with no join to User, so a tenant whose only
    // administrator had been deactivated passed it, and a tenant with a real
    // administrator was refused for the same reason — the two cases were
    // indistinguishable to it.
    await this.prisma.$transaction(async (tx) => {
      const baseline = await captureAdministratorBaseline(organizationId, tx);
      await tx.role.update({ where: { id }, data: { isActive: false } });
      await assertTenantRetainsAnActiveAdministrator(organizationId, tx, baseline);
    });

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

    // ACC-120 — THE TENANT'S ROOT ROLE HAS A FROZEN PERMISSION SET.
    //
    // This method had no guard of any kind, and it is the shortest path to a
    // locked-out tenant in the product: the two lines below delete every
    // permission on the role and write back whatever was sent, so ONE call
    // with an empty `permissionKeys` emptied Organization Administrator. Role
    // intact, assignments intact, both of the old last-admin checks satisfied,
    // and nobody able to administer anything. No custom role required.
    //
    // The holder invariant cannot catch it — the holders are all still there,
    // holding a role that now grants nothing — which is why this is a separate
    // refusal rather than another call to the assertion.
    //
    // CAPABILITY IS FROZEN, THE LABEL IS NOT. `updateRole()` is deliberately
    // left alone: renaming this role to "System Owner" removes no capability,
    // and blocking a rename would reverse the 30 September decision that system
    // roles are tenant-editable for zero safety gain. See CLAUDE.md's
    // Permission System section, where this is written as the single stated
    // exception to that rule rather than a role that mysteriously will not save.
    if (role.key === TENANT_ADMIN_KEY) {
      throw new ConflictException(
        'The Organization Administrator role has a fixed permission set and cannot be ' +
          'changed. Its name and description are editable, and other roles can be given ' +
          'any permissions you choose.',
      );
    }

    const permissionIds = await this.resolvePermissionIds(dto.permissionKeys);

    // ACC-120 — one transaction, which these two writes never had. A failure
    // between them left the role with NO permissions at all: the delete had
    // committed and the write had not.
    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      if (permissionIds.length > 0) {
        await tx.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
        });
      }
    });

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

  // Returns the GRANT, not just the role (ACC-120). See IUserRoleGrant for what
  // the old IRole[] shape cost — in short, a derived grant was indistinguishable
  // from a direct one, and the createdAt it did return was the role's.
  //
  // Tenant-scoped on BOTH sides: `user: { organizationId }` as well as
  // `role: { organizationId }`. The role side alone already made a cross-tenant
  // read impossible in practice — a foreign user cannot hold a row pointing at
  // this tenant's role — but relying on that is reasoning about data rather than
  // scoping the query, which is what CLAUDE.md's rule asks for.
  async getUserRoles(userId: string, organizationId: string): Promise<IUserRoleGrant[]> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId, user: { organizationId }, role: { organizationId } },
      include: { role: true },
      orderBy: { createdAt: 'asc' },
    });
    return userRoles.map((ur) => ({
      id: ur.id,
      role: this.mapRole(ur.role),
      grantedAt: ur.createdAt,
      source: resolveGrantSource(
        ur.grantedViaHeadPositionId,
        ur.grantedViaHeadPositionOrgUnitId,
      ),
      grantedViaHeadPositionId: ur.grantedViaHeadPositionId,
      grantedViaHeadPositionOrgUnitId: ur.grantedViaHeadPositionOrgUnitId,
    }));
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
      where: { userId, roleId, user: { organizationId } },
    });
    if (!assignment) throw new NotFoundException('Role assignment not found');

    // ACC-120 — a HEAD-POSITION-DERIVED grant is not removable by hand.
    //
    // This endpoint deleted any matching row, including a derived one, and the
    // only thing standing in front of it was that no screen offered the button.
    // That is not a guard. revokeRoleViaHeadAuthority() keys on exactly these
    // two columns, so a hand-deleted row leaves the headship in place with the
    // role it confers gone, and the revoke that should later remove it finds
    // nothing — the headship and its roles silently disagree, with no error at
    // either end.
    //
    // Refused with the reason named, and with WHERE TO ACTUALLY END IT, because
    // "cannot be removed" without that leaves an admin to conclude the product
    // is broken. Same sentence the dialog shows; the dialog is the courtesy and
    // this is the rule.
    if (assignment.grantedViaHeadPositionId || assignment.grantedViaHeadPositionOrgUnitId) {
      throw new ConflictException(
        "This role comes with the user's head position and cannot be removed here. " +
          'End it by changing the head position itself.',
      );
    }

    // ACC-120 — was `userRole.count({ roleId }) <= 1`, counting rows rather
    // than people who can sign in. The invariant below replaces it and is
    // checked AFTER the delete, inside the transaction: "would this leave
    // nobody?" is a question about the state the commit would produce, and
    // asking it beforehand is how an off-by-one creeps in.
    await this.prisma.$transaction(async (tx) => {
      const baseline = await captureAdministratorBaseline(organizationId, tx);
      await tx.userRole.delete({ where: { id: assignment.id } });
      await assertTenantRetainsAnActiveAdministrator(organizationId, tx, baseline);
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'DELETE',
      objectType: 'UserRole',
      objectId: roleId,
      metadata: { userId, roleId },
    });
  }

  // ── Head-authority role inheritance (ACC-40 Section 2.6.5) ──────────────────
  //
  // Reuses UserRole directly — a real, temporary row, not a new
  // permission-computation path. getUserPermissions() below needs ZERO
  // changes to pick up a grant made here: it already unions permissions
  // across every UserRole row a user holds, and a new marked row
  // participates in that same union automatically the moment it's created.
  //
  // Two independent callers: UserService (real position-holding
  // assignment/removal) and OrgUnitHeadService (Acting Head assignment/end)
  // — one shared mechanism, not two separate implementations to keep in
  // sync (2.6.5's own framing).

  // Check-first-before-create is a hard requirement, not a nicety —
  // UserRole carries @@unique([userId, roleId]), so blindly creating a
  // second row for a roleId the user already independently holds (or
  // already holds via this exact mechanism) would throw a Prisma
  // unique-constraint violation, not silently succeed. If the user already
  // holds the role in ANY form (independent grant, or already granted via
  // this same mechanism), nothing is created and nothing gets (re-)marked
  // — critically, an independent grant is never overwritten/relabeled as
  // "granted via head authority," so a later revoke correctly leaves it
  // alone.
  // positionId is always required — a grant always originates from a
  // specific, real position (that's how its roleId was resolved in the
  // first place). orgUnitId is nullable — null specifically for an
  // org-wide (primaryOrgUnitId: null) head-conferring position, the one
  // case 2.1 itself calls "valid but inert." Both are stored on the row;
  // revokeRoleViaHeadAuthority() below picks whichever is the safe,
  // unambiguous key at revoke time.
  async grantRoleViaHeadAuthority(
    userId: string,
    roleId: string,
    positionId: string,
    orgUnitId: string | null,
    organizationId: string,
    actorId: string | null,
  ): Promise<void> {
    const existing = await this.prisma.userRole.findFirst({
      where: { userId, roleId, user: { organizationId } },
    });
    if (existing) return;

    await this.prisma.userRole.create({
      data: {
        userId,
        roleId,
        grantedViaHeadPositionId: positionId,
        grantedViaHeadPositionOrgUnitId: orgUnitId,
      },
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId: actorId ?? undefined,
      action: 'CREATE',
      objectType: 'UserRole',
      objectId: roleId,
      metadata: { userId, roleId, grantedViaHeadPositionId: positionId, grantedViaHeadPositionOrgUnitId: orgUnitId },
    });
  }

  // Matches on the marker (userId + one discriminator), not roleId —
  // deliberately simpler than the plan's own illustrative delete filter.
  // Under this codebase's actual usage, a given (userId, orgUnitId) pair
  // — or (userId, positionId) pair, for the org-wide case — can have at
  // most one row ever marked that way (each grant call targets one
  // resolved role at a time, and a unit's authority — real holder or
  // Acting Head — is never concurrently held two ways by the same
  // person; a user's own positionId is a single scalar field, so at most
  // one org-wide grant can ever exist for them at a time either), so the
  // marker alone unambiguously identifies "the row (if any) granted
  // because of this authority" — without requiring the caller to
  // re-derive which roleId was granted at grant time.
  //
  // orgUnitId, when non-null, is ALWAYS the revoke key — it's the safe,
  // always-correct choice for every unit-scoped grant (real holding in a
  // unit, or Acting Head, which is unit-scoped by construction — there is
  // no such thing as an "org-wide Acting Head" anywhere in this design).
  // positionId is the fallback key ONLY when orgUnitId is null — the
  // narrow org-wide real-position-holding case, the one case where
  // matching on orgUnitId would be unsafe (Prisma's equals:null would
  // also match ordinary, independently-held rows, which default to null
  // on both marker fields).
  async revokeRoleViaHeadAuthority(
    userId: string,
    orgUnitId: string | null,
    positionId: string | null,
    organizationId: string,
    actorId: string | null,
  ): Promise<void> {
    if (!orgUnitId && !positionId) return; // nothing to key off — should never happen given real callers

    const result = await this.prisma.userRole.deleteMany({
      where: orgUnitId
        ? { userId, grantedViaHeadPositionOrgUnitId: orgUnitId, user: { organizationId } }
        : { userId, grantedViaHeadPositionId: positionId as string, user: { organizationId } },
    });
    if (result.count === 0) return; // nothing was ever granted via this mechanism — silent no-op, no audit noise

    await this.auditLog.log({
      tenantId: organizationId,
      actorId: actorId ?? undefined,
      action: 'DELETE',
      objectType: 'UserRole',
      objectId: userId,
      metadata: orgUnitId
        ? { userId, grantedViaHeadPositionOrgUnitId: orgUnitId }
        : { userId, grantedViaHeadPositionId: positionId },
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
