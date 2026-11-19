import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { ROLES_PERMISSIONS, USERS_PERMISSIONS } from '../../../common/constants/permissions';
import { PrismaService } from '../../../prisma/prisma.service';
import { UserService } from '../user.service';
import {
  AccessHistoryField,
  AccessHistoryKind,
  IAccessHistoryActor,
  IAccessHistoryName,
  IAccessHistoryRow,
  IUserAccessHistoryPage,
} from './user-access-history.interface';

export const ACCESS_HISTORY_DEFAULT_TAKE = 5;
export const ACCESS_HISTORY_MAX_TAKE = 50;

/**
 * How far apart a transfer's audit row and its UserTransferEvent may be written.
 * transferUser() writes both within one request (the event inside transaction
 * #1, or after the head appointment; the audit row between), so seconds apart.
 */
export const TRANSFER_MATCH_WINDOW_MS = 10 * 60 * 1000;

export interface AccessHistoryViewer {
  id: string;
  permissions: readonly string[];
}

/**
 * ACC-216 — the gate, with NO query (ACC-101 clause a: the request names the
 * parent, a person). Yourself, or users:view: the rule GET /users/:id applies.
 * The refusal is a 403 naming the permission, checked before the person is
 * read, so it is the same for a real colleague and an invented id.
 *
 * There is no child permission to add: the rows are the person's own record.
 * The one child they name that has its own gate, a role, is named only with
 * roles:view (see `role` on IAccessHistoryRow).
 */
export function assertMayReadAccessHistory(viewer: AccessHistoryViewer, userId: string): void {
  if (viewer.id !== userId && !viewer.permissions.includes(USERS_PERMISSIONS.VIEW)) {
    throw new ForbiddenException(`Required permission: ${USERS_PERMISSIONS.VIEW}`);
  }
}

/**
 * The AuditLog rows that are this person's access history. Both shapes are
 * scoped by organisation:
 *   - objectType `User`, objectId = the person: the [objectType, objectId] index;
 *   - objectType `UserRole`, metadata.userId = the person: role grants and
 *     removals are written against the ROLE (objectId = roleId, role.service.ts),
 *     so the person is found in metadata. The objectType prefix of the same
 *     index narrows the scan to role rows.
 * LOGIN and LOGOUT are left out: a sign-in is not a change.
 */
export function accessHistoryWhere(organizationId: string, userId: string): Prisma.AuditLogWhereInput {
  return {
    organizationId,
    action: { notIn: ['LOGIN', 'LOGOUT'] },
    OR: [
      { objectType: 'User', objectId: userId },
      { objectType: 'UserRole', metadata: { path: ['userId'], equals: userId } },
    ],
  };
}

type Copy = Record<string, unknown>;

const asCopy = (value: Prisma.JsonValue | null | undefined): Copy | null =>
  value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value) ? (value as Copy) : null;

/** Each field the history names, with the stored User keys behind it. */
const FIELD_KEYS: ReadonlyArray<[AccessHistoryField, readonly string[]]> = [
  ['name', ['name']],
  ['language', ['language']],
  ['calendar', ['hijriDisplay']],
  ['position', ['positionId']],
  ['unit', ['primaryOrgUnitId']],
  ['manager', ['managerId']],
  ['actingUnit', ['actingOrgUnitId', 'actingOrgUnitUntil']],
  ['outOfOffice', ['outOfOfficeFrom', 'outOfOfficeTo']],
  ['cover', ['actingUserId']],
];

const OUT_OF_OFFICE_FIELDS: ReadonlySet<AccessHistoryField> = new Set(['outOfOffice', 'cover']);

/** Differs only when BOTH copies hold the key: a key one copy lacks is not a change. */
function differs(before: Copy, after: Copy, key: string): boolean {
  if (!(key in before) || !(key in after)) return false;
  return JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null);
}

/** `metadata.event` values, as the writers store them. */
const EVENT_KINDS: Readonly<Record<string, AccessHistoryKind>> = {
  invitation_accepted: 'INVITATION_ACCEPTED',
  deactivated: 'DEACTIVATED',
  reactivated: 'REACTIVATED',
  mfa_enabled: 'TWO_STEP_TURNED_ON',
  mfa_disabled: 'TWO_STEP_TURNED_OFF',
  mfa_reset: 'TWO_STEP_RESET',
  password_reset_requested: 'PASSWORD_RESET_REQUESTED',
  password_reset: 'PASSWORD_RESET',
};

