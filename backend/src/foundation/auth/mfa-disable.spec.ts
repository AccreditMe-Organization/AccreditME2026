import { createHmac } from 'crypto';
import { ValidationPipe } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginAttemptService } from './login-attempt.service';
import { DisableMfaDto } from './dto/disable-mfa.dto';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditLogService } from '../../common/services/audit-log.service';
import type { NotificationService } from '../notification/notification.service';
import type { UserService } from '../user/user.service';
import type { PasswordResetService } from './password-reset/password-reset.service';
import type { SecurityNoticeService } from '../notification/security-notice';

const mockAuthApi = {
  signInEmail: jest.fn(),
  verifyTOTP: jest.fn(),
  disableTwoFactor: jest.fn(),
  signOut: jest.fn(),
};
jest.mock('../../providers/auth/better-auth.config', () => ({
  createBetterAuthInstance: jest.fn(() => ({ api: mockAuthApi })),
}));

/**
 * ACC-164 — turning your own two-step sign-in off (plan §3, §0b).
 *
 * The REAL AuthService and LoginAttemptService run against a small in-memory
 * database, and Better Auth is a fake that behaves like the installed library:
 * every refusal is RETURNED as a Response, with its code, never thrown. The lock
 * is computed from the rows the service wrote; nothing mocks it.
 */

const SECRET = 'test-better-auth-secret';
const ORG = 'org-a';
const EMAIL = 'lina@al-nakheel.example';
const RIGHT_PASSWORD = 'right-password';
const RIGHT_CODE = '482913';
const AUTH_USER = 'au-lina';

function response(body: unknown, status = 200, setCookies: string[] = []) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    headers: { getSetCookie: () => setCookies },
  };
}
/** The first argument of a mock's first call. */
const firstArg = <T>(mock: jest.Mock): T => (mock.mock.calls as unknown[][])[0]![0] as T;

const signed = (identifier: string) =>
  encodeURIComponent(
    `${identifier}.${createHmac('sha256', SECRET).update(identifier).digest('base64')}`,
  );

interface Attempt {
  organizationId: string;
  email: string;
  success: boolean;
  failureReason: string | null;
  createdAt: Date;
}

