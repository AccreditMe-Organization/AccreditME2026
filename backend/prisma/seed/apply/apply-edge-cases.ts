// ACC-62 — applies the four deliberate states from the plan's Section 3.
//
// Every one goes through the real service that a real admin would use, so the
// resulting rows are indistinguishable from rows a person created. That is not
// purity for its own sake: deactivate() and declareHandover() each perform
// bookkeeping the seed would otherwise have to imitate by hand, and imitating
// it is exactly how seed data drifts from what the product actually produces.
import { UserService } from '../../../src/foundation/user/user.service';
import { OrgUnitHeadService } from '../../../src/foundation/organization/org-unit-head.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { SeedContext, TenantFixture, resolve } from '../fixtures/fixture.types';

// Dates are computed here, at seed time, never stored in a fixture. A fixture
// holding absolute dates would silently expire: the out-of-office window would
// close and the handover would fall into the past, and the seed would go on
// "succeeding" while demonstrating nothing.
function daysFromNow(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

export async function applyEdgeCases(
  deps: {
    prisma: PrismaService;
    userService: UserService;
    orgUnitHeadService: OrgUnitHeadService;
  },
  fixture: TenantFixture,
  ctx: SeedContext,
  actorId: string,
): Promise<void> {
  const { prisma, userService, orgUnitHeadService } = deps;
  const edge = fixture.edgeCases;

  // ── EDGE CASE 2 — out of office ───────────────────────────────────────────
  // Applied BEFORE the departure and the handover, deliberately.
  // updateOutOfOffice() requires the acting user to be ACTIVE, and later steps
  // deactivate someone; keeping this first means the ordering never depends on
  // who happens to still be active by then.
  const oooUserId = resolve(ctx.personIdByKey, edge.outOfOffice.person, 'person');
  const coveringUserId = resolve(ctx.personIdByKey, edge.outOfOffice.covering, 'person');
  await userService.updateOutOfOffice(
    oooUserId,
    {
      outOfOfficeFrom: daysFromNow(-edge.outOfOffice.startsDaysAgo).toISOString(),
      outOfOfficeTo: daysFromNow(edge.outOfOffice.endsInDays).toISOString(),
      actingUserId: coveringUserId,
    },
    ctx.organizationId,
    actorId,
    // updateOutOfOffice() permits either self-service or users:manage. The
    // seed acts as the tenant admin, so it supplies that permission
    // explicitly rather than pretending to be each person in turn.
    ['users:manage'],
  );

  // ── EDGE CASE 3 — head handover in progress ───────────────────────────────
  // Future-dated, which is load-bearing: SlaMonitorProcessor.sweepDueHandovers()
  // completes any handover whose headHandoverEffectiveDate <= now, so a past
  // or present date would be swept within 15 minutes and this state would
  // simply disappear. validateFixture() rejects a non-positive value.
  const handoverUnitId = resolve(ctx.unitIdByKey, edge.handover.unit, 'org unit');
  const successorId = resolve(ctx.personIdByKey, edge.handover.to, 'person');
  await orgUnitHeadService.declareHandover(
    handoverUnitId,
    {
      incomingUserId: successorId,
      effectiveDate: daysFromNow(edge.handover.effectiveInDays).toISOString(),
      reason: 'Planned succession — seeded by ACC-62 to exercise the mid-handover state.',
    },
    ctx.organizationId,
    actorId,
  );

  // ── EDGE CASE 1 — vacant head, created by a real departure ────────────────
  // Applied LAST, because it removes an ACTIVE head. Doing it earlier would
  // leave the unit headless while later steps still needed to reference it,
  // and would trip the same ACC-46 staffing block that made the original
  // "born headless" design impossible in the first place.
  //
  // deactivate() does the real work: flips status to INACTIVE, invalidates
  // sessions, and calls refreshOrgUnitHeadVacancy() — which is what actually
  // sets isHeadVacant/headVacantSince. The seed never writes those fields.
  const departingId = resolve(ctx.personIdByKey, edge.vacantHeadUnit.departingHead, 'person');
  await userService.deactivate(departingId, ctx.organizationId, actorId);

  // ── EDGE CASE 4 — duplicate names ─────────────────────────────────────────
  // Nothing to apply: the pairs are ordinary people already created by
  // applyPeople(). Verified here rather than assumed, because this is the one
  // case with no state of its own — if a later edit renamed one of them or
  // moved them into the same unit, the case would dissolve with nothing
  // failing anywhere. validateFixture() checks the fixture; this checks what
  // actually reached the database.
  for (const pair of edge.duplicateNames) {
    const [firstKey, secondKey] = pair.people;
    const first = await prisma.user.findFirst({
      where: { id: resolve(ctx.personIdByKey, firstKey, 'person') },
      select: { name: true, email: true, primaryOrgUnitId: true },
    });
    const second = await prisma.user.findFirst({
      where: { id: resolve(ctx.personIdByKey, secondKey, 'person') },
      select: { name: true, email: true, primaryOrgUnitId: true },
    });
    if (!first || !second) {
      throw new Error(`Duplicate-name pair (${firstKey}, ${secondKey}) — one or both users were not created.`);
    }
    if (first.name !== second.name) {
      throw new Error(
        `Duplicate-name pair (${firstKey}, ${secondKey}) do not share a name in the database: ` +
          `'${first.name}' vs '${second.name}'.`,
      );
    }
    if (first.primaryOrgUnitId === second.primaryOrgUnitId) {
      throw new Error(
        `Duplicate-name pair (${firstKey}, ${secondKey}) are in the same org unit. The case exists to ` +
          'show that a name-only picker cannot tell two people apart across different units.',
      );
    }
    if (first.email === second.email) {
      throw new Error(`Duplicate-name pair (${firstKey}, ${secondKey}) share an email — they must be distinct people.`);
    }
  }
}
