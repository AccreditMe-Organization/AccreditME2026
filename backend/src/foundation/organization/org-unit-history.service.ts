import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { IOrgUnitPathItem } from './interfaces/org-structure.interface';
import type {
  IOrgUnitAuditHistoryEntry,
  IOrgUnitHeadHistoryEntry,
  IOrgUnitHistoryEntry,
  IOrgUnitHistoryPage,
  IOrgUnitHistoryPerson,
  OrgUnitHeadEventKind,
  OrgUnitHistoryField,
} from './interfaces/org-unit-history.interface';
import { viewerFrom } from './org-structure.service';

export const HISTORY_DEFAULT_TAKE = 20;
export const HISTORY_MAX_TAKE = 50;

/**
 * The AuditLog rows that are the unit's OWN record: the ones holding a copy of
 * it (`after`), written by create, update and deactivate.
 *
 * Every headship operation in `org-unit-head.service.ts` writes an
 * `OrgUnitHeadEvent` AND an audit row holding only `metadata`. The ledger row
 * is the one shown, so each headship change appears once, and the audit log
 * is never read for headship (ACC-133: headship history is never
 * reconstructed from it).
 */
export function unitRecordAuditWhere(organizationId: string, orgUnitId: string): Prisma.AuditLogWhereInput {
  return { organizationId, objectType: 'OrgUnit', objectId: orgUnitId, after: { not: Prisma.DbNull } };
}

/** A stored copy's key for each field the record names, compared as stored. */
const FIELD_KEYS: Array<[OrgUnitHistoryField, string]> = [
  ['nameEn', 'nameEn'],
  ['nameAr', 'nameAr'],
  ['code', 'code'],
  ['type', 'typeValueId'],
  ['description', 'description'],
  ['parent', 'parentId'],
  ['sortOrder', 'sortOrder'],
];

type Copy = Record<string, unknown>;

const asCopy = (value: Prisma.JsonValue | null): Copy | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Copy) : null;

interface AuditRow {
  id: string;
  action: string;
  actorId: string | null;
  before: Prisma.JsonValue | null;
  after: Prisma.JsonValue | null;
  createdAt: Date;
}

interface EventRow {
  id: string;
  action: OrgUnitHeadEventKind;
  userId: string;
  approvedBy: string | null;
  positionId: string | null;
  position: { id: string; nameEn: string; nameAr: string | null } | null;
  effectiveDate: Date;
  createdAt: Date;
}

/** What an audit row says happened, read from its copies (never returned). */
interface Classified {
  kind: IOrgUnitAuditHistoryEntry['kind'];
  fields: OrgUnitHistoryField[];
  /** The new parentId when the parent changed; undefined when it did not. */
  newParentId?: string | null;
}

export function classifyAuditRow(row: Pick<AuditRow, 'action' | 'before' | 'after'>): Classified {
  if (row.action === 'CREATE') return { kind: 'CREATED', fields: [] };
  const before = asCopy(row.before);
  const after = asCopy(row.after);
  if (row.action !== 'UPDATE' || !before || !after) return { kind: 'RECORDED', fields: [] };
  if (before['isActive'] === true && after['isActive'] === false) return { kind: 'DEACTIVATED', fields: [] };
  if (before['isActive'] === false && after['isActive'] === true) return { kind: 'REACTIVATED', fields: [] };
  const fields = FIELD_KEYS.filter(([, key]) => (before[key] ?? null) !== (after[key] ?? null)).map(([f]) => f);
  const result: Classified = { kind: 'CHANGED', fields };
  if (fields.includes('parent')) {
    const next = after['parentId'];
    result.newParentId = typeof next === 'string' ? next : null;
  }
  return result;
}

/**
 * ACC-120 slice 11, PR D — the History panel (D8). See
 * `interfaces/org-unit-history.interface.ts` for what a caller sees.
 *
 * Paged over the two sources merged newest first: each page reads at most
 * `skip + take` rows from each table (ordered by when they were written, then
 * id), merges them, and returns the slice. A unit's history is short, and
 * `take` is capped at 50, so the window stays small.
 */
