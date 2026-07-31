// ⚠️ DEVELOPMENT ONLY — do not run against a production database.
//
// Creates (or reuses, idempotently) a demo tenant + admin user, plus the
// designated AccreditMe platform org + a PLATFORM_ADMIN user (ACC-13), each
// with a real, working Better Auth credential (Step 9), and prints login
// credentials for the real Angular login page at http://localhost:4200/login.
// Before Step 9
// this script printed a hand-signed JWT for the now-removed /dev/login page —
// that flow no longer exists; this script creates everything directly
// (no invitation flow) since it's a developer tool, not a proof of the real
// invite-by-email path.
//
// Uses the Prisma client directly — no NestJS DI, no LookupService/RoleService/
// AuthService instances — because bootstrapping the real AppModule via
// NestFactory pulls in PrismaService's `.js`-suffixed generated-client import,
// which only resolves correctly under Nest CLI's own toolchain, not plain
// ts-node (this repo's tsconfig.json uses classic "moduleResolution": "node").
// Importing the generated client here with no extension sidesteps that
// entirely. The same constraint is why this script builds its own minimal
// Better Auth instance below rather than importing
// providers/auth/better-auth.config.ts's shared factory (that factory takes a
// NotificationService, which needs a live BullMQ/Redis queue to construct).
//
// The seeding logic below mirrors LookupService.seedSystemData(),
// RoleService.seedSystemRoles(), and AuthService.namespacedEmail() exactly
// (same upsert shape, same compound unique keys, same namespacing rule) —
// kept in sync by hand since this script can't call the real services
// directly.
//
// Run: npm run seed:demo

import 'dotenv/config';
import * as argon2 from 'argon2';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client';
import { SYSTEM_LOOKUP_SEED } from '../src/foundation/lookup/lookup.seed';
import { SYSTEM_ROLE_SEED } from '../src/foundation/roles/role.seed';
import { ALL_PERMISSIONS } from '../src/foundation/roles/permission.seed';
import { DEFAULT_POSITIONS } from '../src/foundation/org-position/org-position.seed';

const DEMO_ORG_SLUG = 'demo';
const DEMO_ORG_NAME = 'Demo Hospital';
const DEMO_ADMIN_EMAIL =
  process.env['DEMO_ADMIN_EMAIL'] ?? 'admin@demo.accreditme.com';
// Hardcoded, dev-only — never used in production. Real users always set
// their own password via the invitation/accept-invitation flow (Step 9).
const DEMO_ADMIN_PASSWORD = 'Demo@123456';

// ACC-13 — the one Organization row PlatformGuard expects to find with
// isPlatformOrg: true. Reuses the same PLATFORM_ADMIN_EMAIL env var already
// documented in .env.example/CLAUDE.md (previously unused by any code path).
const PLATFORM_ORG_SLUG = 'platform';
const PLATFORM_ORG_NAME = 'AccreditMe Platform';
const PLATFORM_ADMIN_EMAIL =
  process.env['PLATFORM_ADMIN_EMAIL'] ?? 'admin@accreditme.com';
// Hardcoded, dev-only — same rationale as DEMO_ADMIN_PASSWORD above.
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