export interface AccessRowInput {
  action: string;
  objectType: string;
  before: Prisma.JsonValue | null;
  after: Prisma.JsonValue | null;
  metadata: Prisma.JsonValue | null;
}

/** What a stored row says happened. Read from its copies; none of it is returned as is. */
export interface ClassifiedAccessRow {
  kind: AccessHistoryKind;
  fields?: AccessHistoryField[];
  /** UserRole rows: the role id on record, or null (a headship removal keyed by unit or position). */
  roleId?: string | null;
  viaHeadship?: boolean;
  /**
   * A plain edit that moved the unit or position: it may be a transfer's own
   * row. Matched to a UserTransferEvent by the service; unmatched, it stays an edit.
   */
  transferCandidate?: { fromUnitId: string | null; toUnitId: string | null };
}

/**
 * Every audit action written against a person, and its kind:
 *
 *   User CREATE                                 INVITED (UserService.invite)
 *   User DELETE, event invitation_revoked       INVITATION_REVOKED (revokeInvitation)
 *   User UPDATE, event invitation_accepted      INVITATION_ACCEPTED (AuthService)
 *   User UPDATE, event deactivated              DEACTIVATED (UserService.deactivate)
 *   User UPDATE, event reactivated              REACTIVATED (UserService.reactivate)
 *   User UPDATE, event mfa_enabled              TWO_STEP_TURNED_ON (AuthService)
 *   User UPDATE, event mfa_disabled             TWO_STEP_TURNED_OFF (AuthService, ACC-164)
 *   User UPDATE, event mfa_reset                TWO_STEP_RESET (UserMfaResetService, ACC-164)
 *   User UPDATE, event password_reset_requested PASSWORD_RESET_REQUESTED (ACC-188)
 *   User UPDATE, event password_reset           PASSWORD_RESET (ACC-188)
 *   User UPDATE, transferPromotionFailed        HEAD_APPOINTMENT_FAILED (transferUser; reason never returned)
 *   User UPDATE, before + after                 PROFILE_EDITED (updateProfile), OUT_OF_OFFICE_CHANGED
 *                                               (updateOutOfOffice: only out-of-office fields), or
 *                                               TRANSFERRED (transferUser: matched to its UserTransferEvent)
 *   User IMPERSONATE_START                      SIGNED_IN_AS (a platform administrator, ACC-13)
 *   User LOGIN / LOGOUT                         not listed (accessHistoryWhere)
 *   UserRole CREATE                             ROLE_GRANTED (by hand, or with a head position)
 *   UserRole DELETE                             ROLE_REMOVED (by hand, or with a head position)
 *   anything else                               CHANGED
 */
export function classifyAccessRow(row: AccessRowInput): ClassifiedAccessRow {
  const metadata = asCopy(row.metadata);
  if (row.objectType === 'UserRole') {
    const kind: AccessHistoryKind =
      row.action === 'CREATE' ? 'ROLE_GRANTED' : row.action === 'DELETE' ? 'ROLE_REMOVED' : 'CHANGED';
    if (kind === 'CHANGED') return { kind };
    const roleId = typeof metadata?.['roleId'] === 'string' ? (metadata['roleId'] as string) : null;
    const viaHeadship =
      metadata !== null && ('grantedViaHeadPositionId' in metadata || 'grantedViaHeadPositionOrgUnitId' in metadata);
    return { kind, roleId, viaHeadship };
  }
  if (row.objectType !== 'User') return { kind: 'CHANGED' };

  const event = typeof metadata?.['event'] === 'string' ? (metadata['event'] as string) : null;
  switch (row.action) {
    case 'CREATE':
      return { kind: 'INVITED' };
    case 'DELETE':
      return { kind: event === 'invitation_revoked' ? 'INVITATION_REVOKED' : 'CHANGED' };
    case 'IMPERSONATE_START':
      return { kind: 'SIGNED_IN_AS' };
    case 'UPDATE':
      break;
    default:
      return { kind: 'CHANGED' };
  }

  if (event !== null) return { kind: EVENT_KINDS[event] ?? 'CHANGED' };
  if (metadata?.['transferPromotionFailed'] === true) return { kind: 'HEAD_APPOINTMENT_FAILED' };

  const before = asCopy(row.before);
  const after = asCopy(row.after);
  if (!before || !after) return { kind: 'CHANGED' };

  const fields = FIELD_KEYS.filter(([, keys]) => keys.some((k) => differs(before, after, k))).map(([f]) => f);
  const outOfOfficeOnly = fields.length > 0 && fields.every((f) => OUT_OF_OFFICE_FIELDS.has(f));
  const result: ClassifiedAccessRow = { kind: outOfOfficeOnly ? 'OUT_OF_OFFICE_CHANGED' : 'PROFILE_EDITED', fields };
  if (fields.includes('unit') || fields.includes('position')) {
    const unitOf = (copy: Copy): string | null =>
      typeof copy['primaryOrgUnitId'] === 'string' ? (copy['primaryOrgUnitId'] as string) : null;
    result.transferCandidate = { fromUnitId: unitOf(before), toUnitId: unitOf(after) };
  }
  return result;
}

