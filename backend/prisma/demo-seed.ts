// ⚠️ DEVELOPMENT ONLY — do not run against a production database.
//
// GENESIS-ONLY (ACC-23): creates ONLY the designated AccreditMe platform
// Organization (isPlatformOrg: true) and its PLATFORM_ADMIN user (ACC-13),
// with a real, working Better Auth credential (Step 9), and prints login
// credentials for the real Angular login page at http://localhost:4200/login.
//
// This script used to ALSO hand-roll a demo TENANT (org, lookups, roles,
// positions, root org unit, user, TENANT_ADMIN assignment) via direct Prisma
// writes that duplicated TenantService.bootstrap()'s own steps. That demo
// tenant is now created for real, through the Super Admin Portal's actual
// "Create Tenant" flow (POST /platform/tenants -> PlatformTenantService.
// createTenant() -> TenantService.bootstrap()) — log in as the platform
// admin below and use the portal, rather than running this script twice.
//
// Why the duplication was removed (ACC-23): a hand-rolled copy of
// bootstrap() logic silently falls behind every time bootstrap() gains a new
// step. This is exactly what happened here — bootstrap() started calling
// WorkflowTemplateService.seedDefaultWorkflows() when the workflow engine
// shipped (ACC-9), but this script was never updated to match, so any tenant
// created only through this script ended up with zero WorkflowTemplate rows,
// for any object type, silently. Routing demo-tenant creation through the
// real endpoint instead means there's only ever one implementation of
// "provision a tenant" to keep in sync — this script can't drift from it
// again because it no longer reimplements any part of it.
//
// The platform org itself is a narrower, permanent exception: it isn't
// created via the Super Admin Portal (nothing can — creating the *first*
// platform org is what this script is for), so it still can't call
// TenantService.bootstrap() and still hand-rolls its own Better Auth
// signup + PLATFORM_ADMIN role assignment below, same as before.
//
// Uses the Prisma client directly — no NestJS DI, no RoleService/AuthService
// instances — because bootstrapping the real AppModule via NestFactory pulls
// in PrismaService's `.js`-suffixed generated-client import, which only
// resolves correctly under Nest CLI's own toolchain, not plain ts-node (this
// repo's tsconfig.json uses classic "moduleResolution": "node"). Importing
// the generated client here with no extension sidesteps that entirely. The
// same constraint is why this script builds its own minimal Better Auth
// instance below rather than importing
// providers/auth/better-auth.config.ts's shared factory (that factory takes a
// NotificationService, which needs a live BullMQ/Redis queue to construct).
//
// The role-seeding logic below mirrors RoleService.seedPermissions() +
// seedSystemRoles() and AuthService.namespacedEmail() exactly (same upsert
// shape, same compound unique keys, same namespacing rule) — kept in sync by
// hand since this script can't call the real services directly. Still
// duplicated logic, same as the platform org creation above — an accepted,
// narrower exception, not the same "silently reimplements a much larger and
// still-growing bootstrap()" problem this ticket removed.
//
// Run: npm run seed:demo

import 'dotenv/config';
import * as argon2 from 'argon2';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { SYSTEM_ROLE_SEED } from '../src/foundation/roles/role.seed';
import { ALL_PERMISSIONS } from '../src/foundation/roles/permission.seed';

// ACC-13 — the one Organization row PlatformGuard expects to find with
// isPlatformOrg: true. Reuses the same PLATFORM_ADMIN_EMAIL env var already
// documented in .env.example/CLAUDE.md (previously unused by any code path).
const PLATFORM_ORG_SLUG = 'platform';
const PLATFORM_ORG_NAME = 'AccreditMe Platform';
const PLATFORM_ADMIN_EMAIL =
  process.env['PLATFORM_ADMIN_EMAIL'] ?? 'admin@accreditme.com';
// Hardcoded, dev-only — never used in production. Real users always set
// their own password via the invitation/accept-invitation flow (Step 9).
const PLATFORM_ADMIN_PASSWORD = 'Platform@123456';

