import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ORG_PERMISSIONS, USERS_PERMISSIONS } from '../constants/permissions';
import {
  DelegationReasonValue,
  IResolvedDelegation,
} from './delegation-label.interface';

// One stamp as it sits in the database, before its contextId means anything
// to a reader. Accepted as a loose shape rather than a Prisma type because
// three different models carry the identical pair (TaskAssignee,
// WorkflowInstanceStage, WorkflowApproval) and this service resolves all
// three the same way.
export interface DelegationStamp {
  delegationReason: string | null;
  delegationContextId: string | null;
}

// ACC-101 — who is reading, for the entitlement check in resolveMany(). The id
// is needed as well as the permissions because a person may always be told who
// they are covering for.
export interface DelegationViewer {
  id: string;
  permissions: readonly string[];
}

// ACC-76 — resolves ACC-40 §2.6.3's delegation stamp to a displayable name.
//
// Provided by TenantModule alongside AuditLogService, so every module that
// already imports TenantModule (per CLAUDE.md's Foundation Outcomes) can
// inject it with no new module wiring. Both current consumers — TaskModule
// and WorkflowModule — already do.
@Injectable()
export class DelegationLabelService {
  constructor(private readonly prisma: PrismaService) {}

  // Batched deliberately: TWO queries at most, regardless of how many stamps
  // are passed in. The naive per-row alternative would issue one query per
  // assignee per task, and at ~110ms per round trip against the current
  // (Frankfurt) database that is the difference between a panel that loads
  // and one that visibly hangs.
  //
  // TENANT SCOPING: both lookups filter organizationId. A delegationContextId
  // is an opaque id with no tenant of its own, so an unscoped read here would
  // resolve another tenant's OrgUnit or User name — a cross-tenant leak of
  // exactly the kind CLAUDE.md calls business-ending. Covered by a dedicated
  // isolation test.
  // ACC-101 — WHO MAY SEE A QUALIFIER. A delegation label is not neutral
  // decoration: "covering for Ahmad" says a named colleague is absent, and
  // "Acting Head of Cardiology" says who currently holds a unit. Both were
  // shown to anyone who could read the list they hang off.
  //
  // The rule: a viewer sees a qualifier only if they could see the record it
  // names. The two reasons therefore take DIFFERENT permissions, because
  // delegationContextId is polymorphic:
  //   ACTING_HEAD            → an OrgUnit → org:view
  //   OUT_OF_OFFICE_COVERAGE → a User     → users:view, or being that person
  //
  // Suppression SKIPS THE LOOKUP rather than filtering after it, so an
  // unentitled viewer costs one query fewer, not one more.
  async resolveMany(
    stamps: readonly DelegationStamp[],
    organizationId: string,
    viewer: DelegationViewer,
  ): Promise<Map<string, IResolvedDelegation>> {
    const resolved = new Map<string, IResolvedDelegation>();

    const canSeeOrgUnits = viewer.permissions.includes(ORG_PERMISSIONS.VIEW);
    const canSeeUsers = viewer.permissions.includes(USERS_PERMISSIONS.VIEW);

    const orgUnitIds = new Set<string>();
    const userIds = new Set<string>();

    for (const stamp of stamps) {
      if (!stamp.delegationReason || !stamp.delegationContextId) continue;
      if (stamp.delegationReason === 'ACTING_HEAD') {
        if (canSeeOrgUnits) orgUnitIds.add(stamp.delegationContextId);
      } else if (stamp.delegationReason === 'OUT_OF_OFFICE_COVERAGE') {
        // Self is always allowed: a person may be told who they are covering
        // for, which is a fact about their own work.
        if (canSeeUsers || stamp.delegationContextId === viewer.id) {
          userIds.add(stamp.delegationContextId);
        }
      }
    }

    if (orgUnitIds.size === 0 && userIds.size === 0) return resolved;

    const [orgUnits, users] = await Promise.all([
      orgUnitIds.size > 0
        ? this.prisma.orgUnit.findMany({
            where: { id: { in: [...orgUnitIds] }, organizationId },
            select: { id: true, nameEn: true, nameAr: true },
          })
        : Promise.resolve([]),
      userIds.size > 0
        ? this.prisma.user.findMany({
            where: { id: { in: [...userIds] }, organizationId },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    for (const unit of orgUnits) {
      resolved.set(this.key('ACTING_HEAD', unit.id), {
        reason: 'ACTING_HEAD',
        contextId: unit.id,
        contextLabelEn: unit.nameEn,
        // OrgUnit.nameAr is nullable; fall back to the English name rather
        // than null, so an Arabic reader sees the unit rather than losing the
        // qualifier entirely.
        contextLabelAr: unit.nameAr ?? unit.nameEn,
      });
    }

    for (const user of users) {
      resolved.set(this.key('OUT_OF_OFFICE_COVERAGE', user.id), {
        reason: 'OUT_OF_OFFICE_COVERAGE',
        contextId: user.id,
        // A User has one `name`, so both fields carry it — see
        // IResolvedDelegation for why the pair stays uniform anyway.
        contextLabelEn: user.name,
        contextLabelAr: user.name,
      });
    }

    return resolved;
  }

  // Reads one stamp out of a resolveMany() result. Returns null both when the
  // row carries no stamp and when its contextId did not resolve within the
  // tenant — the caller renders no qualifier in either case, never a raw id.
  lookup(
    stamp: DelegationStamp,
    resolved: Map<string, IResolvedDelegation>,
  ): IResolvedDelegation | null {
    if (!stamp.delegationReason || !stamp.delegationContextId) return null;
    return (
      resolved.get(
        this.key(stamp.delegationReason as DelegationReasonValue, stamp.delegationContextId),
      ) ?? null
    );
  }

  private key(reason: DelegationReasonValue, contextId: string): string {
    return `${reason}:${contextId}`;
  }
}