describe('turning your own two-step sign-in off (ACC-164)', () => {
  let attempts: Attempt[];
  let verifications: { identifier: string; value: string }[];
  let twoFactor: { failedVerificationCount: number; lockedUntil: Date | null } | null;
  let mfaOn: boolean;
  let sessions: Set<string>;
  let audit: { log: jest.Mock };
  let notice: { enqueue: jest.Mock };
  let service: AuthService;

  const saved = process.env['BETTER_AUTH_SECRET'];
  beforeAll(() => {
    process.env['BETTER_AUTH_SECRET'] = SECRET;
  });
  afterAll(() => {
    if (saved === undefined) delete process.env['BETTER_AUTH_SECRET'];
    else process.env['BETTER_AUTH_SECRET'] = saved;
  });

  const call = (password = RIGHT_PASSWORD, code = RIGHT_CODE) =>
    service.disableMfa('u-lina', ORG, { password, code }, { ipAddress: '203.0.113.9', userAgent: 'UA' });

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-14T09:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate'] });
    jest.clearAllMocks();
    attempts = [];
    verifications = [];
    twoFactor = { failedVerificationCount: 0, lockedUntil: null };
    mfaOn = true;
    sessions = new Set();
    let next = 0;
    const newSession = (): string => {
      const token = `sess-${++next}`;
      sessions.add(token);
      return `better-auth.session_token=${token}; Path=/; HttpOnly`;
    };
    const sessionFrom = (cookie: string): string | null =>
      /better-auth\.session_token=([^;]+)/.exec(cookie)?.[1] ?? null;

    // Better Auth as installed: refusals are returned, with their codes.
    mockAuthApi.signInEmail.mockImplementation(({ body }: { body: { password: string } }) => {
      if (body.password !== RIGHT_PASSWORD) {
        return Promise.resolve(response({ code: 'INVALID_EMAIL_OR_PASSWORD' }, 401));
      }
      if (!mfaOn) return Promise.resolve(response({ user: { id: AUTH_USER } }, 200, [newSession()]));
      const identifier = `2fa-challenge${verifications.length}`;
      verifications.push({ identifier, value: AUTH_USER }, { identifier: `2fa-attempts-${identifier}`, value: '0' });
      return Promise.resolve(
        response({ twoFactorRedirect: true }, 200, [`better-auth.two_factor=${signed(identifier)}; Path=/`]),
      );
    });
    mockAuthApi.verifyTOTP.mockImplementation(({ body }: { body: { code: string } }) => {
      if (twoFactor?.lockedUntil) return Promise.resolve(response({ code: 'ACCOUNT_TEMPORARILY_LOCKED' }, 401));
      if (body.code !== RIGHT_CODE) {
        twoFactor!.failedVerificationCount++;
        return Promise.resolve(response({ code: 'INVALID_CODE' }, 401));
      }
      return Promise.resolve(response({ token: 't', user: { id: AUTH_USER } }, 200, [newSession()]));
    });
    mockAuthApi.disableTwoFactor.mockImplementation(({ headers }: { headers: Headers }) => {
      const token = sessionFrom(headers.get('cookie') ?? '');
      if (!token || !sessions.has(token)) return Promise.resolve(response({ code: 'UNAUTHORIZED' }, 401));
      mfaOn = false;
      twoFactor = null;
      sessions.delete(token);
      return Promise.resolve(response({ status: true }, 200, [newSession()]));
    });
    mockAuthApi.signOut.mockImplementation(({ headers }: { headers: Headers }) => {
      const token = sessionFrom(headers.get('cookie') ?? '');
      if (token) sessions.delete(token);
      return Promise.resolve(response({ success: true }));
    });

    const prisma = {
      organization: { findUnique: jest.fn().mockResolvedValue({ id: ORG, authConfig: null }) },
      user: {
        findFirst: jest.fn(({ where }: { where: { id: string; organizationId: string } }) =>
          Promise.resolve(
            where.id === 'u-lina' && where.organizationId === ORG
              ? { id: 'u-lina', organizationId: ORG, email: EMAIL, authUserId: AUTH_USER }
              : null,
          ),
        ),
      },
      loginAttempt: {
        create: jest.fn(({ data }: { data: Omit<Attempt, 'createdAt'> }) => {
          attempts.push({ ...data, createdAt: new Date() });
          return Promise.resolve({});
        }),
        findMany: jest.fn(({ where }: { where: { organizationId: string; email: string; createdAt: { gte: Date } } }) =>
          Promise.resolve(
            attempts
              .filter((a) => a.organizationId === where.organizationId && a.email === where.email && a.createdAt >= where.createdAt.gte)
              .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime()),
          ),
        ),
      },
      authVerification: {
        deleteMany: jest.fn(({ where }: { where: { identifier: { in: string[] } } }) => {
          verifications = verifications.filter((v) => !where.identifier.in.includes(v.identifier));
          return Promise.resolve({});
        }),
      },
      authTwoFactor: {
        findUnique: jest.fn(() => Promise.resolve(twoFactor)),
      },
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    notice = { enqueue: jest.fn().mockResolvedValue(undefined) };
    service = new AuthService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditLogService,
      { create: jest.fn() } as unknown as NotificationService,
      new LoginAttemptService(prisma as unknown as PrismaService),
      {} as unknown as UserService,
      {} as unknown as PasswordResetService,
      notice as unknown as SecurityNoticeService,
    );
  });
  afterEach(() => jest.useRealTimers());

  it('turns it off: the calls in order, each with the right cookie, and no session left behind', async () => {
    await call();

    expect(mockAuthApi.verifyTOTP).toHaveBeenCalledWith(
      expect.objectContaining({ body: { code: RIGHT_CODE }, asResponse: true }),
    );
    const verifyCookie = firstArg<{ headers: Headers }>(mockAuthApi.verifyTOTP).headers.get('cookie');
    expect(verifyCookie).toContain('better-auth.two_factor=');
    const disableArgs = firstArg<{ body: unknown; headers: Headers; asResponse: boolean }>(mockAuthApi.disableTwoFactor);
    expect(disableArgs.body).toEqual({ password: RIGHT_PASSWORD });
    expect(disableArgs.asResponse).toBe(true);
    expect(disableArgs.headers.get('cookie')).toContain('better-auth.session_token=sess-1');
    // signOut gets the session disableTwoFactor re-issued, not the one it deleted.
    expect(firstArg<{ headers: Headers }>(mockAuthApi.signOut).headers.get('cookie')).toContain('sess-2');
    expect(sessions.size).toBe(0);
    expect(mfaOn).toBe(false);
  });

  it('then writes one mfa_disabled audit row and enqueues one mfa_disabled notice, in that order', async () => {
    await call();
    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: ORG, actorId: 'u-lina', objectId: 'u-lina', metadata: { event: 'mfa_disabled' } }),
    );
    expect(notice.enqueue).toHaveBeenCalledWith({ organizationId: ORG, userId: 'u-lina', notice: 'mfa_disabled' });
    expect(audit.log.mock.invocationCallOrder[0]).toBeLessThan(notice.enqueue.mock.invocationCallOrder[0]!);
  });

  it('a wrong password: 400 INVALID_CREDENTIALS, recorded against the sign-in lock, no code checked', async () => {
    const refusal = call('wrong');
    await expect(refusal).rejects.toMatchObject({ status: 400, code: 'INVALID_CREDENTIALS' });
    expect(mockAuthApi.verifyTOTP).not.toHaveBeenCalled();
    expect(attempts).toEqual([
      expect.objectContaining({ organizationId: ORG, email: EMAIL, success: false, failureReason: 'invalid_password' }),
    ]);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('five wrong passwords lock it, and the sixth press is refused before the password is checked', async () => {
    for (let i = 0; i < 5; i++) {
      await expect(call('wrong')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      jest.advanceTimersByTime(1000);
    }
    mockAuthApi.signInEmail.mockClear();
    const refusal = call();
    await expect(refusal).rejects.toMatchObject({ status: 400, code: 'ACCOUNT_LOCKED' });
    const body = (await refusal.catch((e: { getResponse(): object }) => e.getResponse())) as { lockedUntil?: string };
    expect(typeof body.lockedUntil).toBe('string');
    expect(mockAuthApi.signInEmail).not.toHaveBeenCalled();
  });

  it('a wrong code: 400 MFA_INVALID with the codes left before the two-step lock, and the challenge cleared', async () => {
    twoFactor!.failedVerificationCount = 7;
    const refusal = call(RIGHT_PASSWORD, '000000');
    await expect(refusal).rejects.toMatchObject({ status: 400, code: 'MFA_INVALID' });
    const body = (await call(RIGHT_PASSWORD, '000000').catch((e: { getResponse(): object }) => e.getResponse())) as {
      attemptsRemaining: number;
    };
    // 10 failures lock it; 9 have now been counted.
    expect(body.attemptsRemaining).toBe(1);
    expect(verifications).toEqual([]);
    expect(mockAuthApi.disableTwoFactor).not.toHaveBeenCalled();
    // A wrong code is Better Auth's lock to count, not the password lock's.
    expect(attempts).toEqual([]);
  });

  it('the two-step lock: 400 ACCOUNT_LOCKED with when it lifts, read from the row', async () => {
    twoFactor!.lockedUntil = new Date('2026-11-14T09:15:00.000Z');
    const refusal = call();
    await expect(refusal).rejects.toMatchObject({ status: 400, code: 'ACCOUNT_LOCKED' });
    const body = (await call().catch((e: { getResponse(): object }) => e.getResponse())) as { lockedUntil: string };
    expect(body.lockedUntil).toBe('2026-11-14T09:15:00.000Z');
  });

  it('already off: 400 MFA_NOT_ENABLED, and the session that sign-in made is ended', async () => {
    mfaOn = false;
    await expect(call()).rejects.toMatchObject({ status: 400, code: 'MFA_NOT_ENABLED' });
    expect(mockAuthApi.verifyTOTP).not.toHaveBeenCalled();
    expect(sessions.size).toBe(0);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('a challenge Better Auth could not find is a fault, not "code expired" (plan §0b, (1))', async () => {
    mockAuthApi.verifyTOTP.mockResolvedValueOnce(response({ code: 'INVALID_TWO_FACTOR_COOKIE' }, 401));
    const refusal = call();
    await expect(refusal).rejects.toThrow('Better Auth verifyTOTP returned 401 INVALID_TWO_FACTOR_COOKIE');
    await expect(refusal).rejects.not.toHaveProperty('code', 'MFA_EXPIRED');
  });

  it('disableTwoFactor refused: a fault, nothing audited, no notice, and its session still ended', async () => {
    mockAuthApi.disableTwoFactor.mockResolvedValueOnce(response({ code: 'INVALID_PASSWORD' }, 400));
    await expect(call()).rejects.toThrow('Better Auth disableTwoFactor returned 400 INVALID_PASSWORD');
    expect(audit.log).not.toHaveBeenCalled();
    expect(notice.enqueue).not.toHaveBeenCalled();
    expect(sessions.size).toBe(0);
  });

  it('never answers 401, whatever the refusal (the interceptor would retry it)', async () => {
    const statuses: number[] = [];
    const record = (p: Promise<void>) => p.catch((e: { getStatus?: () => number }) => statuses.push(e.getStatus?.() ?? 0));
    await record(call('wrong'));
    await record(call(RIGHT_PASSWORD, '000000'));
    twoFactor!.lockedUntil = new Date('2026-11-14T09:15:00.000Z');
    await record(call());
    mfaOn = false;
    await record(call());
    expect(statuses).toEqual([400, 400, 400, 400]);
  });

  it('the body needs a six-digit code', async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true });
    const check = (body: object) => pipe.transform(body, { type: 'body', metatype: DisableMfaDto });
    await expect(check({ password: 'pw', code: '12345' })).rejects.toBeDefined();
    await expect(check({ password: 'pw', code: '12345a' })).rejects.toBeDefined();
    await expect(check({ password: 'pw' })).rejects.toBeDefined();
    await expect(check({ password: 'pw', code: '123456' })).resolves.toEqual({ password: 'pw', code: '123456' });
  });

  it('does not end the person\'s other sessions (Ahmad, 14 Nov)', async () => {
    sessions.add('other-device');
    await call();
    expect(sessions.has('other-device')).toBe(true);
    for (const [arg] of mockAuthApi.signOut.mock.calls as [{ headers: Headers }][]) {
      expect(arg.headers.get('cookie')).not.toContain('other-device');
    }
  });
});
