import { createHmac } from 'crypto';
import { ArgumentsHost, HttpException, ValidationPipe } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginAttemptService } from './login-attempt.service';
import { AuthRefusalException, AUTH_REFUSAL_MESSAGES } from './auth-refusal';
import { LoginDto } from './dto/login.dto';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditLogService } from '../../common/services/audit-log.service';
import type { NotificationService } from '../notification/notification.service';
import type { UserService } from '../user/user.service';

// The filter imports isAPIError from better-auth/api, which is ESM-only.
jest.mock('better-auth/api', () => ({ isAPIError: () => false }));

const mockAuthApi = { signInEmail: jest.fn(), verifyTOTP: jest.fn() };
jest.mock('../../providers/auth/better-auth.config', () => ({
  createBetterAuthInstance: jest.fn(() => ({ api: mockAuthApi })),
}));

/**
 * ACC-120 slice 9b — every sign-in outcome, end to end inside the service.
 *
 * The REAL AuthService and the REAL LoginAttemptService run against a small
 * in-memory database, and Better Auth is replaced by a fake that behaves like
 * the installed library: a refusal is RETURNED as a Response, never thrown.
 * The old specs modelled a wrong password as a rejected promise, which the
 * real library never produces — and that is how a lockout that could not lock
 * passed them. Nothing here mocks the lock: it is computed from the rows the
 * service actually wrote.
 */

const SECRET = 'test-better-auth-secret';
const ORG_A = {
  id: 'org-a',
  slug: 'al-nakheel',
  authConfig: null,
  status: 'ACTIVE',
};
const ORG_B = {
  id: 'org-b',
  slug: 'al-manara',
  authConfig: null,
  status: 'TRIAL',
};
const HESSA = 'hessa@al-nakheel.example';

interface Credential {
  password: string;
  authUserId: string;
  mfa: boolean;
}
interface AppUserRow {
  id: string;
  organizationId: string;
  authUserId: string;
  email: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE' | 'INVITED' | 'SUSPENDED';
  tokenVersion: number;
  lastLoginIp: string | null;
  language: string | null;
}
interface AttemptRow {
  organizationId: string;
  email: string;
  success: boolean;
  failureReason: string | null;
  createdAt: Date;
}
interface VerificationRow {
  identifier: string;
  value: string;
  expiresAt: Date;
  createdAt: Date;
}

function response(body: unknown, status = 200, setCookies: string[] = []) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    headers: { getSetCookie: () => setCookies },
  };
}

function signed(identifier: string, secret = SECRET): string {
  const signature = createHmac('sha256', secret)
    .update(identifier)
    .digest('base64');
  return encodeURIComponent(`${identifier}.${signature}`);
}

