// ACC-62 — creates a tenant's positions and people, and genuinely activates
// them so they can log in.
//
// The ordering here is not cosmetic. Two rules in invite() constrain it, and
// they pull in different directions because they filter on different statuses:
//
//   validateUnitHeadUniqueness -> hasAnyHeadConferringHolder()
//       counts ACTIVE *and* INVITED. One head per unit, and merely inviting
//       a second one is already a conflict.
//
//   the ACC-46 staffing block   -> hasDirectOrActingHead()
//       counts ACTIVE only, and looks at the target unit alone — escalation
//       coverage from a parent explicitly does NOT count.
//
// Together those mean a unit's head must be invited AND fully activated
// before any non-head staff can enter that unit. Inviting everyone and
// activating afterwards fails on the second person into any unit, because
// their head is still INVITED. So this applier interleaves: one person at a
// time, invited then immediately activated.
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import * as argon2 from 'argon2';
import { PrismaClient } from '../../../generated/prisma/client';
import { UserService } from '../../../src/foundation/user/user.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { SeedContext, TenantFixture, resolve } from '../fixtures/fixture.types';
import { orderPeopleForInvite } from './order-people';

// Dev-only, and every seeded account shares it — the whole point is that a
// tester can log in as any persona without looking anything up.
export const SEED_PASSWORD = 'Seed@Accredit2026';

// Mirrors AuthService.namespacedEmail() exactly. Better Auth's AuthUser.email
// is globally unique, so a tenant-namespaced synthetic address is what lets
// two tenants share a real one. Plus-addressing rather than a colon prefix
// because Better Auth validates with zod's z.email().
function namespacedEmail(organizationId: string, email: string): string {
  const [localPart, domain] = email.toLowerCase().split('@');
  return `${localPart}+${organizationId}@${domain}`;
}

// Deliberately minimal, copied from demo-seed.ts's own instance rather than
// the shared better-auth.config.ts factory, for the two reasons that file
// documents: the factory needs a NotificationService this script cannot
// construct without a full NestJS bootstrap, and its haveIBeenPwned plugin
// calls the real api.pwnedpasswords.com on every sign-up — which would make
// seeding 45 users both network-dependent and likely to fail outright on a
// shared dev password.
function createAuthInstance(prisma: PrismaClient) {
  return betterAuth({
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    secret: process.env['BETTER_AUTH_SECRET'],
    emailAndPassword: {
      enabled: true,
      password: {
        hash: (password: string) => argon2.hash(password, { type: argon2.argon2id }),
        verify: ({ hash, password }: { hash: string; password: string }) =>
          argon2.verify(hash, password),
      },
    },
    user: { modelName: 'authUser' },
    session: { modelName: 'authSession' },
    account: { modelName: 'authAccount' },
    verification: { modelName: 'authVerification' },
    advanced: { database: { generateId: false } },
  });
}

export async function applyPeople(
  deps: { prisma: PrismaService; rawPrisma: PrismaClient; userService: UserService },
  fixture: TenantFixture,
  ctx: SeedContext,
  actorId: string,
): Promise<void> {
  const { prisma, rawPrisma, userService } = deps;
  const auth = createAuthInstance(rawPrisma);

  // -- Positions --------------------------------------------------------------
  // Direct create, mirroring seedDefaultPositions()' own approach. That
  // bypasses validateHeadFlagPairing(), which is exactly why validateFixture()
  // enforces the isUnitHeadPosition/isSingleAssignee pairing itself.
  for (const position of fixture.positions) {
    const created = await prisma.orgPosition.create({
      data: {
        organizationId: ctx.organizationId,
        nameEn: position.nameEn,
        nameAr: position.nameAr,
        grade: position.grade,
        isUnitHeadPosition: position.isUnitHeadPosition ?? false,
        isSingleAssignee: position.isSingleAssignee ?? false,
      },
    });
    ctx.positionIdByName.set(position.nameEn, created.id);
  }

  // The 10 DEFAULT_POSITIONS bootstrap() already created are equally usable by
  // fixtures, so resolve them into the same map.
  for (const existing of await prisma.orgPosition.findMany({
    where: { organizationId: ctx.organizationId },
  })) {
    if (!ctx.positionIdByName.has(existing.nameEn)) {
      ctx.positionIdByName.set(existing.nameEn, existing.id);
    }
  }

  // -- People -----------------------------------------------------------------
  const ordered = orderPeopleForInvite(fixture);

  for (const person of ordered) {
    const email = `${person.emailLocal}@${fixture.emailDomain}`;
    const positionId = resolve(ctx.positionIdByName, person.position, 'position');
    const primaryOrgUnitId = resolve(ctx.unitIdByKey, person.unit, 'org unit');
    const managerId = person.reportsTo
      ? resolve(ctx.personIdByKey, person.reportsTo, 'person')
      : undefined;

    let userId: string;

    if (person.key === fixture.adminKey) {
      // createTenant() already invited this person as 'Director' in the root
      // unit, so inviting again would hit the duplicate-email conflict. Update
      // in place instead. Only the position differs — the unit is already root
      // and there is no manager — so this is a title reconciliation, not a
      // move.
      const existing = await prisma.user.findFirst({
        where: { organizationId: ctx.organizationId, email },
      });
      if (!existing) {
        throw new Error(
          `Expected createTenant() to have invited the tenant admin '${email}' before seeding people. ` +
            "Not found — was the fixture's adminKey email passed to createTenant()?",
        );
      }
      await prisma.user.update({
        where: { id: existing.id },
        data: { name: person.name, positionId },
      });
      userId = existing.id;
    } else {
      const invited = await userService.invite(
        { email, name: person.name, positionId, primaryOrgUnitId, managerId },
        ctx.organizationId,
        actorId,
      );
      userId = invited.id;
    }

    // -- Activate ------------------------------------------------------------
    // Mirrors AuthService.acceptInvitation()'s own state transition exactly
    // (authUserId + status ACTIVE + clearing the token), rather than calling
    // it: acceptInvitation() runs against the full auth instance, whose
    // haveIBeenPwned plugin would reject a shared dev password and would add a
    // network round-trip per user. The four fields below are the whole of what
    // that method changes — see auth.service.ts.
    //
    // This must happen BEFORE the next person is invited: the ACC-46 staffing
    // block counts ACTIVE holders only, so a still-INVITED head does not
    // unlock their unit.
    const signUp = await auth.api.signUpEmail({
      body: {
        email: namespacedEmail(ctx.organizationId, email),
        password: SEED_PASSWORD,
        name: person.name,
      },
    });

    await prisma.user.update({
      where: { id: userId },
      data: {
        authUserId: signUp.user.id,
        status: 'ACTIVE',
        invitationToken: null,
        invitationExpiresAt: null,
      },
    });

    ctx.personIdByKey.set(person.key, userId);
  }
}
