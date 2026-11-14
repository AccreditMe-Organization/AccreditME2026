/**
 * ACC-188 — reset links against a REAL Postgres (`npm run test:db`; CI runs it
 * after the migrations, so this also proves migration 64 applies).
 *
 * What only a database can prove: the User row lock really serialises
 * simultaneous requests, so exactly one link is ever open; and the reset's
 * transaction really ends the link, bumps tokenVersion and revokes the refresh
 * rows together.
 *
 * Refuses any database not on this machine, like every db-spec: it writes rows
 * and must never reach a shared database.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { TransactionalEmailService } from '../../notification/transactional-email.service';
import { SecurityNoticeService } from '../../notification/security-notice';
import { PasswordResetService } from './password-reset.service';
import { storedResetIdentifier } from './password-reset-verification';

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
}
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(60_000);

describe('Password reset links against a real database (ACC-188)', () => {
  const prisma = new PrismaService();
  const sent: { body: string }[] = [];
  const email = { send: jest.fn((e: { body: string }) => { sent.push(e); return Promise.resolve(); }) };
  const service = new PasswordResetService(
    prisma,
    { add: jest.fn() } as never,
    email as unknown as TransactionalEmailService,
    { enqueue: jest.fn().mockResolvedValue(undefined) } as unknown as SecurityNoticeService,
    new AuditLogService(prisma),
    { assertNotBreached: jest.fn().mockResolvedValue(undefined) },
  );

  async function person(): Promise<{ slug: string; organizationId: string; userId: string; email: string }> {
    const slug = `acc188-${randomUUID().slice(0, 8)}`;
    const org = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    const address = `${slug}@example.test`;
    const authUser = await prisma.authUser.create({ data: { name: 'Reset', email: `${slug}+${org.id}@example.test` } });
    const user = await prisma.user.create({
      data: { organizationId: org.id, email: address, name: 'Reset', status: 'ACTIVE', authUserId: authUser.id },
    });
    return { slug, organizationId: org.id, userId: user.id, email: address };
  }

  const tokenFromLastEmail = (): string => {
    const match = /reset-password\?token=([A-Za-z0-9_-]{43})/.exec(sent[sent.length - 1]?.body ?? '');
    if (!match?.[1]) throw new Error('no token sent');
    return match[1];
  };

  beforeAll(async () => {
    process.env['APP_BASE_DOMAIN'] = 'accreditme.app';
    delete process.env['APP_LINK_ORIGIN'];
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('five simultaneous requests leave exactly ONE open link; the rest are REPLACED', async () => {
    const p = await person();
    await Promise.all(
      Array.from({ length: 5 }, () => service.issue({ organizationSlug: p.slug, email: p.email })),
    );
    const links = await prisma.passwordResetLink.findMany({
      where: { organizationId: p.organizationId, userId: p.userId },
    });
    expect(links).toHaveLength(5);
    expect(links.filter((l) => l.endedAt === null)).toHaveLength(1);
    expect(links.filter((l) => l.endReason === 'REPLACED')).toHaveLength(4);
  });

  it("a reset ends the link, bumps tokenVersion and revokes refresh rows in one go; Better Auth's row is the hashed one", async () => {
    const p = await person();
    await prisma.refreshToken.create({
      data: {
        userId: p.userId,
        organizationId: p.organizationId,
        tokenHash: randomUUID(),
        tokenVersion: 0,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    await service.issue({ organizationSlug: p.slug, email: p.email });
    const token = tokenFromLastEmail();
    const verification = await prisma.authVerification.findFirst({
      where: { identifier: storedResetIdentifier(token) },
    });
    expect(verification).not.toBeNull();
    expect(await prisma.authVerification.count({ where: { identifier: { contains: token } } })).toBe(0);

    await service.reset(
      { token, password: 'a-long-new-password-1' },
      `https://${p.slug}.accreditme.app`,
      '203.0.113.9',
      () => Promise.resolve(new Response(JSON.stringify({ status: true }), { status: 200 })),
    );

    const [link, user, live] = await Promise.all([
      prisma.passwordResetLink.findFirst({ where: { organizationId: p.organizationId, userId: p.userId } }),
      prisma.user.findFirst({ where: { id: p.userId, organizationId: p.organizationId } }),
      prisma.refreshToken.count({ where: { userId: p.userId, revokedAt: null } }),
    ]);
    expect(link?.endReason).toBe('USED');
    expect(user?.tokenVersion).toBe(1);
    expect(live).toBe(0);
  });
});
