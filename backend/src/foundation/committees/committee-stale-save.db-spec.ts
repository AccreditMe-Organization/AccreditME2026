/**
 * ACC-238 — the committee Edit dialog's stale save, against a REAL Postgres
 * (npm run test:db).
 *
 * The unit spec fakes the row and its `updatedAt`. Only a database proves:
 *
 *   1. the timestamp the dialog loaded round-trips exactly (Postgres keeps
 *      milliseconds, JSON carries them), so an unchanged committee saves;
 *   2. a second save sent with the SAME loaded `updatedAt` is refused with
 *      409 COMMITTEE_CHANGED, and nothing of it is written;
 *   3. two saves pressed at the same moment queue on the committee's row lock:
 *      exactly one commits, and the other reads the first's `updatedAt` and is
 *      refused — without the lock, both read the old row and both commit.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a
 * database, and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { WorkflowService } from '../workflow/workflow.service';
import { StageRulesService } from '../workflow/stage-rules.service';
import { CommitteesService } from './committees.service';

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
}
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(120_000);

describe('Committee stale save against a real database (ACC-238)', () => {
  const prisma = new PrismaService();
  const workflow = { startInstance: async () => undefined } as unknown as WorkflowService;
  const committees = new CommitteesService(prisma, new AuditLogService(prisma), workflow, new StageRulesService(prisma));

  async function committee(): Promise<{ organizationId: string; actorId: string; id: string; loaded: string }> {
    const slug = `acc238-${randomUUID().slice(0, 8)}`;
    const o = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    const actor = await prisma.user.create({ data: { organizationId: o.id, email: `${slug}@example.test`, name: 'Committee editor' } });
    const unit = await prisma.orgUnit.create({ data: { organizationId: o.id, nameEn: 'Root', code: `R-${slug}` } });
    const c = await prisma.committee.create({
      data: { organizationId: o.id, nameEn: 'Quality Council', typeValueId: 'type', orgUnitId: unit.id, quorumCount: 5 },
    });
    // What the dialog holds: the record page's read, serialised as JSON is.
    const read = await committees.getCommitteeDetail(c.id, o.id);
    return { organizationId: o.id, actorId: actor.id, id: c.id, loaded: JSON.parse(JSON.stringify(read)).updatedAt as string };
  }

  const outcome = (p: Promise<unknown>): Promise<string> =>
    p.then(
      () => 'OK',
      (e: { getResponse?: () => { code?: string } }) => e.getResponse?.()?.code ?? `ERROR ${String(e)}`,
    );

  const save = (c: Awaited<ReturnType<typeof committee>>, dto: Record<string, unknown>, organizationId = c.organizationId) =>
    outcome(committees.updateCommittee(c.id, { ...dto, expectedUpdatedAt: c.loaded } as never, organizationId, c.actorId));

  const audits = (objectId: string) => prisma.auditLog.count({ where: { objectId, action: 'UPDATE' } });

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('an unchanged committee saves: the loaded updatedAt round-trips to the millisecond', async () => {
    const c = await committee();

    expect(await save(c, { nameEn: 'Quality and Safety Council' })).toBe('OK');

    const row = await prisma.committee.findFirstOrThrow({ where: { id: c.id } });
    expect(row.nameEn).toBe('Quality and Safety Council');
  });

  it('two saves from the same loaded dialog: the second gets 409 COMMITTEE_CHANGED and nothing of it is written', async () => {
    const c = await committee();

    expect(await save(c, { quorumCount: 6 })).toBe('OK');
    const afterFirst = await prisma.committee.findFirstOrThrow({ where: { id: c.id } });

    expect(await save(c, { quorumCount: 7, nameEn: 'Overwritten' })).toBe('COMMITTEE_CHANGED');

    const row = await prisma.committee.findFirstOrThrow({ where: { id: c.id } });
    expect(row.quorumCount).toBe(6);
    expect(row.nameEn).toBe('Quality Council');
    expect(row.updatedAt.getTime()).toBe(afterFirst.updatedAt.getTime());
    expect(await audits(c.id)).toBe(1);
  });

  it('two saves pressed at the same moment: exactly one commits and the other is refused — ten times over', async () => {
    for (let round = 0; round < 10; round++) {
      const c = await committee();

      const outcomes = await Promise.all([save(c, { quorumCount: 8 }), save(c, { quorumCount: 9 })]);

      expect([...outcomes].sort()).toEqual(['COMMITTEE_CHANGED', 'OK']);
      const row = await prisma.committee.findFirstOrThrow({ where: { id: c.id } });
      expect(row.quorumCount).toBe(outcomes[0] === 'OK' ? 8 : 9);
      expect(await audits(c.id)).toBe(1);
    }
  });

  it("another organisation's committee is the same 404 as a missing one, and nothing is written", async () => {
    const c = await committee();
    const other = await committee();

    const sent = await outcome(
      committees.updateCommittee(c.id, { quorumCount: 1, expectedUpdatedAt: c.loaded } as never, other.organizationId, other.actorId),
    );

    expect(sent).toMatch(/Committee not found/);
    expect((await prisma.committee.findFirstOrThrow({ where: { id: c.id } })).quorumCount).toBe(5);
  });
});
