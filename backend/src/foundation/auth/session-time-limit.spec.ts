import { AuthService } from './auth.service';
import { AuthRefusalException } from './auth-refusal';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { NotificationService } from '../notification/notification.service';
import { LoginAttemptService } from './login-attempt.service';
import { UserService } from '../user/user.service';
import { PasswordResetService } from './password-reset/password-reset.service';
import { verifyJwt } from '../../common/guards/tenant.guard';
import { useFixedClock } from '../../common/testing/fixed-clock';

// Explicit factory: the real better-auth.config imports ESM-only packages that
// Jest's CommonJS transform cannot load (see auth.service.spec.ts).
const mockAuthApi = { signInEmail: jest.fn(), verifyTOTP: jest.fn() };
jest.mock('../../providers/auth/better-auth.config', () => ({
  createBetterAuthInstance: jest.fn(() => ({ api: mockAuthApi })),
}));

// ACC-126 — every session ends 12 hours after sign-in, however active the
// person is. These specs drive the real AuthService through sign-in and
// refresh with the clock held, and read what it writes and mints.

const ORG = 'org-a';
const ORIGIN = 'https://acme.accreditme.app';
const JWT_SECRET = 'test-jwt-secret';
const T0 = new Date('2026-11-13T06:00:00.000Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60 * 1000);
const H = 60;

interface Row {
  id: string;
  userId: string;
  organizationId: string;
  tokenHash: string;
  tokenVersion: number | null;
  sessionStartedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  revokedAt: Date | null;
}

function claims(token: string): { sst?: number; exp: number } {
  return JSON.parse(
    Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
  ) as { sst?: number; exp: number };
}

function fakeRes() {
  return { cookie: jest.fn(), clearCookie: jest.fn(), append: jest.fn() } as any;
}

function fakeReq(cookies: Record<string, string> = {}, origin = ORIGIN) {
  return { cookies, headers: { origin }, ip: '127.0.0.1' } as any;
}

/** The value of one cookie a response set, and its maxAge. */
function cookieSet(res: ReturnType<typeof fakeRes>, name: string): { value: string; maxAge: number } {
  const call = (res.cookie as jest.Mock).mock.calls.find((c) => c[0] === name);
  if (!call) throw new Error(`no ${name} cookie was set`);
  return { value: call[1] as string, maxAge: (call[2] as { maxAge: number }).maxAge };
}

describe('the 12-hour session limit (ACC-126)', () => {
  let service: AuthService;
  let prisma: any;
  /** Every RefreshToken row create() was asked to write, in order. */
  let created: Row[];

  const activeUser = {
    id: 'user-1',
    organizationId: ORG,
    email: 'a@example.com',
    name: 'A User',
    status: 'ACTIVE',
    tokenVersion: 1,
    language: null,
    lastLoginIp: null,
    organization: { status: 'ACTIVE', slug: 'acme' },
  };

  beforeEach(() => {
    process.env['JWT_SECRET'] = JWT_SECRET;
    process.env['APP_BASE_DOMAIN'] = 'accreditme.app';
    jest.clearAllMocks();
    created = [];
    prisma = {
      organization: { findUnique: jest.fn().mockResolvedValue({ id: ORG, slug: 'acme', language: 'en' }) },
      user: {
        findFirst: jest.fn().mockResolvedValue(activeUser),
        update: jest.fn().mockResolvedValue({}),
      },
      refreshToken: {
        create: jest.fn(({ data }: { data: Omit<Row, 'id' | 'createdAt' | 'revokedAt'> }) => {
          const row: Row = {
            id: `rt-${created.length + 1}`,
            createdAt: new Date(),
            revokedAt: null,
            ...data,
          };
          created.push(row);
          return Promise.resolve(row);
        }),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    service = new AuthService(
      prisma as PrismaService,
      { log: jest.fn() } as unknown as AuditLogService,
      { create: jest.fn() } as unknown as NotificationService,
      {
        record: jest.fn().mockResolvedValue(undefined),
        isLocked: jest.fn().mockResolvedValue(false),
        isNewIp: jest.fn().mockReturnValue(false),
      } as unknown as LoginAttemptService,
      {} as UserService,
      {} as unknown as PasswordResetService,
    );
  });

  afterEach(() => jest.useRealTimers());

  /** Refresh as the browser would, presenting `row`. */
  async function refreshWith(row: Row, origin = ORIGIN) {
    prisma.refreshToken.findFirst.mockResolvedValueOnce(row);
    const res = fakeRes();
    await service.refresh(fakeReq({ refresh_token: 'raw' }, origin), res);
    return res;
  }

  /** The refusal code a refresh with `row` gives, or 'renewed'. */
  async function refreshOutcome(row: Row): Promise<string> {
    try {
      await refreshWith(row);
      return 'renewed';
    } catch (e) {
      return e instanceof AuthRefusalException ? e.code : (e as Error).message;
    }
  }

  const rowStartedAt = (start: Date | null, createdAt: Date, over: Partial<Row> = {}): Row => ({
    id: 'rt-presented',
    userId: 'user-1',
    organizationId: ORG,
    tokenHash: 'h',
    tokenVersion: 1,
    sessionStartedAt: start,
    expiresAt: new Date(createdAt.getTime() + 7 * 24 * 3600 * 1000),
    createdAt,
    revokedAt: null,
    ...over,
  });

  describe('sign-in stamps the start', () => {
    it('without MFA: the row, the token and the response all carry the moment of sign-in', async () => {
      useFixedClock(T0);
      mockAuthApi.signInEmail.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ user: { id: 'authuser-1' } }),
        headers: { getSetCookie: () => [] },
      });
      const res = fakeRes();

      const result = await service.login(
        { organizationSlug: 'acme', email: 'a@example.com', password: 'pw' },
        fakeReq(),
        res,
      );

      expect(created).toHaveLength(1);
      expect(created[0]?.sessionStartedAt).toEqual(T0);
      expect(created[0]?.expiresAt).toEqual(at(12 * H));
      const access = cookieSet(res, 'access_token');
      expect(claims(access.value).sst).toBe(T0.getTime() / 1000);
      expect(claims(access.value).exp).toBe(at(15).getTime() / 1000);
      expect(result).toMatchObject({ sessionEndsAt: at(12 * H).toISOString() });
    });

    it('after MFA: the start is the moment the code is accepted', async () => {
      useFixedClock(at(3));
      mockAuthApi.verifyTOTP.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ user: { id: 'authuser-1' } }),
        headers: { getSetCookie: () => [] },
      });

      const result = await service.verifyMfa({ code: '123456' }, fakeReq(), fakeRes());

      expect(created).toHaveLength(1);
      expect(created[0]?.sessionStartedAt).toEqual(at(3));
      expect(result.sessionEndsAt).toBe(at(3 + 12 * H).toISOString());
    });
  });

  describe('refresh', () => {
    it('under 12 hours is not refused: renews, and keeps the start', async () => {
      useFixedClock(at(12 * H - 1));
      const res = await refreshWith(rowStartedAt(T0, at(12 * H - 15)));

      expect(created).toHaveLength(1);
      expect(created[0]?.sessionStartedAt).toEqual(T0);
      // The row and both cookies end at the limit, not 7 days / 15 minutes on.
      expect(created[0]?.expiresAt).toEqual(at(12 * H));
      const access = cookieSet(res, 'access_token');
      expect(claims(access.value).sst).toBe(T0.getTime() / 1000);
      expect(claims(access.value).exp).toBe(at(12 * H).getTime() / 1000);
      expect(access.maxAge).toBe(60 * 1000);
      expect(cookieSet(res, 'refresh_token').maxAge).toBe(60 * 1000);
    });

    it('continuously active past 12 hours is REFUSED: refreshing every 14 minutes does not extend it', async () => {
      // Sign-in at T0, then the browser refreshes every 14 minutes, each time
      // presenting the row the previous refresh wrote.
      let presented = rowStartedAt(T0, T0);
      const outcomes: { minute: number; outcome: string }[] = [];
      for (let minute = 14; minute <= 12 * H + 14; minute += 14) {
        useFixedClock(at(minute));
        const before = created.length;
        const outcome = await refreshOutcome(presented);
        outcomes.push({ minute, outcome });
        if (outcome !== 'renewed') break;
        presented = created[before] as Row;
      }

      const renewed = outcomes.filter((o) => o.outcome === 'renewed');
      const last = outcomes[outcomes.length - 1];
      // Non-vacuity: the loop really did renew all day long first.
      expect(renewed.length).toBe(Math.floor((12 * H - 1) / 14));
      expect(renewed.every((o) => o.minute < 12 * H)).toBe(true);
      expect(last).toEqual({ minute: Math.ceil((12 * H) / 14) * 14, outcome: 'SESSION_TIME_LIMIT' });
      // Every row the day wrote carries the sign-in instant.
      expect(new Set(created.map((r) => r.sessionStartedAt?.toISOString()))).toEqual(
        new Set([T0.toISOString()]),
      );
    });

    it('refuses AT exactly 12 hours', async () => {
      useFixedClock(at(12 * H));
      expect(await refreshOutcome(rowStartedAt(T0, at(12 * H - 10)))).toBe('SESSION_TIME_LIMIT');
    });

    it('checks the limit FIRST: revokes, clears both cookies, writes no row, asks for no user — at any address', async () => {
      useFixedClock(at(13 * H));
      for (const origin of [ORIGIN, 'https://al-manara.accreditme.app']) {
        prisma.user.findFirst.mockClear();
        prisma.refreshToken.updateMany.mockClear();
        prisma.refreshToken.findFirst.mockResolvedValueOnce(rowStartedAt(T0, at(12 * H - 5)));
        const res = fakeRes();
        let code = 'renewed';
        try {
          await service.refresh(fakeReq({ refresh_token: 'raw' }, origin), res);
        } catch (e) {
          code = (e as AuthRefusalException).code;
        }
        expect([origin, code]).toEqual([origin, 'SESSION_TIME_LIMIT']);
        expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
          where: { id: 'rt-presented', revokedAt: null },
          data: { revokedAt: expect.any(Date) },
        });
        expect((res.clearCookie as jest.Mock).mock.calls.map((c) => c[0])).toEqual([
          'access_token',
          'refresh_token',
        ]);
        expect(prisma.user.findFirst).not.toHaveBeenCalled();
      }
      expect(created).toHaveLength(0);
    });

    it("rotation carries the presented row's start, never the new row's createdAt", async () => {
      useFixedClock(at(5 * H));
      await refreshWith(rowStartedAt(T0, at(5 * H - 14)));
      expect(created[0]?.sessionStartedAt).toEqual(T0);
      expect(created[0]?.sessionStartedAt).not.toEqual(created[0]?.createdAt);
    });
  });

  describe('a session open at the deploy (no start on its row)', () => {
    it('is measured from the row it presents: created 11 hours ago, it renews and is stamped with that createdAt', async () => {
      useFixedClock(at(11 * H));
      expect(await refreshOutcome(rowStartedAt(null, T0))).toBe('renewed');
      expect(created[0]?.sessionStartedAt).toEqual(T0);
    });

    it('created 13 hours ago, it is refused', async () => {
      useFixedClock(at(13 * H));
      expect(await refreshOutcome(rowStartedAt(null, T0))).toBe('SESSION_TIME_LIMIT');
    });

    it('a legacy row refreshed 3 times keeps the same start', async () => {
      let presented = rowStartedAt(null, T0);
      for (const minute of [14, 28, 42]) {
        useFixedClock(at(minute));
        const before = created.length;
        await refreshWith(presented);
        presented = created[before] as Row;
      }
      expect(created).toHaveLength(3);
      expect(created.map((r) => r.sessionStartedAt?.toISOString())).toEqual([
        T0.toISOString(),
        T0.toISOString(),
        T0.toISOString(),
      ]);
      // Non-vacuity: each new row's own createdAt moved on.
      expect(created.map((r) => r.createdAt.toISOString())).toEqual([
        at(14).toISOString(),
        at(28).toISOString(),
        at(42).toISOString(),
      ]);
    });
  });

  it("the access token is refused by verifyJwt one second after the limit, though minted with 5 minutes left", async () => {
    useFixedClock(at(12 * H - 5));
    const res = await refreshWith(rowStartedAt(T0, at(12 * H - 20)));
    const token = cookieSet(res, 'access_token').value;

    useFixedClock(at(12 * H - 1));
    expect(() => verifyJwt(token, JWT_SECRET)).not.toThrow();
    useFixedClock(new Date(at(12 * H).getTime() + 1000));
    expect(() => verifyJwt(token, JWT_SECRET)).toThrow('Token expired');
  });

  it('every RefreshToken the service writes carries a start: sign-in, MFA and refresh', async () => {
    useFixedClock(at(60));
    mockAuthApi.signInEmail.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ user: { id: 'authuser-1' } }),
      headers: { getSetCookie: () => [] },
    });
    mockAuthApi.verifyTOTP.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ user: { id: 'authuser-1' } }),
      headers: { getSetCookie: () => [] },
    });
    await service.login({ organizationSlug: 'acme', email: 'a@example.com', password: 'pw' }, fakeReq(), fakeRes());
    await service.verifyMfa({ code: '123456' }, fakeReq(), fakeRes());
    await refreshWith(rowStartedAt(null, at(30)));

    expect(created).toHaveLength(3);
    for (const row of created) {
      expect(row.sessionStartedAt).toBeInstanceOf(Date);
    }
  });
});
