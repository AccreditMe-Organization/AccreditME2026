import { HttpException, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { buildTenantUrl } from '../../../common/config/app-url.config';
import { itEnforcesTenantIsolation } from '../../../common/testing/tenant-isolation';
import { TransactionalEmailService } from '../../notification/transactional-email.service';
import { SecurityNoticeService } from '../../notification/security-notice';
import { PasswordRefusalException } from '../password-refusal';
import {
  BetterAuthResetPassword,
  PASSWORD_RESET_JOB,
  PasswordResetService,
} from './password-reset.service';
import { storedResetIdentifier } from './password-reset-verification';
import { RESET_LINK_TTL_MS, hashResetToken } from './reset-link.config';

/**
 * ACC-188 — the reset flow, end to end inside the service, over a small
 * in-memory database. Better Auth's resetPassword is replaced by a fake that
 * behaves like the installed library: it CONSUMES the row its hashed identifier
 * names (once, and not after it expires) and answers with a returned Response,
 * never a rejected promise.
 */

const ORG_A = {
  id: 'org-a',
  slug: 'al-nakheel',
  status: 'ACTIVE',
  name: 'Al Nakheel Hospital',
  nameAr: 'مستشفى النخيل',
  language: 'en',
};
const ORG_B = { ...ORG_A, id: 'org-b', slug: 'al-manara', name: 'Al Manara', nameAr: null };
const ORIGIN_A = 'https://al-nakheel.accreditme.app';
const ORIGIN_B = 'https://al-manara.accreditme.app';
const PASSWORD = 'a-long-new-password-1';

interface UserRow {
  id: string;
  organizationId: string;
  email: string;
  status: string;
  authUserId: string | null;
  language: string | null;
  tokenVersion: number;
}
interface LinkRow {
  id: string;
  organizationId: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  endedAt: Date | null;
  endReason: 'USED' | 'REPLACED' | 'VOID' | null;
  createdAt: Date;
}

type Where = Record<string, unknown>;

/** The row at this index, or a failed test — never undefined. */
function at<T>(list: T[], index: number): T {
  const row = list[index];
  if (row === undefined) throw new Error(`no row ${index}`);
  return row;
}

function makeDb() {
  const orgs = [{ ...ORG_A }, { ...ORG_B }];
  const users: UserRow[] = [
    { id: 'u-a', organizationId: 'org-a', email: 'hessa@example.test', status: 'ACTIVE', authUserId: 'au-a', language: null, tokenVersion: 3 },
    { id: 'u-b', organizationId: 'org-b', email: 'hessa@example.test', status: 'ACTIVE', authUserId: 'au-b', language: null, tokenVersion: 0 },
    { id: 'u-invited', organizationId: 'org-a', email: 'new@example.test', status: 'INVITED', authUserId: null, language: null, tokenVersion: 0 },
    { id: 'u-inactive', organizationId: 'org-a', email: 'gone@example.test', status: 'INACTIVE', authUserId: 'au-gone', language: null, tokenVersion: 0 },
    { id: 'u-ar', organizationId: 'org-a', email: 'arabic@example.test', status: 'ACTIVE', authUserId: 'au-ar', language: 'ar', tokenVersion: 0 },
  ];
  const links: LinkRow[] = [];
  const verifications: { identifier: string; value: string; expiresAt: Date }[] = [];
  const refreshTokens = [
    { userId: 'u-a', organizationId: 'org-a', revokedAt: null as Date | null },
    { userId: 'u-a', organizationId: 'org-a', revokedAt: null as Date | null },
    { userId: 'u-b', organizationId: 'org-b', revokedAt: null as Date | null },
  ];
  const loginAttempts: Record<string, unknown>[] = [];
  const authSessionDeletes: Where[] = [];
  let seq = 0;

  const linkMatches = (row: LinkRow, where: Where): boolean =>
    Object.entries(where).every(([key, value]) => {
      if (key === 'OR') {
        return (value as Where[]).some((branch) => linkMatches(row, branch));
      }
      const field = row[key as keyof LinkRow];
      if (value !== null && typeof value === 'object' && 'lt' in value) {
        return field instanceof Date && field < (value as { lt: Date }).lt;
      }
      return field === value;
    });

  const authTwoFactor = { update: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn() };

  const db = {
    organization: {
      findUnique: jest.fn(({ where }: { where: { slug: string } }) =>
        Promise.resolve(orgs.find((o) => o.slug === where.slug) ?? null),
      ),
    },
    user: {
      findFirst: jest.fn(({ where }: { where: { organizationId: string; email: { equals: string } } }) =>
        Promise.resolve(
          users.find(
            (u) =>
              u.organizationId === where.organizationId &&
              u.email.toLowerCase() === where.email.equals.toLowerCase(),
          ) ?? null,
        ),
      ),
      updateMany: jest.fn(({ where, data }: { where: { id: string; organizationId: string }; data: { tokenVersion: { increment: number } } }) => {
        const hit = users.filter((u) => u.id === where.id && u.organizationId === where.organizationId);
        hit.forEach((u) => (u.tokenVersion += data.tokenVersion.increment));
        return Promise.resolve({ count: hit.length });
      }),
    },
    passwordResetLink: {
      create: jest.fn(({ data }: { data: Omit<LinkRow, 'id' | 'endedAt' | 'endReason' | 'createdAt'> }) => {
        const row: LinkRow = { ...data, id: `link-${++seq}`, endedAt: null, endReason: null, createdAt: new Date() };
        links.push(row);
        return Promise.resolve({ id: row.id });
      }),
      updateMany: jest.fn(({ where, data }: { where: Where; data: Partial<LinkRow> }) => {
        const hit = links.filter((l) => linkMatches(l, where));
        hit.forEach((l) => Object.assign(l, data));
        return Promise.resolve({ count: hit.length });
      }),
      deleteMany: jest.fn(({ where }: { where: Where }) => {
        const keep = links.filter((l) => !linkMatches(l, where));
        const count = links.length - keep.length;
        links.splice(0, links.length, ...keep);
        return Promise.resolve({ count });
      }),
      findUnique: jest.fn(({ where }: { where: { tokenHash: string } }) => {
        const row = links.find((l) => l.tokenHash === where.tokenHash);
        if (!row) return Promise.resolve(null);
        const user = users.find((u) => u.id === row.userId)!;
        const org = orgs.find((o) => o.id === row.organizationId)!;
        return Promise.resolve({
          id: row.id,
          expiresAt: row.expiresAt,
          endReason: row.endReason,
          user: { id: user.id, organizationId: user.organizationId, email: user.email, status: user.status, authUserId: user.authUserId },
          organization: { slug: org.slug, status: org.status },
        });
      }),
    },
    authVerification: {
      create: jest.fn(({ data }: { data: { identifier: string; value: string; expiresAt: Date } }) => {
        verifications.push({ ...data });
        return Promise.resolve(data);
      }),
    },
    refreshToken: {
      updateMany: jest.fn(({ where, data }: { where: { userId: string; organizationId: string; revokedAt: null }; data: { revokedAt: Date } }) => {
        const hit = refreshTokens.filter(
          (r) => r.userId === where.userId && r.organizationId === where.organizationId && r.revokedAt === null,
        );
        hit.forEach((r) => (r.revokedAt = data.revokedAt));
        return Promise.resolve({ count: hit.length });
      }),
    },
    authSession: {
      deleteMany: jest.fn(({ where }: { where: Where }) => {
        authSessionDeletes.push(where);
        return Promise.resolve({ count: 1 });
      }),
    },
    loginAttempt: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        loginAttempts.push(data);
        return Promise.resolve(data);
      }),
    },
    authTwoFactor,
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(<T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db)),
  };

  /** Better Auth's resetPassword, as the installed library behaves (api/routes/password.mjs). */
  const betterAuthReset = jest.fn<Promise<Response>, [string, string]>((token: string) => {
    const identifier = storedResetIdentifier(token);
    const index = verifications.findIndex((v) => v.identifier === identifier);
    const row = index >= 0 ? verifications.splice(index, 1)[0] : undefined; // consumed either way
    if (!row || row.expiresAt < new Date()) {
      return Promise.resolve(new Response(JSON.stringify({ code: 'INVALID_TOKEN' }), { status: 400 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ status: true }), { status: 200 }));
  });

  return { db, orgs, users, links, verifications, refreshTokens, loginAttempts, authSessionDeletes, authTwoFactor, betterAuthReset };
}