interface AuditRow {
  id: string;
  action: string;
  objectType: string;
  actorId: string | null;
  before: Prisma.JsonValue | null;
  after: Prisma.JsonValue | null;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
}

interface TransferEventRow {
  id: string;
  sourceOrgUnitId: string;
  destinationOrgUnitId: string;
  destinationPositionId: string | null;
  isPromotion: boolean;
  promotionAttempted: boolean;
  performedBy: string;
  createdAt: Date;
}

/**
 * Pairs each candidate audit row with its UserTransferEvent: written by the same
 * person, from the same unit to the same unit, within TRANSFER_MATCH_WINDOW_MS,
 * the nearest in time. An event is used once. Exported for its spec.
 */
export function matchTransfers(
  candidates: ReadonlyArray<{ id: string; actorId: string | null; at: Date; fromUnitId: string | null; toUnitId: string | null }>,
  events: readonly TransferEventRow[],
): Map<string, TransferEventRow> {
  const used = new Set<string>();
  const matched = new Map<string, TransferEventRow>();
  for (const c of [...candidates].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    let best: TransferEventRow | null = null;
    let bestGap = Number.POSITIVE_INFINITY;
    for (const e of events) {
      if (used.has(e.id)) continue;
      if (e.performedBy !== c.actorId || e.sourceOrgUnitId !== c.fromUnitId || e.destinationOrgUnitId !== c.toUnitId) continue;
      const gap = Math.abs(e.createdAt.getTime() - c.at.getTime());
      if (gap <= TRANSFER_MATCH_WINDOW_MS && gap < bestGap) {
        best = e;
        bestGap = gap;
      }
    }
    if (best) {
      used.add(best.id);
      matched.set(c.id, best);
    }
  }
  return matched;
}

/**
 * ACC-216 part 2 — a person's Access history, for their record page (/users/:id).
 * See user-access-history.interface.ts for what a caller sees.
 *
 * ONE PAGED SOURCE: the person's AuditLog rows (accessHistoryWhere), newest
 * first, so `total` is an exact count and Load more never repeats or skips.
 * Every transfer writes an audit row AND a UserTransferEvent (transferUser());
 * the audit row is the one listed, and its event is read only to describe it
 * (units, position, head appointment), so a transfer appears once.
 *
 * QUERIES, whatever the page: the person (1); the page and its count (2, one
 * Promise.all); then actors, roles and transfer events (at most 3, one
 * Promise.all, each only when the page needs it); then units and positions (at
 * most 2, only for a transfer on the page). At most 8. Every query is scoped by
 * organisationId. Nothing runs on the per-request path.
 */
