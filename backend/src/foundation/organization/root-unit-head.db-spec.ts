/**
 * ACC-288 — the root-head rule against a REAL Postgres (npm run test:db).
 *
 * The unit specs fake every answer. Only a database can prove the lock: a root
 * with one head AND one acting cover may lose either, but not both. Two changes
 * saved at the same moment — ending the cover and deactivating the head's
 * position — would each read the other still in place, both pass, and both
 * commit, leaving the root with nobody. The per-organisation advisory lock
 * (`root-head:<org>`) makes the second wait for the first, and then see it.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a
 * database, and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { OrganizationService } from './organization.service';
import { OrgUnitHeadService } from './org-unit-head.service';
import { OrgPositionService } from '../org-position/org-position.service';
import { UserService } from '../user/user.service';
import { RoleService } from '../roles/role.service';
import { findCurrentHeadHolders, findRunningActingCover } from './unit-headship';
import { ROOT_UNIT_NEEDS_HEAD } from './org-unit-refusals';

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
}
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(120_000);

describe('The root unit keeps a head, against a real database (ACC-288)', () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const organizations = new OrganizationService(prisma, audit);
  // clearActingHead() revokes a cover's role after commit; nothing here holds one.
  const roles = { revokeRoleViaHeadAuthority: async () => undefined } as unknown as RoleService;
  const heads = new OrgUnitHeadService(prisma, audit, {} as UserService, organizations, roles);
  const positions = new OrgPositionService(prisma, audit, organizations);

  const code = (p: Promise<unknown>): Promise<string> =>
    p.then(
      () => 'OK',
      (e: { getResponse?: () => { code?: string } }) => e.getResponse?.()?.code ?? `ERROR ${String(e)}`,
    );

  /** A tenant whose root has one head (on an active head position) and one acting cover in force. */
  async function rootWithHeadAndCover() {
    const slug = `acc288-${randomUUID().slice(0, 8)}`;
    const org = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    const root = await prisma.orgUnit.create({ data: { organizationId: org.id, nameEn: 'Root', code: `R-${slug}` } });
    const position = await prisma.orgPosition.create({
      data: { organizationId: org.id, nameEn: 'Director', grade: 10, isUnitHeadPosition: true, isSingleAssignee: true },
    });
    const head = await prisma.user.create({
      data: { organizationId: org.id, email: `head-${slug}@example.test`, name: 'Head', status: 'ACTIVE', primaryOrgUnitId: root.id, positionId: position.id },
    });
    const acting = await prisma.user.create({
      data: { organizationId: org.id, email: `acting-${slug}@example.test`, name: 'Acting', status: 'ACTIVE' },
    });
    await prisma.orgUnitHeadAssignment.create({
      data: {
        organizationId: org.id,
        orgUnitId: root.id,
        userId: acting.id,
        kind: 'ACTING',
        reason: 'ABSENCE',
        validFrom: new Date(Date.now() - 24 * 60 * 60 * 1000),
        createdById: head.id,
      },
    });
    await prisma.orgUnit.update({ where: { id: root.id }, data: { actingHeadUserId: acting.id } });
    return { organizationId: org.id, rootId: root.id, positionId: position.id, actorId: head.id };
  }

  async function headed(organizationId: string, rootId: string): Promise<boolean> {
    if ((await findCurrentHeadHolders(prisma, organizationId, rootId)).length > 0) return true;
    return (await findRunningActingCover(prisma, organizationId, rootId)) !== null;
  }

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('either change alone passes: the root keeps the other', async () => {
    const a = await rootWithHeadAndCover();
    expect(await code(heads.clearActingHead(a.rootId, a.organizationId, a.actorId))).toBe('OK');
    expect(await headed(a.organizationId, a.rootId)).toBe(true);

    const b = await rootWithHeadAndCover();
    expect(await code(positions.deactivatePosition(b.positionId, b.organizationId, b.actorId))).toBe('OK');
    expect(await headed(b.organizationId, b.rootId)).toBe(true);
  });

  it('two changes at the same moment: exactly one is refused, and the root stays headed', async () => {
    const t = await rootWithHeadAndCover();

    const results = await Promise.all([
      code(heads.clearActingHead(t.rootId, t.organizationId, t.actorId)),
      code(positions.deactivatePosition(t.positionId, t.organizationId, t.actorId)),
    ]);

    expect(results.filter((r) => r === 'OK')).toHaveLength(1);
    expect(results.filter((r) => r === ROOT_UNIT_NEEDS_HEAD)).toHaveLength(1);
    expect(await headed(t.organizationId, t.rootId)).toBe(true);
  });

  it('a refused change leaves nothing written: the cover is still open and no ACTING_ENDED event exists', async () => {
    const t = await rootWithHeadAndCover();
    expect(await code(positions.deactivatePosition(t.positionId, t.organizationId, t.actorId))).toBe('OK');

    expect(await code(heads.clearActingHead(t.rootId, t.organizationId, t.actorId))).toBe(ROOT_UNIT_NEEDS_HEAD);

    const open = await prisma.orgUnitHeadAssignment.count({ where: { organizationId: t.organizationId, orgUnitId: t.rootId, endedAt: null } });
    const ended = await prisma.orgUnitHeadEvent.count({ where: { organizationId: t.organizationId, orgUnitId: t.rootId, action: 'ACTING_ENDED' } });
    const unit = await prisma.orgUnit.findFirst({ where: { id: t.rootId, organizationId: t.organizationId }, select: { actingHeadUserId: true } });
    expect(open).toBe(1);
    expect(ended).toBe(0);
    expect(unit?.actingHeadUserId).not.toBeNull();
  });
});
