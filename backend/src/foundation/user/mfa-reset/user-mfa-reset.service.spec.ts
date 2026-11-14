import { HttpException } from '@nestjs/common';
import { UserMfaResetService } from './user-mfa-reset.service';
import { itEnforcesTenantIsolation } from '../../../common/testing/tenant-isolation';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { AuditLogService } from '../../../common/services/audit-log.service';
import type { SecurityNoticeService } from '../../notification/security-notice';

/**
 * ACC-164 — the administrator reset (plan §4, §0b). A small in-memory database
 * holds two organisations, so every query's scoping is what decides the
 * outcome, and every write is visible: what committed, and what rolled back.
 */

const ORG = 'org-nakheel';
const OTHER_ORG = 'org-manara';

interface UserRow {
  id: string;
  organizationId: string;
  authUserId: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'INVITED';
  tokenVersion: number;
}

function build() {
  const users: UserRow[] = [
    { id: 'u-nora', organizationId: ORG, authUserId: 'au-nora', status: 'ACTIVE', tokenVersion: 3 },
    { id: 'u-lina', organizationId: ORG, authUserId: 'au-lina', status: 'ACTIVE', tokenVersion: 5 },
    { id: 'u-samir', organizationId: ORG, authUserId: 'au-samir', status: 'ACTIVE', tokenVersion: 1 },
    { id: 'u-omar', organizationId: ORG, authUserId: 'au-omar', status: 'ACTIVE', tokenVersion: 1 },
    { id: 'u-invited', organizationId: ORG, authUserId: null, status: 'INVITED', tokenVersion: 0 },
    { id: 'u-fahad', organizationId: OTHER_ORG, authUserId: 'au-fahad', status: 'ACTIVE', tokenVersion: 2 },
  ];
  const state = {
    owners: new Map<string, string | null>([
      [ORG, 'u-omar'],
      [OTHER_ORG, null],
    ]),
    // Organization Administrator holders, by organisation. `rootRoleActive` is the role's own switch.
    rootHolders: new Map<string, Set<string>>([
      [ORG, new Set(['u-nora', 'u-omar'])],
      [OTHER_ORG, new Set(['u-fahad'])],
    ]),
    rootRoleActive: true,
    twoFactorEnabled: new Map<string, boolean>([
      ['au-nora', true],
      ['au-lina', true],
      ['au-samir', false],
      ['au-omar', true],
      ['au-fahad', true],
    ]),
    twoFactorRows: new Map<string, { verified: boolean }>([
      ['au-nora', { verified: true }],
      ['au-lina', { verified: true }],
      ['au-omar', { verified: true }],
      ['au-fahad', { verified: true }],
    ]),
    verifications: [
      { identifier: '2fa-abc', value: 'au-lina' },
      { identifier: '2fa-attempts-2fa-abc', value: '1' },
      { identifier: 'reset-password:hashed', value: 'au-lina' },
      { identifier: '2fa-def', value: 'au-nora' },
    ],
    refreshTokens: [
      { userId: 'u-lina', organizationId: ORG, revokedAt: null as Date | null },
      { userId: 'u-lina', organizationId: ORG, revokedAt: null as Date | null },
      { userId: 'u-nora', organizationId: ORG, revokedAt: null as Date | null },
    ],
    authSessions: [
      { userId: 'au-lina', token: 's1' },
      { userId: 'au-nora', token: 's2' },
    ],
    users,
    /** Fails the transaction at this step, to prove a rollback writes nothing. */
    failAt: null as string | null,
  };

  const userRoleFindFirst = jest.fn(
    ({ where }: { where: { userId: string; user: { organizationId: string }; role: { organizationId: string; key: string; isActive: true } } }) => {
      const user = users.find((u) => u.id === where.userId && u.organizationId === where.user.organizationId);
      const holds =
        user !== undefined &&
        where.role.key === 'TENANT_ADMIN' &&
        state.rootRoleActive &&
        state.rootHolders.get(where.role.organizationId)?.has(where.userId) === true;
      return Promise.resolve(holds ? { id: 'ur' } : null);
    },
  );

  // The transaction works on a copy and commits it only if the callback returns.
  const makeClient = (s: typeof state) => ({
    $queryRaw: jest.fn().mockResolvedValue([]),
    organization: {
      findFirst: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve({ ownerUserId: s.owners.get(where.id) ?? null }),
      ),
    },
    userRole: { findFirst: userRoleFindFirst },
    user: {
      findFirst: jest.fn(({ where }: { where: { id: string; organizationId: string } }) => {
        const u = s.users.find((x) => x.id === where.id && x.organizationId === where.organizationId);
        if (!u) return Promise.resolve(null);
        return Promise.resolve({
          id: u.id,
          organizationId: u.organizationId,
          authUserId: u.authUserId,
          authUser: u.authUserId ? { twoFactorEnabled: s.twoFactorEnabled.get(u.authUserId) ?? false } : null,
          ownedOrganizations: s.owners.get(where.organizationId) === u.id ? [{ id: where.organizationId }] : [],
        });
      }),
      updateMany: jest.fn(
        ({ where, data }: { where: { id: string; organizationId: string }; data: { tokenVersion: { increment: number } } }) => {
        if (s.failAt === 'tokenVersion') throw new Error('database went away');
        for (const u of s.users)
          if (u.id === where.id && u.organizationId === where.organizationId) u.tokenVersion += data.tokenVersion.increment;
        return Promise.resolve({});
      },
      ),
    },
    authUser: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve({ twoFactorEnabled: s.twoFactorEnabled.get(where.id) ?? false }),
      ),
      update: jest.fn(({ where, data }: { where: { id: string }; data: { twoFactorEnabled: boolean } }) => {
        s.twoFactorEnabled.set(where.id, data.twoFactorEnabled);
        return Promise.resolve({});
      }),
    },
    authTwoFactor: {
      deleteMany: jest.fn(({ where }: { where: { userId: string } }) => {
        s.twoFactorRows.delete(where.userId);
        return Promise.resolve({});
      }),
    },
    authVerification: {
      findMany: jest.fn(({ where }: { where: { value: string; identifier: { startsWith: string; not: { startsWith: string } } } }) =>
        Promise.resolve(
          s.verifications.filter(
            (v) =>
              v.value === where.value &&
              v.identifier.startsWith(where.identifier.startsWith) &&
              !v.identifier.startsWith(where.identifier.not.startsWith),
          ),
        ),
      ),
      deleteMany: jest.fn(({ where }: { where: { identifier: { in: string[] } } }) => {
        s.verifications = s.verifications.filter((v) => !where.identifier.in.includes(v.identifier));
        return Promise.resolve({});
      }),
    },
    refreshToken: {
      updateMany: jest.fn(({ where, data }: { where: { userId: string; organizationId: string }; data: { revokedAt: Date } }) => {
        for (const t of s.refreshTokens)
          if (t.userId === where.userId && t.organizationId === where.organizationId && t.revokedAt === null) t.revokedAt = data.revokedAt;
        return Promise.resolve({});
      }),
    },
    authSession: {
      deleteMany: jest.fn(({ where }: { where: { userId: string } }) => {
        s.authSessions = s.authSessions.filter((x) => x.userId !== where.userId);
        return Promise.resolve({});
      }),
    },
  });

  let transactions = 0;
  const prisma = {
    ...makeClient(state),
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      transactions++;
      const working = {
        ...state,
        users: state.users.map((u) => ({ ...u })),
        twoFactorEnabled: new Map(state.twoFactorEnabled),
        twoFactorRows: new Map(state.twoFactorRows),
        verifications: state.verifications.map((v) => ({ ...v })),
        refreshTokens: state.refreshTokens.map((t) => ({ ...t })),
        authSessions: state.authSessions.map((x) => ({ ...x })),
      };
      const result = await fn(makeClient(working));
      // Commit.
      state.users.splice(0, state.users.length, ...working.users);
      state.twoFactorEnabled = working.twoFactorEnabled;
      state.twoFactorRows = working.twoFactorRows;
      state.verifications = working.verifications;
      state.refreshTokens = working.refreshTokens;
      state.authSessions = working.authSessions;
      return result;
    }),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const notice = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const service = new UserMfaResetService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditLogService,
    notice as unknown as SecurityNoticeService,
  );
  return { state, prisma, audit, notice, service, transactions: () => transactions };
}

