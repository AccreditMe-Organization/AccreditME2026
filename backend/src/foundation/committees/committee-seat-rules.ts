import { HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// ACC-286 — the ONE reader of required committee seats and who fills them.
// Going live (transition-preconditions.ts), keeping a seat filled
// (CommitteesService's member writes) and, in PR 2, Setup health all ask this
// file. Never a second copy.
//
// A seat is a `committee_member_role` lookup value. It is REQUIRED when its
// attributes say `required: true`, read exactly as LookupService.getValues()
// shows the value to the organisation: the shared row's attributes with the
// organisation's override row over them KEY BY KEY, a hidden seat left out,
// and the organisation's own seats as they are. db-spec pins the two together.
//
// WHO COUNTS (Ahmad, 14 Nov, Q3): an active membership AND a user whose status
// is ACTIVE. An invited user cannot act yet, and a deactivated one keeps the
// membership row (deactivation ends no seat) but fills nothing.

type SeatClient = Pick<PrismaService, '$queryRaw'>;

export interface RequiredSeat {
  id: string;
  key: string;
  labelEn: string;
  labelAr: string | null;
}

export async function requiredSeats(client: SeatClient, organizationId: string): Promise<RequiredSeat[]> {
  return client.$queryRaw<RequiredSeat[]>`
    WITH cat AS (
      SELECT id FROM "LookupCategory" WHERE key = 'committee_member_role' AND "organizationId" IS NULL
    ),
    shared AS (
      SELECT v.* FROM "LookupValue" v
      WHERE v."categoryId" IN (SELECT id FROM cat) AND v."organizationId" IS NULL AND v."isActive"
    ),
    own AS (
      SELECT v.* FROM "LookupValue" v
      WHERE v."categoryId" IN (SELECT id FROM cat) AND v."organizationId" = ${organizationId} AND v."isActive"
    )
    SELECT id, key, "labelEn", "labelAr" FROM (
      SELECT s.id, s.key,
             COALESCE(o."labelOverrideEn", s."labelEn") AS "labelEn",
             COALESCE(o."labelOverrideAr", s."labelAr") AS "labelAr",
             s."sortOrder"
      FROM shared s
      LEFT JOIN own o ON o.key = s.key
      WHERE NOT COALESCE(o."isHidden", false)
        AND (
          (CASE WHEN jsonb_typeof(s.attributes) = 'object' THEN s.attributes ELSE '{}'::jsonb END)
          || (CASE WHEN jsonb_typeof(o.attributes) = 'object' THEN o.attributes ELSE '{}'::jsonb END)
        ) ->> 'required' = 'true'
      UNION ALL
      SELECT o.id, o.key, o."labelEn", o."labelAr", o."sortOrder"
      FROM own o
      WHERE NOT EXISTS (SELECT 1 FROM shared s WHERE s.key = o.key)
        AND jsonb_typeof(o.attributes) = 'object'
        AND o.attributes ->> 'required' = 'true'
    ) seats
    ORDER BY "sortOrder", key`;
}

export interface SeatValue extends RequiredSeat {
  /** The attributes as the organisation sees them: the shared row's, with its override's over them key by key. */
  attributes: Record<string, unknown>;
}

/**
 * ACC-283 — every seat the organisation sees, with its attributes MERGED as
 * `requiredSeats()` merges them (and as LookupService.getValues() shows them):
 * the shared row's attributes with the organisation's override row over them
 * key by key, a hidden seat left out, the organisation's own seats as they are.
 * The seat defaults (seat-actions.ts) read it. db-spec pins it to getValues().
 */
export async function seatValues(client: SeatClient, organizationId: string): Promise<SeatValue[]> {
  return client.$queryRaw<SeatValue[]>`
    WITH cat AS (
      SELECT id FROM "LookupCategory" WHERE key = 'committee_member_role' AND "organizationId" IS NULL
    ),
    shared AS (
      SELECT v.* FROM "LookupValue" v
      WHERE v."categoryId" IN (SELECT id FROM cat) AND v."organizationId" IS NULL AND v."isActive"
    ),
    own AS (
      SELECT v.* FROM "LookupValue" v
      WHERE v."categoryId" IN (SELECT id FROM cat) AND v."organizationId" = ${organizationId} AND v."isActive"
    )
    SELECT id, key, "labelEn", "labelAr", attributes FROM (
      SELECT s.id, s.key,
             COALESCE(o."labelOverrideEn", s."labelEn") AS "labelEn",
             COALESCE(o."labelOverrideAr", s."labelAr") AS "labelAr",
             s."sortOrder",
             (CASE WHEN jsonb_typeof(s.attributes) = 'object' THEN s.attributes ELSE '{}'::jsonb END)
               || (CASE WHEN jsonb_typeof(o.attributes) = 'object' THEN o.attributes ELSE '{}'::jsonb END) AS attributes
      FROM shared s
      LEFT JOIN own o ON o.key = s.key
      WHERE NOT COALESCE(o."isHidden", false)
      UNION ALL
      SELECT o.id, o.key, o."labelEn", o."labelAr", o."sortOrder",
             CASE WHEN jsonb_typeof(o.attributes) = 'object' THEN o.attributes ELSE '{}'::jsonb END AS attributes
      FROM own o
      WHERE NOT EXISTS (SELECT 1 FROM shared s WHERE s.key = o.key)
    ) seats
    ORDER BY "sortOrder", key`;
}

export interface SeatHolder {
  memberId: string;
  userId: string;
  roleValueId: string;
}

/** The committee's members who fill one of `seatIds`: an active membership, an ACTIVE user. */
export async function seatHolders(
  client: SeatClient,
  organizationId: string,
  committeeId: string,
  seatIds: readonly string[],
): Promise<SeatHolder[]> {
  const rows = await seatHoldersFor(client, organizationId, [committeeId], seatIds);
  return rows.map(({ memberId, userId, roleValueId }) => ({ memberId, userId, roleValueId }));
}

export interface CommitteeSeatHolder extends SeatHolder {
  committeeId: string;
}

/**
 * ACC-286 PR 2 — `seatHolders()` for many committees in ONE query (the Setup
 * health detector reads every committee in force at once). The same rule:
 * an active membership of an ACTIVE user, scoped by organisation.
 */
export async function seatHoldersFor(
  client: SeatClient,
  organizationId: string,
  committeeIds: readonly string[],
  seatIds: readonly string[],
): Promise<CommitteeSeatHolder[]> {
  if (committeeIds.length === 0 || seatIds.length === 0) return [];
  return client.$queryRaw<CommitteeSeatHolder[]>`
    SELECT cm."committeeId", cm.id AS "memberId", cm."userId", cm."roleValueId"
    FROM "CommitteeMember" cm
    JOIN "User" u ON u.id = cm."userId" AND u."organizationId" = ${organizationId}
    WHERE cm."organizationId" = ${organizationId}
      AND cm."committeeId" = ANY(${[...committeeIds]}::text[])
      AND cm."isActive"
      AND u.status = 'ACTIVE'
      AND cm."roleValueId" = ANY(${[...seatIds]}::text[])`;
}

/** The members who count toward the committee's quorum: an active membership, an ACTIVE user. */
export async function activeMemberCount(client: SeatClient, organizationId: string, committeeId: string): Promise<number> {
  const rows = await client.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n
    FROM "CommitteeMember" cm
    JOIN "User" u ON u.id = cm."userId" AND u."organizationId" = ${organizationId}
    WHERE cm."organizationId" = ${organizationId}
      AND cm."committeeId" = ${committeeId}
      AND cm."isActive"
      AND u.status = 'ACTIVE'`;
  return rows[0]?.n ?? 0;
}

/** The required seats nobody fills, in seat order. */
export async function emptyRequiredSeats(
  client: SeatClient,
  organizationId: string,
  committeeId: string,
): Promise<RequiredSeat[]> {
  const seats = await requiredSeats(client, organizationId);
  const holders = await seatHolders(client, organizationId, committeeId, seats.map((s) => s.id));
  const filled = new Set(holders.map((h) => h.roleValueId));
  return seats.filter((s) => !filled.has(s.id));
}

// ACC-286 — the refusal of a member write that would empty a required seat of
// a committee in force (rule 3). The storage refusals' shape (ACC-177), so the
// screens say it from `code` and name the seat in the reader's language.
export class CommitteeSeatRefusal extends HttpException {
  constructor(seat: RequiredSeat) {
    super(
      {
        statusCode: HttpStatus.CONFLICT,
        message: `Appoint another ${seat.labelEn} first: this committee is in force and needs one`,
        error: 'Conflict',
        code: 'COMMITTEE_REQUIRED_SEAT_LAST_HOLDER',
        seat: { id: seat.id, labelEn: seat.labelEn, labelAr: seat.labelAr },
      },
      HttpStatus.CONFLICT,
    );
  }
}
