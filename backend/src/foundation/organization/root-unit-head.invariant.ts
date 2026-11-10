import { Logger } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { RootUnitNeedsHeadRefusal } from './org-unit-refusals';
import { findCurrentHeadHolders, findRunningActingCover } from './unit-headship';

/**
 * ACC-288 — the root unit always keeps a head or an acting head.
 *
 * DECIDED (Ahmad, 10 Nov 2026): at least one ACTIVE person heads the root unit
 * (the OrgUnit with `parentId` null) at all times — a current head holder, or
 * an acting cover in force. A change that would leave the root with neither is
 * refused, 409 `ROOT_UNIT_NEEDS_HEAD`. The chain of authority (ACC-283) ends at
 * the root unit's head, so it must never end in nobody.
 *
 * ## One assertion, the shape of tenant-administrator.invariant.ts
 *
 * The rule can be broken from several places (deactivating the head,
 * transferring them, vacating the position, ending a cover, completing a
 * handover, deactivating the head position or turning its head flag off), so it
 * lives here once and each of those transactions calls it, after the mutation
 * and before commit. Throwing rolls the transaction back: the refusal and the
 * undo are the same act.
 *
 * ## "Headed" is read through unit-headship.ts, and only there
 *
 * `findCurrentHeadHolders()` (an ACTIVE user on an active head position whose
 * primary unit is the root) or `findRunningActingCover()` (an ACTING period in
 * force now). Never `OrgUnit.isHeadVacant` or `actingHeadUserId`: both are
 * caches, and a cover that starts next month or lapsed on its own date makes
 * them wrong in opposite directions.
 *
 * ## The baseline: an organisation already headless is not refused
 *
 * The baseline is captured before the mutation. Headed before and headless
 * after: refused. Headless before AND after: allowed, with one logged line
 * (ids only), because refusing would block the very changes needed to recover;
 * such a root already shows on Setup health as `ORG_UNIT_WITHOUT_HEAD`.
 *
 * ## The platform organisation is excluded, structurally
 *
 * It is not a tenant and its root has no head to keep (the same exclusion as
 * the administrator invariant).
 *
 * ## The lock
 *
 * Every transaction that asks takes a per-organisation advisory lock first
 * (`root-head:<organizationId>`, the ACC-233 hierarchy-lock shape), inside
 * `captureRootHeadBaseline()` so no caller can forget it. Without it, ending
 * the cover and deactivating the head in two parallel requests could each see
 * the other still in place, both pass, and both commit.
 *
 * Cost: the lock and a few indexed reads, on mutation paths only. Nothing on
 * the per-request path.
 */

const logger = new Logger('RootUnitHeadInvariant');

/** A transaction on the app's client — the same type the other invariants' callers pass. */
type RootHeadTx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

/** The slice of that transaction this invariant reads. */
export type RootHeadInvariantClient = Pick<
  RootHeadTx,
  'organization' | 'orgUnit' | 'user' | 'orgUnitHeadAssignment' | '$queryRaw'
>;

interface RootUnit {
  id: string;
  nameEn: string;
  nameAr: string | null;
}

/** The organisation's root unit, or null when it has none (or it is the platform). */
async function findRoot(organizationId: string, client: RootHeadInvariantClient): Promise<RootUnit | null> {
  const org = await client.organization.findFirst({ where: { id: organizationId }, select: { isPlatformOrg: true } });
  if (!org || org.isPlatformOrg) return null;
  return client.orgUnit.findFirst({
    where: { organizationId, parentId: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, nameEn: true, nameAr: true },
  });
}

/** Whether `root` has a current head holder or an acting cover in force now. */
async function isHeaded(organizationId: string, root: RootUnit, client: RootHeadInvariantClient): Promise<boolean> {
  const holders = await findCurrentHeadHolders(client, organizationId, root.id);
  if (holders.length > 0) return true;
  return (await findRunningActingCover(client, organizationId, root.id, new Date())) !== null;
}

/**
 * Takes the per-organisation lock, then says whether the root is headed NOW.
 * Call it first in the transaction, before the mutation. The platform
 * organisation, and an organisation with no root, read as headed (nothing to
 * keep).
 */
export async function captureRootHeadBaseline(
  organizationId: string,
  client: RootHeadInvariantClient,
): Promise<boolean> {
  await client.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`root-head:${organizationId}`}))::text`;
  const root = await findRoot(organizationId, client);
  if (!root) return true;
  return isHeaded(organizationId, root, client);
}

export type RootHeadOutcome =
  | { kind: 'kept' }
  | { kind: 'already-headless'; root: RootUnit }
  | { kind: 'breach'; root: RootUnit };

/** The state after the mutation, against the baseline. Reads only; never throws. */
export async function evaluateRootHead(
  organizationId: string,
  client: RootHeadInvariantClient,
  baseline: boolean,
): Promise<RootHeadOutcome> {
  const root = await findRoot(organizationId, client);
  if (!root) return { kind: 'kept' };
  if (await isHeaded(organizationId, root, client)) return { kind: 'kept' };
  return baseline ? { kind: 'breach', root } : { kind: 'already-headless', root };
}

function logAlreadyHeadless(organizationId: string, root: RootUnit): void {
  logger.error(
    `Organization ${organizationId}: root unit ${root.id} has no head or acting head, and had none ` +
      `before this change either. The change was allowed: refusing it would block the changes needed ` +
      `to recover. Appoint a head or an acting head.`,
  );
}

/**
 * Refuse to commit a change that leaves the root unit with no head and no
 * acting head. Call it INSIDE the transaction, after the mutation and before
 * commit, with the baseline `captureRootHeadBaseline()` returned.
 */
export async function assertRootUnitRetainsAHead(
  organizationId: string,
  client: RootHeadInvariantClient,
  baseline: boolean,
): Promise<void> {
  const outcome = await evaluateRootHead(organizationId, client, baseline);
  if (outcome.kind === 'kept') return;
  if (outcome.kind === 'already-headless') {
    logAlreadyHeadless(organizationId, outcome.root);
    return;
  }
  throw new RootUnitNeedsHeadRefusal(outcome.root.id, outcome.root.nameEn, outcome.root.nameAr);
}

/**
 * The same check for a change nobody can refuse (the handover sweep, which
 * completes a handover on its declared date). It never throws: a breach is
 * logged, ids only, and Setup health reports the vacancy.
 */
export async function reportRootUnitHeadBreach(
  organizationId: string,
  client: RootHeadInvariantClient,
  baseline: boolean,
): Promise<void> {
  const outcome = await evaluateRootHead(organizationId, client, baseline);
  if (outcome.kind === 'kept') return;
  if (outcome.kind === 'already-headless') {
    logAlreadyHeadless(organizationId, outcome.root);
    return;
  }
  logger.error(
    `Organization ${organizationId}: an automatic handover left root unit ${outcome.root.id} with no ` +
      `head or acting head. It could not be refused (no person made the change). Appoint a head or an ` +
      `acting head.`,
  );
}
