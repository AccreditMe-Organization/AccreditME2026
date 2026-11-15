/**
 * ACC-164 — the administrator reset against a REAL Postgres (npm run test:db).
 *
 * What only a database proves: the person's row lock makes two administrators
 * pressing at once one reset and one MFA_NOT_ENABLED; the reset's writes all
 * commit together (flag off, secret row gone, open challenge gone, every
 * session ended); and the floor reads the real root role.
 *
 * Like every db-spec it FAILS without a database and refuses one that is not
 * on this machine, so it can never reach the shared dev database (ACC-120).
 */
import { randomUUID } from 'crypto';
import { HttpException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { SecurityNoticeService } from '../../notification/security-notice';
import { UserMfaResetService } from './user-mfa-reset.service';

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
}
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(60_000);

describe('The two-step reset against a real database (ACC-164)', () => {
  const prisma = new PrismaService();
  const notice = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const service = new UserMfaResetService(prisma, new AuditLogService(prisma), notice as unknown as SecurityNoticeService);

  beforeAll(async () => {
    await prisma.onModuleInit();
  });
  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  async function organisation() {
    const slug = `acc164-${randomUUID().slice(0, 8)}`;
    const org = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    const root = await prisma.role.create({
      data: { organizationId: org.id, key: 'TENANT_ADMIN', nameEn: 'Organization Administrator', isSystem: true },
    });
    const other = await prisma.role.create({ data: { organizationId: org.id, key: 'IT_LEAD', nameEn: 'IT lead' } });
    const person = async (name: string, opts: { mfa?: boolean; roleId?: string } = {}) => {
      const authUser = await prisma.authUser.create({
        data: { name, email: `${name}-${slug}+${org.id}@example.test`, twoFactorEnabled: opts.mfa ?? false },
      });
      if (opts.mfa) {
        await prisma.authTwoFactor.create({ data: { userId: authUser.id, secret: 'enc', backupCodes: 'enc', verified: true } });
      }
      const user = await prisma.user.create({
        data: { organizationId: org.id, email: `${name}-${slug}@example.test`, name, status: 'ACTIVE', authUserId: authUser.id },
      });
      if (opts.roleId) await prisma.userRole.create({ data: { userId: user.id, roleId: opts.roleId } });
      return { id: user.id, authUserId: authUser.id };
    };
    return { org, root, other, person };
  }

  it('resets it, ending every session, all in one commit', async () => {
    const { org, root, person } = await organisation();
    const admin = await person('nora', { roleId: root.id });
    const lina = await person('lina', { mfa: true });
    await prisma.authVerification.create({
      data: { identifier: `2fa-${lina.authUserId}`, value: lina.authUserId, expiresAt: new Date(Date.now() + 600_000) },
    });
    await prisma.authVerification.create({
      data: { identifier: `2fa-attempts-2fa-${lina.authUserId}`, value: '1', expiresAt: new Date(Date.now() + 600_000) },
    });
    await prisma.refreshToken.create({
      data: { userId: lina.id, organizationId: org.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 86_400_000) },
    });
    const before = await prisma.user.findFirstOrThrow({ where: { id: lina.id }, select: { tokenVersion: true } });

    await service.resetMfa(lina.id, org.id, admin.id, false);

    expect((await prisma.authUser.findUniqueOrThrow({ where: { id: lina.authUserId } })).twoFactorEnabled).toBe(false);
    expect(await prisma.authTwoFactor.count({ where: { userId: lina.authUserId } })).toBe(0);
    expect(await prisma.authVerification.count({ where: { value: lina.authUserId } })).toBe(0);
    expect(await prisma.authVerification.count({ where: { identifier: `2fa-attempts-2fa-${lina.authUserId}` } })).toBe(0);
    expect((await prisma.user.findFirstOrThrow({ where: { id: lina.id } })).tokenVersion).toBe(before.tokenVersion + 1);
    expect(await prisma.refreshToken.count({ where: { userId: lina.id, revokedAt: null } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { organizationId: org.id, objectId: lina.id, actorId: admin.id } })).toBe(1);
  });

  it('two administrators pressing at once: one reset and one MFA_NOT_ENABLED', async () => {
    const { org, root, person } = await organisation();
    const a = await person('a', { roleId: root.id });
    const b = await person('b', { roleId: root.id });
    const lina = await person('lina', { mfa: true });
    const before = await prisma.user.findFirstOrThrow({ where: { id: lina.id }, select: { tokenVersion: true } });

    const outcomes = await Promise.all(
      [a.id, b.id].map((actor) =>
        service.resetMfa(lina.id, org.id, actor, false).then(
          () => 'reset',
          (e: unknown) => (e instanceof HttpException ? (e.getResponse() as { code?: string }).code : String(e)),
        ),
      ),
    );
    expect(outcomes.sort()).toEqual(['MFA_NOT_ENABLED', 'reset']);
    expect((await prisma.user.findFirstOrThrow({ where: { id: lina.id } })).tokenVersion).toBe(before.tokenVersion + 1);
  });

  it('the floor: an IT lead with the key can reset a colleague, not an Organization Administrator', async () => {
    const { org, root, other, person } = await organisation();
    const itLead = await person('it', { roleId: other.id });
    const admin = await person('admin', { roleId: root.id, mfa: true });
    const lina = await person('lina', { mfa: true });

    await expect(service.resetMfa(admin.id, org.id, itLead.id, false)).rejects.toMatchObject({
      response: { code: 'MFA_RESET_HIGHER_ACCOUNT' },
    });
    expect((await prisma.authUser.findUniqueOrThrow({ where: { id: admin.authUserId } })).twoFactorEnabled).toBe(true);

    await service.resetMfa(lina.id, org.id, itLead.id, false);
    expect((await prisma.authUser.findUniqueOrThrow({ where: { id: lina.authUserId } })).twoFactorEnabled).toBe(false);
  });
});
