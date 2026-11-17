// ACC-216 part 2 — GET /users/:userId/access-history. Yourself or users:view,
// checked BEFORE any read; another organisation's person is the same 404 as an
// invented id; every query is scoped by organisation; every audit action maps to
// a kind, an unknown one to CHANGED; before / after / metadata never leave.
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  ACCESS_HISTORY_MAX_TAKE,
  TRANSFER_MATCH_WINDOW_MS,
  UserAccessHistoryService,
  classifyAccessRow,
  matchTransfers,
} from './user-access-history.service';
import type { AccessHistoryKind } from './user-access-history.interface';

const ORG = 'org-a';
const PLATFORM_ORG = 'org-platform';
const OTHER_ORG = 'org-b';
const ME = 'user-me';
const ADMIN = 'user-admin';
const COLLEAGUE = 'user-colleague';
const GONE = 'user-gone';
const PLATFORM_ADMIN = 'user-platform-admin';

interface Audit {
  id: string;
  organizationId: string;
  action: string;
  objectType: string;
  objectId: string | null;
  actorId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

interface TransferEvent {
  id: string;
  organizationId: string;
  userId: string;
  sourceOrgUnitId: string;
  destinationOrgUnitId: string;
  destinationPositionId: string | null;
  isPromotion: boolean;
  promotionAttempted: boolean;
  performedBy: string;
  createdAt: Date;
}

const at = (minute: number) => new Date(Date.UTC(2026, 10, 10, 8, minute));
let seq = 0;
const audit = (over: Partial<Audit>): Audit => ({
  id: `a${String(++seq).padStart(3, '0')}`,
  organizationId: ORG,
  action: 'UPDATE',
  objectType: 'User',
  objectId: COLLEAGUE,
  actorId: ADMIN,
  before: null,
  after: null,
  metadata: null,
  createdAt: at(seq),
  ...over,
});

// A User row as the writers store it: the whole record, its invitation token included.
const userCopy = (over: Record<string, unknown> = {}) => ({
  id: COLLEAGUE,
  organizationId: ORG,
  email: 'huda@example.test',
  name: 'Huda',
  language: 'en',
  hijriDisplay: false,
  status: 'ACTIVE',
  tokenVersion: 3,
  invitationToken: 'SECRET-INVITE-TOKEN',
  positionId: 'pos-1',
  primaryOrgUnitId: 'unit-1',
  managerId: null,
  actingOrgUnitId: null,
  actingOrgUnitUntil: null,
  outOfOfficeFrom: null,
  outOfOfficeTo: null,
  actingUserId: null,
  updatedAt: '2026-11-01T00:00:00.000Z',
  ...over,
});

interface Where {
  organizationId?: string;
  action?: { notIn: string[] };
  OR?: Array<{ objectType: string; objectId?: string; metadata?: { path: string[]; equals: string } }>;
  id?: { in: string[] };
  userId?: string;
  createdAt?: { gte: Date; lte: Date };
}

function auditMatches(row: Audit, where: Where): boolean {
  if (where.organizationId !== undefined && row.organizationId !== where.organizationId) return false;
  if (where.action?.notIn.includes(row.action)) return false;
  if (where.OR) {
    return where.OR.some((c) => {
      if (row.objectType !== c.objectType) return false;
      if (c.objectId !== undefined && row.objectId !== c.objectId) return false;
      if (c.metadata) return row.metadata?.[c.metadata.path[0]] === c.metadata.equals;
      return true;
    });
  }
  return true;
}

const scoped = <T extends { id: string; organizationId: string }>(rows: T[], where: Where) =>
  rows.filter((r) => (where.organizationId === undefined || r.organizationId === where.organizationId) && (!where.id || where.id.in.includes(r.id)));

function makeService(data: {
  audits?: Audit[];
  events?: TransferEvent[];
  people?: Array<{ id: string; organizationId: string; name: string }>;
}) {
  const audits = data.audits ?? [];
  const events = data.events ?? [];
  const people = data.people ?? [
    { id: ME, organizationId: ORG, name: 'Me' },
    { id: ADMIN, organizationId: ORG, name: 'Ahmad Admin' },
    { id: COLLEAGUE, organizationId: ORG, name: 'Huda' },
    { id: PLATFORM_ADMIN, organizationId: PLATFORM_ORG, name: 'Platform Admin' },
  ];
  const roles = [
    { id: 'role-qm', organizationId: ORG, nameEn: 'Quality Manager', nameAr: 'مدير الجودة' },
    { id: 'role-foreign', organizationId: OTHER_ORG, nameEn: 'Foreign Role', nameAr: null },
  ];
  const units = [
    { id: 'unit-1', organizationId: ORG, nameEn: 'Cardiology', nameAr: 'القلب' },
    { id: 'unit-2', organizationId: ORG, nameEn: 'Internal Medicine', nameAr: 'الباطنة' },
    { id: 'unit-foreign', organizationId: OTHER_ORG, nameEn: 'Foreign Unit', nameAr: null },
  ];
  const positions = [
    { id: 'pos-2', organizationId: ORG, nameEn: 'Head Nurse', nameAr: 'رئيس التمريض' },
    { id: 'pos-foreign', organizationId: OTHER_ORG, nameEn: 'Foreign Position', nameAr: null },
  ];

  const calls: Array<{ model: string; where: Where }> = [];
  const auditFindMany = jest.fn((args: { where: Where; skip: number; take: number; orderBy: unknown }) => {
    calls.push({ model: 'auditLog', where: args.where });
    const sorted = audits
      .filter((r) => auditMatches(r, args.where))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));
    return Promise.resolve(sorted.slice(args.skip, args.skip + args.take));
  });
  const auditCount = jest.fn(({ where }: { where: Where }) => {
    calls.push({ model: 'auditLog.count', where });
    return Promise.resolve(audits.filter((r) => auditMatches(r, where)).length);
  });
  const named = (model: string, rows: Array<{ id: string; organizationId: string }>, pick: (r: never) => unknown) =>
    jest.fn(({ where }: { where: Where }) => {
      calls.push({ model, where });
      return Promise.resolve(scoped(rows, where).map(pick as (r: unknown) => unknown));
    });
  const userFindMany = named('user', people, (r: { id: string; name: string }) => ({ id: r.id, name: r.name }));
  const roleFindMany = named('role', roles, ({ organizationId: _o, ...r }: { organizationId: string }) => r);
  const unitFindMany = named('orgUnit', units, ({ organizationId: _o, ...r }: { organizationId: string }) => r);
  const positionFindMany = named('orgPosition', positions, ({ organizationId: _o, ...r }: { organizationId: string }) => r);
  const eventFindMany = jest.fn(({ where }: { where: Where }) => {
    calls.push({ model: 'userTransferEvent', where });
    return Promise.resolve(
      events
        .filter(
          (e) =>
            e.organizationId === where.organizationId &&
            e.userId === where.userId &&
            e.createdAt >= where.createdAt!.gte &&
            e.createdAt <= where.createdAt!.lte,
        )
        .map(({ organizationId: _o, userId: _u, ...e }) => e),
    );
  });
  const prisma = {
    auditLog: { findMany: auditFindMany, count: auditCount },
    user: { findMany: userFindMany },
    role: { findMany: roleFindMany },
    orgUnit: { findMany: unitFindMany },
    orgPosition: { findMany: positionFindMany },
    userTransferEvent: { findMany: eventFindMany },
  };
  const getById = jest.fn((id: string, organizationId: string) =>
    people.some((p) => p.id === id && p.organizationId === organizationId)
      ? Promise.resolve({ id, organizationId })
      : Promise.reject(new NotFoundException('User not found')),
  );
  const service = new UserAccessHistoryService(prisma as never, { getById } as never);
  return { service, calls, getById, auditFindMany, auditCount, userFindMany, roleFindMany, eventFindMany, unitFindMany };
}