@Injectable()
export class UserAccessHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserService,
  ) {}

  async forUser(
    organizationId: string,
    viewer: AccessHistoryViewer,
    userId: string,
    page: { skip?: number; take?: number } = {},
  ): Promise<IUserAccessHistoryPage> {
    assertMayReadAccessHistory(viewer, userId);
    // Another organisation's person, or an invented id: the identical 404.
    await this.users.getById(userId, organizationId);

    const skip = Math.max(0, page.skip ?? 0);
    const take = Math.min(ACCESS_HISTORY_MAX_TAKE, Math.max(1, page.take ?? ACCESS_HISTORY_DEFAULT_TAKE));
    const where = accessHistoryWhere(organizationId, userId);

    const [auditRows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
        select: {
          id: true,
          action: true,
          objectType: true,
          actorId: true,
          before: true,
          after: true,
          metadata: true,
          createdAt: true,
        },
      }) as Promise<AuditRow[]>,
      this.prisma.auditLog.count({ where }),
    ]);
    if (auditRows.length === 0) return { rows: [], total, skip, take };

    const classified = new Map(auditRows.map((r) => [r.id, classifyAccessRow(r)]));

    const actorIds = [...new Set(auditRows.map((r) => r.actorId).filter((id): id is string => !!id))];
    const roleIds = viewer.permissions.includes(ROLES_PERMISSIONS.VIEW)
      ? [...new Set([...classified.values()].map((c) => c.roleId).filter((id): id is string => !!id))]
      : [];
    const candidates = auditRows
      .filter((r) => classified.get(r.id)!.transferCandidate)
      .map((r) => ({ id: r.id, actorId: r.actorId, at: r.createdAt, ...classified.get(r.id)!.transferCandidate! }));

    const [actors, roles, events] = await Promise.all([
      actorIds.length
        ? this.prisma.user.findMany({ where: { organizationId, id: { in: actorIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
      roleIds.length
        ? this.prisma.role.findMany({
            where: { organizationId, id: { in: roleIds } },
            select: { id: true, nameEn: true, nameAr: true },
          })
        : Promise.resolve([]),
      candidates.length
        ? (this.prisma.userTransferEvent.findMany({
            where: {
              organizationId,
              userId,
              createdAt: {
                gte: new Date(Math.min(...candidates.map((c) => c.at.getTime())) - TRANSFER_MATCH_WINDOW_MS),
                lte: new Date(Math.max(...candidates.map((c) => c.at.getTime())) + TRANSFER_MATCH_WINDOW_MS),
              },
            },
            select: {
              id: true,
              sourceOrgUnitId: true,
              destinationOrgUnitId: true,
              destinationPositionId: true,
              isPromotion: true,
              promotionAttempted: true,
              performedBy: true,
              createdAt: true,
            },
          }) as Promise<TransferEventRow[]>)
        : Promise.resolve([] as TransferEventRow[]),
    ]);

    const transfers = matchTransfers(candidates, events);
    const unitIds = new Set<string>();
    const positionIds = new Set<string>();
    for (const e of transfers.values()) {
      unitIds.add(e.sourceOrgUnitId);
      unitIds.add(e.destinationOrgUnitId);
      if (e.destinationPositionId) positionIds.add(e.destinationPositionId);
    }
    const nameSelect = { id: true, nameEn: true, nameAr: true } as const;
    const [units, positions] = await Promise.all([
      unitIds.size
        ? this.prisma.orgUnit.findMany({ where: { organizationId, id: { in: [...unitIds] } }, select: nameSelect })
        : Promise.resolve([]),
      positionIds.size
        ? this.prisma.orgPosition.findMany({ where: { organizationId, id: { in: [...positionIds] } }, select: nameSelect })
        : Promise.resolve([]),
    ]);

    const actorById = new Map<string, IAccessHistoryActor>(actors.map((a) => [a.id, { id: a.id, name: a.name }]));
    const roleById = new Map<string, IAccessHistoryName>(roles.map((r) => [r.id, r]));
    const unitById = new Map<string, IAccessHistoryName>(units.map((u) => [u.id, u]));
    const positionById = new Map<string, IAccessHistoryName>(positions.map((p) => [p.id, p]));

    const rows = auditRows.map((r): IAccessHistoryRow => {
      const c = classified.get(r.id)!;
      const row: IAccessHistoryRow = {
        id: `audit:${r.id}`,
        at: r.createdAt,
        kind: c.kind,
        actor: r.actorId ? (actorById.get(r.actorId) ?? null) : null,
      };
      const event = transfers.get(r.id);
      if (event) {
        row.kind = 'TRANSFERRED';
        row.transfer = {
          from: unitById.get(event.sourceOrgUnitId) ?? null,
          to: unitById.get(event.destinationOrgUnitId) ?? null,
          position: event.destinationPositionId ? (positionById.get(event.destinationPositionId) ?? null) : null,
          headAppointment: event.isPromotion ? 'DONE' : event.promotionAttempted ? 'FAILED' : 'NONE',
        };
        return row;
      }
      if (c.fields) row.fields = c.fields;
      if (c.kind === 'ROLE_GRANTED' || c.kind === 'ROLE_REMOVED') {
        row.role = c.roleId ? (roleById.get(c.roleId) ?? null) : null;
        row.viaHeadship = c.viaHeadship ?? false;
      }
      return row;
    });
    return { rows, total, skip, take };
  }
}
