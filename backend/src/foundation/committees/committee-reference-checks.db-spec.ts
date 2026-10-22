/**
 * ACC-233 — the committee reference checks against a REAL Postgres
 * (npm run test:db).
 *
 * The unit spec fakes every database answer. Only a database can prove the
 * three things this file is for:
 *
 *   1. the recursive walk finds a loop through real rows, along each chain
 *      separately, and ends on a loop already in the data;
 *   2. the organisation's hierarchy lock stops two edits saved at the same
 *      moment from closing a loop between them — without it, each reads a tree
 *      that does not yet contain the other's edit, both pass, and both commit;
 *   3. "dissolving" is read from the stage KEY, whatever the stage is called.
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

describe('Committee reference checks against a real database (ACC-233)', () => {
  const prisma = new PrismaService();
  // A new committee's workflow instance is not what these tests are about; the
  // instances the dissolving test needs are written directly below.
  const workflow = { startInstance: async () => undefined } as unknown as WorkflowService;
  const committees = new CommitteesService(prisma, new AuditLogService(prisma), workflow, new StageRulesService(prisma));

  interface Org {
    organizationId: string;
    actorId: string;
    unitId: string;
    make: (name: string, links?: { parentCommitteeId?: string; reportingToCommitteeId?: string }) => Promise<string>;
  }

  async function org(): Promise<Org> {
    const slug = `acc233-${randomUUID().slice(0, 8)}`;
    const o = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    const actor = await prisma.user.create({ data: { organizationId: o.id, email: `${slug}@example.test`, name: 'Committee editor' } });
    const unit = await prisma.orgUnit.create({ data: { organizationId: o.id, nameEn: 'Root', code: `R-${slug}` } });
    const make = async (name: string, links: { parentCommitteeId?: string; reportingToCommitteeId?: string } = {}) =>
      (
        await prisma.committee.create({
          data: { organizationId: o.id, nameEn: name, typeValueId: 'type', orgUnitId: unit.id, ...links },
        })
      ).id;
    return { organizationId: o.id, actorId: actor.id, unitId: unit.id, make };
  }

  const code = (p: Promise<unknown>): Promise<string> =>
    p.then(
      () => 'OK',
      (e: { getResponse?: () => { code?: string } }) => e.getResponse?.()?.code ?? `ERROR ${String(e)}`,
    );

  const update = (o: Org, id: string, dto: Record<string, unknown>) =>
    code(committees.updateCommittee(id, dto as never, o.organizationId, o.actorId));

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  describe('the loop walk, on real rows', () => {
    it('refuses a parent that is one of the committee\'s own descendants, at any depth', async () => {
      const o = await org();
      const a = await o.make('A');
      const b = await o.make('B', { parentCommitteeId: a });
      const c = await o.make('C', { parentCommitteeId: b });

      expect(await update(o, a, { parentCommitteeId: b })).toBe('COMMITTEE_PARENT_LOOP');
      expect(await update(o, a, { parentCommitteeId: c })).toBe('COMMITTEE_PARENT_LOOP');
      expect(await update(o, a, { parentCommitteeId: a })).toBe('COMMITTEE_OWN_PARENT');
      const d = await o.make('D');
      expect(await update(o, a, { parentCommitteeId: d })).toBe('OK');
    });

    it('walks the reports-to chain separately from the parent chain', async () => {
      const o = await org();
      const a = await o.make('A');
      const b = await o.make('B', { reportingToCommitteeId: a });

      // B reports to A, so A may not report to B…
      expect(await update(o, a, { reportingToCommitteeId: b })).toBe('COMMITTEE_REPORTS_TO_LOOP');
      // …but A may still sit under B: the parent chain has no loop.
      expect(await update(o, a, { parentCommitteeId: b })).toBe('OK');
    });

    it('a loop already in the data ends the walk instead of hanging the request', async () => {
      const o = await org();
      const x = await o.make('X');
      const y = await o.make('Y', { parentCommitteeId: x });
      await prisma.committee.update({ where: { id: x }, data: { parentCommitteeId: y } }); // bad data, written directly
      const z = await o.make('Z');

      expect(await update(o, z, { parentCommitteeId: x })).toBe('OK');
    });
  });

  describe('two edits saved at the same moment', () => {
    it('A under B and B under A, together: exactly one commits and the tree has no loop — ten times over', async () => {
      for (let round = 0; round < 10; round++) {
        const o = await org();
        const a = await o.make(`A${round}`);
        const b = await o.make(`B${round}`);

        const outcomes = await Promise.all([update(o, a, { parentCommitteeId: b }), update(o, b, { parentCommitteeId: a })]);

        expect(outcomes.sort()).toEqual(['COMMITTEE_PARENT_LOOP', 'OK']);
        const rows = await prisma.committee.findMany({ where: { id: { in: [a, b] } }, select: { id: true, parentCommitteeId: true } });
        const loop = rows.every((r) => r.parentCommitteeId !== null);
        expect(loop).toBe(false);
      }
    });

    it('the same holds along the reports-to chain', async () => {
      const o = await org();
      const a = await o.make('A');
      const b = await o.make('B');

      const outcomes = await Promise.all([update(o, a, { reportingToCommitteeId: b }), update(o, b, { reportingToCommitteeId: a })]);

      expect(outcomes.sort()).toEqual(['COMMITTEE_REPORTS_TO_LOOP', 'OK']);
    });
  });

  describe('dissolving is read from the stage KEY', () => {
    async function inStage(o: Org, committeeId: string, stage: { nameEn: string; key: string | null; order: number }) {
      const template = await prisma.workflowTemplate.create({
        data: { organizationId: o.organizationId, nameEn: `Lifecycle ${committeeId}`, objectType: 'COMMITTEE' },
      });
      const s = await prisma.workflowStage.create({
        data: { workflowTemplateId: template.id, nameEn: stage.nameEn, order: stage.order, key: stage.key },
      });
      await prisma.workflowInstance.create({
        data: { organizationId: o.organizationId, workflowTemplateId: template.id, objectType: 'COMMITTEE', objectId: committeeId, currentStageId: s.id },
      });
    }

    it('a parent in a stage keyed dissolution_pending is refused even when the tenant has renamed it', async () => {
      const o = await org();
      const target = await o.make('Winding up');
      await inStage(o, target, { nameEn: 'Winding up', key: 'dissolution_pending', order: 50 });
      const self = await o.make('Self');

      expect(await update(o, self, { parentCommitteeId: target })).toBe('COMMITTEE_PARENT_DISSOLVING');
      expect(await code(committees.createCommittee({ nameEn: 'New', typeValueId: 't', reportingToCommitteeId: target } as never, o.organizationId, o.actorId))).toBe(
        'COMMITTEE_REPORTS_TO_DISSOLVING',
      );
    });

    it('a stage NAMED "Dissolved" with no key is not dissolving — the name is never read', async () => {
      const o = await org();
      const target = await o.make('Target');
      await inStage(o, target, { nameEn: 'Dissolved', key: null, order: 60 });
      const self = await o.make('Self');

      expect(await update(o, self, { parentCommitteeId: target })).toBe('OK');
    });

    it('a parent in a stage keyed dissolved is refused', async () => {
      const o = await org();
      const target = await o.make('Target');
      await inStage(o, target, { nameEn: 'Closed', key: 'dissolved', order: 60 });
      const self = await o.make('Self');

      expect(await update(o, self, { parentCommitteeId: target })).toBe('COMMITTEE_PARENT_DISSOLVING');
    });
  });

  describe('another organisation and the owning unit', () => {
    it('another organisation\'s committee or unit gets exactly the refusal an invented id does', async () => {
      const mine = await org();
      const theirs = await org();
      const self = await mine.make('Self');
      const foreign = await theirs.make('Foreign');

      expect(await update(mine, self, { parentCommitteeId: foreign })).toBe('COMMITTEE_PARENT_NOT_FOUND');
      expect(await update(mine, self, { parentCommitteeId: 'invented-id' })).toBe('COMMITTEE_PARENT_NOT_FOUND');
      expect(await update(mine, self, { reportingToCommitteeId: foreign })).toBe('COMMITTEE_REPORTS_TO_NOT_FOUND');
      expect(await update(mine, self, { orgUnitId: theirs.unitId })).toBe('COMMITTEE_UNIT_NOT_FOUND');
      expect(await update(mine, self, { orgUnitId: 'invented-id' })).toBe('COMMITTEE_UNIT_NOT_FOUND');
    });

    it('an inactive unit is refused, and an empty one is "choose the unit" — never a database error', async () => {
      const o = await org();
      const self = await o.make('Self');
      const closed = await prisma.orgUnit.create({ data: { organizationId: o.organizationId, nameEn: 'Closed', code: `C-${self}`, isActive: false } });

      expect(await update(o, self, { orgUnitId: closed.id })).toBe('COMMITTEE_UNIT_NOT_FOUND');
      expect(await update(o, self, { orgUnitId: '' })).toBe('COMMITTEE_UNIT_REQUIRED');
      expect(await update(o, self, { orgUnitId: null })).toBe('COMMITTEE_UNIT_REQUIRED');
      const row = await prisma.committee.findFirst({ where: { id: self }, select: { orgUnitId: true } });
      expect(row?.orgUnitId).toBe(o.unitId);
    });
  });
});