@Injectable()
export class OrgUnitHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async history(
    organizationId: string,
    permissions: string[],
    orgUnitId: string,
    page: { skip?: number; take?: number } = {},
  ): Promise<IOrgUnitHistoryPage> {
    const viewer = viewerFrom(permissions);
    const skip = Math.max(0, page.skip ?? 0);
    const take = Math.min(HISTORY_MAX_TAKE, Math.max(1, page.take ?? HISTORY_DEFAULT_TAKE));

    // The same 404 for an invented id and another organisation's unit.
    const unit = await this.prisma.orgUnit.findFirst({
      where: { id: orgUnitId, organizationId },
      select: { id: true, isActive: true },
    });
    if (!unit) throw new NotFoundException('Org unit not found');

    const auditWhere = unitRecordAuditWhere(organizationId, orgUnitId);
    const eventWhere: Prisma.OrgUnitHeadEventWhereInput = { organizationId, orgUnitId };
    const window = skip + take;

    const [auditRows, eventRows, auditCount, eventCount, deactivationRow] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: auditWhere,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: window,
        select: { id: true, action: true, actorId: true, before: true, after: true, createdAt: true },
      }) as Promise<AuditRow[]>,
      this.prisma.orgUnitHeadEvent.findMany({
        where: eventWhere,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: window,
        select: {
          id: true,
          action: true,
          userId: true,
          approvedBy: true,
          positionId: true,
          position: { select: { id: true, nameEn: true, nameAr: true } },
          effectiveDate: true,
          createdAt: true,
        },
      }) as Promise<EventRow[]>,
      this.prisma.auditLog.count({ where: auditWhere }),
      this.prisma.orgUnitHeadEvent.count({ where: eventWhere }),
      unit.isActive
        ? Promise.resolve(null)
        : (this.prisma.auditLog.findFirst({
            where: {
              ...auditWhere,
              action: 'UPDATE',
              AND: [
                { before: { path: ['isActive'], equals: true } },
                { after: { path: ['isActive'], equals: false } },
              ],
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: { id: true, action: true, actorId: true, before: true, after: true, createdAt: true },
          }) as Promise<AuditRow | null>),
    ]);

    type Merged = { at: Date; key: string; audit?: AuditRow; event?: EventRow };
    const merged: Merged[] = [
      ...auditRows.map((r) => ({ at: r.createdAt, key: `audit:${r.id}`, audit: r })),
      ...eventRows.map((r) => ({ at: r.createdAt, key: `head:${r.id}`, event: r })),
    ]
      .sort((a, b) => b.at.getTime() - a.at.getTime() || (a.key < b.key ? 1 : a.key > b.key ? -1 : 0))
      .slice(skip, window);

    const classified = new Map<string, Classified>();
    for (const m of merged) if (m.audit) classified.set(m.audit.id, classifyAuditRow(m.audit));

    // One read each for the people and the new parents the page names.
    const userIds = new Set<string>();
    for (const m of merged) {
      if (m.audit?.actorId) userIds.add(m.audit.actorId);
      if (m.event) {
        userIds.add(m.event.userId);
        if (m.event.approvedBy) userIds.add(m.event.approvedBy);
      }
    }
    if (deactivationRow?.actorId) userIds.add(deactivationRow.actorId);
    const parentIds = new Set<string>();
    for (const c of classified.values()) if (c.newParentId) parentIds.add(c.newParentId);

    const [users, parents] = await Promise.all([
      userIds.size
        ? this.prisma.user.findMany({
            where: { organizationId, id: { in: [...userIds] } },
            select: { id: true, name: true, position: { select: { nameEn: true, nameAr: true } } },
          })
        : Promise.resolve([]),
      parentIds.size
        ? this.prisma.orgUnit.findMany({
            where: { organizationId, id: { in: [...parentIds] } },
            select: { id: true, nameEn: true, nameAr: true },
          })
        : Promise.resolve([]),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const parentById = new Map<string, IOrgUnitPathItem>(
      parents.map((p) => [p.id, { id: p.id, nameEn: p.nameEn, nameAr: p.nameAr }]),
    );

    const person = (userId: string): IOrgUnitHistoryPerson => {
      const u = userById.get(userId);
      return {
        userId,
        name: viewer.names ? (u?.name ?? null) : null,
        inOrganization: !!u,
        positionNameEn: u?.position?.nameEn ?? null,
        positionNameAr: u?.position?.nameAr ?? null,
      };
    };

    const items = merged.map((m): IOrgUnitHistoryEntry => {
      if (m.audit) {
        const c = classified.get(m.audit.id)!;
        const entry: IOrgUnitAuditHistoryEntry = {
          id: m.key,
          source: 'AUDIT',
          kind: c.kind,
          at: m.at,
          actor: m.audit.actorId ? person(m.audit.actorId) : null,
          fields: c.fields,
        };
        // Moved to the top: null. Moved under a unit no longer there: no
        // movedTo, so the row says only that the parent changed.
        if (c.newParentId === null) entry.movedTo = null;
        else if (c.newParentId && parentById.has(c.newParentId)) entry.movedTo = parentById.get(c.newParentId)!;
        return entry;
      }
      const e = m.event!;
      const entry: IOrgUnitHeadHistoryEntry = {
        id: m.key,
        source: 'HEAD_EVENT',
        kind: e.action,
        at: m.at,
        effectiveDate: e.effectiveDate,
        actor: e.approvedBy ? person(e.approvedBy) : null,
        subject: person(e.userId),
        position: e.position ? { id: e.position.id, nameEn: e.position.nameEn, nameAr: e.position.nameAr } : null,
      };
      return entry;
    });

    const result: IOrgUnitHistoryPage = { items, total: auditCount + eventCount, skip, take };
    if (!unit.isActive) {
      result.deactivation = deactivationRow
        ? { at: deactivationRow.createdAt, actor: deactivationRow.actorId ? person(deactivationRow.actorId) : null }
        : null;
    }
    return result;
  }
}
