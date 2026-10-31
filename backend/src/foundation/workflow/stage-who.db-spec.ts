/**
 * ACC-271 PR 3 — saving who works a stage, Keep this assignment, and Setup
 * health's starting-assignment condition, against a REAL Postgres (npm run
 * test:db).
 *
 * Only a database proves:
 *
 *   - a save writes the mode and the entries in one transaction, keeps the
 *     starting flag only on an entry that survives, and audits field by field;
 *   - another organisation's person, position, unit, committee or role is
 *     refused, exactly as an invented id is, and nothing is written;
 *   - Keep this assignment clears the flag once; the reconciler, the only
 *     writer, opens one condition per starting stage and closes it on the next
 *     run after Keep.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a
 * database, and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { HttpException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { StageTaskDefinitionService } from './stage-task-definition.service';
import { WorkflowTemplateService } from './workflow-template.service';
import type { TaskService } from '../task/task.service';
import { SetupConditionDetectors } from '../setup-health/setup-condition.detectors';
import { SetupConditionReconciler } from '../setup-health/setup-condition.reconciler';
import { SetupHealthService } from '../setup-health/setup-health.service';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(180_000);

describe('Who works a stage, saved and kept, against a real database (ACC-271 PR 3)', () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const templates = new WorkflowTemplateService(prisma, audit, new StageTaskDefinitionService(prisma, audit, {} as TaskService));
  const reconciler = new SetupConditionReconciler(prisma, new SetupConditionDetectors(prisma));
  const health = new SetupHealthService(prisma);

  /** The refusal's code and body, or undefined when it did not throw. */
  async function refusal(p: Promise<unknown>): Promise<Record<string, unknown> | undefined> {
    try {
      await p;
      return undefined;
    } catch (e) {
      if (e instanceof HttpException) return { status: e.getStatus(), ...(e.getResponse() as Record<string, unknown>) };
      throw e;
    }
  }

  async function committeeRoleCategory(): Promise<string> {
    const existing = await prisma.lookupCategory.findFirst({ where: { key: 'committee_member_role', organizationId: null }, select: { id: true } });
    if (existing) return existing.id;
    return (await prisma.lookupCategory.create({ data: { key: 'committee_member_role', labelEn: 'Committee member role', labelAr: 'دور عضو اللجنة' } })).id;
  }

  /** An organisation with one committee workflow, its stage on a starting assignment, and one of everything an entry names. */
  async function org() {
    const slug = `acc271w-${randomUUID().slice(0, 8)}`;
    const o = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    const admin = await prisma.user.create({ data: { organizationId: o.id, email: `${slug}-admin@example.test`, name: 'Hessa', status: 'ACTIVE' } });
    const person = await prisma.user.create({ data: { organizationId: o.id, email: `${slug}-p@example.test`, name: 'Huda', status: 'ACTIVE' } });
    const unit = await prisma.orgUnit.create({ data: { organizationId: o.id, nameEn: 'Quality', nameAr: 'الجودة', code: slug } });
    const position = await prisma.orgPosition.create({ data: { organizationId: o.id, nameEn: 'Team Leader', nameAr: 'قائد الفريق', grade: 3 } });
    const committee = await prisma.committee.create({
      data: { organizationId: o.id, nameEn: 'Quality Committee', nameAr: 'لجنة الجودة', typeValueId: 'type', orgUnitId: unit.id, quorumCount: 1, meetingFrequency: 'MONTHLY' },
    });
    const role = await prisma.lookupValue.create({
      data: { categoryId: await committeeRoleCategory(), organizationId: o.id, key: `chair-${slug}`, labelEn: 'Chairman', labelAr: 'رئيس اللجنة' },
    });
    const template = await prisma.workflowTemplate.create({
      data: { organizationId: o.id, nameEn: 'Committee Management', nameAr: 'إدارة اللجان', objectType: 'COMMITTEE', isDefault: true, isActive: true },
    });
    const stage = await prisma.workflowStage.create({
      data: { workflowTemplateId: template.id, nameEn: 'Terms Review', nameAr: 'مراجعة الشروط', order: 20, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', whoMode: 'ANY_ONE' },
    });
    await prisma.workflowStageAssignee.create({
      data: { organizationId: o.id, stageId: stage.id, order: 1, kind: 'SPECIFIC_USER', userId: admin.id, isStartingAssignment: true },
    });
    return { id: o.id, slug, admin: admin.id, person: person.id, unit: unit.id, position: position.id, committee: committee.id, role: role.id, template: template.id, stage: stage.id };
  }

  const entries = (stageId: string) =>
    prisma.workflowStageAssignee.findMany({ where: { stageId }, orderBy: { order: 'asc' }, select: { kind: true, userId: true, order: true, isStartingAssignment: true } });

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('a save writes the mode and entries together, keeps the starting flag only on an entry that survives, and audits field by field', async () => {
    const o = await org();

    // The starting entry stays (first), another is added: its flag stays, the new one has none.
    await templates.updateStage(
      o.stage,
      { who: { mode: 'ALL', entries: [{ kind: 'SPECIFIC_USER', userId: o.admin }, { kind: 'POSITION_IN_UNIT', positionId: o.position, orgUnitId: o.unit }] } } as never,
      o.id,
      o.admin,
    );
    expect((await prisma.workflowStage.findUniqueOrThrow({ where: { id: o.stage } })).whoMode).toBe('ALL');
    expect(await entries(o.stage)).toEqual([
      { kind: 'SPECIFIC_USER', userId: o.admin, order: 1, isStartingAssignment: true },
      { kind: 'POSITION_IN_UNIT', userId: null, order: 2, isStartingAssignment: false },
    ]);

    // Moving the starting entry keeps its flag; replacing it clears it.
    await templates.updateStage(
      o.stage,
      { who: { mode: 'ALL', entries: [{ kind: 'POSITION_IN_UNIT', positionId: o.position, orgUnitId: o.unit }, { kind: 'SPECIFIC_USER', userId: o.admin }] } } as never,
      o.id,
      o.admin,
    );
    expect((await entries(o.stage)).map((e) => [e.kind, e.isStartingAssignment])).toEqual([
      ['POSITION_IN_UNIT', false],
      ['SPECIFIC_USER', true],
    ]);
    await templates.updateStage(o.stage, { who: { mode: 'ANY_ONE', entries: [{ kind: 'SPECIFIC_USER', userId: o.person }] } } as never, o.id, o.admin);
    expect(await entries(o.stage)).toEqual([{ kind: 'SPECIFIC_USER', userId: o.person, order: 1, isStartingAssignment: false }]);

    // Field by field: the last save named only who.
    const rows = await prisma.auditLog.findMany({ where: { organizationId: o.id, objectType: 'WorkflowStage', objectId: o.stage }, orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(3);
    expect(rows[2]!.before).toEqual({
      whoMode: 'ALL',
      whoEntries: ['1. whoever holds Team Leader in Quality', '2. Hessa (starting assignment)'],
    });
    expect(rows[2]!.after).toEqual({ whoMode: 'ANY_ONE', whoEntries: ['1. Huda'] });

    // The same who again changes nothing and audits nothing.
    await templates.updateStage(o.stage, { who: { mode: 'ANY_ONE', entries: [{ kind: 'SPECIFIC_USER', userId: o.person }] } } as never, o.id, o.admin);
    expect(await prisma.auditLog.count({ where: { organizationId: o.id, objectType: 'WorkflowStage', objectId: o.stage } })).toBe(3);
  });

  it('the template read names each entry and reads the sentence back, in both languages', async () => {
    const o = await org();
    await templates.updateStage(
      o.stage,
      {
        who: {
          mode: 'ANY_ONE',
          entries: [
            { kind: 'ORG_UNIT_HEAD', orgUnitId: o.unit },
            { kind: 'COMMITTEE', committeeId: o.committee, committeeRoleValueId: o.role },
          ],
        },
      } as never,
      o.id,
      o.admin,
    );
    const stage = (await templates.getTemplateById(o.template, o.id)).stages!.find((s) => s.id === o.stage)!;
    expect(stage.who!.entries.map((e) => [e.kind, e.orgUnit?.nameEn ?? null, e.committee?.nameEn ?? null, e.committeeRole?.labelEn ?? null])).toEqual([
      ['ORG_UNIT_HEAD', 'Quality', null, null],
      ['COMMITTEE', null, 'Quality Committee', 'Chairman'],
    ]);
    expect(stage.whoSentence).toEqual({
      en: 'Any one of: the head of Quality, or the members of Quality Committee in the role Chairman.',
      ar: 'أيٌّ من: من يرأس الجودة، أو أعضاء لجنة الجودة بدور رئيس اللجنة.',
    });
  });

  it.each([
    ['a person', 'userId', (b: Awaited<ReturnType<typeof org>>) => ({ kind: 'SPECIFIC_USER', userId: b.person })],
    ['a position', 'positionId', (b: Awaited<ReturnType<typeof org>>) => ({ kind: 'POSITION_IN_UNIT', positionId: b.position, orgUnitId: null })],
    ['a unit', 'orgUnitId', (b: Awaited<ReturnType<typeof org>>) => ({ kind: 'ORG_UNIT_HEAD', orgUnitId: b.unit })],
    ['a committee', 'committeeId', (b: Awaited<ReturnType<typeof org>>) => ({ kind: 'COMMITTEE', committeeId: b.committee })],
    ['a committee role', 'committeeRoleValueId', (b: Awaited<ReturnType<typeof org>>) => ({ kind: 'COMMITTEE', committeeRoleValueId: b.role })],
  ])('should NOT return records belonging to a different tenant — %s of another organisation is refused like an invented one, and nothing is written', async (_what, field, entryOf) => {
    const a = await org();
    const b = await org();
    let entry = entryOf(b) as Record<string, unknown>;
    // A position needs a unit; give it this organisation's, so only the position is foreign.
    if (field === 'positionId') entry = { ...entry, orgUnitId: a.unit };
    const before = await entries(a.stage);

    const foreign = await refusal(templates.updateStage(a.stage, { who: { mode: 'ANY_ONE', entries: [entry] } } as never, a.id, a.admin));
    const invented = await refusal(
      templates.updateStage(a.stage, { who: { mode: 'ANY_ONE', entries: [{ ...entry, [field]: `nope-${randomUUID()}` }] } } as never, a.id, a.admin),
    );

    expect(foreign).toEqual(expect.objectContaining({ status: 404, code: 'WHO_REFERENCE_NOT_FOUND', field }));
    expect(invented).toEqual(foreign);
    expect(await entries(a.stage)).toEqual(before);
    expect((await prisma.workflowStage.findUniqueOrThrow({ where: { id: a.stage } })).whoMode).toBe('ANY_ONE');
  });

  it('a deactivated person is refused; an invited one may be chosen', async () => {
    const o = await org();
    await prisma.user.update({ where: { id: o.person }, data: { status: 'INACTIVE' } });
    expect(await refusal(templates.updateStage(o.stage, { who: { mode: 'ANY_ONE', entries: [{ kind: 'SPECIFIC_USER', userId: o.person }] } } as never, o.id, o.admin))).toEqual(
      expect.objectContaining({ code: 'WHO_USER_NOT_ACTIVE' }),
    );
    await prisma.user.update({ where: { id: o.person }, data: { status: 'INVITED' } });
    await expect(
      templates.updateStage(o.stage, { who: { mode: 'ANY_ONE', entries: [{ kind: 'SPECIFIC_USER', userId: o.person }] } } as never, o.id, o.admin),
    ).resolves.toBeDefined();
  });

  it('a Committee vote with two entries is refused, writing nothing', async () => {
    const o = await org();
    const body = await refusal(
      templates.updateStage(
        o.stage,
        { who: { mode: 'COMMITTEE_VOTE', entries: [{ kind: 'COMMITTEE', committeeId: o.committee }, { kind: 'CREATOR' }] } } as never,
        o.id,
        o.admin,
      ),
    );
    expect(body).toEqual(expect.objectContaining({ code: 'COMMITTEE_VOTE_NEEDS_ONE_COMMITTEE' }));
    expect((await entries(o.stage)).map((e) => e.isStartingAssignment)).toEqual([true]);
  });

  it('the reconciler opens one condition per starting stage, Keep clears the flag once, and the next run closes it', async () => {
    const o = await org();

    await reconciler.reconcileTenant(o.id, new Date());
    const open = await prisma.setupCondition.findMany({ where: { organizationId: o.id, type: 'STAGE_ON_STARTING_ASSIGNMENT', clearedAt: null } });
    expect(open).toHaveLength(1);
    expect(open[0]).toEqual(
      expect.objectContaining({
        objectId: o.stage,
        severity: 'AT_RISK',
        subject: expect.objectContaining({ nameEn: 'Terms Review', templateId: o.template, templateNameEn: 'Committee Management', adminName: 'Hessa' }),
      }),
    );
    // Reconciled, but not reported until the screens that show it ship (PR 5).
    expect((await health.getHealth(o.id)).open.map((c) => c.type)).not.toContain('STAGE_ON_STARTING_ASSIGNMENT');

    await expect(templates.keepStartingAssignment(o.stage, o.id, o.admin)).resolves.toEqual({ kept: true });
    await expect(templates.keepStartingAssignment(o.stage, o.id, o.admin)).resolves.toEqual({ kept: false });
    expect(await prisma.auditLog.count({ where: { organizationId: o.id, objectId: o.stage, objectType: 'WorkflowStage' } })).toBe(1);
    expect((await entries(o.stage)).map((e) => e.isStartingAssignment)).toEqual([false]);
    // Keep wrote no condition row itself: the reconciler is the only writer.
    expect(await prisma.setupCondition.count({ where: { organizationId: o.id, type: 'STAGE_ON_STARTING_ASSIGNMENT', clearedAt: { not: null } } })).toBe(0);

    await reconciler.reconcileTenant(o.id, new Date());
    expect(await prisma.setupCondition.count({ where: { organizationId: o.id, type: 'STAGE_ON_STARTING_ASSIGNMENT', clearedAt: null } })).toBe(0);
    expect(await prisma.setupCondition.count({ where: { organizationId: o.id, type: 'STAGE_ON_STARTING_ASSIGNMENT', clearedAt: { not: null } } })).toBe(1);
  });

  it("should NOT return records belonging to a different tenant — the detector lists only the organisation's own starting stages", async () => {
    const a = await org();
    const b = await org();
    const found = await new SetupConditionDetectors(prisma).stagesOnStartingAssignment(a.id);
    expect(found.map((c) => c.objectId)).toEqual([a.stage]);
    expect(found.map((c) => c.objectId)).not.toContain(b.stage);
  });

  it("should NOT return records belonging to a different tenant — Keep refuses another organisation's stage and changes nothing", async () => {
    const a = await org();
    const b = await org();
    await expect(templates.keepStartingAssignment(b.stage, a.id, a.admin)).rejects.toThrow('Workflow stage not found');
    expect((await entries(b.stage)).map((e) => e.isStartingAssignment)).toEqual([true]);
  });
});