describe('PasswordResetService (ACC-188)', () => {
  let store: ReturnType<typeof makeDb>;
  let queue: { add: jest.Mock };
  let email: { send: jest.Mock };
  let notices: { enqueue: jest.Mock };
  let audit: { log: jest.Mock };
  let breach: { assertNotBreached: jest.Mock };
  let service: PasswordResetService;
  let logError: jest.SpyInstance;

  const savedEnv = { ...process.env };

  beforeEach(() => {
    process.env['APP_BASE_DOMAIN'] = 'accreditme.app';
    process.env['API_ORIGIN'] = 'https://api.accreditme.app';
    delete process.env['APP_LINK_ORIGIN'];
    store = makeDb();
    queue = { add: jest.fn().mockResolvedValue({}) };
    email = { send: jest.fn().mockResolvedValue(undefined) };
    notices = { enqueue: jest.fn().mockResolvedValue(undefined) };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    breach = { assertNotBreached: jest.fn().mockResolvedValue(undefined) };
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    service = new PasswordResetService(
      store.db as unknown as PrismaService,
      queue as never,
      email as unknown as TransactionalEmailService,
      notices as unknown as SecurityNoticeService,
      audit as unknown as AuditLogService,
      breach,
    );
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    logError.mockRestore();
  });

  /** Issue a link for this address and return the token from the email. */
  async function issueFor(address: string, slug = ORG_A.slug, now?: Date): Promise<string> {
    const before = email.send.mock.calls.length;
    await service.issue({ organizationSlug: slug, email: address }, now);
    const call = email.send.mock.calls[before] as [{ body: string }] | undefined;
    if (!call) throw new Error('no email was sent');
    const match = /\/reset-password\?token=([A-Za-z0-9_-]{43})/.exec(call[0].body);
    const token = match?.[1];
    if (!token) throw new Error('no token in the email');
    return token;
  }

  const reset = (token: string, password = PASSWORD, origin = ORIGIN_A): Promise<void> =>
    service.reset({ token, password }, origin, '203.0.113.9', store.betterAuthReset as BetterAuthResetPassword);

  async function refusalOf(promise: Promise<unknown>): Promise<HttpException> {
    try {
      await promise;
    } catch (err) {
      if (err instanceof HttpException) return err;
      throw err;
    }
    throw new Error('expected a refusal');
  }

  async function codeOf(promise: Promise<unknown>): Promise<string> {
    const err = await refusalOf(promise);
    return (err.getResponse() as { code: string }).code;
  }

  describe('request() — in the request', () => {
    it('adds ONE job carrying only the organisation and the address, and reads nothing', async () => {
      await service.request({ organizationSlug: 'al-nakheel', email: 'hessa@example.test' });
      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(queue.add).toHaveBeenCalledWith(
        PASSWORD_RESET_JOB,
        { organizationSlug: 'al-nakheel', email: 'hessa@example.test' },
        { attempts: 1, removeOnComplete: true, removeOnFail: { age: 7 * 24 * 3600 } },
      );
      expect(store.db.organization.findUnique).not.toHaveBeenCalled();
      expect(store.db.user.findFirst).not.toHaveBeenCalled();
    });

    it('still answers when the queue is down, and logs no address', async () => {
      queue.add.mockRejectedValue(new Error('connect ECONNREFUSED redis.internal:6379'));
      await expect(
        service.request({ organizationSlug: 'al-nakheel', email: 'hessa@example.test' }),
      ).resolves.toBeUndefined();
      const logged = JSON.stringify(logError.mock.calls);
      expect(logged).not.toContain('hessa@example.test');
      expect(logged).not.toContain('redis.internal');
    });
  });

  describe('issue() — in the worker', () => {
    it("emails a TENANT link built by buildTenantUrl(), never Better Auth's", async () => {
      const token = await issueFor('Hessa@Example.test');
      const [sent] = email.send.mock.calls[0] as [{ to: string; subject: string; body: string; direction: string }];
      expect(sent.to).toBe('hessa@example.test');
      expect(sent.body).toContain(buildTenantUrl('al-nakheel', `/reset-password?token=${token}`));
      expect(sent.body).toContain('https://al-nakheel.accreditme.app/reset-password?token=');
      expect(sent.body).not.toContain('api.accreditme.app');
      expect(sent.body).toContain('within 1 hour');
      expect(sent.direction).toBe('ltr');
    });

    it("writes the ledger row as a SHA-256 of the token, and Better Auth's row hashed, both expiring in 1 hour", async () => {
      const now = new Date('2026-11-14T09:00:00.000Z');
      const token = await issueFor('hessa@example.test', ORG_A.slug, now);
      expect(token).toHaveLength(43);
      expect(store.links).toHaveLength(1);
      expect(at(store.links, 0).tokenHash).toBe(hashResetToken(token));
      expect(at(store.links, 0).tokenHash).not.toContain(token);
      expect(at(store.links, 0).expiresAt.getTime()).toBe(now.getTime() + RESET_LINK_TTL_MS);
      expect(store.verifications).toEqual([
        { identifier: storedResetIdentifier(token), value: 'au-a', expiresAt: at(store.links, 0).expiresAt },
      ]);
      expect(at(store.verifications, 0).identifier).not.toContain(token);
      expect(store.db.$queryRaw).toHaveBeenCalled(); // the User row lock
    });

    it('a second link ENDS the first as REPLACED, in the same transaction', async () => {
      const first = await issueFor('hessa@example.test');
      const second = await issueFor('hessa@example.test');
      expect(store.links.filter((l) => l.endedAt === null)).toHaveLength(1);
      expect(await codeOf(service.lookup({ token: first }, ORIGIN_A))).toBe('RESET_LINK_REPLACED');
      await expect(service.lookup({ token: second }, ORIGIN_A)).resolves.toEqual(
        expect.objectContaining({ state: 'open' }),
      );
      expect(store.db.$transaction).toHaveBeenCalledTimes(2);
    });

    it('deletes this person\'s links that ended or expired more than 30 days ago, and keeps the rest', async () => {
      const day = 24 * 60 * 60 * 1000;
      const now = new Date('2026-11-14T09:00:00.000Z');
      const old = (offsetDays: number, ended: boolean): LinkRow => ({
        id: `old-${offsetDays}-${ended}`,
        organizationId: 'org-a',
        userId: 'u-a',
        tokenHash: `h-${offsetDays}-${ended}`,
        expiresAt: new Date(now.getTime() - offsetDays * day),
        endedAt: ended ? new Date(now.getTime() - offsetDays * day) : null,
        endReason: ended ? 'USED' : null,
        createdAt: new Date(now.getTime() - offsetDays * day),
      });
      store.links.push(old(31, true), old(31, false), old(29, true));
      await issueFor('hessa@example.test', ORG_A.slug, now);
      expect(store.links.map((l) => l.id)).toEqual(['old-29-true', expect.stringMatching(/^link-/)]);
    });

    it.each([
      ['an unknown organisation', 'hessa@example.test', 'nowhere'],
      ['an unknown address', 'nobody@example.test', 'al-nakheel'],
      ['an invited person (no password yet)', 'new@example.test', 'al-nakheel'],
      ['an inactive person', 'gone@example.test', 'al-nakheel'],
    ])('issues nothing and sends nothing for %s', async (_case, address, slug) => {
      await service.issue({ organizationSlug: slug, email: address });
      expect(store.links).toHaveLength(0);
      expect(store.verifications).toHaveLength(0);
      expect(email.send).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('issues nothing in a closed organisation', async () => {
      at(store.orgs, 0).status = 'SUSPENDED';
      await service.issue({ organizationSlug: 'al-nakheel', email: 'hessa@example.test' });
      expect(store.links).toHaveLength(0);
      expect(email.send).not.toHaveBeenCalled();
    });

    itEnforcesTenantIsolation('issue: the same address in another organisation is never used', async () => {
      await issueFor('hessa@example.test', ORG_B.slug);
      expect(store.links).toEqual([expect.objectContaining({ organizationId: 'org-b', userId: 'u-b' })]);
      expect(at(store.verifications, 0).value).toBe('au-b');
    });

    it("writes the email in the person's language, with the organisation's Arabic name", async () => {
      await issueFor('arabic@example.test');
      const [sent] = email.send.mock.calls[0] as [{ subject: string; body: string; direction: string }];
      expect(sent.direction).toBe('rtl');
      expect(sent.subject).toBe('إعادة تعيين كلمة مرور AccreditMe');
      expect(sent.body).toContain('منشأة مستشفى النخيل');
      expect(sent.body).toContain('خلال ساعة');
    });

    it('voids a link whose email could not be sent, and rethrows without the token', async () => {
      email.send.mockRejectedValue(new Error('Resend delivery failed: domain not verified'));
      await expect(
        service.issue({ organizationSlug: 'al-nakheel', email: 'hessa@example.test' }),
      ).rejects.toThrow(/Reset-link email not sent for user u-a/);
      expect(at(store.links, 0)).toEqual(expect.objectContaining({ endReason: 'VOID' }));
    });

    it('audits the request with the event name only', async () => {
      await issueFor('hessa@example.test');
      expect(audit.log).toHaveBeenCalledWith({
        tenantId: 'org-a',
        actorId: 'u-a',
        action: 'UPDATE',
        objectType: 'User',
        objectId: 'u-a',
        metadata: { event: 'password_reset_requested' },
      });
    });
  });

  describe('lookup() — is the link usable?', () => {
    it('answers open, with when it expires', async () => {
      const now = new Date(Date.now() - 60_000);
      const token = await issueFor('hessa@example.test', ORG_A.slug, now);
      await expect(service.lookup({ token }, ORIGIN_A)).resolves.toEqual({
        state: 'open',
        expiresAt: new Date(now.getTime() + RESET_LINK_TTL_MS).toISOString(),
      });
    });

    it('answers EXPIRED once the hour has passed', async () => {
      const token = await issueFor('hessa@example.test', ORG_A.slug, new Date(Date.now() - RESET_LINK_TTL_MS - 1));
      expect(await codeOf(service.lookup({ token }, ORIGIN_A))).toBe('RESET_LINK_EXPIRED');
    });

    it('answers USED after the password was set with it', async () => {
      const token = await issueFor('hessa@example.test');
      await reset(token);
      expect(await codeOf(service.lookup({ token }, ORIGIN_A))).toBe('RESET_LINK_USED');
    });

    it.each([
      ['an unknown token', () => ({ token: 'A'.repeat(43) })],
      ['a malformed token', () => ({ token: 'short' })],
      ['a body with no token', () => ({})],
      ['a body with extra fields', () => ({ token: 'A'.repeat(43), email: 'x' })],
      ['an array', () => ['A'.repeat(43)]],
      ['null', () => null],
    ])('answers %s with the one INVALID body', async (_case, body) => {
      const err = await refusalOf(service.lookup(body(), ORIGIN_A));
      expect(err.getStatus()).toBe(400);
      expect(err.getResponse()).toEqual({
        statusCode: 400,
        message: 'This reset link cannot be used',
        error: 'Bad Request',
        code: 'RESET_LINK_INVALID',
      });
    });

    itEnforcesTenantIsolation('lookup: a link opened at another organisation\'s address is INVALID', async () => {
      const token = await issueFor('hessa@example.test');
      const atB = await refusalOf(service.lookup({ token }, ORIGIN_B));
      const unknown = await refusalOf(service.lookup({ token: 'B'.repeat(43) }, ORIGIN_B));
      expect(atB.getResponse()).toEqual(unknown.getResponse());
      expect(await codeOf(service.lookup({ token }, undefined))).toBe('RESET_LINK_INVALID');
    });

    it('answers INVALID once the person is deactivated, or the organisation closes', async () => {
      const token = await issueFor('hessa@example.test');
      at(store.users, 0).status = 'INACTIVE';
      expect(await codeOf(service.lookup({ token }, ORIGIN_A))).toBe('RESET_LINK_INVALID');
      at(store.users, 0).status = 'ACTIVE';
      at(store.orgs, 0).status = 'CANCELLED';
      expect(await codeOf(service.lookup({ token }, ORIGIN_A))).toBe('RESET_LINK_INVALID');
    });

    it('answers a VOID link with INVALID', async () => {
      const token = await issueFor('hessa@example.test');
      at(store.links, 0).endedAt = new Date();
      at(store.links, 0).endReason = 'VOID';
      expect(await codeOf(service.lookup({ token }, ORIGIN_A))).toBe('RESET_LINK_INVALID');
    });
  });

  describe('reset() — set the new password', () => {
    it('sets it through Better Auth once, ends the link, signs out everywhere, clears the password lock, audits and sends the notice', async () => {
      const token = await issueFor('hessa@example.test');
      await reset(token);

      expect(store.betterAuthReset).toHaveBeenCalledTimes(1);
      expect(store.betterAuthReset).toHaveBeenCalledWith(token, PASSWORD);
      expect(at(store.links, 0)).toEqual(expect.objectContaining({ endReason: 'USED' }));
      // Signed out everywhere (Ahmad's rule 2).
      expect(at(store.users, 0).tokenVersion).toBe(4);
      expect(store.refreshTokens.filter((r) => r.userId === 'u-a').every((r) => r.revokedAt)).toBe(true);
      expect(store.refreshTokens.find((r) => r.userId === 'u-b')!.revokedAt).toBeNull();
      expect(store.authSessionDeletes).toEqual([{ userId: 'au-a' }]);
      // The wrong-password lock ends (rule 3) — and nothing touches the MFA code lock.
      expect(store.loginAttempts).toEqual([
        { organizationId: 'org-a', email: 'hessa@example.test', success: true, failureReason: 'password_reset', ipAddress: '203.0.113.9' },
      ]);
      expect(store.authTwoFactor.update).not.toHaveBeenCalled();
      expect(store.authTwoFactor.updateMany).not.toHaveBeenCalled();
      expect(store.authTwoFactor.deleteMany).not.toHaveBeenCalled();
      expect(audit.log).toHaveBeenLastCalledWith(
        expect.objectContaining({ actorId: 'u-a', objectId: 'u-a', metadata: { event: 'password_reset' } }),
      );
      expect(notices.enqueue).toHaveBeenCalledWith({ organizationId: 'org-a', userId: 'u-a', notice: 'password_changed' });
    });

    it('a used link does not work again: USED, and Better Auth is not called', async () => {
      const token = await issueFor('hessa@example.test');
      await reset(token);
      store.betterAuthReset.mockClear();
      expect(await codeOf(reset(token))).toBe('RESET_LINK_USED');
      expect(store.betterAuthReset).not.toHaveBeenCalled();
    });

    it('a replaced link does not work: REPLACED, and Better Auth is not called', async () => {
      const first = await issueFor('hessa@example.test');
      await issueFor('hessa@example.test');
      expect(await codeOf(reset(first))).toBe('RESET_LINK_REPLACED');
      expect(store.betterAuthReset).not.toHaveBeenCalled();
    });

    it('an expired link: EXPIRED, and Better Auth is not called', async () => {
      const token = await issueFor('hessa@example.test', ORG_A.slug, new Date(Date.now() - RESET_LINK_TTL_MS - 1));
      expect(await codeOf(reset(token))).toBe('RESET_LINK_EXPIRED');
      expect(store.betterAuthReset).not.toHaveBeenCalled();
    });

    it.each([
      ['too short', 'short', 'PASSWORD_TOO_SHORT'],
      ['too long', 'x'.repeat(129), 'PASSWORD_TOO_LONG'],
    ])('a password %s is refused before anything is spent', async (_case, password, code) => {
      const token = await issueFor('hessa@example.test');
      const err = await refusalOf(reset(token, password));
      expect(err).toBeInstanceOf(PasswordRefusalException);
      expect((err.getResponse() as { code: string }).code).toBe(code);
      expect(store.betterAuthReset).not.toHaveBeenCalled();
      expect(breach.assertNotBreached).not.toHaveBeenCalled();
      await expect(service.lookup({ token }, ORIGIN_A)).resolves.toEqual(expect.objectContaining({ state: 'open' }));
    });

    it.each([
      ['breached', 'PASSWORD_COMPROMISED', 400],
      ['unchecked (the check is down)', 'PASSWORD_CHECK_UNAVAILABLE', 503],
    ])('a %s password is refused BEFORE the token is spent, and the link still works', async (_case, code, status) => {
      breach.assertNotBreached.mockRejectedValue(new PasswordRefusalException(code as 'PASSWORD_COMPROMISED'));
      const token = await issueFor('hessa@example.test');
      const err = await refusalOf(reset(token));
      expect(err.getStatus()).toBe(status);
      expect((err.getResponse() as { code: string }).code).toBe(code);
      expect(store.betterAuthReset).not.toHaveBeenCalled();
      expect(store.verifications).toHaveLength(1);
      await expect(service.lookup({ token }, ORIGIN_A)).resolves.toEqual(expect.objectContaining({ state: 'open' }));
    });

    it("another request spending the token first answers USED (Better Auth's INVALID_TOKEN)", async () => {
      const token = await issueFor('hessa@example.test');
      store.verifications.splice(0); // spent by the other request
      expect(await codeOf(reset(token))).toBe('RESET_LINK_USED');
      expect(at(store.users, 0).tokenVersion).toBe(3);
    });

    it.each([
      ['a breach found by Better Auth after consuming', { code: 'PASSWORD_COMPROMISED' }, 400],
      ['the breach check failing after consuming', { message: 'Failed to check password. Please try again later.' }, 500],
    ])('%s voids the link and answers INVALID', async (_case, body, status) => {
      const token = await issueFor('hessa@example.test');
      store.betterAuthReset.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
      expect(await codeOf(reset(token))).toBe('RESET_LINK_INVALID');
      expect(at(store.links, 0)).toEqual(expect.objectContaining({ endReason: 'VOID' }));
      expect(at(store.users, 0).tokenVersion).toBe(3);
    });

    it('any other Better Auth answer is a fault, named by status and code only', async () => {
      const token = await issueFor('hessa@example.test');
      store.betterAuthReset.mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'SOMETHING_ELSE', message: `echo ${token}` }), { status: 500 }),
      );
      await expect(reset(token)).rejects.toThrow(/^Better Auth resetPassword returned 500 SOMETHING_ELSE$/);
    });

    it('a notice that cannot be enqueued does not undo the reset', async () => {
      notices.enqueue.mockRejectedValue(new Error('redis down'));
      const token = await issueFor('hessa@example.test');
      await expect(reset(token)).resolves.toBeUndefined();
      expect(at(store.links, 0).endReason).toBe('USED');
    });

    it('never answers 401: the interceptor would renew and retry', async () => {
      const token = await issueFor('hessa@example.test');
      const statuses = [
        (await refusalOf(reset('A'.repeat(43)))).getStatus(),
        (await refusalOf(reset(token, 'short'))).getStatus(),
        (await refusalOf(service.lookup({ token: 'nope' }, ORIGIN_A))).getStatus(),
      ];
      await reset(token);
      statuses.push((await refusalOf(reset(token))).getStatus());
      expect(statuses).not.toContain(401);
    });

    itEnforcesTenantIsolation('reset: a link used at another organisation\'s address changes nothing', async () => {
      const token = await issueFor('hessa@example.test');
      expect(await codeOf(reset(token, PASSWORD, ORIGIN_B))).toBe('RESET_LINK_INVALID');
      expect(store.betterAuthReset).not.toHaveBeenCalled();
      expect(store.users.map((u) => u.tokenVersion)).toEqual([3, 0, 0, 0, 0]);
    });
  });

  it('THE TOKEN is never in a job, a log line, an audit row or a notice', async () => {
    await service.request({ organizationSlug: 'al-nakheel', email: 'hessa@example.test' });
    const token = await issueFor('hessa@example.test');
    await reset(token);
    const written = JSON.stringify([
      queue.add.mock.calls,
      audit.log.mock.calls,
      notices.enqueue.mock.calls,
      logError.mock.calls,
      store.links,
      store.verifications,
      store.loginAttempts,
    ]);
    expect(written).not.toContain(token);
    // The email is the only place it goes.
    expect(JSON.stringify(email.send.mock.calls)).toContain(token);
  });
});