const ADMIN_VIEW = { id: ADMIN, permissions: ['users:view', 'roles:view'] };

describe('UserAccessHistoryService (ACC-216 part 2)', () => {
  beforeEach(() => {
    seq = 0;
  });

  describe('the gate, before any read', () => {
    it("someone else's, without users:view: 403 naming users:view, and no query", async () => {
      const { service, calls, getById } = makeService({});
      const err = await service.forUser(ORG, { id: ME, permissions: ['roles:view'] }, COLLEAGUE).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).message).toBe('Required permission: users:view');
      expect(getById).not.toHaveBeenCalled();
      expect(calls).toEqual([]);
    });

    it('the refusal is the same for an invented id (existence-neutral)', async () => {
      const { service, calls, getById } = makeService({});
      const err = await service.forUser(ORG, { id: ME, permissions: [] }, 'user-invented').catch((e: unknown) => e);
      expect((err as ForbiddenException).message).toBe('Required permission: users:view');
      expect(getById).not.toHaveBeenCalled();
      expect(calls).toEqual([]);
    });

    it('yourself, with no permission at all: admitted', async () => {
      const { service } = makeService({ audits: [audit({ objectId: ME, actorId: ME, metadata: { event: 'mfa_enabled' } })] });
      const page = await service.forUser(ORG, { id: ME, permissions: [] }, ME);
      expect(page.rows.map((r) => r.kind)).toEqual(['TWO_STEP_TURNED_ON']);
    });
  });

  it("another organisation's person, or an invented id: the identical 404, and no history read", async () => {
    const { service, auditFindMany } = makeService({});
    for (const id of ['user-invented', PLATFORM_ADMIN]) {
      const err = await service.forUser(ORG, ADMIN_VIEW, id).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NotFoundException);
      expect((err as NotFoundException).message).toBe('User not found');
    }
    expect(auditFindMany).not.toHaveBeenCalled();
  });

  it('should NOT return records belonging to a different tenant', async () => {
    // The platform organisation's own IMPERSONATE_START row names the person as
    // its object; so does a row in another tenant. Neither is this person's history.
    const { service, calls } = makeService({
      audits: [
        audit({ action: 'IMPERSONATE_START', organizationId: PLATFORM_ORG, actorId: PLATFORM_ADMIN }),
        audit({ organizationId: OTHER_ORG, metadata: { event: 'deactivated' } }),
        audit({ organizationId: OTHER_ORG, objectType: 'UserRole', objectId: 'role-foreign', action: 'CREATE', metadata: { userId: COLLEAGUE, roleId: 'role-foreign' } }),
        audit({ metadata: { event: 'reactivated' } }),
      ],
    });
    const page = await service.forUser(ORG, ADMIN_VIEW, COLLEAGUE);
    expect(page.rows.map((r) => r.kind)).toEqual(['REACTIVATED']);
    expect(page.total).toBe(1);
    for (const call of calls) expect(call.where.organizationId).toBe(ORG);
  });

  it('should NOT return records belonging to a different tenant — the names a row resolves', async () => {
    // A role id from another organisation in this tenant's metadata, and a
    // platform administrator as an actor: neither is named.
    const { service, calls } = makeService({
      audits: [
        audit({ action: 'IMPERSONATE_START', actorId: PLATFORM_ADMIN, metadata: { platformAdminUserId: PLATFORM_ADMIN } }),
        audit({ objectType: 'UserRole', objectId: 'role-foreign', action: 'CREATE', metadata: { userId: COLLEAGUE, roleId: 'role-foreign' } }),
      ],
    });
    const page = await service.forUser(ORG, ADMIN_VIEW, COLLEAGUE);
    const byKind = Object.fromEntries(page.rows.map((r) => [r.kind, r]));
    expect(byKind['SIGNED_IN_AS']!.actor).toBeNull();
    expect(byKind['ROLE_GRANTED']!.role).toBeNull();
    for (const call of calls) expect(call.where.organizationId).toBe(ORG);
  });

  it('should NOT return records belonging to a different tenant — a transfer naming a unit of another organisation', async () => {
    const { service, calls } = makeService({
      audits: [audit({ before: userCopy(), after: userCopy({ primaryOrgUnitId: 'unit-foreign' }), createdAt: at(20) })],
      events: [
        {
          id: 'e-foreign',
          organizationId: ORG,
          userId: COLLEAGUE,
          sourceOrgUnitId: 'unit-1',
          destinationOrgUnitId: 'unit-foreign',
          destinationPositionId: 'pos-foreign',
          isPromotion: false,
          promotionAttempted: false,
          performedBy: ADMIN,
          createdAt: at(20),
        },
      ],
    });
    const page = await service.forUser(ORG, ADMIN_VIEW, COLLEAGUE);
    expect(page.rows[0]!.transfer).toEqual({
      from: { id: 'unit-1', nameEn: 'Cardiology', nameAr: 'القلب' },
      to: null,
      position: null,
      headAppointment: 'NONE',
    });
    for (const call of calls) expect(call.where.organizationId).toBe(ORG);
  });

  it('every audit action written against a person maps to its kind; an unknown one is CHANGED, never dropped', () => {
    const cases: Array<[Partial<Audit>, AccessHistoryKind]> = [
      [{ action: 'CREATE', after: userCopy() }, 'INVITED'],
      [{ action: 'DELETE', metadata: { event: 'invitation_revoked', email: 'x@example.test' } }, 'INVITATION_REVOKED'],
      [{ metadata: { event: 'invitation_accepted' } }, 'INVITATION_ACCEPTED'],
      [{ before: userCopy(), metadata: { event: 'deactivated', reassignedCount: 2 } }, 'DEACTIVATED'],
      [{ before: { status: 'DEACTIVATED' }, after: { status: 'ACTIVE' }, metadata: { event: 'reactivated' } }, 'REACTIVATED'],
      [{ metadata: { event: 'mfa_enabled' } }, 'TWO_STEP_TURNED_ON'],
      [{ metadata: { event: 'mfa_disabled' } }, 'TWO_STEP_TURNED_OFF'],
      [{ metadata: { event: 'mfa_reset' } }, 'TWO_STEP_RESET'],
      [{ metadata: { event: 'password_reset_requested' } }, 'PASSWORD_RESET_REQUESTED'],
      [{ metadata: { event: 'password_reset' } }, 'PASSWORD_RESET'],
      [{ metadata: { transferPromotionFailed: true, reason: 'boom' } }, 'HEAD_APPOINTMENT_FAILED'],
      [{ before: userCopy(), after: userCopy({ name: 'Huda A.' }) }, 'PROFILE_EDITED'],
      [{ before: userCopy(), after: userCopy({ outOfOfficeFrom: '2026-12-01', actingUserId: ME }) }, 'OUT_OF_OFFICE_CHANGED'],
      [{ action: 'IMPERSONATE_START', metadata: { platformAdminUserId: 'x' } }, 'SIGNED_IN_AS'],
      [{ objectType: 'UserRole', action: 'CREATE', metadata: { userId: COLLEAGUE, roleId: 'r' } }, 'ROLE_GRANTED'],
      [{ objectType: 'UserRole', action: 'DELETE', metadata: { userId: COLLEAGUE, roleId: 'r' } }, 'ROLE_REMOVED'],
      // Unknown: an event nobody writes yet, an action with no meaning here, a bare UPDATE.
      [{ metadata: { event: 'something_new' } }, 'CHANGED'],
      [{ action: 'EXPORT' }, 'CHANGED'],
      [{ action: 'DELETE' }, 'CHANGED'],
      [{ action: 'UPDATE' }, 'CHANGED'],
      [{ objectType: 'UserRole', action: 'UPDATE', metadata: { userId: COLLEAGUE } }, 'CHANGED'],
    ];
    for (const [over, kind] of cases) {
      const row = audit(over);
      expect({ over, kind: classifyAccessRow(row).kind }).toEqual({ over, kind });
    }
  });

  it('an edit names only the fields that differ, from a fixed list, and never their values', () => {
    const c = classifyAccessRow(
      audit({
        before: userCopy(),
        after: userCopy({ name: 'Huda A.', language: 'ar', managerId: ADMIN, tokenVersion: 4, invitationToken: null, updatedAt: 'later' }),
      }),
    );
    expect(c).toEqual({ kind: 'PROFILE_EDITED', fields: ['name', 'language', 'manager'] });
  });

  it('a key only one copy holds is not a change', () => {
    const c = classifyAccessRow(audit({ before: { name: 'Huda' }, after: userCopy() }));
    expect(c).toEqual({ kind: 'PROFILE_EDITED', fields: [] });
  });

  it('LOGIN and LOGOUT are not listed and not counted', async () => {
    const { service } = makeService({
      audits: [
        audit({ action: 'LOGIN', actorId: COLLEAGUE }),
        audit({ action: 'LOGOUT', actorId: COLLEAGUE }),
        audit({ metadata: { event: 'password_reset' }, actorId: COLLEAGUE }),
      ],
    });
    const page = await service.forUser(ORG, ADMIN_VIEW, COLLEAGUE);
    expect(page.rows.map((r) => r.kind)).toEqual(['PASSWORD_RESET']);
    expect(page.total).toBe(1);
  });

  describe('roles', () => {
    const roleRows = () => [
      audit({ objectType: 'UserRole', objectId: 'role-qm', action: 'CREATE', metadata: { userId: COLLEAGUE, roleId: 'role-qm' } }),
      audit({
        objectType: 'UserRole',
        objectId: 'role-qm',
        action: 'CREATE',
        actorId: null,
        metadata: { userId: COLLEAGUE, roleId: 'role-qm', grantedViaHeadPositionId: 'pos-2', grantedViaHeadPositionOrgUnitId: 'unit-2' },
      }),
      // The headship removal is keyed by the person and has no role id.
      audit({ objectType: 'UserRole', objectId: COLLEAGUE, action: 'DELETE', actorId: null, metadata: { userId: COLLEAGUE, grantedViaHeadPositionOrgUnitId: 'unit-2' } }),
      // Someone else's grant is not this person's history.
      audit({ objectType: 'UserRole', objectId: 'role-qm', action: 'CREATE', metadata: { userId: ME, roleId: 'role-qm' } }),
    ];

    it('found by metadata.userId, named with roles:view, by hand or with headship', async () => {
      const { service } = makeService({ audits: roleRows() });
      const page = await service.forUser(ORG, ADMIN_VIEW, COLLEAGUE);
      expect(page.rows.map((r) => [r.kind, r.role?.nameEn ?? null, r.viaHeadship])).toEqual([
        ['ROLE_REMOVED', null, true],
        ['ROLE_GRANTED', 'Quality Manager', true],
        ['ROLE_GRANTED', 'Quality Manager', false],
      ]);
    });

    it('without roles:view: the row is there, the role is not named, and no role is read', async () => {
      const { service, roleFindMany } = makeService({ audits: roleRows() });
      const page = await service.forUser(ORG, { id: ADMIN, permissions: ['users:view'] }, COLLEAGUE);
      expect(page.rows.map((r) => [r.kind, r.role])).toEqual([
        ['ROLE_REMOVED', null],
        ['ROLE_GRANTED', null],
        ['ROLE_GRANTED', null],
      ]);
      expect(roleFindMany).not.toHaveBeenCalled();
    });
  });

  describe('transfers', () => {
    const transferAudit = (minute: number, over: Partial<Audit> = {}) =>
      audit({
        before: userCopy(),
        after: userCopy({ primaryOrgUnitId: 'unit-2', positionId: 'pos-2', managerId: null }),
        createdAt: at(minute),
        ...over,
      });
    const event = (minute: number, over: Partial<TransferEvent> = {}): TransferEvent => ({
      id: `e${minute}`,
      organizationId: ORG,
      userId: COLLEAGUE,
      sourceOrgUnitId: 'unit-1',
      destinationOrgUnitId: 'unit-2',
      destinationPositionId: 'pos-2',
      isPromotion: false,
      promotionAttempted: false,
      performedBy: ADMIN,
      createdAt: at(minute),
      ...over,
    });

    it('the audit row is described by its UserTransferEvent, once', async () => {
      const { service } = makeService({ audits: [transferAudit(10)], events: [event(10)] });
      const page = await service.forUser(ORG, ADMIN_VIEW, COLLEAGUE);
      expect(page.total).toBe(1);
      expect(page.rows).toEqual([
        {
          id: expect.stringMatching(/^audit:/),
          at: at(10),
          kind: 'TRANSFERRED',
          actor: { id: ADMIN, name: 'Ahmad Admin' },
          transfer: {
            from: { id: 'unit-1', nameEn: 'Cardiology', nameAr: 'القلب' },
            to: { id: 'unit-2', nameEn: 'Internal Medicine', nameAr: 'الباطنة' },
            position: { id: 'pos-2', nameEn: 'Head Nurse', nameAr: 'رئيس التمريض' },
            headAppointment: 'NONE',
          },
        },
      ]);
    });

    it('a head appointment that completed reads DONE; one attempted and failed reads FAILED, with its own row', async () => {
      const failed = audit({ metadata: { transferPromotionFailed: true, reason: 'SECRET ERROR TEXT', destinationOrgUnitId: 'unit-2' }, createdAt: at(31) });
      const { service } = makeService({
        audits: [transferAudit(10), transferAudit(30), failed],
        events: [event(10, { isPromotion: true, promotionAttempted: true }), event(32, { promotionAttempted: true })],
      });
      const page = await service.forUser(ORG, ADMIN_VIEW, COLLEAGUE);
      expect(page.rows.map((r) => [r.kind, r.transfer?.headAppointment ?? null])).toEqual([
        ['HEAD_APPOINTMENT_FAILED', null],
        ['TRANSFERRED', 'FAILED'],
        ['TRANSFERRED', 'DONE'],
      ]);
    });

    it('an edit of the unit with no matching event (a first placement) stays an edit', async () => {
      const { service } = makeService({
        audits: [transferAudit(10)],
        // Another actor, and one too far away: neither is this edit's transfer.
        events: [event(10, { performedBy: ME }), event(10 + TRANSFER_MATCH_WINDOW_MS / 60000 + 1)],
      });
      const page = await service.forUser(ORG, ADMIN_VIEW, COLLEAGUE);
      expect(page.rows.map((r) => [r.kind, r.fields])).toEqual([['PROFILE_EDITED', ['position', 'unit']]]);
    });

    it('matchTransfers uses each event once, nearest first', () => {
      const ev = (id: string, minute: number) => ({ ...event(minute), id });
      const matched = matchTransfers(
        [
          { id: 'x', actorId: ADMIN, at: at(10), fromUnitId: 'unit-1', toUnitId: 'unit-2' },
          { id: 'y', actorId: ADMIN, at: at(12), fromUnitId: 'unit-1', toUnitId: 'unit-2' },
        ],
        [ev('far', 14), ev('near', 10)],
      );
      expect([matched.get('x')?.id, matched.get('y')?.id]).toEqual(['near', 'far']);
    });
  });

  it('the actor: named while in the organisation (deactivated too), null for nobody, a deleted account or a platform administrator', async () => {
    const { service } = makeService({
      audits: [
        audit({ actorId: ADMIN, metadata: { event: 'deactivated' } }),
        audit({ actorId: null, metadata: { event: 'reactivated' } }),
        audit({ actorId: GONE, metadata: { event: 'mfa_reset' } }),
        audit({ action: 'IMPERSONATE_START', actorId: PLATFORM_ADMIN }),
      ],
    });
    const page = await service.forUser(ORG, ADMIN_VIEW, COLLEAGUE);
    expect(page.rows.map((r) => [r.kind, r.actor])).toEqual([
      ['SIGNED_IN_AS', null],
      ['TWO_STEP_RESET', null],
      ['REACTIVATED', null],
      ['DEACTIVATED', { id: ADMIN, name: 'Ahmad Admin' }],
    ]);
  });

  it('never returns before, after or metadata: no token, email or error text in the response', async () => {
    const { service } = makeService({
      audits: [
        audit({ action: 'CREATE', after: userCopy() }),
        audit({ before: userCopy(), after: userCopy({ name: 'Huda A.' }) }),
        audit({ metadata: { transferPromotionFailed: true, reason: 'SECRET ERROR TEXT' } }),
        audit({ action: 'DELETE', before: userCopy(), metadata: { event: 'invitation_revoked', email: 'huda@example.test' } }),
      ],
    });
    const page = await service.forUser(ORG, ADMIN_VIEW, COLLEAGUE);
    const body = JSON.stringify(page);
    for (const secret of ['SECRET-INVITE-TOKEN', 'SECRET ERROR TEXT', 'huda@example.test', 'tokenVersion']) {
      expect(body).not.toContain(secret);
    }
    for (const row of page.rows) {
      expect(Object.keys(row).every((k) => ['id', 'at', 'kind', 'actor', 'fields', 'role', 'viaHeadship', 'transfer'].includes(k))).toBe(true);
    }
  });

  describe('paging', () => {
    const many = () => Array.from({ length: 60 }, () => audit({ metadata: { event: 'mfa_enabled' } }));

    it('newest first, by skip and take; total counts every row', async () => {
      const rows = many();
      const { service, auditFindMany } = makeService({ audits: rows });
      const page = await service.forUser(ORG, ADMIN_VIEW, COLLEAGUE, { skip: 5, take: 10 });
      expect(page).toMatchObject({ total: 60, skip: 5, take: 10 });
      expect(page.rows.map((r) => r.id)).toEqual(rows.slice(-15, -5).reverse().map((r) => `audit:${r.id}`));
      expect(auditFindMany.mock.calls[0]![0].orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    });

    it(`take defaults to 5 and is held to 1–${ACCESS_HISTORY_MAX_TAKE}; skip is never negative`, async () => {
      const { service } = makeService({ audits: many() });
      expect((await service.forUser(ORG, ADMIN_VIEW, COLLEAGUE)).rows).toHaveLength(5);
      expect((await service.forUser(ORG, ADMIN_VIEW, COLLEAGUE, { take: 500 })).take).toBe(ACCESS_HISTORY_MAX_TAKE);
      expect((await service.forUser(ORG, ADMIN_VIEW, COLLEAGUE, { take: 0 })).take).toBe(1);
      expect((await service.forUser(ORG, ADMIN_VIEW, COLLEAGUE, { skip: -3 })).skip).toBe(0);
    });

    it('no history: an empty page, total 0, and nothing more is read', async () => {
      const { service, calls } = makeService({});
      expect(await service.forUser(ORG, ADMIN_VIEW, COLLEAGUE)).toEqual({ rows: [], total: 0, skip: 0, take: 5 });
      expect(calls.map((c) => c.model)).toEqual(['auditLog', 'auditLog.count']);
    });
  });

  it('at most 8 queries for a page holding every kind of row; only what the page needs is read', async () => {
    const { service, calls, getById, eventFindMany, unitFindMany } = makeService({
      audits: [
        audit({ before: userCopy(), after: userCopy({ primaryOrgUnitId: 'unit-2' }), createdAt: at(40) }),
        audit({ objectType: 'UserRole', objectId: 'role-qm', action: 'CREATE', metadata: { userId: COLLEAGUE, roleId: 'role-qm' } }),
        audit({ metadata: { event: 'mfa_reset' } }),
      ],
      events: [{ id: 'e', organizationId: ORG, userId: COLLEAGUE, sourceOrgUnitId: 'unit-1', destinationOrgUnitId: 'unit-2', destinationPositionId: null, isPromotion: false, promotionAttempted: false, performedBy: ADMIN, createdAt: at(40) }],
    });
    await service.forUser(ORG, ADMIN_VIEW, COLLEAGUE);
    expect(getById).toHaveBeenCalledTimes(1);
    expect(calls.length + getById.mock.calls.length).toBeLessThanOrEqual(8);
    expect(calls.map((c) => c.model)).toEqual(['auditLog', 'auditLog.count', 'user', 'role', 'userTransferEvent', 'orgUnit']);

    const quiet = makeService({ audits: [audit({ metadata: { event: 'mfa_reset' }, actorId: null })] });
    await quiet.service.forUser(ORG, ADMIN_VIEW, COLLEAGUE);
    expect(quiet.calls.map((c) => c.model)).toEqual(['auditLog', 'auditLog.count']);
    expect(eventFindMany).toHaveBeenCalledTimes(1);
    expect(unitFindMany).toHaveBeenCalledTimes(1);
  });
});
