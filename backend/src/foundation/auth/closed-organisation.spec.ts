import {
  ConflictException,
  ExecutionContext,
  HttpException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { AuthService, signAccessToken } from './auth.service';
import { LoginAttemptService } from './login-attempt.service';
import { AuthRefusalException, AUTH_REFUSAL_MESSAGES } from './auth-refusal';
import { TenantGuard } from '../../common/guards/tenant.guard';
import * as organizationStatus from '../../common/tenant/organization-status';
import { isOrganizationOpen } from '../../common/tenant/organization-status';
import { PlatformTenantService } from '../../platform/tenant/platform-tenant.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditLogService } from '../../common/services/audit-log.service';
import type { NotificationService } from '../notification/notification.service';
import type { UserService } from '../user/user.service';
import type { TenantService } from '../tenant/tenant.service';
import type { RoleService } from '../roles/role.service';
import type { PermissionResolver } from '../../common/services/permission-resolver.interface';

jest.mock('better-auth/api', () => ({ isAPIError: () => false }));
const mockAuthApi = { signInEmail: jest.fn(), verifyTOTP: jest.fn() };
jest.mock('../../providers/auth/better-auth.config', () => ({
  createBetterAuthInstance: jest.fn(() => ({ api: mockAuthApi })),
}));

/**
 * ACC-168 — a closed organisation is closed everywhere.
 *
 * The REAL AuthService, LoginAttemptService, TenantGuard and
 * PlatformTenantService share ONE in-memory database, so a status written by a
 * test is the status every path reads — the way suspending an organisation
 * actually reaches its users. Better Auth behaves like the installed library:
 * a refusal is a returned Response, never a thrown one.
 */

const CLOSED = ['SUSPENDED', 'CANCELLED', 'OFFBOARDING'] as const;
type Status = 'TRIAL' | 'ACTIVE' | (typeof CLOSED)[number];

const PLATFORM = 'org-platform';
const ORG_A = 'org-a';
const ORG_B = 'org-b';
const HESSA = 'hessa@al-nakheel.example';
const NOURA = 'noura@al-manara.example';
const ADMIN = 'admin@accreditme.example';

interface OrgRow {
  id: string;
  slug: string;
  name: string;
  status: Status;
  isPlatformOrg: boolean;
  authConfig: null;
  settings: null;
  planId: null;
  createdAt: Date;
}
interface UserRow {
  id: string;
  organizationId: string;
  authUserId: string;
  email: string;
  name: string;
  status: 'ACTIVE';
  tokenVersion: number;
  lastLoginIp: string;
  language: string;
}
interface AttemptRow {
  organizationId: string;
  email: string;
  success: boolean;
  failureReason: string | null;
  createdAt: Date;
}
interface RefreshRow {
  id: string;
  userId: string;
  tokenHash: string;
  tokenVersion: number;
  revokedAt: Date | null;
  expiresAt: Date;
}

const response = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
  headers: { getSetCookie: (): string[] => [] },
});