// Mirrors AuthService.namespacedEmail() (backend/src/foundation/auth/auth.service.ts)
// exactly — Better Auth's AuthUser.email is a tenant-namespaced synthetic
// value, never the real email, so two tenants can share a real address
// without colliding in Better Auth's own (globally-unique) identity space.
// Uses RFC 5321 plus-addressing (not a colon prefix) so the result stays a
// syntactically valid email — Better Auth's routes validate the body with
// zod's z.email() and reject a colon in the local part.
function namespacedEmail(organizationId: string, email: string): string {
  const [localPart, domain] = email.toLowerCase().split('@');
  return `${localPart}+${organizationId}@${domain}`;
}

// A deliberately minimal Better Auth instance — NOT the shared
// providers/auth/better-auth.config.ts factory, which requires a
// NotificationService (for its sendResetPassword callback) this script has
// no way to construct without full NestJS bootstrap. This instance is only
// ever used to call signUpEmail() once, so it omits:
//   - the haveIBeenPwned plugin: it checks new passwords against the real
//     api.pwnedpasswords.com API on /sign-up/email, and the hardcoded
//     Platform@123456 pattern is exactly the kind of password that shows up
//     in real breach corpora — including this plugin would make seeding fail.
//   - the twoFactor plugin: irrelevant for a plain seed account.
//   - emailAndPassword.sendResetPassword: never invoked by this script.
function createAuthInstance(prisma: PrismaClient) {
  return betterAuth({
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    secret: process.env['BETTER_AUTH_SECRET'],
    emailAndPassword: {
      enabled: true,
      password: {
        hash: (password: string) =>
          argon2.hash(password, { type: argon2.argon2id }),
        verify: ({ hash, password }: { hash: string; password: string }) =>
          argon2.verify(hash, password),
      },
    },
    user: { modelName: 'authUser' },
    session: { modelName: 'authSession' },
    account: { modelName: 'authAccount' },
    verification: { modelName: 'authVerification' },
    advanced: {
      database: { generateId: false },
    },
  });
}