describe('sign-in outcomes (ACC-120 slice 9b)', () => {
  let clock: number;
  let attempts: AttemptRow[];
  let users: AppUserRow[];
  let credentials: Map<string, Credential>;
  let verifications: VerificationRow[];
  let twoFactor: Map<
    string,
    { failedVerificationCount: number; lockedUntil: Date | null }
  >;
  let service: AuthService;
  let prisma: Record<
    | 'organization'
    | 'user'
    | 'refreshToken'
    | 'loginAttempt'
    | 'authVerification'
    | 'authTwoFactor',
    Record<string, jest.Mock>
  >;

  const savedSecret = process.env['BETTER_AUTH_SECRET'];
  beforeAll(() => {
    process.env['BETTER_AUTH_SECRET'] = SECRET;
    process.env['JWT_SECRET'] = 'test-jwt-secret';
  });
  afterAll(() => {
    if (savedSecret === undefined) delete process.env['BETTER_AUTH_SECRET'];
    else process.env['BETTER_AUTH_SECRET'] = savedSecret;
  });

  const now = (): Date => new Date(clock);
  const tick = (ms = 1000): void => {
    clock += ms;
    jest.setSystemTime(clock);
  };

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-05T09:00:00.000Z') });
    clock = Date.now();
    jest.clearAllMocks();
    attempts = [];
    verifications = [];
    twoFactor = new Map();
    users = [
      {
        id: 'u-hessa',
        organizationId: ORG_A.id,
        authUserId: 'au-hessa',
        email: HESSA,
        name: 'Dr. Hessa',
        status: 'ACTIVE',
        tokenVersion: 1,
        lastLoginIp: '10.0.0.1',
        language: 'en',
      },
    ];
    credentials = new Map([
      [
        AuthService.namespacedEmail(ORG_A.id, HESSA),
        { password: 'right', authUserId: 'au-hessa', mfa: false },
      ],
    ]);

    const orgs = [ORG_A, ORG_B];
    // Honour `include`, as Prisma does: a query that asks for the
    // organisation's status gets it; one that does not, does not.
    const withOrganization = (
      row: AppUserRow | null,
      include?: { organization?: unknown },
    ) =>
      row && include?.organization
        ? {
            ...row,
            organization: {
              status: orgs.find((o) => o.id === row.organizationId)!.status,
            },
          }
        : row;
    prisma = {
      organization: {
        findUnique: jest.fn(
          ({ where }: { where: { slug?: string; id?: string } }) =>
            Promise.resolve(
              orgs.find((o) => o.slug === where.slug || o.id === where.id) ??
                null,
            ),
        ),
      },
      user: {
        findFirst: jest.fn(
          ({
            where,
            include,
          }: {
            where: {
              id?: string;
              authUserId?: string;
              organizationId?: string;
              authUser?: { email: string };
            };
            include?: { organization?: unknown };
          }) =>
            Promise.resolve(
              withOrganization(
                users.find(
                (u) =>
                  (where.id === undefined || u.id === where.id) &&
                  (where.authUserId === undefined ||
                    u.authUserId === where.authUserId) &&
                  (where.organizationId === undefined ||
                    u.organizationId === where.organizationId) &&
                  (where.authUser === undefined ||
                    AuthService.namespacedEmail(u.organizationId, u.email) ===
                      where.authUser.email),
              ) ?? null,
                include,
              ),
            ),
        ),
        update: jest.fn().mockResolvedValue({}),
      },
      refreshToken: { create: jest.fn().mockResolvedValue({}) },
      loginAttempt: {
        create: jest.fn(({ data }: { data: Omit<AttemptRow, 'createdAt'> }) => {
          attempts.push({ ...data, createdAt: now() });
          return Promise.resolve({});
        }),
        findMany: jest.fn(
          ({
            where,
          }: {
            where: {
              organizationId: string;
              email: string;
              createdAt: { gte: Date };
            };
          }) =>
            Promise.resolve(
              attempts
                .filter(
                  (a) =>
                    a.organizationId === where.organizationId &&
                    a.email === where.email &&
                    a.createdAt >= where.createdAt.gte,
                )
                .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime()),
            ),
        ),
      },
      authVerification: {
        findFirst: jest.fn(({ where }: { where: { identifier: string } }) =>
          Promise.resolve(
            verifications
              .filter((v) => v.identifier === where.identifier)
              .sort(
                (x, y) => y.createdAt.getTime() - x.createdAt.getTime(),
              )[0] ?? null,
          ),
        ),
        deleteMany: jest.fn(
          ({ where }: { where: { identifier: { in: string[] } } }) => {
            const before = verifications.length;
            verifications = verifications.filter(
              (v) => !where.identifier.in.includes(v.identifier),
            );
            return Promise.resolve({ count: before - verifications.length });
          },
        ),
      },
      authTwoFactor: {
        findUnique: jest.fn(({ where }: { where: { userId: string } }) =>
          Promise.resolve(twoFactor.get(where.userId) ?? null),
        ),
      },
    };

    // Better Auth, as the installed library behaves: refusals are RETURNED.
    mockAuthApi.signInEmail.mockImplementation(
      ({ body }: { body: { email: string; password: string } }) => {
        const credential = credentials.get(body.email);
        if (!credential || credential.password !== body.password) {
          return Promise.resolve(
            response(
              {
                message: 'Invalid email or password',
                code: 'INVALID_EMAIL_OR_PASSWORD',
              },
              401,
            ),
          );
        }
        if (!credential.mfa)
          return Promise.resolve(
            response({ user: { id: credential.authUserId } }),
          );
        const identifier = `2fa-${'x'.repeat(19)}${verifications.length}`;
        const expiresAt = new Date(clock + 600_000);
        verifications.push(
          {
            identifier,
            value: credential.authUserId,
            expiresAt,
            createdAt: now(),
          },
          {
            identifier: `2fa-attempts-${identifier}`,
            value: '0',
            expiresAt,
            createdAt: now(),
          },
        );
        return Promise.resolve(
          response({ twoFactorRedirect: true }, 200, [
            `better-auth.two_factor=${signed(identifier)}; Max-Age=600; Path=/; HttpOnly; SameSite=Lax`,
          ]),
        );
      },
    );

    service = new AuthService(
      prisma as unknown as PrismaService,
      { log: jest.fn() } as unknown as AuditLogService,
      { create: jest.fn() } as unknown as NotificationService,
      new LoginAttemptService(prisma as unknown as PrismaService),
      {} as unknown as UserService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const req = (cookie?: string) =>
    ({
      headers: cookie ? { cookie } : {},
      cookies: {},
      ip: '10.0.0.1',
    }) as never;
  const res = () =>
    ({ cookie: jest.fn(), clearCookie: jest.fn(), append: jest.fn() }) as never;

  const signIn = (slug: string, email: string, password: string) =>
    service.login({ organizationSlug: slug, email, password }, req(), res());

  /** What a refused sign-in throws, as the exception itself. */
  async function refusal(attempt: Promise<unknown>): Promise<HttpException> {
    try {
      await attempt;
    } catch (e) {
      return e as HttpException;
    }
    throw new Error('expected the sign-in to be refused');
  }

  /** The status and body the real HttpExceptionFilter sends for an exception. */
  function delivered(exception: unknown): { status: number; body: string } {
    let status = 0;
    let body = '';
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({
          status(code: number) {
            status = code;
            return this;
          },
          json(payload: unknown) {
            body = JSON.stringify(payload);
          },
        }),
      }),
    } as unknown as ArgumentsHost;
    new HttpExceptionFilter().catch(exception, host);
    return { status, body };
  }

  const failures = (email = HESSA) =>
    attempts.filter(
      (a) =>
        a.email === email &&
        !a.success &&
        a.failureReason !== 'account_inactive',
    ).length;

  // ── 1. The vague cases are byte-identical ──────────────────────────────────

  it('sends a byte-identical body and status for an unknown organisation, no such user and a wrong password', async () => {
    const unknownOrg = delivered(
      await refusal(signIn('no-such-org', HESSA, 'right')),
    );
    const noSuchUser = delivered(
      await refusal(
        signIn(ORG_A.slug, 'nobody@al-nakheel.example', 'whatever'),
      ),
    );
    const wrongPassword = delivered(
      await refusal(signIn(ORG_A.slug, HESSA, 'wrong')),
    );

    // Guard first: the body really is the INVALID_CREDENTIALS refusal. Without
    // this, three empty or three generic-500 bodies would also be "identical".
    expect(JSON.parse(wrongPassword.body)).toStrictEqual({
      statusCode: 401,
      message: AUTH_REFUSAL_MESSAGES.INVALID_CREDENTIALS,
      error: 'Unauthorized',
      code: 'INVALID_CREDENTIALS',
    });
    expect(wrongPassword.status).toBe(401);

    expect(unknownOrg).toStrictEqual(wrongPassword);
    expect(noSuchUser).toStrictEqual(wrongPassword);
  });

  // ── 2. One test per code ───────────────────────────────────────────────────

  it('INVALID_CREDENTIALS records a failed attempt for a wrong password', async () => {
    const e = await refusal(signIn(ORG_A.slug, HESSA, 'wrong'));
    expect(e).toBeInstanceOf(AuthRefusalException);
    expect((e as AuthRefusalException).code).toBe('INVALID_CREDENTIALS');
    expect(attempts).toEqual([
      expect.objectContaining({
        email: HESSA,
        success: false,
        failureReason: 'invalid_password',
      }),
    ]);
  });

  it('ACCOUNT_LOCKED after five failures, carrying when the lock lifts', async () => {
    const firstFailureAt = now();
    for (let i = 0; i < 5; i += 1) {
      await refusal(signIn(ORG_A.slug, HESSA, 'wrong'));
      tick();
    }
    const lockedAt = now();
    const body = (
      await refusal(signIn(ORG_A.slug, HESSA, 'right'))
    ).getResponse();

    // Five failures plus the locked attempt itself make a six-failure streak,
    // newest first; the lock lifts when the FIFTH newest leaves the 15-minute
    // window. The fifth newest is the second failure, one tick after the first.
    expect(body).toStrictEqual({
      statusCode: 401,
      message: AUTH_REFUSAL_MESSAGES.ACCOUNT_LOCKED,
      error: 'Unauthorized',
      code: 'ACCOUNT_LOCKED',
      lockedUntil: new Date(
        firstFailureAt.getTime() + 1000 + 15 * 60_000,
      ).toISOString(),
    });
    // Locked even with the right password, and the locked try is recorded.
    expect(attempts.at(-1)).toEqual(
      expect.objectContaining({ failureReason: 'locked', createdAt: lockedAt }),
    );
  });

  it('ACCOUNT_INACTIVE for a deactivated account with the right password', async () => {
    users[0]!.status = 'INACTIVE';
    const e = await refusal(signIn(ORG_A.slug, HESSA, 'right'));
    expect(e.getResponse()).toStrictEqual({
      statusCode: 401,
      message: AUTH_REFUSAL_MESSAGES.ACCOUNT_INACTIVE,
      error: 'Unauthorized',
      code: 'ACCOUNT_INACTIVE',
    });
  });

  // ── 3. The two rules ───────────────────────────────────────────────────────

  it('locks an email that has no account, exactly as it locks a real one — ACCOUNT_LOCKED never reveals existence', async () => {
    const ghost = 'nobody@al-nakheel.example';
    for (let i = 0; i < 5; i += 1) {
      await refusal(signIn(ORG_A.slug, ghost, 'guess'));
      await refusal(signIn(ORG_A.slug, HESSA, 'guess'));
      tick();
    }
    const forGhost = delivered(
      await refusal(signIn(ORG_A.slug, ghost, 'guess')),
    );
    const forHessa = delivered(
      await refusal(signIn(ORG_A.slug, HESSA, 'guess')),
    );

    expect((JSON.parse(forGhost.body) as { code: string }).code).toBe(
      'ACCOUNT_LOCKED',
    );
    // Same attempt history at the same instants, so the same body — including
    // lockedUntil — and nothing in it to tell the two apart.
    expect(forGhost).toStrictEqual(forHessa);
  });

  it('gives an inactive account INVALID_CREDENTIALS for a wrong password and ACCOUNT_INACTIVE only for the right one', async () => {
    users[0]!.status = 'INACTIVE';
    const wrong = (await refusal(
      signIn(ORG_A.slug, HESSA, 'wrong'),
    )) as AuthRefusalException;
    const right = (await refusal(
      signIn(ORG_A.slug, HESSA, 'right'),
    )) as AuthRefusalException;
    expect(wrong.code).toBe('INVALID_CREDENTIALS');
    expect(right.code).toBe('ACCOUNT_INACTIVE');
    // And the wrong-password body is the ordinary vague one, byte for byte.
    expect(delivered(wrong)).toStrictEqual(
      delivered(
        await refusal(signIn(ORG_A.slug, 'nobody@al-nakheel.example', 'x')),
      ),
    );
  });

  // ── 4. The LoginAttempt fix ────────────────────────────────────────────────

  it("records no success for an inactive account's refused sign-in, and leaves the failure count exactly where it was", async () => {
    const lockout = new LoginAttemptService(prisma as unknown as PrismaService);
    for (let i = 0; i < 4; i += 1) {
      await refusal(signIn(ORG_A.slug, HESSA, 'wrong'));
      tick();
    }
    users[0]!.status = 'INACTIVE';
    await refusal(signIn(ORG_A.slug, HESSA, 'right'));
    tick();

    expect(attempts.some((a) => a.success)).toBe(false);
    expect(attempts.at(-1)).toEqual(
      expect.objectContaining({
        success: false,
        failureReason: 'account_inactive',
      }),
    );
    // NOT counted: four failures and an inactive refusal are still under five.
    expect(await lockout.isLocked(ORG_A.id, HESSA)).toBe(false);

    users[0]!.status = 'ACTIVE';
    await refusal(signIn(ORG_A.slug, HESSA, 'wrong'));
    // NOT a reset either: the fifth real failure locks.
    expect(await lockout.isLocked(ORG_A.id, HESSA)).toBe(true);
  });

  it('records the success only once the sign-in completes, after the status check', async () => {
    await refusal(signIn(ORG_A.slug, HESSA, 'wrong'));
    await signIn(ORG_A.slug, HESSA, 'right');
    expect(attempts.map((a) => a.success)).toEqual([false, true]);
  });

  // ── 5. Only a wrong password counts ────────────────────────────────────────

  it('lets a thrown database error through as itself, records nothing, and is not INVALID_CREDENTIALS', async () => {
    const outage = new Error('connect ECONNREFUSED 10.0.0.9:5432');
    mockAuthApi.signInEmail.mockRejectedValueOnce(outage);
    const e = await refusal(signIn(ORG_A.slug, HESSA, 'right'));
    expect(e).toBe(outage);
    expect(e).not.toBeInstanceOf(AuthRefusalException);
    expect(attempts).toEqual([]);
    // And the filter turns it into a 500, not a 401.
    expect(delivered(e).status).toBe(500);
  });

  it('treats any other Better Auth refusal as a fault: no failure recorded', async () => {
    mockAuthApi.signInEmail.mockResolvedValueOnce(
      response(
        { message: 'Email not verified', code: 'EMAIL_NOT_VERIFIED' },
        403,
      ),
    );
    const e = await refusal(signIn(ORG_A.slug, HESSA, 'right'));
    expect(e).not.toBeInstanceOf(AuthRefusalException);
    expect(e.message).toBe(
      'Better Auth sign-in returned 403 EMAIL_NOT_VERIFIED',
    );
    expect(attempts).toEqual([]);
  });

  // ── 6. One spelling, one counter ───────────────────────────────────────────

  it('counts Hessa@…, HESSA@… and hessa@… as one email, so case cannot buy extra attempts', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const spellings = [
      'Hessa@Al-Nakheel.example',
      ' HESSA@al-nakheel.example',
      'hessa@AL-NAKHEEL.example ',
    ];
    for (let i = 0; i < 5; i += 1) {
      const dto = (await pipe.transform(
        {
          organizationSlug: ORG_A.slug,
          email: spellings[i % 3],
          password: 'wrong',
        },
        { type: 'body', metatype: LoginDto },
      )) as LoginDto;
      await refusal(service.login(dto, req(), res()));
      tick();
    }
    expect(new Set(attempts.map((a) => a.email))).toEqual(new Set([HESSA]));
    expect(failures()).toBe(5);
    const dto = (await pipe.transform(
      {
        organizationSlug: ORG_A.slug,
        email: 'HeSsA@al-nakheel.example',
        password: 'right',
      },
      { type: 'body', metatype: LoginDto },
    )) as LoginDto;
    expect(
      (
        (await refusal(
          service.login(dto, req(), res()),
        )) as AuthRefusalException
      ).code,
    ).toBe('ACCOUNT_LOCKED');
  });

  // ── 7. MFA ─────────────────────────────────────────────────────────────────

  describe('with MFA on', () => {
    let cookie: string;

    beforeEach(async () => {
      credentials.get(AuthService.namespacedEmail(ORG_A.id, HESSA))!.mfa = true;
      const response = res() as unknown as { append: jest.Mock };
      const result = await service.login(
        { organizationSlug: ORG_A.slug, email: HESSA, password: 'right' },
        req(),
        response as never,
      );
      const { mfaRequired, mfaExpiresAt } = result as {
        mfaRequired?: boolean;
        mfaExpiresAt?: string;
      };
      expect(mfaRequired).toBe(true);
      expect(typeof mfaExpiresAt).toBe('string');
      const [, setCookie] = response.append.mock.calls[0] as [string, string];
      cookie = setCookie.split(';')[0]!;
    });

    const challengeRow = () =>
      verifications.find((v) => !v.identifier.startsWith('2fa-attempts-'))!;
    const counterRow = () =>
      verifications.find((v) => v.identifier.startsWith('2fa-attempts-'))!;
    const verify = (code: string, withCookie = cookie) =>
      service.verifyMfa({ code }, req(withCookie), res());

    it("reports mfaExpiresAt as the challenge's own expiry, and records nothing yet", async () => {
      const result = await service.login(
        { organizationSlug: ORG_A.slug, email: HESSA, password: 'right' },
        req(),
        res(),
      );
      const newest = verifications
        .filter((v) => !v.identifier.startsWith('2fa-attempts-'))
        .at(-1)!;
      expect(result).toEqual({
        mfaRequired: true,
        mfaExpiresAt: newest.expiresAt.toISOString(),
      });
      expect(attempts).toEqual([]);
    });

    it('MFA_INVALID carries the attempts left on the challenge', async () => {
      counterRow().value = '2';
      mockAuthApi.verifyTOTP.mockResolvedValueOnce(
        response({ code: 'INVALID_CODE' }, 401),
      );
      const e = await refusal(verify('000000'));
      expect(e.getResponse()).toStrictEqual({
        statusCode: 401,
        message: AUTH_REFUSAL_MESSAGES.MFA_INVALID,
        error: 'Unauthorized',
        code: 'MFA_INVALID',
        attemptsRemaining: 3,
      });
    });

    it('MFA_INVALID reports the smaller limit when the per-user MFA lock is nearer', async () => {
      counterRow().value = '1';
      twoFactor.set('au-hessa', {
        failedVerificationCount: 9,
        lockedUntil: null,
      });
      mockAuthApi.verifyTOTP.mockResolvedValueOnce(
        response({ code: 'INVALID_CODE' }, 401),
      );
      const body = (await refusal(verify('000000'))).getResponse() as {
        attemptsRemaining: number;
      };
      expect(body.attemptsRemaining).toBe(1);
    });

    it('MFA_EXPIRED when the challenge cookie is gone or expired, and when its attempts are spent', async () => {
      for (const code of [
        'INVALID_TWO_FACTOR_COOKIE',
        'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE',
      ]) {
        mockAuthApi.verifyTOTP.mockResolvedValueOnce(
          response({ code }, code.startsWith('TOO') ? 400 : 401),
        );
        const e = (await refusal(verify('000000'))) as AuthRefusalException;
        expect(e.code).toBe('MFA_EXPIRED');
        expect(e.getStatus()).toBe(401);
      }
    });

    it('ACCOUNT_LOCKED, with the MFA lock time, when Better Auth has locked the user', async () => {
      const until = new Date(clock + 15 * 60_000);
      twoFactor.set('au-hessa', {
        failedVerificationCount: 10,
        lockedUntil: until,
      });
      mockAuthApi.verifyTOTP.mockResolvedValueOnce(
        response({ code: 'ACCOUNT_TEMPORARILY_LOCKED' }, 429),
      );
      const body = (await refusal(verify('000000'))).getResponse() as {
        code: string;
        lockedUntil: string;
      };
      expect(body).toEqual(
        expect.objectContaining({
          code: 'ACCOUNT_LOCKED',
          lockedUntil: until.toISOString(),
        }),
      );
    });

    it('records the success only after the code is accepted', async () => {
      mockAuthApi.verifyTOTP.mockResolvedValueOnce(
        response({ user: { id: 'au-hessa' } }),
      );
      await verify('123456');
      expect(attempts).toEqual([
        expect.objectContaining({ email: HESSA, success: true }),
      ]);
    });

    it('refuses an inactive account after the password and BEFORE any challenge is handed over', async () => {
      users[0]!.status = 'INACTIVE';
      const response = res() as unknown as { append: jest.Mock };
      const e = (await refusal(
        service.login(
          { organizationSlug: ORG_A.slug, email: HESSA, password: 'right' },
          req(),
          response as never,
        ),
      )) as AuthRefusalException;
      expect(e.code).toBe('ACCOUNT_INACTIVE');
      // No challenge cookie reaches the browser: they are not asked for a code.
      expect(response.append).not.toHaveBeenCalled();
      expect(attempts).toEqual([
        expect.objectContaining({
          success: false,
          failureReason: 'account_inactive',
        }),
      ]);
    });

    it('ACCOUNT_INACTIVE, recorded as neutral, for an account deactivated while its challenge was open', async () => {
      users[0]!.status = 'INACTIVE';
      mockAuthApi.verifyTOTP.mockResolvedValueOnce(
        response({ user: { id: 'au-hessa' } }),
      );
      const e = (await refusal(verify('123456'))) as AuthRefusalException;
      expect(e.code).toBe('ACCOUNT_INACTIVE');
      expect(attempts).toEqual([
        expect.objectContaining({
          success: false,
          failureReason: 'account_inactive',
        }),
      ]);
    });

    describe('POST /auth/mfa/cancel', () => {
      it('deletes both rows of the caller’s challenge and expires the cookie', async () => {
        expect(verifications).toHaveLength(2);
        const response = res() as unknown as { clearCookie: jest.Mock };
        await expect(
          service.cancelMfa(req(cookie), response as never),
        ).resolves.toEqual({ success: true });
        expect(verifications).toEqual([]);
        expect(response.clearCookie).toHaveBeenCalledWith(
          'better-auth.two_factor',
          expect.any(Object),
        );
      });

      it("cannot remove another caller's challenge", async () => {
        const mine = challengeRow().identifier;
        // A second sign-in, in another browser, gets its own challenge.
        await service.login(
          { organizationSlug: ORG_A.slug, email: HESSA, password: 'right' },
          req(),
          res(),
        );
        const theirs = verifications.find(
          (v) =>
            v.identifier !== mine && !v.identifier.startsWith('2fa-attempts-'),
        )!.identifier;
        const identifiers = () => verifications.map((v) => v.identifier).sort();
        expect(identifiers()).toEqual(
          [
            mine,
            `2fa-attempts-${mine}`,
            theirs,
            `2fa-attempts-${theirs}`,
          ].sort(),
        );

        // I cancel mine: theirs survives, whole.
        await service.cancelMfa(req(cookie), res());
        expect(identifiers()).toEqual(
          [theirs, `2fa-attempts-${theirs}`].sort(),
        );

        // Knowing their identifier is not enough: a cookie naming it without
        // Better Auth's signature, or signed with any other secret, clears
        // nothing.
        await service.cancelMfa(
          req(`better-auth.two_factor=${encodeURIComponent(theirs)}`),
          res(),
        );
        await service.cancelMfa(
          req(`better-auth.two_factor=${signed(theirs, 'not-the-secret')}`),
          res(),
        );
        expect(identifiers()).toEqual(
          [theirs, `2fa-attempts-${theirs}`].sort(),
        );
      });

      it('answers { success: true } when there is nothing to cancel', async () => {
        await expect(service.cancelMfa(req(), res())).resolves.toEqual({
          success: true,
        });
        await service.cancelMfa(req(cookie), res());
        await expect(service.cancelMfa(req(cookie), res())).resolves.toEqual({
          success: true,
        });
      });
    });
  });

  // ── 8. Tenant isolation of the new user lookup ─────────────────────────────

  itEnforcesTenantIsolation(
    'AuthService.login() resolves the person within the signing-in organization',
    async () => {
      // The same person's email exists in ORG_B, active, with its own account.
      users.push({
        ...users[0]!,
        id: 'u-hessa-b',
        organizationId: ORG_B.id,
        authUserId: 'au-hessa-b',
      });
      users[0]!.status = 'INACTIVE';
      // ORG_A's own account is the one refused; ORG_B's active twin is never used.
      const e = (await refusal(
        signIn(ORG_A.slug, HESSA, 'right'),
      )) as AuthRefusalException;
      expect(e.code).toBe('ACCOUNT_INACTIVE');
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          organizationId: ORG_A.id,
          authUser: { email: AuthService.namespacedEmail(ORG_A.id, HESSA) },
        },
        // ACC-168 — the organisation's status is joined into the same query.
        include: { organization: { select: { status: true } } },
      });
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    },
  );
});
