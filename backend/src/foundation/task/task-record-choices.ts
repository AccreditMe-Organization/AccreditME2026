import { ConflictException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { RecordChoicesQueryDto } from './dto/record-choices-query.dto';
import { holdsCreateKey, seesRecordType, TASK_RECORD_TYPES } from './task-record-types';

/**
 * ACC-280 — New task's record picker, and the rules it shares with POST /tasks.
 *
 * - createTypes(): the types New task offers (`create.types` of GET /tasks/views).
 *   The type's Create tasks key, and either its view permission or an active
 *   membership of one of its records (decision 2). The membership query runs only
 *   for a caller holding the key WITHOUT the view, one per such type, together.
 * - recordChoices(): GET /tasks/record-choices. The records the caller may open
 *   (every record with the view permission, else their own by membership) that take
 *   new tasks (acceptsTasksSql); a type they hold no key on has an empty page. Two
 *   queries, the rows and both counts, in Promise.all; at most 50 rows; every value
 *   bound; the organisation in every WHERE.
 * - assertRecordAcceptsTasks(): POST /tasks' half of decision 7. The same SQL, asked
 *   of one record: 409 TASK_RECORD_CLOSED. The record check runs first, so a record
 *   the caller may not see keeps its 403/404.
 *
 * Nothing here runs on the per-request path: each is its own route's work.
 */

type ChoicesClient = Pick<PrismaService, '$queryRaw'>;

export interface TaskRecordChoice {
  id: string;
  nameEn: string;
  nameAr: string | null;
}

/** am-simple-list's page: `total` before the search, `matching` after it. */
export interface TaskRecordChoicesPage {
  items: TaskRecordChoice[];
  total: number;
  matching: number;
}

export interface RecordChoicesViewer {
  id: string;
  permissions: readonly string[];
}

const PAGE = 20;

/** ACC-280 — the refusal POST /tasks gives a record that takes no new tasks (decision 7). */
export const TASK_RECORD_CLOSED = 'TASK_RECORD_CLOSED';

export class TaskRecordClosedException extends ConflictException {
  readonly code = TASK_RECORD_CLOSED;

  constructor() {
    super({
      statusCode: 409,
      message: 'This committee is dissolved or inactive, so it takes no new tasks.',
      error: 'Conflict',
      code: TASK_RECORD_CLOSED,
    });
  }
}

export async function createTypes(client: ChoicesClient, viewer: RecordChoicesViewer, organizationId: string): Promise<string[]> {
  const keyed = Object.keys(TASK_RECORD_TYPES).filter((type) => holdsCreateKey(viewer.permissions, type));
  const allowed = await Promise.all(
    keyed.map((type) =>
      seesRecordType(viewer.permissions, type) ? Promise.resolve(true) : isMemberOfAny(client, type, viewer.id, organizationId),
    ),
  );
  return keyed.filter((_, i) => allowed[i]);
}

export async function recordChoices(
  client: ChoicesClient,
  dto: RecordChoicesQueryDto,
  organizationId: string,
  viewer: RecordChoicesViewer,
): Promise<TaskRecordChoicesPage> {
  const choices = TASK_RECORD_TYPES[dto.type]?.choices;
  if (!choices || !holdsCreateKey(viewer.permissions, dto.type)) return { items: [], total: 0, matching: 0 };

  // With the view permission every record of the type; else the caller's own by
  // membership (decision 2). A key holder with neither gets an empty page, as
  // createTypes() leaves the type out for them.
  const scope = seesRecordType(viewer.permissions, dto.type) ? Prisma.sql`TRUE` : choices.memberSql(viewer.id);
  const base = Prisma.sql`r."organizationId" = ${organizationId} AND ${choices.acceptsTasksSql} AND ${scope}`;
  const q = dto.q?.trim();
  const search = q ? Prisma.sql`(r."nameEn" ILIKE ${likePattern(q)} OR r."nameAr" ILIKE ${likePattern(q)})` : Prisma.sql`TRUE`;
  // The name the reader sees: Arabic in Arabic (an unnamed one last, ACC-160), then
  // English; the id last, so Load more never repeats or skips.
  const order =
    dto.lang === 'ar' ? Prisma.sql`r."nameAr" ASC NULLS LAST, r."nameEn" ASC, r.id ASC` : Prisma.sql`r."nameEn" ASC, r.id ASC`;

  const [rows, counts] = await Promise.all([
    client.$queryRaw<TaskRecordChoice[]>`
      SELECT r.id, r."nameEn", r."nameAr"
      FROM ${choices.fromSql}
      WHERE ${base} AND ${search}
      ORDER BY ${order}
      LIMIT ${dto.take ?? PAGE} OFFSET ${dto.skip ?? 0}`,
    client.$queryRaw<{ total: bigint; matching: bigint }[]>`
      SELECT count(*)::bigint AS total, count(*) FILTER (WHERE ${search})::bigint AS matching
      FROM ${choices.fromSql}
      WHERE ${base}`,
  ]);
  return {
    items: rows.map((r) => ({ id: r.id, nameEn: r.nameEn, nameAr: r.nameAr })),
    total: Number(counts[0]?.total ?? 0),
    matching: Number(counts[0]?.matching ?? 0),
  };
}

/**
 * POST /tasks: does this record take new tasks? One indexed EXISTS, inside the create
 * request only. A type with no choices entry has no closed state to read.
 */
export async function assertRecordAcceptsTasks(
  client: ChoicesClient,
  sourceType: string,
  sourceId: string,
  organizationId: string,
): Promise<void> {
  const choices = TASK_RECORD_TYPES[sourceType]?.choices;
  if (!choices) return;
  const [row] = await client.$queryRaw<{ open: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM ${choices.fromSql}
      WHERE r.id = ${sourceId} AND r."organizationId" = ${organizationId} AND ${choices.acceptsTasksSql}
    ) AS open`;
  if (!row?.open) throw new TaskRecordClosedException();
}

async function isMemberOfAny(client: ChoicesClient, type: string, viewerId: string, organizationId: string): Promise<boolean> {
  const choices = TASK_RECORD_TYPES[type]?.choices;
  if (!choices) return false;
  const [row] = await client.$queryRaw<{ member: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM ${choices.fromSql}
      WHERE r."organizationId" = ${organizationId} AND ${choices.memberSql(viewerId)}
    ) AS member`;
  return !!row?.member;
}

/** A case-insensitive "contains" pattern, with LIKE's own wildcards taken literally. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