// A second, deliberately minimal Better Auth instance — NOT the shared
// providers/auth/better-auth.config.ts factory, which requires a
// NotificationService (for its sendResetPassword callback) this script has
// no way to construct without full NestJS bootstrap. This instance is only
// ever used to call signUpEmail() once, so it omits:
//   - the haveIBeenPwned plugin: it checks new passwords against the real
//     api.pwnedpasswords.com API on /sign-up/email, and the hardcoded
//     Demo@123456 pattern is exactly the kind of password that shows up in
//     real breach corpora — including this plugin would make seeding fail.
//   - the twoFactor plugin: irrelevant for a plain seed account.
//   - emailAndPassword.sendResetPassword: never invoked by this script.
function createDemoAuthInstance(prisma: PrismaClient) {
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

// ── Reimplements LookupService.seedSystemData() with raw Prisma calls ───────
async function seedSystemLookups(prisma: PrismaClient): Promise<void> {
  for (const category of SYSTEM_LOOKUP_SEED) {
    const existing = await prisma.lookupCategory.findFirst({
      where: { key: category.key, organizationId: null },
    });

    const categoryData = {
      labelEn: category.labelEn,
      labelAr: category.labelAr,
      isSystem: true,
      isExtensible: category.isExtensible,
      attributeSchema: category.attributeSchema
        ? (category.attributeSchema as Prisma.InputJsonValue)
        : Prisma.DbNull,
      sortOrder: category.sortOrder,
    };

    const seededCategory = existing
      ? await prisma.lookupCategory.update({
          where: { id: existing.id },
          data: categoryData,
        })
      : await prisma.lookupCategory.create({
          data: {
            key: category.key,
            organizationId: null,
            isActive: true,
            ...categoryData,
          },
        });

    for (const value of category.values) {
      const existingValue = await prisma.lookupValue.findFirst({
        where: {
          categoryId: seededCategory.id,
          key: value.key,
          organizationId: null,
        },
      });

      const valueData = {
        labelEn: value.labelEn,
        labelAr: value.labelAr,
        attributes: value.attributes
          ? (value.attributes as Prisma.InputJsonValue)
          : Prisma.DbNull,
        sortOrder: value.sortOrder,
      };

      if (existingValue) {
        await prisma.lookupValue.update({
          where: { id: existingValue.id },
          data: valueData,
        });
      } else {
        await prisma.lookupValue.create({
          data: {
            categoryId: seededCategory.id,
            organizationId: null,
            key: value.key,
            layer: 'SYSTEM',
            isActive: true,
            isHidden: false,
            ...valueData,
          },
        });
      }
    }
  }
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

// ── Reimplements OrgPositionService.seedDefaultPositions() ──────────────────
async function seedDefaultPositions(
  prisma: PrismaClient,
  organizationId: string,
): Promise<void> {
  for (const position of DEFAULT_POSITIONS) {
    const existing = await prisma.orgPosition.findFirst({
      where: { organizationId, orgUnitId: null, nameEn: position.nameEn },
    });
    if (existing) continue;

    await prisma.orgPosition.create({
      data: {
        organizationId,
        orgUnitId: null,
        nameEn: position.nameEn,
        nameAr: position.nameAr,
        grade: position.grade,
      },
    });
  }
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    // ── Organization ─────────────────────────────────────────────────────────
    let org = await prisma.organization.findUnique({
      where: { slug: DEMO_ORG_SLUG },
    });
    if (!org) {
      org = await prisma.organization.create({
        data: {
          name: DEMO_ORG_NAME,
          slug: DEMO_ORG_SLUG,
          country: 'KW',
          isBootstrapped: false,
        },
      });
      console.log(`Created organization: ${org.name} (${org.id})`);
    } else {
      console.log(`Reusing existing organization: ${org.name} (${org.id})`);
    }

    // ── Bootstrap steps — idempotent, mirror TenantService.bootstrap() ───────
    // Order matches tenant.service.ts's bootstrap(): positions, then
    // lookups, then roles (workflows not mirrored here — out of scope, this
    // script doesn't need default workflow templates for anything it seeds).
    await seedDefaultPositions(prisma, org.id);
    await seedSystemLookups(prisma);
    await seedSystemRoles(prisma, org.id);

    let rootUnit = await prisma.orgUnit.findUnique({
      where: { organizationId_code: { organizationId: org.id, code: 'DEMO' } },
    });
    if (!rootUnit) {
      rootUnit = await prisma.orgUnit.create({
        data: {
          organizationId: org.id,
          nameEn: DEMO_ORG_NAME,
          nameAr: 'مستشفى تجريبي',
          code: 'DEMO',
          sortOrder: 0,
        },
      });
      console.log(`Created root org unit: ${rootUnit.code}`);
    } else {
      console.log(`Reusing existing root org unit: ${rootUnit.code}`);
    }

    org = await prisma.organization.update({
      where: { id: org.id },
      data: {
        isBootstrapped: true,
        bootstrappedAt: org.bootstrappedAt ?? new Date(),
      },
    });

    // ── Demo user ────────────────────────────────────────────────────────────
    let user = await prisma.user.findUnique({
      where: {
        organizationId_email: {
          organizationId: org.id,
          email: DEMO_ADMIN_EMAIL,
        },
      },
    });
    if (!user) {
      user = await prisma.user.create({
        data: {
          organizationId: org.id,
          email: DEMO_ADMIN_EMAIL,
          name: 'Demo Admin',
          status: 'ACTIVE',
        },
      });
      console.log(`Created demo user: ${user.email} (${user.id})`);
    } else {
      console.log(`Reusing existing demo user: ${user.email} (${user.id})`);
    }

    // ── Better Auth credential — created directly, no invitation flow ────────
    if (!user.authUserId) {
      const auth = createDemoAuthInstance(prisma);
      const signUpResult = await auth.api.signUpEmail({
        body: {
          email: namespacedEmail(org.id, user.email),
          password: DEMO_ADMIN_PASSWORD,
          name: user.name,
        },
      });

      user = await prisma.user.update({
        where: { id: user.id },
        data: { authUserId: signUpResult.user.id },
      });
      console.log('Created Better Auth credential for demo user');
    } else {
      console.log('Demo user already has a Better Auth credential — skipping');
    }

    // ── TENANT_ADMIN role assignment ─────────────────────────────────────────
    const tenantAdminRole = await prisma.role.findFirst({
      where: { organizationId: org.id, key: 'TENANT_ADMIN' },
    });
    if (!tenantAdminRole) {
      throw new Error(
        'TENANT_ADMIN role not found after seedSystemRoles() — this should never happen',
      );
    }

    const existingAssignment = await prisma.userRole.findFirst({
      where: { userId: user.id, roleId: tenantAdminRole.id },
    });
    if (!existingAssignment) {
      await prisma.userRole.create({
        data: { userId: user.id, roleId: tenantAdminRole.id },
      });
      console.log('Assigned TENANT_ADMIN role to demo user');
    } else {
      console.log('Demo user already holds TENANT_ADMIN — skipping assignment');
    }

    console.log('\n=== DEMO LOGIN CREDENTIALS ===');
    console.log('URL:      http://localhost:4200/login');
    console.log('Org slug: demo');
    console.log('Email:    ' + user.email);
    console.log('Password: Demo@123456');
    console.log('==============================\n');

    // ── Platform organization + platform admin (ACC-13) ───────────────────────
    // Mirrors the demo tenant block above exactly (org → roles → root org unit
    // → user → Better Auth credential → role assignment), but creates the
    // designated platform Organization (isPlatformOrg: true) and assigns
    // PLATFORM_ADMIN instead of TENANT_ADMIN — lets the Super Admin Portal be
    // exercised through the real /login page instead of hand-editing
    // Organization.isPlatformOrg + UserRole in Prisma Studio.
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

    // Lookups are global (organizationId: null) — already seeded above via
    // the demo org block, no need to repeat. Roles are org-scoped though.
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
      const auth = createDemoAuthInstance(prisma);
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
    console.log('==========================================\n');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
