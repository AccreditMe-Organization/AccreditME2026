import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { IOrgUnit, IOrgUnitType } from './interfaces/org-unit.interface';
import { CreateOrgUnitDto } from './dto/create-org-unit.dto';
import { UpdateOrgUnitDto } from './dto/update-org-unit.dto';

// ACC-137 — the lookup category a unit's type comes from. Seeded as a SYSTEM
// category (organizationId null) and extensible, so a tenant may add its own
// values beside the six shipped ones — the seed already does, with `ward` for
// the hospital and `faculty`/`school`/`program`/`deanship` for the university.
const ORG_UNIT_TYPE_CATEGORY = 'org_unit_type';

// ACC-141 - the type reserved for the ROOT unit, and for nothing else.
//
// A root unit IS the organisation; every other value in org_unit_type names a
// part of one. The system sets this at bootstrap and there is no edit path, so
// it is never a choice anyone makes.
const ORGANIZATION_TYPE_KEY = 'organization';

@Injectable()
export class OrganizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async getTree(organizationId: string): Promise<IOrgUnit[]> {
    const all = await this.prisma.orgUnit.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
    });
    // ACC-137 — ONE resolver for the whole tree, not one lookup per unit. A
    // per-unit join would be a query per node on a hierarchy with no depth
    // limit; the type vocabulary is a handful of rows either way.
    const types = await this.buildTypeResolver(organizationId);
    return this.buildTree(all, null, types);
  }

  async listFlat(organizationId: string): Promise<IOrgUnit[]> {
    const units = await this.prisma.orgUnit.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
    });
    const types = await this.buildTypeResolver(organizationId);
    return units.map((u) => this.toInterface(u, types));
  }

  async findById(id: string, organizationId: string): Promise<IOrgUnit> {
    const unit = await this.prisma.orgUnit.findFirst({
      where: { id, organizationId },
    });
    if (!unit) throw new NotFoundException('Org unit not found');
    const types = await this.buildTypeResolver(organizationId);
    return this.toInterface(unit, types);
  }

  // ACC-40 Section 2.5 — a genuine resolver, not isInSameOrParentOrgUnit()
  // reused directly: that method is a validator (given one already-known
  // target, walk upward checking for equality); this one enumerates
  // candidates at a unit and only walks to the parent when that unit's own
  // candidate set is empty. Returns a pool (string[]), matching
  // resolveAssigneeRaw()'s established convention, not a single nullable
  // id. Placement confirmed here, not WorkflowService: this is a pure
  // org-structure query (User/OrgUnit only, never WorkflowStage/
  // WorkflowInstance) with two independent callers — plain vacancy
  // detection (this file) and, later, the workflow engine's ORG_UNIT_HEAD
  // assignee resolution (Phase 7) — WorkflowService calls into this
  // service for it, not the reverse.
  //
  // No special-case logic for an in-progress handover: during a declared
  // handover, the holders query below naturally returns both the outgoing
  // and incoming users, because both genuinely hold the position at that
  // moment (2.3). The pool is sized 1 in the normal case, 2 during a
  // handover, by construction.
  //
  // position.isActive: true is a deliberate extension beyond this
  // document's own original illustrative code for this method (which
  // showed no isActive filter at all) — added because it's the only way
  // OrgPositionService.deactivatePosition()'s refreshOrgUnitHeadVacancy()
  // wiring (2.5.1, Phase 6 commit 2) has any real effect: deactivating a
  // position never clears existing holders' positionId, so without this
  // filter a deactivated position's holder would still count as "the
  // Head" forever. Flagged here explicitly as a reasoned deviation, not a
  // silent one.
  async resolveActingHeadForOrgUnit(
    orgUnitId: string,
    organizationId: string,
  ): Promise<string[]> {
    let current: string | null = orgUnitId;
    while (current) {
      const holders = await this.prisma.user.findMany({
        where: {
          organizationId,
          primaryOrgUnitId: current,
          status: 'ACTIVE',
          position: { isUnitHeadPosition: true, isActive: true },
        },
        select: { id: true },
      });
      if (holders.length > 0) {
        return holders.map((h) => h.id);
      }

      const unit: { actingHeadUserId: string | null; parentId: string | null } | null =
        await this.prisma.orgUnit.findFirst({
          where: { id: current, organizationId },
          select: { actingHeadUserId: true, parentId: true },
        });
      if (!unit) return [];
      if (unit.actingHeadUserId) return [unit.actingHeadUserId];

      current = unit.parentId;
    }
    return [];
  }

  // ACC-40 Section 2.5 — entry-time check, mirroring
  // checkAndFlagUnassignedStage()'s exact role: whenever a change could
  // plausibly affect a unit's derived head-holder count, re-run the
  // holder query, update isHeadVacant/headVacantSince, and — only on a
  // genuine false→true transition — run the escalation walk once to set
  // isHeadFullyUnresolved. No-op (not a throw) when the unit doesn't
  // exist — this is a background-consistency helper, not a user-facing
  // action; a caller passing a stale/already-deleted id should not fail
  // the surrounding mutation it's attached to.
  //
  // ACC-82 — notifies no one. A vacant unit is a standing condition, not an
  // event: Setup health reads these flags and lists the unit until it has a
  // head (SYSTEM-REFERENCE §13.7). The first notification and its 2-day
  // reminders were removed with it, so headFullyUnresolvedLastRemindedAt is
  // no longer written; the column stays until a destructive-migration
  // cleanup.
  async refreshOrgUnitHeadVacancy(orgUnitId: string, organizationId: string): Promise<void> {
    const orgUnit = await this.prisma.orgUnit.findFirst({ where: { id: orgUnitId, organizationId } });
    if (!orgUnit) return;

    const directHolderCount = await this.prisma.user.count({
      where: {
        organizationId,
        primaryOrgUnitId: orgUnitId,
        status: 'ACTIVE',
        position: { isUnitHeadPosition: true, isActive: true },
      },
    });

    const isNowVacant = directHolderCount === 0 && !orgUnit.actingHeadUserId;
    if (isNowVacant === orgUnit.isHeadVacant) return; // no transition — the sweep handles ongoing drift, not this entry-time check

    if (!isNowVacant) {
      // Recovered — silent, same convention as sweepUnassignedStages()'s
      // own clear-on-recovery case.
      await this.prisma.orgUnit.update({
        where: { id: orgUnitId },
        data: {
          isHeadVacant: false,
          headVacantSince: null,
          isHeadFullyUnresolved: false,
        },
      });
      return;
    }

    // Newly vacant — run the escalation walk exactly once.
    const pool = await this.resolveActingHeadForOrgUnit(orgUnitId, organizationId);

    await this.prisma.orgUnit.update({
      where: { id: orgUnitId },
      data: {
        isHeadVacant: true,
        headVacantSince: new Date(),
        isHeadFullyUnresolved: pool.length === 0,
      },
    });
  }

  /**
   * The organization's existing root unit, if it has one — ACC-134.
   *
   * A tenant has exactly ONE root org unit (Ahmad, 27 Sep). `parentId` was a
   * plain nullable column with nothing stopping a second, and `update()`
   * explicitly supported creating one. Both entry points now ask this first.
   *
   * ## It counts ACTIVE roots only, and that is a decision, not an oversight
   *
   * The ticket says "exactly one root" without saying what an archived one is.
   * A deactivated unit keeps its row and its null `parentId`, so counting every
   * root would mean a deactivated root blocks a new one forever — and there is
   * NO reactivate method on this service, so nothing could undo it. That is an
   * unrecoverable state reachable by an ordinary action, which is worse than
   * the problem the constraint exists to prevent.
   *
   * Measured before choosing (`npm run verify:acc134-roots`, 28 Sep): 3
   * organizations, one root each, ZERO of them inactive. So this is a
   * forward-looking choice about a state that does not exist yet, not a
   * accommodation of existing data.
   *
   * Whatever database constraint follows MUST use the same predicate, or the
   * service and the index will disagree about what "one root" means.
   *
   * Scoped by organizationId — a root in another tenant must never be found
   * here, or one tenant's structure would refuse another tenant's write.
   */
  /**
   * ACC-135 — THIS DEFINITION IS DUPLICATED, AND THE TWO MUST CHANGE TOGETHER.
   *
   * `CommitteesService.resolveOwningOrgUnitId()` asks the same question — parentId
   * null, isActive true — because a committee created with no owning unit is given
   * the tenant's root. It queries directly rather than calling this, which is
   * private: sharing it would mean a fifth forwardRef() edge into this module's DI
   * graph, where every existing edge carries a comment about the real `nest start`
   * failure that proved it necessary. Four lines of query cost less than a
   * boot-proving cycle, and the cost of that choice is this note.
   *
   * The two are NOT identical, deliberately. This one orders by createdAt and
   * takes the first, which is right for its own question — "is there already a
   * root" only needs to know that one exists. The committee resolver REFUSES on
   * two, because there the answer becomes a real owner written onto a real record,
   * and ACC-134 says a tenant has exactly one root: two is a violation of that
   * invariant, not a tie to break.
   */
  private async findActiveRoot(
    organizationId: string,
    excludeUnitId?: string,
  ): Promise<{ id: string; nameEn: string; code: string } | null> {
    return this.prisma.orgUnit.findFirst({
      where: {
        organizationId,
        parentId: null,
        isActive: true,
        ...(excludeUnitId ? { id: { not: excludeUnitId } } : {}),
      },
      select: { id: true, nameEn: true, code: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * The refusal, naming the root that is already there — ACC-134 acceptance.
   *
   * "The refusal names the existing root rather than reporting a constraint
   * error." A bare 500 from a unique index tells the caller nothing about what
   * to do next; the name and code tell them the parent they probably meant.
   */
  private rootAlreadyExists(root: { nameEn: string; code: string }): ConflictException {
    return new ConflictException(
      `This organization already has a root unit: "${root.nameEn}" (${root.code}). ` +
        'An org unit with no parent would be a second root, which is not allowed. ' +
        'Choose a parent unit instead.',
    );
  }

  /**
   * The org_unit_type values visible to a tenant, by value id — ACC-137.
   *
   * ## Why this is not `LookupService.getValues()`
   *
   * `getValues()` is the SELECTION list: it drops hidden values and inactive
   * ones, which is right for a picker and wrong here. A unit that already holds
   * a value the admin has since hidden must keep rendering its type, marked as
   * retired — an acceptance criterion, and the alternative is a type silently
   * vanishing from a column because someone tidied the Lookups page, which reads
   * as data loss.
   *
   * So this resolves the same TWO LAYERS by the same rules, and keeps what
   * `getValues()` discards:
   *
   *   - a SYSTEM value (organizationId null) is visible to every tenant;
   *   - a tenant row with the same key OVERRIDES its labels, and the id stays
   *     the SYSTEM row's, which is why the foreign key works for both layers;
   *   - a tenant row with a different key is that tenant's own value;
   *   - hidden or deactivated marks `isRetired` instead of removing the entry.
   *
   * One query per read, not per unit — the caller resolves the whole tree from
   * this map.
   */
  private async buildTypeResolver(
    organizationId: string,
  ): Promise<Map<string, IOrgUnitType>> {
    const category = await this.prisma.lookupCategory.findFirst({
      where: { key: ORG_UNIT_TYPE_CATEGORY, organizationId: null },
      select: { id: true },
    });
    if (!category) return new Map();

    const rows = await this.prisma.lookupValue.findMany({
      where: {
        categoryId: category.id,
        OR: [{ organizationId: null }, { organizationId }],
      },
    });

    const tenantByKey = new Map(
      rows.filter((r) => r.organizationId === organizationId).map((r) => [r.key, r]),
    );

    const resolved = new Map<string, IOrgUnitType>();
    for (const row of rows) {
      if (row.organizationId === null) {
        const override = tenantByKey.get(row.key);
        resolved.set(row.id, {
          id: row.id,
          key: row.key,
          labelEn: override?.labelOverrideEn ?? row.labelEn,
          labelAr: override?.labelOverrideAr ?? row.labelAr,
          isRetired: !row.isActive || (override ? override.isHidden || !override.isActive : false),
        });
      } else {
        resolved.set(row.id, {
          id: row.id,
          key: row.key,
          labelEn: row.labelOverrideEn ?? row.labelEn,
          labelAr: row.labelOverrideAr ?? row.labelAr,
          isRetired: !row.isActive || row.isHidden,
        });
      }
    }
    return resolved;
  }

  /**
   * Validate a `typeValueId` for WRITING, and return the value — ACC-137.
   *
   * Stricter than the read resolver on purpose: a retired value still RENDERS on
   * a unit that holds it, but must not be newly CHOSEN. Selecting a value the
   * tenant has just hidden would re-introduce it through a side door.
   *
   * The tenant scoping is the part worth stating. A value is acceptable when it
   * is SYSTEM (`organizationId` null, shared by every tenant) OR belongs to this
   * tenant. `ward` and `faculty` are real TENANT-layer values in the seed, so a
   * check that only compared KEYS, or that ignored `organizationId`, would let
   * one tenant's private type be set on another tenant's unit.
   */
  private async resolveTypeValueForWrite(
    typeValueId: string,
    organizationId: string,
  ): Promise<IOrgUnitType> {
    const resolver = await this.buildTypeResolver(organizationId);
    const value = resolver.get(typeValueId);

    if (!value || value.isRetired) {
      throw new NotFoundException(
        `Unit type '${typeValueId}' is not an available ${ORG_UNIT_TYPE_CATEGORY} value in this organization`,
      );
    }
    return value;
  }

  async create(
    organizationId: string,
    dto: CreateOrgUnitDto,
    actorId: string,
  ): Promise<IOrgUnit> {
    if (dto.parentId) {
      const parent = await this.prisma.orgUnit.findFirst({
        where: { id: dto.parentId, organizationId },
      });
      if (!parent) throw new NotFoundException('Parent org unit not found');
    } else {
      // ACC-134 — no parent means this would be a root. Refuse if one exists.
      const root = await this.findActiveRoot(organizationId);
      if (root) throw this.rootAlreadyExists(root);
    }

    const existing = await this.prisma.orgUnit.findFirst({
      where: { organizationId, code: dto.code },
    });
    if (existing) {
      throw new ConflictException(`Code "${dto.code}" is already in use in this organization`);
    }

    // ACC-137 — required, and validated against this tenant's own available
    // values. The DTO makes it mandatory; this makes it MEAN something.
    const typeValue = await this.resolveTypeValueForWrite(dto.typeValueId, organizationId);

    // ACC-141 rule 3 - UNCONDITIONAL HERE, and asymmetric with update() on
    // purpose. The next reader will wonder why create() does not ask whether
    // this is the root and update() does, so: ACC-134 already forbids a second
    // root, and bootstrap() creates the only one by writing Prisma directly.
    // So EVERY unit created through this API is non-root by construction, and
    // `organization` is simply never valid on POST - there is no root to detect.
    //
    // Verified in a browser, not inferred: a create with no parentId is refused
    // by ACC-134's guard with "This organization already has a root unit", so
    // the parentless path cannot reach here at all.
    if (typeValue.key === ORGANIZATION_TYPE_KEY) {
      throw new ConflictException(
        `"${typeValue.labelEn}" is reserved for the organization's root unit and cannot be ` +
          'set on any other unit. Choose the type that describes this part of the organization.',
      );
    }

    const unit = await this.prisma.orgUnit.create({
      data: {
        organizationId,
        parentId: dto.parentId ?? null,
        nameEn: dto.nameEn,
        nameAr: dto.nameAr ?? null,
        code: dto.code,
        // ACC-137 — BOTH shapes are written, deliberately. `type` is the legacy
        // free-text column and the container running the old code still selects
        // it; writing only `typeValueId` would leave rows this deploy created
        // looking untyped to the deployment still serving. Expand then contract
        // (ACC-127): write both, drop `type` once nothing reads it. The key is
        // taken from the resolved value, so the two cannot disagree.
        type: typeValue.key,
        typeValueId: typeValue.id,
        description: dto.description ?? null,
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'CREATE',
      objectType: 'OrgUnit',
      objectId: unit.id,
      after: this.toInterface(unit) as unknown as Record<string, unknown>,
    });

    return this.toInterface(unit);
  }

  async update(
    id: string,
    organizationId: string,
    dto: UpdateOrgUnitDto,
    actorId: string,
  ): Promise<IOrgUnit> {
    const unit = await this.prisma.orgUnit.findFirst({
      where: { id, organizationId },
    });
    if (!unit) throw new NotFoundException('Org unit not found');

    // Code is permanently locked once a document number has been generated using it
    if (dto.code !== undefined && dto.code !== unit.code && unit.isCodeLocked) {
      throw new ForbiddenException(
        'Unit code is locked and cannot be changed after document numbers have been generated using it',
      );
    }

    // Validate code uniqueness if changing it
    if (dto.code !== undefined && dto.code !== unit.code) {
      const conflict = await this.prisma.orgUnit.findFirst({
        where: { organizationId, code: dto.code, id: { not: id } },
      });
      if (conflict) {
        throw new ConflictException(`Code "${dto.code}" is already in use in this organization`);
      }
    }

    // Setting parentId to another unit moves it in the hierarchy.
    //
    // ACC-134 — setting parentId to NULL no longer promotes the unit to root
    // level. This comment used to read "promotes the unit to root level —
    // intentional", and it was: the service deliberately supported a second
    // root. A tenant now has exactly one, so the path is refused rather than
    // removed, because callers still send it and a silent no-op would be worse
    // than a stated refusal.
    //
    // Promoting the unit that is ALREADY the root is not a second root, so it
    // stays allowed — the exclusion below is what makes the write idempotent
    // instead of a unit being unable to re-save its own unchanged parent.
    if (dto.parentId !== undefined && dto.parentId !== null) {
      if (dto.parentId === id) {
        throw new ConflictException('An org unit cannot be its own parent');
      }
      const parent = await this.prisma.orgUnit.findFirst({
        where: { id: dto.parentId, organizationId },
      });
      if (!parent) throw new NotFoundException('Parent org unit not found');
    } else if (dto.parentId === null) {
      const root = await this.findActiveRoot(organizationId, id);
      if (root) throw this.rootAlreadyExists(root);
    }

    // ACC-137 — validated only when supplied. An edit that does not mention the
    // type must not have to resend it, and must not silently clear it: the type
    // is required to CREATE a unit, not required in every PATCH body.
    const updatedType =
      dto.typeValueId !== undefined
        ? await this.resolveTypeValueForWrite(dto.typeValueId, organizationId)
        : null;

    // ACC-141 - the two rules that need to know whether this unit is the root,
    // which is why update() asks and create() does not.
    if (updatedType) {
      const isRoot = unit.parentId === null;

      if (isRoot && updatedType.id !== unit.typeValueId) {
        // RULE 2 - the root's type is system-set and FIXED. Not a default that
        // can be changed: there is no edit path at all. A root unit is the
        // organisation, so the value is structurally determined and there is no
        // judgement for anyone to exercise.
        //
        // Re-saving the SAME value is allowed, so a form that round-trips every
        // field is not refused for changing nothing.
        throw new ConflictException(
          "The root unit's type is set by the system and cannot be changed. " +
            'It is the organization itself, not a part of it.',
        );
      }

      if (!isRoot && updatedType.key === ORGANIZATION_TYPE_KEY) {
        // RULE 3 on the update path, where a root DOES have to be detected -
        // unlike create(), a non-root unit already exists and can be edited.
        throw new ConflictException(
          `"${updatedType.labelEn}" is reserved for the organization's root unit and cannot be ` +
            'set on any other unit. Choose the type that describes this part of the organization.',
        );
      }
    }

    const types = await this.buildTypeResolver(organizationId);
    const before = this.toInterface(unit, types);

    const updated = await this.prisma.orgUnit.update({
      where: { id },
      data: {
        ...(dto.nameEn !== undefined && { nameEn: dto.nameEn }),
        ...(dto.nameAr !== undefined && { nameAr: dto.nameAr }),
        ...(dto.code !== undefined && { code: dto.code }),
        // ACC-137 — both shapes again, from the resolved value, so `type` and
        // `typeValueId` can never drift apart on an edit.
        ...(updatedType ? { type: updatedType.key, typeValueId: updatedType.id } : {}),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        ...(dto.parentId !== undefined && { parentId: dto.parentId }),
      },
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'OrgUnit',
      objectId: id,
      before: before as unknown as Record<string, unknown>,
      after: this.toInterface(updated, types) as unknown as Record<string, unknown>,
    });

    return this.toInterface(updated, types);
  }

  async deactivate(
    id: string,
    organizationId: string,
    actorId: string,
  ): Promise<IOrgUnit> {
    const unit = await this.prisma.orgUnit.findFirst({
      where: { id, organizationId },
    });
    if (!unit) throw new NotFoundException('Org unit not found');

    // Idempotent — already inactive
    if (!unit.isActive) return this.toInterface(unit);

    const blockers: string[] = [];

    // Check active child org units (available now — same module)
    const activeChildren = await this.prisma.orgUnit.count({
      where: { parentId: id, organizationId, isActive: true },
    });
    if (activeChildren > 0) {
      blockers.push(`${activeChildren} active child unit(s) must be deactivated first`);
    }

    // Users shipped at ACC-12 — this blocker is no longer deferred.
    const activeUsers = await this.prisma.user.count({
      where: { primaryOrgUnitId: id, organizationId, status: 'ACTIVE' },
    });
    if (activeUsers > 0) blockers.push(`${activeUsers} active user(s) are assigned to this unit`);

    // ACC-135 — ships with the relation that made it possible, not after it.
    //
    // The TODOs below are deferred because those tables do not exist. Committee
    // does, and Committee.orgUnitId is required in meaning, so deactivating a unit
    // that still owns active committees would leave them owned by a unit nobody
    // can reach. Same shape as the active-users blocker directly above.
    const activeCommittees = await this.prisma.committee.count({
      where: { orgUnitId: id, organizationId, isActive: true },
    });
    if (activeCommittees > 0) {
      blockers.push(`${activeCommittees} active committee(s) are owned by this unit`);
    }

    // TODO(Step 17 — Documents): check for active documents owned by this org unit
    // const activeDocs = await this.prisma.document.count({
    //   where: { ownerOrgUnitId: id, organizationId, status: { not: 'OBSOLETE' } },
    // });
    // if (activeDocs > 0) blockers.push(`${activeDocs} active document(s) are owned by this unit`);

    // TODO(Step 18 — Quality Improvement): check for open incidents referencing this org unit
    // const openIncidents = await this.prisma.incident.count({
    //   where: { orgUnitId: id, organizationId, status: { not: 'CLOSED' } },
    // });
    // if (openIncidents > 0) blockers.push(`${openIncidents} open incident(s) reference this unit`);

    // TODO(Step 6 — Workflow): check for active workflow instances in this org unit
    // const activeWorkflows = await this.prisma.workflowInstance.count({
    //   where: { orgUnitId: id, organizationId, status: { in: ['PENDING', 'IN_PROGRESS'] } },
    // });
    // if (activeWorkflows > 0) blockers.push(`${activeWorkflows} active workflow instance(s) are running in this unit`);

    if (blockers.length > 0) {
      throw new ConflictException({
        message: 'Cannot deactivate org unit — active dependencies exist',
        blockers,
      });
    }

    const before = this.toInterface(unit);

    const updated = await this.prisma.orgUnit.update({
      where: { id },
      data: { isActive: false },
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'OrgUnit',
      objectId: id,
      before: before as unknown as Record<string, unknown>,
      after: this.toInterface(updated) as unknown as Record<string, unknown>,
    });

    return this.toInterface(updated);
  }

  // Used by TenantService.bootstrap() to seed the root org unit without injecting this service
  static generateCode(nameEn: string): string {
    return nameEn
      .toUpperCase()
      .replace(/[^A-Z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 10);
  }

  private buildTree(
    all: Array<{
      id: string; organizationId: string; parentId: string | null;
      nameEn: string; nameAr: string | null; code: string;
      type: string | null; typeValueId: string | null; description: string | null;
      isActive: boolean; isCodeLocked: boolean; sortOrder: number;
      createdAt: Date; updatedAt: Date;
    }>,
    parentId: string | null,
    types: Map<string, IOrgUnitType>,
  ): IOrgUnit[] {
    return all
      .filter((u) => u.parentId === parentId)
      .map((u) => ({
        ...this.toInterface(u, types),
        children: this.buildTree(all, u.id, types),
      }));
  }

  private toInterface(
    record: {
      id: string; organizationId: string; parentId: string | null;
      nameEn: string; nameAr: string | null; code: string;
      type: string | null; typeValueId: string | null; description: string | null;
      isActive: boolean; isCodeLocked: boolean; sortOrder: number;
      createdAt: Date; updatedAt: Date;
    },
    // ACC-137 — defaulted so every existing caller keeps compiling and simply
    // gets an unresolved type. A REQUIRED parameter would have been the tidier
    // signature and the wrong trade: it turns "this read forgot to resolve" into
    // a compile error at dozens of call sites that do not care, and the failure
    // it prevents is visible the moment anything renders a type.
    types: Map<string, IOrgUnitType> = new Map(),
  ): IOrgUnit {
    return {
      id: record.id,
      organizationId: record.organizationId,
      parentId: record.parentId,
      nameEn: record.nameEn,
      nameAr: record.nameAr,
      code: record.code,
      type: record.type,
      typeValueId: record.typeValueId,
      typeValue: record.typeValueId ? (types.get(record.typeValueId) ?? null) : null,
      description: record.description,
      isActive: record.isActive,
      isCodeLocked: record.isCodeLocked,
      sortOrder: record.sortOrder,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
