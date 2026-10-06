import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { AuthService } from './auth.service';
import { INVITATION_REFUSAL_BODY } from './invitation-refusal';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { UserService } from '../user/user.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditLogService } from '../../common/services/audit-log.service';
import type { NotificationService } from '../notification/notification.service';
import type { LoginAttemptService } from './login-attempt.service';

// The filter imports isAPIError from better-auth/api, which is ESM-only.
jest.mock('better-auth/api', () => ({ isAPIError: () => false }));
jest.mock('../../providers/auth/better-auth.config', () => ({
  createBetterAuthInstance: jest.fn(() => ({ api: {} })),
}));

/**
 * ACC-120 slice 9c — POST /auth/invitations/lookup, over HTTP.
 *
 * A real Nest app with the SAME global ValidationPipe and filter as main.ts,
 * the real controller and the real AuthService, against an in-memory table. So
 * "byte-identical" is checked on the response text the client actually
 * receives, and a malformed body has to get past the real global pipe — which
 * is the part a DTO class would have broken.
 *
 * The database here can only READ: `user.findFirst` and nothing else. A
 * lookup that wrote anything would call a method that does not exist and fail.
 */

const ORG_A = {
  id: 'org-a',
  name: 'Al Nakheel Specialist Hospital',
  nameAr: 'مستشفى النخيل التخصصي',
  status: 'ACTIVE',
};
const ORG_B = {
  id: 'org-b',
  name: 'Al Manara University',
  nameAr: null,
  status: 'TRIAL',
};
const token = (n: number): string => n.toString(16).padStart(48, 'a');

interface InviteeRow {
  id: string;
  organizationId: string;
  email: string;
  status: string;
  invitationToken: string | null;
  invitationExpiresAt: Date | null;
}

