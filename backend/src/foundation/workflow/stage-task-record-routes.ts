import { WorkflowObjectType } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

// ACC-190 — "the record's unit" and "the record's committee", per kind of
// record. FAIL CLOSED, the ACC-101 registry's shape: a kind with no entry here
// cannot use the relative assignment routes, and saving one is refused
// (STAGE_TASK_ROUTE_NOT_AVAILABLE) rather than creating tasks that land with
// nobody. Documents, Incidents and the rest add their line when they are built.
//
// A vacant position in the record's unit is NOT passed up to a parent unit
// (Ahmad, 9 Oct, C): the task is UNASSIGNED with its target, and Setup health
// lists it.

type RouteClient = Pick<PrismaService, 'committee' | 'meeting'>;

export interface RecordRoute {
  /** The unit the record belongs to, or null if the record has none. */
  unit(client: RouteClient, objectId: string, organizationId: string): Promise<string | null>;
  /** The committee the record belongs to, or null if it has none. */
  committee(client: RouteClient, objectId: string, organizationId: string): Promise<string | null>;
  /**
   * ACC-271 — unit() for many records in ONE query: record id → unit id. A
   * record with no unit, or not in this organisation, is absent.
   */
  unitsOf(client: RouteClient, objectIds: string[], organizationId: string): Promise<Map<string, string>>;
  /** ACC-271 — committee() for many records in ONE query: record id → committee id. */
  committeesOf(client: RouteClient, objectIds: string[], organizationId: string): Promise<Map<string, string>>;
}

function toMap<T>(rows: T[], key: (row: T) => string, value: (row: T) => string | null | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const v = value(row);
    if (v) map.set(key(row), v);
  }
  return map;
}

export const RECORD_ROUTES: Partial<Record<WorkflowObjectType, RecordRoute>> = {
  // A committee's own unit (required since ACC-135), and the committee itself.
  COMMITTEE: {
    async unit(client, objectId, organizationId) {
      const committee = await client.committee.findFirst({ where: { id: objectId, organizationId }, select: { orgUnitId: true } });
      return committee?.orgUnitId ?? null;
    },
    async committee(client, objectId, organizationId) {
      const committee = await client.committee.findFirst({ where: { id: objectId, organizationId }, select: { id: true } });
      return committee?.id ?? null;
    },
    async unitsOf(client, objectIds, organizationId) {
      const rows = await client.committee.findMany({ where: { id: { in: objectIds }, organizationId }, select: { id: true, orgUnitId: true } });
      return toMap(rows, (r) => r.id, (r) => r.orgUnitId);
    },
    async committeesOf(client, objectIds, organizationId) {
      const rows = await client.committee.findMany({ where: { id: { in: objectIds }, organizationId }, select: { id: true } });
      return toMap(rows, (r) => r.id, (r) => r.id);
    },
  },
  // A meeting belongs to its committee, and through it to the committee's unit.
  MEETING: {
    async unit(client, objectId, organizationId) {
      const meeting = await client.meeting.findFirst({
        where: { id: objectId, organizationId },
        select: { committee: { select: { orgUnitId: true } } },
      });
      return meeting?.committee?.orgUnitId ?? null;
    },
    async committee(client, objectId, organizationId) {
      const meeting = await client.meeting.findFirst({ where: { id: objectId, organizationId }, select: { committeeId: true } });
      return meeting?.committeeId ?? null;
    },
    async unitsOf(client, objectIds, organizationId) {
      const rows = await client.meeting.findMany({
        where: { id: { in: objectIds }, organizationId },
        select: { id: true, committee: { select: { orgUnitId: true } } },
      });
      return toMap(rows, (r) => r.id, (r) => r.committee?.orgUnitId);
    },
    async committeesOf(client, objectIds, organizationId) {
      const rows = await client.meeting.findMany({ where: { id: { in: objectIds }, organizationId }, select: { id: true, committeeId: true } });
      return toMap(rows, (r) => r.id, (r) => r.committeeId);
    },
  },
};
