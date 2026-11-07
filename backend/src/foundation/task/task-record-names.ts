import { Prisma } from '../../../generated/prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { memberCommitteeIds } from '../../common/services/committee-membership';
import { seesRecordType } from './task-record-types';

/**
 * ACC-120 slice 3 — A TASK'S RECORD, NAMED ONLY FOR A VIEWER WHO MAY SEE ITS
 * TYPE. One gate for every list that names records: the record list's rows,
 * the decider inbox and the Available list ask it, and so does the record-name
 * search, so a search can never reveal a name the row would not show.
 *
 * The gate is the record TYPE (seesRecordType, rule 1): a viewer without
 * committees:view gets a committee task's row with the type and id and no
 * name. The task page is stricter — it asks ObjectVisibilityService for the
 * one record (TaskAdmissionService) — and keeps its own check.
 */
export interface ITaskRecordRef {
  type: string;
  id: string;
  nameEn: string | null;
  nameAr: string | null;
}

type NamesClient = Pick<PrismaService, 'committee' | 'meeting' | 'committeeMember'>;

const key = (type: string, id: string) => `${type}:${id}`;

/**
 * The names of these tasks' records, read in at most two batched,
 * organisation-scoped lookups (committees, meetings) — never one per row. A
 * type the viewer may not see, or with no ids, is not looked up at all.
 */
export async function recordNamesOf(
  prisma: NamesClient,
  tasks: readonly { sourceType: string; sourceId: string }[],
  organizationId: string,
  permissions: readonly string[],
  viewerId?: string,
): Promise<Map<string, ITaskRecordRef>> {
  const all = (type: string) => [...new Set(tasks.filter((t) => t.sourceType === type).map((t) => t.sourceId))];
  const ids = (type: string) => (seesRecordType(permissions, type) ? all(type) : []);
  // ACC-281 — a viewer without committees:view may still open the committees they
  // are an ACTIVE member of, so those are named too (ACC-228: named only for a
  // viewer who may open the record). One membership read for the whole batch.
  const committeeIds =
    seesRecordType(permissions, 'COMMITTEE') || !viewerId
      ? ids('COMMITTEE')
      : [...(await memberCommitteeIds(prisma, viewerId, organizationId, all('COMMITTEE')))];
  const meetingIds = ids('MEETING');
  const [committees, meetings] = await Promise.all([
    committeeIds.length
      ? prisma.committee.findMany({ where: { id: { in: committeeIds }, organizationId }, select: { id: true, nameEn: true, nameAr: true } })
      : Promise.resolve([] as { id: string; nameEn: string; nameAr: string | null }[]),
    meetingIds.length
      ? prisma.meeting.findMany({ where: { id: { in: meetingIds }, organizationId }, select: { id: true, title: true } })
      : Promise.resolve([] as { id: string; title: string }[]),
  ]);
  const map = new Map<string, ITaskRecordRef>();
  for (const c of committees) map.set(key('COMMITTEE', c.id), { type: 'COMMITTEE', id: c.id, nameEn: c.nameEn, nameAr: c.nameAr });
  for (const m of meetings) map.set(key('MEETING', m.id), { type: 'MEETING', id: m.id, nameEn: m.title, nameAr: null });
  return map;
}

/** A task's record from recordNamesOf()'s map: named, or its type and id alone. */
export function recordOf(map: ReadonlyMap<string, ITaskRecordRef>, task: { sourceType: string; sourceId: string }): ITaskRecordRef {
  return map.get(key(task.sourceType, task.sourceId)) ?? { type: task.sourceType, id: task.sourceId, nameEn: null, nameAr: null };
}

/**
 * The record-name half of a search over task row `t`: its committee's English
 * or Arabic name, or its meeting's title, matching the already-escaped
 * pattern — each in this organisation, and only for a type the viewer may see
 * (the same gate as recordNamesOf). Null when the viewer sees neither type.
 */
export function recordNameMatchSql(pattern: string, organizationId: string, permissions: readonly string[]): Prisma.Sql | null {
  const parts: Prisma.Sql[] = [];
  if (seesRecordType(permissions, 'COMMITTEE')) {
    parts.push(Prisma.sql`(t."sourceType"::text = 'COMMITTEE' AND EXISTS (SELECT 1 FROM "Committee" nc
      WHERE nc.id = t."sourceId" AND nc."organizationId" = ${organizationId}
        AND (nc."nameEn" ILIKE ${pattern} ESCAPE '\\' OR COALESCE(nc."nameAr", '') ILIKE ${pattern} ESCAPE '\\')))`);
  }
  if (seesRecordType(permissions, 'MEETING')) {
    parts.push(Prisma.sql`(t."sourceType"::text = 'MEETING' AND EXISTS (SELECT 1 FROM "Meeting" nm
      WHERE nm.id = t."sourceId" AND nm."organizationId" = ${organizationId} AND nm.title ILIKE ${pattern} ESCAPE '\\'))`);
  }
  return parts.length ? Prisma.sql`(${Prisma.join(parts, ' OR ')})` : null;
}
