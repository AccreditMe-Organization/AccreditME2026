import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { NotificationService } from '../notification/notification.service';
import { LoginAttemptService } from './login-attempt.service';
import { UserService } from '../user/user.service';
import { OrganizationService } from '../organization/organization.service';

jest.mock('better-auth/api', () => ({ isAPIError: () => false }));
const mockAuthApi = { signUpEmail: jest.fn() };
jest.mock('../../providers/auth/better-auth.config', () => ({
  createBetterAuthInstance: jest.fn(() => ({ api: mockAuthApi })),
}));

// ACC-82 — regression: a Head brought in by invitation left their unit flagged
// vacant for good.
//
// UserService.invite() refreshes the unit's vacancy while the new Head is still
// INVITED, and INVITED holders do not count, so the flag reads vacant.
// AuthService.acceptInvitation() then flips the user to ACTIVE without
// refreshing it again, and nothing else re-derived isHeadVacant. On dev this
// left 32 of 34 "vacant" units with an active Head (SYSTEM-REFERENCE §5, §13).
//
// The service and prisma layers are real where they decide the outcome:
// OrganizationService.refreshOrgUnitHeadVacancy() runs for real against an
// in-memory unit/user store that applies the same filters Postgres would, and
// AuthService.acceptInvitation() and the UserService method it calls are the
// real code. Step 1 calls refreshOrgUnitHeadVacancy() directly for the
// invited user, which is exactly the call invite() makes (user.service.ts,
// "ACC-43 — mirrors updateProfile()'s own vacancy refresh") — the rest of
// invite() (seats, tokens, email) has no bearing on the flag.
describe('Invitation → acceptance leaves the unit correctly flagged (ACC-82 regression)', () => {
  const ORG = 'org-a';
  const UNIT = 'unit-radiology';

  type UnitRow = {
    id: string;
    organizationId: string;
    parentId: string | null;
    actingHeadUserId: string | null;
    isHeadVacant: boolean;
    headVacantSince: Date | null;
    isHeadFullyUnresolved: boolean;
  };
  type UserRow = {
    id: string;
    organizationId: string;
    name: string;
    email: string;
    status: string;
    primaryOrgUnitId: string | null;
    positionId: string | null;
    invitationToken: string | null;
    invitationExpiresAt: Date | null;
  };

  const HEAD_POSITION = { id: 'pos-head', isUnitHeadPosition: true, isActive: true };

  let units: UnitRow[];
  let users: UserRow[];
  let auth: AuthService;
  let organizationService: OrganizationService;

  const holdsHeadPosition = (u: UserRow, w: { position?: { isUnitHeadPosition?: boolean; isActive?: boolean } }) =>
    !w.position ||
    (u.positionId === HEAD_POSITION.id &&
      (w.position.isUnitHeadPosition === undefined || w.position.isUnitHeadPosition === HEAD_POSITION.isUnitHeadPosition) &&
      (w.position.isActive === undefined || w.position.isActive === HEAD_POSITION.isActive));

  const userMatches = (u: UserRow, w: Record<string, unknown>) =>
    (w['organizationId'] === undefined || u.organizationId === w['organizationId']) &&
    (w['primaryOrgUnitId'] === undefined || u.primaryOrgUnitId === w['primaryOrgUnitId']) &&
    (w['status'] === undefined || u.status === w['status']) &&
    (w['invitationToken'] === undefined || u.invitationToken === w['invitationToken']) &&
    (w['id'] === undefined || u.id === w['id']) &&
    holdsHeadPosition(u, w as { position?: { isUnitHeadPosition?: boolean; isActive?: boolean } });

  beforeEach(() => {
    units = [
      {
        id: UNIT,
        organizationId: ORG,
        parentId: null,
        actingHeadUserId: null,
        isHeadVacant: false,
        headVacantSince: null,
        isHeadFullyUnresolved: false,
      },
    ];
    users = [
      {
        id: 'user-new-head',
        organizationId: ORG,
        name: 'Dr. New Head',
        email: 'new.head@example.test',
        status: 'INVITED',
        primaryOrgUnitId: UNIT,
        positionId: HEAD_POSITION.id,
        invitationToken: 'invite-token',
        invitationExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    ];

    const prisma = {
      orgUnit: {
        findFirst: jest.fn(({ where }: { where: { id: string; organizationId: string } }) =>
          Promise.resolve(units.find((u) => u.id === where.id && u.organizationId === where.organizationId) ?? null),
        ),
        update: jest.fn(({ where, data }: { where: { id: string }; data: Partial<UnitRow> }) => {
          const unit = units.find((u) => u.id === where.id)!;
          Object.assign(unit, data);
          return Promise.resolve({ ...unit });
        }),
        updateMany: jest.fn(
          ({ where, data }: { where: { id: string; organizationId: string }; data: Partial<UnitRow> }) => {
            const hit = units.filter((u) => u.id === where.id && u.organizationId === where.organizationId);
            hit.forEach((u) => Object.assign(u, data));
            return Promise.resolve({ count: hit.length });
          },
        ),
      },
      user: {
        findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(users.find((u) => userMatches(u, where)) ?? null),
        ),
        findMany: jest.fn(({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(users.filter((u) => userMatches(u, where)).map((u) => ({ id: u.id }))),
        ),
        count: jest.fn(({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(users.filter((u) => userMatches(u, where)).length),
        ),
        update: jest.fn(({ where, data }: { where: { id: string }; data: Partial<UserRow> }) => {
          const user = users.find((u) => u.id === where.id)!;
          Object.assign(user, data);
          return Promise.resolve({ ...user });
        }),
      },
    };
    const auditLog = { log: jest.fn() };

    organizationService = new OrganizationService(
      prisma as unknown as PrismaService,
      auditLog as unknown as AuditLogService,
    );

    // The real UserService methods, with only what they touch wired in —
    // validatePositionAssignment() is stubbed because single-assignee and
    // head-uniqueness rules are not what this regression is about.
    const userService = Object.create(UserService.prototype) as UserService;
    Object.assign(userService, {
      prisma,
      organizationService,
      validatePositionAssignment: jest.fn().mockResolvedValue(undefined),
    });

    mockAuthApi.signUpEmail.mockResolvedValue({ user: { id: 'auth-user-1' } });
    auth = new AuthService(
      prisma as unknown as PrismaService,
      auditLog as unknown as AuditLogService,
      { create: jest.fn() } as unknown as NotificationService,
      {} as LoginAttemptService,
      userService,
    );
  });

  it('does not leave the unit flagged vacant once the invited Head accepts', async () => {
    // Step 1 — invite(): the Head is INVITED, so the unit is (correctly) vacant.
    await organizationService.refreshOrgUnitHeadVacancy(UNIT, ORG);
    expect(units[0]).toMatchObject({ isHeadVacant: true });

    // Step 2 — the invitation is accepted.
    await auth.acceptInvitation({ token: 'invite-token', password: 'a-long-enough-password' });
    expect(users[0]!.status).toBe('ACTIVE');

    // The unit has an active Head now, so it must not read as vacant.
    expect(units[0]).toMatchObject({
      isHeadVacant: false,
      headVacantSince: null,
      isHeadFullyUnresolved: false,
    });
  });

  it('leaves a unit vacant when the accepting user does not hold a head position', async () => {
    users[0]!.positionId = 'pos-ordinary';
    await organizationService.refreshOrgUnitHeadVacancy(UNIT, ORG);

    await auth.acceptInvitation({ token: 'invite-token', password: 'a-long-enough-password' });

    expect(units[0]).toMatchObject({ isHeadVacant: true });
  });
});