describe('closed organisations (ACC-168)', () => {
  let clock: number;
  let orgs: OrgRow[];
  let users: UserRow[];
  let attempts: AttemptRow[];
  let refreshTokens: RefreshRow[];
  let audit: jest.Mock;
  let userFindFirst: jest.Mock;
  let orgUpdate: jest.Mock;
  let auth: AuthService;
  let guard: TenantGuard;
  let platform: PlatformTenantService;
  let db: PrismaService;

  const JWT_SECRET = 'test-jwt-secret';
  beforeAll(() => {
    process.env['JWT_SECRET'] = JWT_SECRET;
  });

  const orgOf = (id: string) => orgs.find((o) => o.id === id)!;
  const setStatus = (id: string, status: Status) => {
    orgOf(id).status = status;
  };
  const tick = (ms = 1000) => {
    clock += ms;
    jest.setSystemTime(clock);
  };

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-06T09:00:00.000Z') });
    clock = Date.now();
    jest.clearAllMocks();
    const created = new Date('2026-01-01T00:00:00.000Z');
    const org = (
      id: string,
      slug: string,
      status: Status,
      isPlatformOrg = false,
    ): OrgRow => ({
      id,
      slug,
      name: slug,
      status,
      isPlatformOrg,
      authConfig: null,
      settings: null,
      planId: null,
      createdAt: created,
    });
    orgs = [
      org(PLATFORM, 'platform', 'TRIAL', true),
      org(ORG_A, 'al-nakheel', 'ACTIVE'),
      org(ORG_B, 'al-manara', 'TRIAL'),
    ];
    const user = (
      id: string,
      organizationId: string,
      email: string,
    ): UserRow => ({
      id,
      organizationId,
      authUserId: `au-${id}`,
      email,
      name: id,
      status: 'ACTIVE',
      tokenVersion: 1,
      lastLoginIp: '10.0.0.1',
      language: 'en',
    });
    users = [
      user('u-hessa', ORG_A, HESSA),
      user('u-noura', ORG_B, NOURA),
      user('u-admin', PLATFORM, ADMIN),
    ];
    attempts = [];
    refreshTokens = [];
    audit = jest.fn().mockResolvedValue(undefined);
    orgUpdate = jest.fn(
      ({
        where,
        data,
      }: {
        where: { id: string };
        data: { status: Status };
      }) => {
        Object.assign(orgOf(where.id), data);
        return Promise.resolve(orgOf(where.id));
      },
    );

    // Honour `include` and `select` of the organisation's status, as Prisma
    // does — so a path that forgot to ask for it gets nothing to check.
    const withOrg = (row: UserRow, shape?: { organization?: unknown }) =>
      shape?.organization
        ? { ...row, organization: { status: orgOf(row.organizationId).status } }
        : { ...row };
    userFindFirst = jest.fn(
      (args: {
        where: {
          id?: string;
          organizationId?: string;
          authUserId?: string;
          authUser?: { email: string };
        };
        include?: { organization?: unknown };
        select?: { tokenVersion?: boolean; organization?: unknown };
      }) => {
        const w = args.where;
        const row = users.find(
          (u) =>
            (w.id === undefined || u.id === w.id) &&
            (w.organizationId === undefined ||
              u.organizationId === w.organizationId) &&
            (w.authUserId === undefined || u.authUserId === w.authUserId) &&
            (w.authUser === undefined ||
              AuthService.namespacedEmail(u.organizationId, u.email) ===
                w.authUser.email),
        );
        if (!row) return Promise.resolve(null);
        if (args.select) {
          const picked: Record<string, unknown> = {};
          if (args.select.tokenVersion)
            picked['tokenVersion'] = row.tokenVersion;
          if (args.select.organization)
            picked['organization'] = {
              status: orgOf(row.organizationId).status,
            };
          return Promise.resolve(picked);
        }
        return Promise.resolve(withOrg(row, args.include));
      },
    );

    const prisma = {
      organization: {
        findUnique: jest.fn(
          ({ where }: { where: { id?: string; slug?: string } }) =>
            Promise.resolve(
              orgs.find((o) => o.id === where.id || o.slug === where.slug) ??
                null,
            ),
        ),
        findMany: jest.fn(({ where }: { where: { status?: Status } }) =>
          Promise.resolve(
            orgs
              .filter(
                (o) => where.status === undefined || o.status === where.status,
              )
              .map((o) => ({ ...o, planCatalog: null })),
          ),
        ),
        update: orgUpdate,
      },
      user: {
        findFirst: userFindFirst,
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockResolvedValue({}),
      },
      userRole: { findFirst: jest.fn().mockResolvedValue({ id: 'ur-1' }) },
      loginAttempt: {
        create: jest.fn(({ data }: { data: Omit<AttemptRow, 'createdAt'> }) => {
          attempts.push({ ...data, createdAt: new Date(clock) });
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
      refreshToken: {
        create: jest.fn(
          ({ data }: { data: Omit<RefreshRow, 'id' | 'revokedAt'> }) => {
            refreshTokens.push({
              id: `rt-${refreshTokens.length}`,
              revokedAt: null,
              ...data,
            });
            return Promise.resolve({});
          },
        ),
        findFirst: jest.fn(({ where }: { where: { tokenHash: string } }) =>
          Promise.resolve(
            refreshTokens.find((t) => t.tokenHash === where.tokenHash) ?? null,
          ),
        ),
        update: jest.fn(
          ({
            where,
            data,
          }: {
            where: { id: string };
            data: Partial<RefreshRow>;
          }) => {
            Object.assign(
              refreshTokens.find((t) => t.id === where.id)!,
              data,
            );
            return Promise.resolve({});
          },
        ),
      },
    } as unknown as PrismaService;
    db = prisma;

    const auditLog = { log: audit } as unknown as AuditLogService;
    auth = new AuthService(
      prisma,
      auditLog,
      { create: jest.fn() } as unknown as NotificationService,
      new LoginAttemptService(prisma),
      {} as unknown as UserService,
    );
    const permissions = {
      getUserPermissions: jest.fn().mockResolvedValue(['users:view']),
    } as unknown as PermissionResolver;
    guard = new TenantGuard(permissions, prisma);
    platform = new PlatformTenantService(
      prisma,
      auditLog,
      {} as unknown as TenantService,
      {} as unknown as UserService,
      {} as unknown as RoleService,
    );

    // Better Auth: the right password is 'right', for everyone.
    mockAuthApi.signInEmail.mockImplementation(
      ({ body }: { body: { email: string; password: string } }) => {
        const u = users.find(
          (x) =>
            AuthService.namespacedEmail(x.organizationId, x.email) ===
            body.email,
        );
        return Promise.resolve(
          u && body.password === 'right'
            ? response({ user: { id: u.authUserId } })
            : response(
                {
                  message: 'Invalid email or password',
                  code: 'INVALID_EMAIL_OR_PASSWORD',
                },
                401,
              ),
        );
      },
    );
  });
  afterEach(() => jest.useRealTimers());

  const req = (over: Record<string, unknown> = {}) =>
    ({ headers: {}, cookies: {}, ip: '10.0.0.1', ...over }) as never;
  const res = () => ({
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    append: jest.fn(),
  });

  const signIn = (slug: string, email: string, password: string) =>
    auth.login(
      { organizationSlug: slug, email, password },
      req(),
      res() as never,
    );

  async function refusal(attempt: Promise<unknown>): Promise<HttpException> {
    try {
      await attempt;
    } catch (e) {
      return e as HttpException;
    }
    throw new Error('expected a refusal');
  }

  const tokenFor = (userId: string, organizationId: string, tokenVersion = 1) =>
    signAccessToken({ sub: userId, organizationId, tokenVersion }, JWT_SECRET);
  const ctx = (token: string): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ cookies: { access_token: token }, headers: {} }),
      }),
    }) as unknown as ExecutionContext;
  const request = (token: string) => guard.canActivate(ctx(token));

  const UNAVAILABLE = {
    statusCode: 401,
    message: AUTH_REFUSAL_MESSAGES.ORGANIZATION_UNAVAILABLE,
    error: 'Unauthorized',
    code: 'ORGANIZATION_UNAVAILABLE',
  };

  // ── The one rule ──────────────────────────────────────────────────────────

  it('opens TRIAL and ACTIVE, and closes SUSPENDED, CANCELLED and OFFBOARDING', () => {
    expect(isOrganizationOpen('TRIAL')).toBe(true);
    expect(isOrganizationOpen('ACTIVE')).toBe(true);
    for (const status of CLOSED) expect(isOrganizationOpen(status)).toBe(false);
  });

  // ── Each closed status, on every path ─────────────────────────────────────

  for (const status of CLOSED) {
    describe(`a ${status} organisation`, () => {
      beforeEach(() => setStatus(ORG_A, status));

      it('refuses sign-in with ORGANIZATION_UNAVAILABLE after a correct password, recorded as neutral', async () => {
        const e = await refusal(signIn('al-nakheel', HESSA, 'right'));
        expect(e).toBeInstanceOf(AuthRefusalException);
        expect(e.getStatus()).toBe(401);
        expect(e.getResponse()).toStrictEqual(UNAVAILABLE);
        expect(attempts).toEqual([
          expect.objectContaining({
            email: HESSA,
            success: false,
            failureReason: 'organization_unavailable',
          }),
        ]);
      });

      it('still answers a wrong password with INVALID_CREDENTIALS', async () => {
        const e = (await refusal(
          signIn('al-nakheel', HESSA, 'wrong'),
        )) as AuthRefusalException;
        expect(e.code).toBe('INVALID_CREDENTIALS');
      });

      it('refuses to renew a session', async () => {
        setStatus(ORG_A, 'ACTIVE');
        const r = res();
        await auth.login(
          { organizationSlug: 'al-nakheel', email: HESSA, password: 'right' },
          req(),
          r as never,
        );
        const raw = (
          (r.cookie.mock.calls as [string, string][]).find(
            (c) => c[0] === 'refresh_token',
          ) as [string, string]
        )[1];
        setStatus(ORG_A, status);
        const e = await refusal(
          auth.refresh(
            req({ cookies: { refresh_token: raw } }),
            res() as never,
          ),
        );
        expect(e.getResponse()).toStrictEqual(UNAVAILABLE);
        // The refresh token is spent on the way, so the refusal cannot be retried.
        expect(
          refreshTokens.find(
            (t) =>
              t.tokenHash === createHash('sha256').update(raw).digest('hex'),
          )!.revokedAt,
        ).not.toBeNull();
      });

      it("refuses an existing session's next request", async () => {
        const e = await refusal(request(tokenFor('u-hessa', ORG_A)));
        expect(e.getResponse()).toStrictEqual(UNAVAILABLE);
      });

      it('refuses an impersonation with 409 — no token, no audit row, and the admin keeps their own session', async () => {
        const r = res();
        const e = await refusal(
          platform.startImpersonation(
            ORG_A,
            'u-hessa',
            'u-admin',
            PLATFORM,
            r as never,
          ),
        );
        expect(e).toBeInstanceOf(ConflictException);
        expect(e.getStatus()).toBe(409);
        expect(e.message).toBe('This organization is not active');
        expect(r.cookie).not.toHaveBeenCalled();
        expect(audit).not.toHaveBeenCalled();
        await expect(request(tokenFor('u-admin', PLATFORM))).resolves.toBe(
          true,
        );
      });
    });
  }

  it('refuses a closed organisation BEFORE any MFA challenge is handed over', async () => {
    setStatus(ORG_A, 'SUSPENDED');
    // Better Auth answers the right password for an MFA account with a challenge.
    mockAuthApi.signInEmail.mockResolvedValueOnce({
      ...response({ twoFactorRedirect: true }),
      headers: { getSetCookie: () => ['better-auth.two_factor=x; Path=/'] },
    });
    const r = res();
    const e = (await refusal(
      auth.login(
        { organizationSlug: 'al-nakheel', email: HESSA, password: 'right' },
        req(),
        r as never,
      ),
    )) as AuthRefusalException;
    expect(e.code).toBe('ORGANIZATION_UNAVAILABLE');
    expect(r.append).not.toHaveBeenCalled(); // no challenge cookie reaches the browser
    expect(attempts).toEqual([
      expect.objectContaining({ failureReason: 'organization_unavailable' }),
    ]);
  });

  it("refuses an organisation closed while its MFA challenge was open, at the code's acceptance, as neutral", async () => {
    setStatus(ORG_A, 'SUSPENDED');
    mockAuthApi.verifyTOTP.mockResolvedValueOnce(
      response({ user: { id: 'au-u-hessa' } }),
    );
    const e = (await refusal(
      auth.verifyMfa({ code: '123456' }, req(), res() as never),
    )) as AuthRefusalException;
    expect(e.code).toBe('ORGANIZATION_UNAVAILABLE');
    expect(attempts).toEqual([
      expect.objectContaining({ failureReason: 'organization_unavailable' }),
    ]);
  });

  // ── Reopening ─────────────────────────────────────────────────────────────

  it('restores the SAME session when the organisation is reactivated, with no other step', async () => {
    const token = tokenFor('u-hessa', ORG_A);
    await expect(request(token)).resolves.toBe(true);
    await platform.suspendTenant(ORG_A, 'u-admin');
    expect((await refusal(request(token))).getResponse()).toStrictEqual(
      UNAVAILABLE,
    );
    await platform.reactivateTenant(ORG_A, 'u-admin');
    await expect(request(token)).resolves.toBe(true);
    await expect(signIn('al-nakheel', HESSA, 'right')).resolves.toEqual(
      expect.objectContaining({ success: true }),
    );
  });

  // ── The lockout ───────────────────────────────────────────────────────────

  it('does not count a closed-organisation refusal towards the lockout, nor reset it', async () => {
    const lockout = new LoginAttemptService(db);
    for (let i = 0; i < 4; i += 1) {
      await refusal(signIn('al-nakheel', HESSA, 'wrong'));
      tick();
    }
    setStatus(ORG_A, 'SUSPENDED');
    await refusal(signIn('al-nakheel', HESSA, 'right'));
    tick();
    expect(await lockout.isLocked(ORG_A, HESSA)).toBe(false); // not counted
    setStatus(ORG_A, 'ACTIVE');
    await refusal(signIn('al-nakheel', HESSA, 'wrong'));
    expect(await lockout.isLocked(ORG_A, HESSA)).toBe(true); // not a reset
  });

  // ── The platform ──────────────────────────────────────────────────────────

  it('lets a platform administrator list and view a closed tenant from the platform organisation', async () => {
    setStatus(ORG_A, 'SUSPENDED');
    await expect(request(tokenFor('u-admin', PLATFORM))).resolves.toBe(true);
    const list = await platform.listTenants();
    expect(list.find((t) => t.id === ORG_A)).toEqual(
      expect.objectContaining({ status: 'SUSPENDED' }),
    );
    await expect(platform.getTenantDetail(ORG_A)).resolves.toEqual(
      expect.objectContaining({ id: ORG_A, status: 'SUSPENDED' }),
    );
  });

  it('refuses to suspend the platform organisation, and writes nothing', async () => {
    const e = await refusal(platform.suspendTenant(PLATFORM, 'u-admin'));
    expect(e).toBeInstanceOf(ConflictException);
    expect(e.getStatus()).toBe(409);
    expect(orgOf(PLATFORM).status).toBe('TRIAL');
    expect(orgUpdate).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  // ── One rule ──────────────────────────────────────────────────────────
  //
  // A second copy of the TRIAL/ACTIVE list that happened to agree with the
  // first would pass every behavioural test above. So this pins the structure
  // itself: every path decides by calling THE shared rule, with the status it
  // read. (ts-jest compiles each import to a property read on the module
  // object at call time, which is what lets the spy see the call.)
  it('decides on every path by calling the one shared rule', async () => {
    const spy = jest.spyOn(organizationStatus, 'isOrganizationOpen');
    const asked = () => spy.mock.calls.map(([status]) => status);

    await request(tokenFor('u-hessa', ORG_A));
    expect(asked()).toEqual(['ACTIVE']); // TenantGuard
    spy.mockClear();

    const r = res();
    await auth.login(
      { organizationSlug: 'al-nakheel', email: HESSA, password: 'right' },
      req(),
      r as never,
    );
    expect(asked().length).toBeGreaterThanOrEqual(2); // login() and completeLogin()
    spy.mockClear();

    const raw = (
      (r.cookie.mock.calls as [string, string][]).find(
        (c) => c[0] === 'refresh_token',
      ) as [string, string]
    )[1];
    await auth.refresh(
      req({ cookies: { refresh_token: raw } }),
      res() as never,
    );
    expect(asked()).toEqual(['ACTIVE']); // refresh()
    spy.mockClear();

    setStatus(ORG_A, 'SUSPENDED');
    await refusal(
      platform.startImpersonation(
        ORG_A,
        'u-hessa',
        'u-admin',
        PLATFORM,
        res() as never,
      ),
    );
    expect(asked()).toEqual(['SUSPENDED']); // startImpersonation()
    spy.mockRestore();
  });

  // ── Cost ──────────────────────────────────────────────────────────────────

  it('costs the guard exactly one query, as before — the status rides on the user query', async () => {
    await request(tokenFor('u-hessa', ORG_A));
    expect(userFindFirst).toHaveBeenCalledTimes(1);
    expect(userFindFirst).toHaveBeenCalledWith({
      where: { id: 'u-hessa', organizationId: ORG_A },
      select: {
        tokenVersion: true,
        organization: { select: { status: true } },
      },
    });
  });

  // ── Isolation ─────────────────────────────────────────────────────────────

  itEnforcesTenantIsolation(
    "suspending one organisation leaves another's users signed in",
    async () => {
      await platform.suspendTenant(ORG_A, 'u-admin');
      expect(
        (await refusal(request(tokenFor('u-hessa', ORG_A)))).getResponse(),
      ).toStrictEqual(UNAVAILABLE);
      await expect(request(tokenFor('u-noura', ORG_B))).resolves.toBe(true);
      await expect(signIn('al-manara', NOURA, 'right')).resolves.toEqual(
        expect.objectContaining({ success: true }),
      );
    },
  );
});