const bodyOf = async (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof HttpException ? { status: e.getStatus(), body: e.getResponse() } : e),
  );

describe('UserMfaResetService.resetMfa (ACC-164)', () => {
  it('resets it: in ONE transaction, flag off, secret row gone, challenges gone, every session ended', async () => {
    const t = build();
    await t.service.resetMfa('u-lina', ORG, 'u-nora', false);

    expect(t.transactions()).toBe(1);
    expect(t.state.twoFactorEnabled.get('au-lina')).toBe(false);
    expect(t.state.twoFactorRows.has('au-lina')).toBe(false);
    // Her open sign-in challenge and its counter are gone; nobody else's rows,
    // and not her password-reset link (ACC-188's), are touched.
    expect(t.state.verifications.map((v) => v.identifier)).toEqual(['reset-password:hashed', '2fa-def']);
    expect(t.state.users.find((u) => u.id === 'u-lina')!.tokenVersion).toBe(6);
    expect(t.state.refreshTokens.filter((r) => r.userId === 'u-lina').every((r) => r.revokedAt !== null)).toBe(true);
    expect(t.state.refreshTokens.find((r) => r.userId === 'u-nora')!.revokedAt).toBeNull();
    expect(t.state.authSessions).toEqual([{ userId: 'au-nora', token: 's2' }]);
    // The administrator's own state is untouched.
    expect(t.state.twoFactorEnabled.get('au-nora')).toBe(true);
    expect(t.state.users.find((u) => u.id === 'u-nora')!.tokenVersion).toBe(3);
  });

  it('then one audit row (administrator actor, person object, mfa_reset), then the mfa_reset notice', async () => {
    const t = build();
    await t.service.resetMfa('u-lina', ORG, 'u-nora', false);
    expect(t.audit.log).toHaveBeenCalledTimes(1);
    expect(t.audit.log).toHaveBeenCalledWith({
      tenantId: ORG,
      actorId: 'u-nora',
      action: 'UPDATE',
      objectType: 'User',
      objectId: 'u-lina',
      metadata: { event: 'mfa_reset' },
    });
    expect(t.notice.enqueue).toHaveBeenCalledWith({ organizationId: ORG, userId: 'u-lina', notice: 'mfa_reset' });
    expect(t.prisma.$transaction.mock.invocationCallOrder[0]).toBeLessThan(t.audit.log.mock.invocationCallOrder[0]!);
    expect(t.audit.log.mock.invocationCallOrder[0]).toBeLessThan(t.notice.enqueue.mock.invocationCallOrder[0]!);
  });

  it('a transaction that fails writes nothing, audits nothing and sends nothing', async () => {
    const t = build();
    t.state.failAt = 'tokenVersion';
    await expect(t.service.resetMfa('u-lina', ORG, 'u-nora', false)).rejects.toThrow('database went away');
    expect(t.state.twoFactorEnabled.get('au-lina')).toBe(true);
    expect(t.state.twoFactorRows.has('au-lina')).toBe(true);
    expect(t.audit.log).not.toHaveBeenCalled();
    expect(t.notice.enqueue).not.toHaveBeenCalled();
  });

  itEnforcesTenantIsolation('resetMfa: another organisation\'s person is the 404 an invented id gets, with no write', async () => {
    const t = build();
    const other = await bodyOf(t.service.resetMfa('u-fahad', ORG, 'u-nora', false));
    const invented = await bodyOf(t.service.resetMfa('u-nobody', ORG, 'u-nora', false));
    expect(other).toEqual({ status: 404, body: { statusCode: 404, message: 'User not found', error: 'Not Found' } });
    expect(other).toEqual(invented);
    expect(t.state.twoFactorEnabled.get('au-fahad')).toBe(true);
    expect(t.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses yourself: 409 MFA_RESET_SELF, before any write', async () => {
    const t = build();
    const r = await bodyOf(t.service.resetMfa('u-nora', ORG, 'u-nora', false));
    expect(r).toMatchObject({ status: 409, body: { code: 'MFA_RESET_SELF' } });
    expect(t.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses while impersonating: 409 MFA_RESET_IMPERSONATING', async () => {
    const t = build();
    const r = await bodyOf(t.service.resetMfa('u-lina', ORG, 'u-nora', true));
    expect(r).toMatchObject({ status: 409, body: { code: 'MFA_RESET_IMPERSONATING' } });
    expect(t.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses the account owner: 409 ACCOUNT_OWNER_PROTECTED (Ahmad, rule 1)', async () => {
    const t = build();
    const r = await bodyOf(t.service.resetMfa('u-omar', ORG, 'u-nora', false));
    expect(r).toMatchObject({ status: 409, body: { code: 'ACCOUNT_OWNER_PROTECTED' } });
    expect(t.state.twoFactorEnabled.get('au-omar')).toBe(true);
    expect(t.prisma.$transaction).not.toHaveBeenCalled();
  });

  describe('the floor (lane B): a holder without Organization Administrator cannot reset someone who has it', () => {
    it('refuses with 409 MFA_RESET_HIGHER_ACCOUNT, before any write', async () => {
      const t = build();
      // Samir holds users:reset_mfa through some other role, not the root role.
      const r = await bodyOf(t.service.resetMfa('u-nora', ORG, 'u-samir', false));
      expect(r).toMatchObject({ status: 409, body: { code: 'MFA_RESET_HIGHER_ACCOUNT' } });
      expect(t.state.twoFactorEnabled.get('au-nora')).toBe(true);
      expect(t.prisma.$transaction).not.toHaveBeenCalled();
    });

    it('lets him reset someone without Organization Administrator', async () => {
      const t = build();
      await t.service.resetMfa('u-lina', ORG, 'u-samir', false);
      expect(t.state.twoFactorEnabled.get('au-lina')).toBe(false);
    });

    it('lets an Organization Administrator reset another one', async () => {
      const t = build();
      t.state.owners.set(ORG, null);
      await t.service.resetMfa('u-omar', ORG, 'u-nora', false);
      expect(t.state.twoFactorEnabled.get('au-omar')).toBe(false);
    });

    it('reads the root role as granted only while the role is active', async () => {
      const t = build();
      t.state.rootRoleActive = false;
      await t.service.resetMfa('u-nora', ORG, 'u-samir', false);
      expect(t.state.twoFactorEnabled.get('au-nora')).toBe(false);
    });

    it('reads only this organisation\'s root role', async () => {
      const t = build();
      // Samir is no administrator here, whatever another organisation says.
      t.state.rootHolders.get(OTHER_ORG)!.add('u-samir');
      const r = await bodyOf(t.service.resetMfa('u-nora', ORG, 'u-samir', false));
      expect(r).toMatchObject({ body: { code: 'MFA_RESET_HIGHER_ACCOUNT' } });
    });
  });

  it.each([
    ['an invited person, who has no sign-in yet', 'u-invited'],
    ['a person whose two-step sign-in is off', 'u-samir'],
  ])('refuses %s: 409 MFA_NOT_ENABLED, nothing written', async (_label, id) => {
    const t = build();
    const r = await bodyOf(t.service.resetMfa(id, ORG, 'u-nora', false));
    expect(r).toMatchObject({ status: 409, body: { code: 'MFA_NOT_ENABLED' } });
    expect(t.prisma.$transaction).not.toHaveBeenCalled();
    expect(t.audit.log).not.toHaveBeenCalled();
  });

  it('two administrators at once: the second, re-reading under the lock, gets MFA_NOT_ENABLED and writes nothing', async () => {
    const t = build();
    await t.service.resetMfa('u-lina', ORG, 'u-nora', false);
    // The second press read "on" before the first committed: replay that read.
    t.state.twoFactorEnabled.set('au-lina', false);
    const before = t.state.users.find((u) => u.id === 'u-lina')!.tokenVersion;
    const r = await bodyOf(
      (async () => {
        const stale = t.prisma.user.findFirst;
        t.prisma.user.findFirst = jest.fn().mockResolvedValueOnce({
          id: 'u-lina',
          organizationId: ORG,
          authUserId: 'au-lina',
          authUser: { twoFactorEnabled: true },
          ownedOrganizations: [],
        }) as typeof stale;
        try {
          await t.service.resetMfa('u-lina', ORG, 'u-samir', false);
        } finally {
          t.prisma.user.findFirst = stale;
        }
      })(),
    );
    expect(r).toMatchObject({ status: 409, body: { code: 'MFA_NOT_ENABLED' } });
    expect(t.state.users.find((u) => u.id === 'u-lina')!.tokenVersion).toBe(before);
    expect(t.audit.log).toHaveBeenCalledTimes(1);
  });

  it('never answers 401', async () => {
    const t = build();
    const statuses = await Promise.all(
      [
        t.service.resetMfa('u-nora', ORG, 'u-nora', false),
        t.service.resetMfa('u-lina', ORG, 'u-nora', true),
        t.service.resetMfa('u-omar', ORG, 'u-nora', false),
        t.service.resetMfa('u-nora', ORG, 'u-samir', false),
        t.service.resetMfa('u-samir', ORG, 'u-nora', false),
        t.service.resetMfa('u-fahad', ORG, 'u-nora', false),
      ].map((p) => p.then(() => 0, (e: unknown) => (e instanceof HttpException ? e.getStatus() : -1))),
    );
    expect(statuses).toEqual([409, 409, 409, 409, 409, 404]);
  });

  /**
   * The leftover-row proof (plan §4.1). Better Auth, as the contract spec pins
   * it: enableTwoFactor gives the new secret `verified = old row exists and
   * was verified`, and verifyTOTP turns the flag on only for an unverified
   * secret. So a reset that left the row behind would make the person's next
   * set-up say "on" while sign-in never asks for a code.
   */
  it('after a reset, setting it up again really turns it on (the leftover-row defect is absent)', async () => {
    const t = build();
    await t.service.resetMfa('u-lina', ORG, 'u-nora', false);

    const existing = t.state.twoFactorRows.get('au-lina');
    const verified = existing != null && existing.verified !== false; // two-factor/index.mjs
    t.state.twoFactorRows.set('au-lina', { verified });
    if (t.state.twoFactorRows.get('au-lina')!.verified !== true) {
      t.state.twoFactorEnabled.set('au-lina', true); // totp/index.mjs, the verified gate
    }
    expect(t.state.twoFactorEnabled.get('au-lina')).toBe(true);
  });
});

describe('UserMfaResetService.twoStepFor — who sees someone else\'s status (ACC-164, rule 4)', () => {
  const holder = (id: string, impersonating = false) => ({ id, permissions: ['users:view', 'users:reset_mfa'], impersonating });

  it('shows it, with Reset, to an Organization Administrator holding the key', async () => {
    const t = build();
    await expect(
      t.service.twoStepFor(ORG, holder('u-nora'), { id: 'u-lina', isAccountOwner: false, twoFactorEnabled: true }),
    ).resolves.toEqual({ enabled: true, mayReset: true });
  });

  it('shows "off" with no Reset when it is off', async () => {
    const t = build();
    await expect(
      t.service.twoStepFor(ORG, holder('u-nora'), { id: 'u-samir', isAccountOwner: false, twoFactorEnabled: false }),
    ).resolves.toEqual({ enabled: false, mayReset: false });
  });

  it('hides Reset, not the panel, while impersonating', async () => {
    const t = build();
    await expect(
      t.service.twoStepFor(ORG, holder('u-nora', true), { id: 'u-lina', isAccountOwner: false, twoFactorEnabled: true }),
    ).resolves.toEqual({ enabled: true, mayReset: false });
  });

  it.each([
    ['a viewer with users:view only', { id: 'u-nora', permissions: ['users:view'], impersonating: false }, 'u-lina', false],
    ['your own record', holder('u-lina'), 'u-lina', false],
    ['the account owner\'s record', holder('u-nora'), 'u-omar', true],
    ['an administrator\'s record, below the floor', holder('u-samir'), 'u-nora', false],
  ])('is null — no panel at all — for %s', async (_label, viewer, targetId, isAccountOwner) => {
    const t = build();
    await expect(
      t.service.twoStepFor(ORG, viewer, { id: targetId, isAccountOwner, twoFactorEnabled: true }),
    ).resolves.toBeNull();
  });

  it('costs no query for a viewer without the key', async () => {
    const t = build();
    await t.service.twoStepFor(ORG, { id: 'u-nora', permissions: ['users:view'], impersonating: false }, {
      id: 'u-lina',
      isAccountOwner: false,
      twoFactorEnabled: true,
    });
    expect(t.prisma.userRole.findFirst).not.toHaveBeenCalled();
  });

});
