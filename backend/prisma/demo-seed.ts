// ⚠️ DEVELOPMENT ONLY — do not run against a production database.
//
// Creates (or reuses, idempotently) a demo tenant + admin user and prints a
// ready-to-use JWT for testing the Angular UIs built in Steps 2–5 against
// http://localhost:4200/dev/login.
//
// Run: npm run seed:demo

import 'dotenv/config';
import { createHmac } from 'crypto';
import { NestFactory } from '@nestjs/core';
import { ConflictException } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { LookupService } from '../src/foundation/lookup/lookup.service';
import { RoleService } from '../src/foundation/roles/role.service';

const DEMO_ORG_SLUG = 'demo';
const DEMO_ORG_NAME = 'Demo Hospital';
const DEMO_USER_EMAIL = 'admin@demo.accreditme.com';
const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

// Manual HS256 construction — matches TenantGuard's verifyJwt() exactly
// (same approach already validated against it earlier this session).
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

async function main(): Promise<void> {
  const jwtSecret = process.env['JWT_SECRET'];
  if (!jwtSecret) {
    throw new Error('JWT_SECRET is not set — check backend/.env');
  }

  // Bootstraps the real AppModule so we reuse the actual LookupService/RoleService
  // (with their real PrismaService, including the AuditLog-append-only $extends()
  // wrapper) instead of duplicating their DI wiring here.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const prisma = app.get(PrismaService);
  const lookupService = app.get(LookupService);
  const roleService = app.get(RoleService);

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
    await lookupService.seedSystemData();
    await roleService.seedSystemRoles(org.id);

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

    try {
      // Self-assigned actorId — this is a dev bootstrap script; no other actor exists yet.
      await roleService.assignRoleToUser(user.id, { roleId: tenantAdminRole.id }, org.id, user.id);
      console.log('Assigned TENANT_ADMIN role to demo user');
    } catch (err) {
      if (err instanceof ConflictException) {
        console.log('Demo user already holds TENANT_ADMIN — skipping assignment');
      } else {
        throw err;
      }
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
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
