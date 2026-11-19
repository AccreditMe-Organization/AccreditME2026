// ACC-216 Sessions PR 1 — a person's sign-ins, and ending them
// (backend/Plans/step-216-sessions-and-tasks.md §2, Ahmad's answers of 17 Nov).
// The gate before any read; every query scoped by the person AND the
// organisation; the account-action rule on "Sign out everywhere"; nothing on
// the per-request path.
import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AccountOwnerProtectedException } from '../../roles/role-permission-refusal';
import { sessionDevice } from './session-device';
import { liveSessionWhere, SessionsRefusalException, USER_SESSIONS_CAP } from './user-sessions.interface';
import { UserSessionsService } from './user-sessions.service';

const ORG = 'org-a';
const OTHER_ORG = 'org-b';
const ME = 'user-me';
const ADMIN = 'user-admin';
const COLLEAGUE = 'user-colleague';
const NOW = new Date('2026-11-17T10:00:00.000Z');
const KEYS = ['users:view', 'users:manage_sessions'];
const CHROME_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

interface Row {
  id: string;
  userId: string;
  organizationId: string;
  tokenHash: string;
  tokenVersion: number | null;
  sessionStartedAt: Date | null;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  deviceInfo: string | null;
  ipAddress: string | null;
}

const at = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000);
let n = 0;
const row = (over: Partial<Row> = {}): Row => ({
  id: `rt-${++n}`,
  userId: COLLEAGUE,
  organizationId: ORG,
  tokenHash: `hash-${n}`,
  tokenVersion: 0,
  sessionStartedAt: at(60),
  createdAt: at(5),
  expiresAt: at(-300),
  revokedAt: null,
  deviceInfo: CHROME_WIN,
  ipAddress: '203.0.113.7',
  ...over,
});

function makeService(opts: { people?: Array<{ id: string; organizationId: string; status?: string; tokenVersion?: number; owner?: boolean }> } = {}) {
  const people = opts.people ?? [
    { id: ME, organizationId: ORG },
    { id: ADMIN, organizationId: ORG },
    { id: COLLEAGUE, organizationId: ORG },
  ];
  const calls: string[] = [];
  const userFindFirst = jest.fn(({ where }: { where: { id: string; organizationId: string } }) => {
    calls.push('user.findFirst');
    const p = people.find((x) => x.id === where.id && x.organizationId === where.organizationId);
    return Promise.resolve(
      p
        ? {
            id: p.id,
            status: p.status ?? 'ACTIVE',
            tokenVersion: p.tokenVersion ?? 0,
            authUserId: `auth-${p.id}`,
            ownedOrganizations: p.owner ? [{ id: ORG }] : [],
          }
        : null,
    );
  });
  const rtFindMany = jest.fn((_args: unknown) => (calls.push('refreshToken.findMany'), Promise.resolve([] as Row[])));
  const rtCount = jest.fn((_args: unknown) => (calls.push('refreshToken.count'), Promise.resolve(0)));
  const rtFindFirst = jest.fn((_args: unknown) => (calls.push('refreshToken.findFirst'), Promise.resolve(null as Partial<Row> | null)));
  const rtUpdateMany = jest.fn((_args: unknown) => (calls.push('refreshToken.updateMany'), Promise.resolve({ count: 2 })));
  const userUpdateMany = jest.fn((_args: unknown) => (calls.push('user.updateMany'), Promise.resolve({ count: 1 })));
  const authSessionDeleteMany = jest.fn((_args: unknown) => (calls.push('authSession.deleteMany'), Promise.resolve({ count: 1 })));
  const userRoleFindFirst = jest.fn((_args: unknown) => Promise.resolve(null as { id: string } | null));
  const organizationFindFirst = jest.fn((_args: unknown) => Promise.resolve(null));
  const queryRaw = jest.fn(() => (calls.push('lock'), Promise.resolve([])));
  const prisma: Record<string, unknown> = {
    user: { findFirst: userFindFirst, updateMany: userUpdateMany },
    refreshToken: { findMany: rtFindMany, count: rtCount, findFirst: rtFindFirst, updateMany: rtUpdateMany },
    authSession: { deleteMany: authSessionDeleteMany },
    userRole: { findFirst: userRoleFindFirst },
    organization: { findFirst: organizationFindFirst },
    $queryRaw: queryRaw,
  };
  let inTx = false;
  prisma['$transaction'] = jest.fn(async (cb: (tx: unknown) => unknown) => {
    calls.push('tx');
    inTx = true;
    try {
      return await cb(prisma);
    } finally {
      inTx = false;
      calls.push('commit');
    }
  });
  const auditLog = { log: jest.fn((_e: unknown) => (calls.push(`audit in-tx=${inTx}`), Promise.resolve())) };
  const securityNotice = { enqueue: jest.fn((_d: unknown) => (calls.push(`notice in-tx=${inTx}`), Promise.resolve())) };
  const service = new UserSessionsService(prisma as never, auditLog as never, securityNotice as never);
  return { service, calls, userFindFirst, rtFindMany, rtCount, rtFindFirst, rtUpdateMany, userUpdateMany, authSessionDeleteMany, userRoleFindFirst, organizationFindFirst, auditLog, securityNotice };
}

