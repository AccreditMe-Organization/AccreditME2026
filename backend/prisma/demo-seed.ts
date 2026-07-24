// ⚠️ DEVELOPMENT ONLY — do not run against a production database.
//
// Creates (or reuses, idempotently) a demo tenant + admin user and prints a
// ready-to-use JWT for testing the Angular UIs built in Steps 2–5 against
// http://localhost:4200/dev/login.
//
// Uses the Prisma client directly — no NestJS DI, no LookupService/RoleService
// instances — because bootstrapping the real AppModule via NestFactory pulls in
// PrismaService's `.js`-suffixed generated-client import, which only resolves
// correctly under Nest CLI's own toolchain, not plain ts-node (this repo's
// tsconfig.json uses classic "moduleResolution": "node"). Importing the
// generated client here with no extension sidesteps that entirely.
//
// The seeding logic below mirrors LookupService.seedSystemData() and
// RoleService.seedSystemRoles() exactly (same upsert shape, same compound
// unique keys) — kept in sync by hand since this script can't call the real
// services directly.
//
// Run: npm run seed:demo

import 'dotenv/config';
import { createHmac } from 'crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client';
import { SYSTEM_LOOKUP_SEED } from '../src/foundation/lookup/lookup.seed';
import { SYSTEM_ROLE_SEED } from '../src/foundation/roles/role.seed';
import { ALL_PERMISSIONS } from '../src/foundation/roles/permission.seed';

const DEMO_ORG_SLUG = 'demo';
const DEMO_ORG_NAME = 'Demo Hospital';
const DEMO_USER_EMAIL = 'admin@demo.accreditme.com';
const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

// Manual HS256 construction — matches TenantGuard's verifyJwt() exactly.
// No jsonwebtoken dependency needed.
function signDemoJwt(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const base64url = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const headerB64 = base64url(header);
  const payloadB64 = base64url(payload);
  const signature = createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');
  return `${headerB64}.${payloadB64}.${signature}`;
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
      ? await prisma.lookupCategory.update({ where: { id: existing.id }, data: categoryData })
      : await prisma.lookupCategory.create({
          data: { key: category.key, organizationId: null, isActive: true, ...categoryData },
        });

    for (const value of category.values) {
      const existingValue = await prisma.lookupValue.findFirst({
        where: { categoryId: seededCategory.id, key: value.key, organizationId: null },
      });

      const valueData = {
        labelEn: value.labelEn,
        labelAr: value.labelAr,
        attributes: value.attributes ? (value.attributes as Prisma.InputJsonValue) : Prisma.DbNull,
        sortOrder: value.sortOrder,
      };

      if (existingValue) {
        await prisma.lookupValue.update({ where: { id: existingValue.id }, data: valueData });
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
async function seedSystemRoles(prisma: PrismaClient, organizationId: string): Promise<void> {
  for (const p of ALL_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { module_action: { module: p.module, action: p.action } },
      update: { description: p.description },
      create: { module: p.module, action: p.action, description: p.description },
    });
  }

  const allPermissions = await prisma.permission.findMany();
  const permissionIdByKey = new Map(allPermissions.map((p) => [`${p.module}:${p.action}`, p.id]));

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
        data: permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })),
      });
    }
  }
}

async function main(): Promise<void> {
  const jwtSecret = process.env['JWT_SECRET'];
  if (!jwtSecret) {
    throw new Error('JWT_SECRET is not set — check backend/.env');
  }

  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    // ── Organization ─────────────────────────────────────────────────────────
    let org = await prisma.organization.findUnique({ where: { slug: DEMO_ORG_SLUG } });
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
      data: { isBootstrapped: true, bootstrappedAt: org.bootstrappedAt ?? new Date() },
    });

    // ── Demo user ────────────────────────────────────────────────────────────
    let user = await prisma.user.findUnique({
      where: { organizationId_email: { organizationId: org.id, email: DEMO_USER_EMAIL } },
    });
    if (!user) {
      user = await prisma.user.create({
        data: {
          organizationId: org.id,
          email: DEMO_USER_EMAIL,
          name: 'Demo Admin',
          status: 'ACTIVE',
        },
      });
      console.log(`Created demo user: ${user.email} (${user.id})`);
    } else {
      console.log(`Reusing existing demo user: ${user.email} (${user.id})`);
    }

    // ── TENANT_ADMIN role assignment ─────────────────────────────────────────
    const tenantAdminRole = await prisma.role.findFirst({
      where: { organizationId: org.id, key: 'TENANT_ADMIN' },
    });
    if (!tenantAdminRole) {
      throw new Error('TENANT_ADMIN role not found after seedSystemRoles() — this should never happen');
    }

    const existingAssignment = await prisma.userRole.findFirst({
      where: { userId: user.id, roleId: tenantAdminRole.id },
    });
    if (!existingAssignment) {
      await prisma.userRole.create({ data: { userId: user.id, roleId: tenantAdminRole.id } });
      console.log('Assigned TENANT_ADMIN role to demo user');
    } else {
      console.log('Demo user already holds TENANT_ADMIN — skipping assignment');
    }

    // ── JWT ──────────────────────────────────────────────────────────────────
    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = signDemoJwt(
      {
        sub: user.id,
        organizationId: org.id,
        tokenVersion: 1,
        exp: nowSeconds + TOKEN_TTL_SECONDS,
      },
      jwtSecret,
    );

    console.log('\n=== DEMO TOKEN (valid 30 days) ===');
    console.log(token);
    console.log('Paste this into http://localhost:4200/dev/login\n');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