describe('POST /auth/invitations/lookup (ACC-120 slice 9c)', () => {
  let app: INestApplication;
  let users: InviteeRow[];
  let orgs: Array<{
    id: string;
    name: string;
    nameAr: string | null;
    status: string;
  }>;
  let findFirst: jest.Mock;
  const NOW = new Date('2026-10-05T09:00:00.000Z');
  const inAnHour = new Date(NOW.getTime() + 3_600_000);

  beforeAll(async () => {
    findFirst = jest.fn(
      ({
        where,
        include,
      }: {
        where: { invitationToken: string };
        include?: { organization?: unknown };
      }) => {
        const row = users.find(
          (u) =>
            u.invitationToken !== null &&
            u.invitationToken === where.invitationToken,
        );
        if (!row) return Promise.resolve(null);
        const org = orgs.find((o) => o.id === row.organizationId)!;
        // Honour the include, so a lookup that forgot the join would see no
        // organisation and fail rather than pass on a fixture.
        return Promise.resolve(
          include?.organization
            ? {
                ...row,
                organization: {
                  name: org.name,
                  nameAr: org.nameAr,
                  status: org.status,
                },
              }
            : { ...row },
        );
      },
    );
    const prisma = { user: { findFirst } } as unknown as PrismaService;
    const service = new AuthService(
      prisma,
      {} as AuditLogService,
      {} as NotificationService,
      {} as LoginAttemptService,
      {} as UserService,
    );

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: service },
        { provide: UserService, useValue: {} },
        { provide: WorkingCalendarService, useValue: {} },
      ],
    })
      // Other routes on this controller (/me, /logout) carry TenantGuard; the
      // lookup does not, and the route-level test below asserts that.
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    // Exactly main.ts's global pipe and filter.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // getHttpServer() is typed `any`; name what supertest takes, once.
  const server = () => app.getHttpServer() as Parameters<typeof request>[0];

  beforeEach(() => {
    jest.useFakeTimers({
      now: NOW,
      doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'queueMicrotask'],
    });
    findFirst.mockClear();
    orgs = [{ ...ORG_A }, { ...ORG_B }];
    users = [
      {
        id: 'u-1',
        organizationId: ORG_A.id,
        email: 'invitee@al-nakheel.example',
        status: 'INVITED',
        invitationToken: token(1),
        invitationExpiresAt: inAnHour,
      },
      {
        id: 'u-2',
        organizationId: ORG_B.id,
        email: 'invitee@al-manara.example',
        status: 'INVITED',
        invitationToken: token(2),
        invitationExpiresAt: inAnHour,
      },
    ];
  });
  afterEach(() => jest.useRealTimers());

  const lookup = (body: unknown) =>
    request(server())
      .post('/api/v1/auth/invitations/lookup')
      .send(body as object);
  const REFUSAL_TEXT = JSON.stringify(INVITATION_REFUSAL_BODY);

  // ── An open invitation ────────────────────────────────────────────────────

  it('returns exactly { name, nameAr } of the inviting organisation', async () => {
    const res = await lookup({ token: token(1) });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body as object).sort()).toEqual(['name', 'nameAr']);
    expect(res.body).toStrictEqual({ name: ORG_A.name, nameAr: ORG_A.nameAr });
  });

  it('returns nameAr null for a tenant with no Arabic name — and a TRIAL tenant is open', async () => {
    const res = await lookup({ token: token(2) });
    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({ name: ORG_B.name, nameAr: null });
  });

  it('treats the expiry instant itself as still open, the same `<` accept uses', async () => {
    users[0]!.invitationExpiresAt = new Date(NOW);
    expect((await lookup({ token: token(1) })).status).toBe(200);
  });

  // ── Every refusal is the same bytes ───────────────────────────────────────

  const refusals: Array<[string, () => unknown]> = [
    ['an unknown token', () => ({ token: token(99) })],
    [
      'an expired token',
      () => {
        users[0]!.invitationExpiresAt = new Date(NOW.getTime() - 1);
        return { token: token(1) };
      },
    ],
    [
      'an invitation with no expiry',
      () => {
        users[0]!.invitationExpiresAt = null;
        return { token: token(1) };
      },
    ],
    [
      'a used invitation (token cleared on acceptance)',
      () => {
        users[0]!.invitationToken = null;
        users[0]!.status = 'ACTIVE';
        return { token: token(1) };
      },
    ],
    [
      'a revoked invitation (row deleted)',
      () => {
        users.shift();
        return { token: token(1) };
      },
    ],
    [
      'a deactivated invitee whose token survived',
      () => {
        users[0]!.status = 'INACTIVE';
        return { token: token(1) };
      },
    ],
    [
      'a SUSPENDED tenant',
      () => {
        orgs[0]!.status = 'SUSPENDED';
        return { token: token(1) };
      },
    ],
    [
      'a CANCELLED tenant',
      () => {
        orgs[0]!.status = 'CANCELLED';
        return { token: token(1) };
      },
    ],
    [
      'an OFFBOARDING tenant',
      () => {
        orgs[0]!.status = 'OFFBOARDING';
        return { token: token(1) };
      },
    ],
    ['an empty body', () => ({})],
    ['a number for a token', () => ({ token: 42 })],
    ['an empty token', () => ({ token: '' })],
    ['a token of the wrong length', () => ({ token: 'abc123' })],
    ['a token in upper case', () => ({ token: token(1).toUpperCase() })],
    [
      'an extra field beside a valid token',
      () => ({ token: token(1), email: 'x@y.z' }),
    ],
    ['an array body', () => [token(1)]],
  ];

  for (const [name, setup] of refusals) {
    it(`refuses ${name} with the one refusal, byte for byte`, async () => {
      const res = await lookup(setup());
      // Guard first: the body really is the invitation refusal, not some
      // other 400 that happens to repeat — the pipe's own message, say.
      expect(res.body).toStrictEqual({ ...INVITATION_REFUSAL_BODY });
      expect(res.status).toBe(400);
      expect(res.text).toBe(REFUSAL_TEXT);
    });
  }

  // ── Read-only, and one query ──────────────────────────────────────────────

  it('changes nothing — the row is identical before and after, for an open and a refused lookup', async () => {
    const before = structuredClone(users);
    await lookup({ token: token(1) });
    users[1]!.invitationExpiresAt = new Date(NOW.getTime() - 1);
    const expiredBefore = structuredClone(users);
    await lookup({ token: token(2) });
    expect(users[0]).toStrictEqual(before[0]);
    expect(users).toStrictEqual(expiredBefore);
  });

  it('costs exactly one query, with the organisation joined, whether the token is unknown, expired or open', async () => {
    users[1]!.invitationExpiresAt = new Date(NOW.getTime() - 1);
    for (const body of [
      { token: token(99) },
      { token: token(2) },
      { token: token(1) },
    ]) {
      findFirst.mockClear();
      await lookup(body);
      expect(findFirst).toHaveBeenCalledTimes(1);
      expect(findFirst).toHaveBeenCalledWith({
        where: { invitationToken: body.token },
        include: {
          organization: { select: { name: true, nameAr: true, status: true } },
        },
      });
    }
  });

  // ── The route itself ──────────────────────────────────────────────────────

  it('is public: no guard on the route, and it answers without a session', () => {
    const handler = Object.getOwnPropertyDescriptor(
      AuthController.prototype,
      'lookupInvitation',
    )?.value as object;
    expect(Reflect.getMetadata('__guards__', handler)).toBeUndefined();
    expect(Reflect.getMetadata('__guards__', AuthController)).toBeUndefined();
  });

  it('is POST only, so a token never sits in a URL', async () => {
    const res = await request(server()).get(
      `/api/v1/auth/invitations/lookup?token=${token(1)}`,
    );
    expect(res.status).toBe(404);
    expect(findFirst).not.toHaveBeenCalled();
  });

  // Recorded, not part of the identical set (Ahmad, 2026-10-05): unparseable
  // JSON is rejected by the body parser before any route runs, the same on
  // every endpoint, and says nothing about any invitation.
  it('answers unparseable JSON from the body parser, before the lookup runs', async () => {
    const res = await request(server())
      .post('/api/v1/auth/invitations/lookup')
      .set('Content-Type', 'application/json')
      .send('{"token": ');
    // Measured 2026-10-05: Nest turns the parser's error into a
    // BadRequestException carrying the parser's own message, e.g.
    // {"message":"Unexpected end of JSON input","error":"Bad Request","statusCode":400}.
    expect(res.status).toBe(400);
    expect(res.body).toStrictEqual({
      message: expect.any(String) as string,
      error: 'Bad Request',
      statusCode: 400,
    });
    expect(res.text).not.toBe(REFUSAL_TEXT);
    expect(findFirst).not.toHaveBeenCalled();
  });

  itEnforcesTenantIsolation(
    'lookupInvitation() names only the organisation the token belongs to',
    async () => {
      const forA = await lookup({ token: token(1) });
      const forB = await lookup({ token: token(2) });
      expect(forA.body).toStrictEqual({
        name: ORG_A.name,
        nameAr: ORG_A.nameAr,
      });
      expect(forB.body).toStrictEqual({ name: ORG_B.name, nameAr: null });
    },
  );
});