beforeEach(() => {
  n = 0;
});

describe('UserSessionsService (ACC-216 Sessions)', () => {
  describe('the read: GET /users/:userId/sessions', () => {
    it("someone else's without users:view: 403 naming it, and no query", async () => {
      const t = makeService();
      const err = await t.service.list(ORG, { id: ADMIN, permissions: ['users:manage_sessions'] }, COLLEAGUE).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).message).toBe('Required permission: users:view');
      expect(t.calls).toEqual([]);
    });

    it("someone else's with users:view but not users:manage_sessions: 403 naming the key, and no query, for a real or invented id", async () => {
      const t = makeService();
      for (const id of [COLLEAGUE, 'user-invented']) {
        const err = await t.service.list(ORG, { id: ADMIN, permissions: ['users:view'] }, id).catch((e: unknown) => e);
        expect((err as ForbiddenException).message).toBe('Required permission: users:manage_sessions');
      }
      expect(t.calls).toEqual([]);
    });

    it('yourself, with no permission at all: admitted', async () => {
      const t = makeService();
      await expect(t.service.list(ORG, { id: ME, permissions: [] }, ME, NOW)).resolves.toEqual({ total: 0, rows: [] });
    });

    it("another organisation's person, or an invented id: the identical 404, and no session read", async () => {
      const t = makeService({ people: [{ id: COLLEAGUE, organizationId: OTHER_ORG }] });
      for (const id of [COLLEAGUE, 'user-invented']) {
        const err = await t.service.list(ORG, { id: ADMIN, permissions: KEYS }, id).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(NotFoundException);
        expect((err as NotFoundException).message).toBe('User not found');
      }
      expect(t.rtFindMany).not.toHaveBeenCalled();
    });

    it('should NOT return records belonging to a different tenant: the read is scoped by the person AND the organisation', async () => {
      const t = makeService();
      await t.service.list(ORG, { id: ADMIN, permissions: KEYS }, COLLEAGUE, NOW);
      expect(t.userFindFirst).toHaveBeenCalledWith({ where: { id: COLLEAGUE, organizationId: ORG }, select: { status: true, tokenVersion: true } });
      for (const call of [...t.rtFindMany.mock.calls, ...t.rtCount.mock.calls]) {
        expect((call[0] as { where: unknown }).where).toEqual(liveSessionWhere(COLLEAGUE, ORG, 0, NOW));
      }
    });

    it('the live predicate: not revoked, not expired, under 12 hours from the start (a null start counts from createdAt), the current tokenVersion', () => {
      const twelveHoursAgo = new Date(NOW.getTime() - 12 * 3_600_000);
      expect(liveSessionWhere(COLLEAGUE, ORG, 3, NOW)).toEqual({
        userId: COLLEAGUE,
        organizationId: ORG,
        revokedAt: null,
        expiresAt: { gt: NOW },
        AND: [
          { OR: [{ sessionStartedAt: { gt: twelveHoursAgo } }, { sessionStartedAt: null, createdAt: { gt: twelveHoursAgo } }] },
          { OR: [{ tokenVersion: null }, { tokenVersion: 3 }] },
        ],
      });
    });

    it('a person who is not ACTIVE has no current sign-in, and no row is read', async () => {
      const t = makeService({ people: [{ id: COLLEAGUE, organizationId: ORG, status: 'INACTIVE' }] });
      expect(await t.service.list(ORG, { id: ADMIN, permissions: KEYS }, COLLEAGUE, NOW)).toEqual({ total: 0, rows: [] });
      expect(t.rtFindMany).not.toHaveBeenCalled();
    });

    it(`capped at ${USER_SESSIONS_CAP}, most recently active first; total counts past the cap; two reads after the person`, async () => {
      const t = makeService();
      t.rtCount.mockImplementationOnce(() => (t.calls.push('refreshToken.count'), Promise.resolve(23)));
      await t.service.list(ORG, { id: ADMIN, permissions: KEYS }, COLLEAGUE, NOW);
      expect(t.rtFindMany.mock.calls[0]![0]).toMatchObject({ take: 20, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      expect(t.calls).toEqual(['user.findFirst', 'refreshToken.findMany', 'refreshToken.count']);
    });

    it('each row: the device parsed, the address for the key holder, and never the token hash, version or raw user agent', async () => {
      const t = makeService();
      const r = row({ sessionStartedAt: null, createdAt: at(30) });
      t.rtFindMany.mockResolvedValueOnce([r]);
      t.rtCount.mockResolvedValueOnce(1);
      const page = await t.service.list(ORG, { id: ADMIN, permissions: KEYS }, COLLEAGUE, NOW);
      expect(page.rows).toEqual([
        {
          id: r.id,
          startedAt: r.createdAt,
          lastActiveAt: r.createdAt,
          expiresAt: r.expiresAt,
          device: { browser: 'Chrome', os: 'Windows' },
          address: '203.0.113.7',
          current: false,
        },
      ]);
      // The select itself never asks for what must not leave.
      const select = (t.rtFindMany.mock.calls[0]![0] as { select: Record<string, boolean> }).select;
      expect(Object.keys(select).sort()).toEqual(['createdAt', 'deviceInfo', 'expiresAt', 'id', 'ipAddress', 'sessionStartedAt']);
      expect(JSON.stringify(page)).not.toContain('Mozilla');
    });

    it('"This device": only on your own list, matched by the access token\'s sst to the second', async () => {
      const t = makeService();
      const mine = row({ userId: ME, sessionStartedAt: new Date('2026-11-17T08:00:00.640Z') });
      const other = row({ userId: ME, sessionStartedAt: new Date('2026-11-16T08:00:00.000Z') });
      t.rtFindMany.mockResolvedValue([mine, other]);
      const own = await t.service.list(ORG, { id: ME, permissions: [], sessionStartedAt: new Date('2026-11-17T08:00:00.000Z') }, ME, NOW);
      expect(own.rows.map((r) => r.current)).toEqual([true, false]);
      // An administrator reading the same rows sees no "this device".
      const t2 = makeService();
      t2.rtFindMany.mockResolvedValue([mine]);
      const theirs = await t2.service.list(ORG, { id: ADMIN, permissions: KEYS, sessionStartedAt: new Date('2026-11-17T08:00:00.000Z') }, ME, NOW);
      expect(theirs.rows[0]!.current).toBe(false);
    });
  });

  describe('yourself: POST /auth/sessions/:id/end and /auth/sessions/end-others', () => {
    it('while signed in as someone else: 409 SESSIONS_IMPERSONATING, and no query', async () => {
      const t = makeService();
      for (const call of [
        () => t.service.endOwn(ORG, { id: ME, impersonating: true }, 'cookie', 'rt-x'),
        () => t.service.endOtherOwn(ORG, { id: ME, impersonating: true }, 'cookie'),
      ]) {
        const err = await call().catch((e: unknown) => e);
        expect((err as SessionsRefusalException).code).toBe('SESSIONS_IMPERSONATING');
      }
      expect(t.calls).toEqual([]);
    });

    it('should NOT return records belonging to a different tenant: another person\'s or organisation\'s row is the 404, and nothing is ended', async () => {
      const t = makeService();
      const err = await t.service.endOwn(ORG, { id: ME, impersonating: false }, 'cookie', 'rt-theirs').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NotFoundException);
      expect(t.rtFindFirst.mock.calls[0]![0]).toMatchObject({ where: { id: 'rt-theirs', userId: ME, organizationId: ORG } });
      expect(t.rtUpdateMany).not.toHaveBeenCalled();
    });

    it("ends the chosen sign-in's whole chain (by its start), scoped to you, and audits it", async () => {
      const t = makeService();
      const start = new Date('2026-11-16T07:00:00.000Z');
      t.rtFindFirst.mockResolvedValueOnce({ id: 'rt-old', sessionStartedAt: start }); // the chosen row
      t.rtFindFirst.mockResolvedValueOnce({ id: 'rt-now', sessionStartedAt: new Date('2026-11-17T08:00:00.000Z') }); // the cookie's
      await expect(t.service.endOwn(ORG, { id: ME, impersonating: false }, 'cookie', 'rt-old')).resolves.toEqual({ ended: 2 });
      expect(t.rtUpdateMany).toHaveBeenCalledWith({
        where: { userId: ME, organizationId: ORG, revokedAt: null, sessionStartedAt: start },
        data: { revokedAt: expect.any(Date) },
      });
      expect(t.auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: ORG, actorId: ME, objectType: 'User', objectId: ME, metadata: { event: 'sessions_ended', scope: 'one', count: 2 } }),
      );
    });

    it('a sign-in with no recorded start is ended by its own row', async () => {
      const t = makeService();
      t.rtFindFirst.mockResolvedValueOnce({ id: 'rt-legacy', sessionStartedAt: null });
      await t.service.endOwn(ORG, { id: ME, impersonating: false }, undefined, 'rt-legacy');
      expect(t.rtUpdateMany.mock.calls[0]![0]).toMatchObject({ where: { userId: ME, organizationId: ORG, revokedAt: null, id: 'rt-legacy' } });
    });

    it('the device you are using is refused (409 SESSION_IS_CURRENT): Sign out ends it', async () => {
      const t = makeService();
      const start = new Date('2026-11-17T08:00:00.000Z');
      t.rtFindFirst.mockResolvedValueOnce({ id: 'rt-a', sessionStartedAt: start });
      t.rtFindFirst.mockResolvedValueOnce({ id: 'rt-b', sessionStartedAt: start }); // same chain, renewed since
      const err = await t.service.endOwn(ORG, { id: ME, impersonating: false }, 'cookie', 'rt-a').catch((e: unknown) => e);
      expect((err as SessionsRefusalException).code).toBe('SESSION_IS_CURRENT');
      expect(t.rtUpdateMany).not.toHaveBeenCalled();
    });

    it("\"this device\" is the refresh cookie's row, by its hash, scoped to you", async () => {
      const t = makeService();
      t.rtFindFirst.mockResolvedValueOnce({ id: 'rt-now', sessionStartedAt: new Date('2026-11-17T08:00:00.000Z') });
      await t.service.endOtherOwn(ORG, { id: ME, impersonating: false }, 'raw-cookie');
      const where = (t.rtFindFirst.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
      expect(where).toMatchObject({ userId: ME, organizationId: ORG, revokedAt: null });
      expect(where['tokenHash']).toMatch(/^[0-9a-f]{64}$/);
      expect(where['tokenHash']).not.toBe('raw-cookie');
    });

    it('end-others: every chain but yours, rows with no start included, scoped to you, and audited', async () => {
      const t = makeService();
      const start = new Date('2026-11-17T08:00:00.000Z');
      t.rtFindFirst.mockResolvedValueOnce({ id: 'rt-now', sessionStartedAt: start });
      await expect(t.service.endOtherOwn(ORG, { id: ME, impersonating: false }, 'cookie')).resolves.toEqual({ ended: 2 });
      expect(t.rtUpdateMany).toHaveBeenCalledWith({
        where: { userId: ME, organizationId: ORG, revokedAt: null, OR: [{ sessionStartedAt: null }, { sessionStartedAt: { not: start } }] },
        data: { revokedAt: expect.any(Date) },
      });
      expect(t.auditLog.log).toHaveBeenCalledWith(expect.objectContaining({ metadata: { event: 'sessions_ended', scope: 'others', count: 2 } }));
    });

    it('end-others without an identifiable current sign-in: 409 CURRENT_SESSION_UNKNOWN, and nothing is ended', async () => {
      const t = makeService();
      for (const cookie of [undefined, 'not-a-live-row']) {
        const err = await t.service.endOtherOwn(ORG, { id: ME, impersonating: false }, cookie).catch((e: unknown) => e);
        expect((err as SessionsRefusalException).code).toBe('CURRENT_SESSION_UNKNOWN');
      }
      expect(t.rtUpdateMany).not.toHaveBeenCalled();
    });
  });

  describe('an administrator: POST /users/:userId/sessions/end-all ("Sign out everywhere")', () => {
    it('without users:view or users:manage_sessions: 403 naming it, before any read', async () => {
      const t = makeService();
      for (const [permissions, missing] of [
        [['users:manage_sessions'], 'users:view'],
        [['users:view'], 'users:manage_sessions'],
      ] as const) {
        const err = await t.service.endEverywhere(ORG, { id: ADMIN, permissions, impersonating: false }, COLLEAGUE).catch((e: unknown) => e);
        expect((err as ForbiddenException).message).toBe(`Required permission: ${missing}`);
      }
      expect(t.calls).toEqual([]);
    });

    it('should NOT return records belonging to a different tenant: another organisation\'s person is the 404, and nothing is written', async () => {
      const t = makeService({ people: [{ id: ADMIN, organizationId: ORG }, { id: COLLEAGUE, organizationId: OTHER_ORG }] });
      const err = await t.service.endEverywhere(ORG, { id: ADMIN, permissions: KEYS, impersonating: false }, COLLEAGUE).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NotFoundException);
      expect(t.calls).toEqual(['user.findFirst']);
    });

    it('the account-action rule: yourself, impersonating, the owner, and the floor are refused before any write', async () => {
      const cases: Array<[string, () => ReturnType<typeof makeService>, { id: string; impersonating: boolean }, string, string]> = [
        ['yourself', () => makeService(), { id: COLLEAGUE, impersonating: false }, COLLEAGUE, 'SESSIONS_END_SELF'],
        ['impersonating', () => makeService(), { id: ADMIN, impersonating: true }, COLLEAGUE, 'SESSIONS_IMPERSONATING'],
        ['the floor', () => {
          const t = makeService();
          // The target holds Organization Administrator; the actor does not.
          t.userRoleFindFirst.mockImplementation((args: unknown) =>
            Promise.resolve((args as { where: { userId: string } }).where.userId === COLLEAGUE ? { id: 'ur' } : null),
          );
          return t;
        }, { id: ADMIN, impersonating: false }, COLLEAGUE, 'SESSIONS_END_HIGHER_ACCOUNT'],
      ];
      for (const [, build, actor, target, code] of cases) {
        const t = build();
        const err = await t.service.endEverywhere(ORG, { ...actor, permissions: KEYS }, target).catch((e: unknown) => e);
        expect({ code: (err as SessionsRefusalException).code }).toEqual({ code });
        expect(t.rtUpdateMany).not.toHaveBeenCalled();
      }
      const owner = makeService({ people: [{ id: ADMIN, organizationId: ORG }, { id: COLLEAGUE, organizationId: ORG, owner: true }] });
      await expect(owner.service.endEverywhere(ORG, { id: ADMIN, permissions: KEYS, impersonating: false }, COLLEAGUE)).rejects.toBeInstanceOf(
        AccountOwnerProtectedException,
      );
      expect(owner.rtUpdateMany).not.toHaveBeenCalled();
    });

    it('ends every sign-in at once (endEverySessionInTx, under the row lock), then audits and emails AFTER the commit', async () => {
      const t = makeService();
      t.rtCount.mockImplementationOnce(() => (t.calls.push('refreshToken.count'), Promise.resolve(3)));
      await expect(t.service.endEverywhere(ORG, { id: ADMIN, permissions: KEYS, impersonating: false }, COLLEAGUE)).resolves.toEqual({ ended: 3 });
      expect(t.calls).toEqual([
        'user.findFirst',
        'tx',
        'lock',
        'refreshToken.count',
        'user.updateMany',
        'refreshToken.updateMany',
        'authSession.deleteMany',
        'commit',
        'audit in-tx=false',
        'notice in-tx=false',
      ]);
      expect(t.userUpdateMany).toHaveBeenCalledWith({ where: { id: COLLEAGUE, organizationId: ORG }, data: { tokenVersion: { increment: 1 } } });
      expect(t.rtUpdateMany).toHaveBeenCalledWith({ where: { userId: COLLEAGUE, organizationId: ORG, revokedAt: null }, data: { revokedAt: expect.any(Date) } });
      expect(t.auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: ORG, actorId: ADMIN, objectId: COLLEAGUE, metadata: { event: 'sessions_ended', scope: 'all', count: 3 } }),
      );
      expect(t.securityNotice.enqueue).toHaveBeenCalledWith({ organizationId: ORG, userId: COLLEAGUE, notice: 'sessions_ended' });
    });

    it('a failed email never turns a committed sign-out into an error; it is logged without the error text', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const t = makeService();
      t.securityNotice.enqueue.mockRejectedValueOnce(new Error('redis://secret-host:6379 refused'));
      await expect(t.service.endEverywhere(ORG, { id: ADMIN, permissions: KEYS, impersonating: false }, COLLEAGUE)).resolves.toEqual({ ended: 0 });
      const line = String(warn.mock.calls[0]![0]);
      expect(line).toContain(`organisation ${ORG}, user ${COLLEAGUE}`);
      expect(line).not.toContain('secret-host');
      warn.mockRestore();
    });
  });

  describe('the device, read on the server', () => {
    it.each([
      [CHROME_WIN, { browser: 'Chrome', os: 'Windows' }],
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0', { browser: 'Edge', os: 'Windows' }],
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', { browser: 'Safari', os: 'iOS' }],
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1', { browser: 'Chrome', os: 'iOS' }],
      ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', { browser: 'Safari', os: 'macOS' }],
      ['Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0', { browser: 'Firefox', os: 'Linux' }],
      ['Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36', { browser: 'Samsung Internet', os: 'Android' }],
      ['curl/8.4.0', { browser: null, os: null }],
      [null, { browser: null, os: null }],
    ])('%s', (ua, expected) => {
      expect(sessionDevice(ua)).toEqual(expected);
    });
  });

  it('the per-request path is untouched: no guard, throttler or interceptor reads a refresh row', () => {
    const root = join(__dirname, '..', '..', '..', 'common');
    const files = ['guards/tenant.guard.ts', 'guards/permission.guard.ts', 'guards/module.guard.ts', 'guards/platform.guard.ts', 'throttle/accreditme-throttler.guard.ts'];
    for (const f of files) {
      const text = readFileSync(join(root, f), 'utf8');
      expect(text.length).toBeGreaterThan(0);
      expect({ f, reads: /refreshToken\s*\./.test(text) }).toEqual({ f, reads: false });
    }
  });
});