// ── Reimplements RoleService.seedPermissions() + seedSystemRoles() ──────────
async function seedSystemRoles(
  prisma: PrismaClient,
  organizationId: string,
): Promise<void> {
  for (const p of ALL_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { module_action: { module: p.module, action: p.action } },
      update: { description: p.description },
      create: {
        module: p.module,
        action: p.action,
        description: p.description,
      },
    });
  }

  const allPermissions = await prisma.permission.findMany();
  const permissionIdByKey = new Map(
    allPermissions.map((p) => [`${p.module}:${p.action}`, p.id]),
  );

  for (const seedRole of SYSTEM_ROLE_SEED) {
    const role = await prisma.role.upsert({
      where: { organizationId_key: { organizationId, key: seedRole.key } },
      update: {
        nameEn: seedRole.nameEn,
        nameAr: seedRole.nameAr,
        description: seedRole.description,
        isSystem: true,
      },
      create: {
        organizationId,
        key: seedRole.key,
        nameEn: seedRole.nameEn,
        nameAr: seedRole.nameAr,
        description: seedRole.description,
        isSystem: true,
      },
    });

    const permissionIds = seedRole.permissions
      .map((key) => permissionIdByKey.get(key))
      .filter((id): id is string => Boolean(id));

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    if (permissionIds.length > 0) {
      await prisma.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({
          roleId: role.id,
          permissionId,
        })),
      });
    }
  }
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    // ── Platform organization + platform admin (ACC-13) ───────────────────────
    let platformOrg = await prisma.organization.findUnique({
      where: { slug: PLATFORM_ORG_SLUG },
    });
    if (!platformOrg) {
      platformOrg = await prisma.organization.create({
        data: {
          name: PLATFORM_ORG_NAME,
          slug: PLATFORM_ORG_SLUG,
          country: 'KW',
          isPlatformOrg: true,
          isBootstrapped: false,
        },
      });
      console.log(
        `Created organization: ${platformOrg.name} (${platformOrg.id})`,
      );
    } else if (!platformOrg.isPlatformOrg) {
      platformOrg = await prisma.organization.update({
        where: { id: platformOrg.id },
        data: { isPlatformOrg: true },
      });
      console.log(
        `Reusing existing organization: ${platformOrg.name} (${platformOrg.id}) — set isPlatformOrg: true`,
      );
    } else {
      console.log(
        `Reusing existing organization: ${platformOrg.name} (${platformOrg.id})`,
      );
    }

    await seedSystemRoles(prisma, platformOrg.id);

    let platformRootUnit = await prisma.orgUnit.findUnique({
      where: {
        organizationId_code: {
          organizationId: platformOrg.id,
          code: 'PLATFORM',
        },
      },
    });
    if (!platformRootUnit) {
      platformRootUnit = await prisma.orgUnit.create({
        data: {
          organizationId: platformOrg.id,
          nameEn: PLATFORM_ORG_NAME,
          nameAr: 'منصة أكريدت مي',
          code: 'PLATFORM',
          sortOrder: 0,
        },
      });
      console.log(`Created root org unit: ${platformRootUnit.code}`);
    } else {
      console.log(`Reusing existing root org unit: ${platformRootUnit.code}`);
    }

    platformOrg = await prisma.organization.update({
      where: { id: platformOrg.id },
      data: {
        isBootstrapped: true,
        bootstrappedAt: platformOrg.bootstrappedAt ?? new Date(),
      },
    });

    let platformAdmin = await prisma.user.findUnique({
      where: {
        organizationId_email: {
          organizationId: platformOrg.id,
          email: PLATFORM_ADMIN_EMAIL,
        },
      },
    });
    if (!platformAdmin) {
      platformAdmin = await prisma.user.create({
        data: {
          organizationId: platformOrg.id,
          email: PLATFORM_ADMIN_EMAIL,
          name: 'Platform Admin',
          status: 'ACTIVE',
        },
      });
      console.log(
        `Created platform admin user: ${platformAdmin.email} (${platformAdmin.id})`,
      );
    } else {
      console.log(
        `Reusing existing platform admin user: ${platformAdmin.email} (${platformAdmin.id})`,
      );
    }

    if (!platformAdmin.authUserId) {
      const auth = createAuthInstance(prisma);
      const signUpResult = await auth.api.signUpEmail({
        body: {
          email: namespacedEmail(platformOrg.id, platformAdmin.email),
          password: PLATFORM_ADMIN_PASSWORD,
          name: platformAdmin.name,
        },
      });

      platformAdmin = await prisma.user.update({
        where: { id: platformAdmin.id },
        data: { authUserId: signUpResult.user.id },
      });
      console.log('Created Better Auth credential for platform admin user');
    } else {
      console.log(
        'Platform admin user already has a Better Auth credential — skipping',
      );
    }

    const platformAdminRole = await prisma.role.findFirst({
      where: { organizationId: platformOrg.id, key: 'PLATFORM_ADMIN' },
    });
    if (!platformAdminRole) {
      throw new Error(
        'PLATFORM_ADMIN role not found after seedSystemRoles() — this should never happen',
      );
    }

    const existingPlatformAssignment = await prisma.userRole.findFirst({
      where: { userId: platformAdmin.id, roleId: platformAdminRole.id },
    });
    if (!existingPlatformAssignment) {
      await prisma.userRole.create({
        data: { userId: platformAdmin.id, roleId: platformAdminRole.id },
      });
      console.log('Assigned PLATFORM_ADMIN role to platform admin user');
    } else {
      console.log(
        'Platform admin user already holds PLATFORM_ADMIN — skipping assignment',
      );
    }

    console.log('\n=== PLATFORM ADMIN LOGIN CREDENTIALS ===');
    console.log('URL:      http://localhost:4200/login');
    console.log(`Org slug: ${PLATFORM_ORG_SLUG}`);
    console.log('Email:    ' + platformAdmin.email);
    console.log('Password: ' + PLATFORM_ADMIN_PASSWORD);
    console.log('==========================================');
    console.log('\nNo demo tenant was created by this script (ACC-23). Log in');
    console.log('above, go to Super Admin -> Tenants -> Create Tenant, and');
    console.log('provision the demo tenant through the real bootstrap flow.\n');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
