/**
 * ACC-57 — a template's starting and final stages, against a REAL Postgres
 * (npm run test:db). Plan: backend/Plans/step-57-191-202-workflow-checks.md.
 *
 * Only a database proves:
 *
 *   - every path that can change a template's start or end (addStage,
 *     updateStage, removeStage, setDefault) is refused with the code that names
 *     the stage, and a refused save writes nothing — the move of the starting
 *     stage included, since it is rolled back with the save;
 *   - ticking Initial MOVES the starting stage (Q1), audited on both stages;
 *   - a template already in breach can still be renamed and mended, and only a
 *     save that makes it worse is refused;
 *   - two saves that each tick Initial on a different stage at once both go
 *     through, one after the other, ending with ONE starting stage: the
 *     template lock serialises them.
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

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(180_000);

describe("A template's starting and final stages, against a real database (ACC-57)", () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const templates = new WorkflowTemplateService(prisma, audit, new StageTaskDefinitionService(prisma, audit, {} as TaskService));

  /** The refusal's status, code and body, or undefined when it did not throw. */
  async function refusal(p: Promise<unknown>): Promise<Record<string, unknown> | undefined> {
    try {
      await p;
      return undefined;
    } catch (e) {
      if (e instanceof HttpException) return { status: e.getStatus(), ...(e.getResponse() as Record<string, unknown>) };
      throw e;
    }
  }

  /** An organisation with one committee workflow: Formation (starting), Terms Review, Dissolved (final). */
  async function org(options: { stages?: boolean } = {}) {
    const slug = `acc57-${randomUUID().slice(0, 8)}`;
    const o = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    const admin = await prisma.user.create({ data: { organizationId: o.id, email: `${slug}-admin@example.test`, name: 'Hessa', status: 'ACTIVE' } });
    const template = await prisma.workflowTemplate.create({
      data: { organizationId: o.id, nameEn: 'Committee Management', nameAr: 'إدارة اللجان', objectType: 'COMMITTEE', isDefault: false, isActive: true },
    });
    const stage = (nameEn: string, nameAr: string, order: number, flags: { isInitial?: boolean; isFinal?: boolean } = {}) =>
      prisma.workflowStage.create({
        data: { workflowTemplateId: template.id, nameEn, nameAr, order, whoMode: 'ANY_ONE', isInitial: false, isFinal: false, ...flags },
      });
    if (options.stages === false) return { id: o.id, admin: admin.id, template: template.id, a: '', b: '', c: '' };
    const a = await stage('Formation', 'التكوين', 10, { isInitial: true });
    const b = await stage('Terms Review', 'مراجعة الشروط', 20);
    const c = await stage('Dissolved', 'منحلة', 30, { isFinal: true });
    return { id: o.id, admin: admin.id, template: template.id, a: a.id, b: b.id, c: c.id };
  }

  const who = (userId: string) => ({ mode: 'ANY_ONE', entries: [{ kind: 'SPECIFIC_USER', userId }] });
  const flagsOf = async (templateId: string) =>
    Object.fromEntries(
      (await prisma.workflowStage.findMany({ where: { workflowTemplateId: templateId }, select: { nameEn: true, isInitial: true, isFinal: true } })).map((s) => [
        s.nameEn,
        `${s.isInitial ? 'I' : '-'}${s.isFinal ? 'F' : '-'}`,
      ]),
    );

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  describe('updateStage', () => {
    it('refuses unticking the only starting stage (STAGE_INITIAL_REQUIRED, naming it), writing nothing', async () => {
      const o = await org();
      const r = await refusal(templates.updateStage(o.a, { isInitial: false } as never, o.id, o.admin));
      expect(r).toMatchObject({ status: 409, code: 'STAGE_INITIAL_REQUIRED', stageIds: [o.a], stageNames: [{ nameEn: 'Formation', nameAr: 'التكوين' }] });
      expect(await flagsOf(o.template)).toEqual({ Formation: 'I-', 'Terms Review': '--', Dissolved: '-F' });
    });

    it('refuses making one stage both starting and final (STAGE_INITIAL_AND_FINAL), from either side', async () => {
      const o = await org();
      expect(await refusal(templates.updateStage(o.a, { isFinal: true } as never, o.id, o.admin))).toMatchObject({
        status: 400,
        code: 'STAGE_INITIAL_AND_FINAL',
        stageIds: [o.a],
      });
      // Ticking Initial on the final stage would move the start there AND make it both: the whole save rolls back, the move included.
      expect(await refusal(templates.updateStage(o.c, { isInitial: true } as never, o.id, o.admin))).toMatchObject({
        code: 'STAGE_INITIAL_AND_FINAL',
        stageIds: [o.c],
      });
      expect(await flagsOf(o.template)).toEqual({ Formation: 'I-', 'Terms Review': '--', Dissolved: '-F' });
    });

    it('moves the starting stage when Initial is ticked on another (Q1), saying where from, and audits both stages', async () => {
      const o = await org();
      const saved = await templates.updateStage(o.b, { isInitial: true } as never, o.id, o.admin);

      expect(saved.startingStageMovedFrom).toEqual([{ id: o.a, nameEn: 'Formation', nameAr: 'التكوين' }]);
      expect(await flagsOf(o.template)).toEqual({ Formation: '--', 'Terms Review': 'I-', Dissolved: '-F' });
      const rows = await prisma.auditLog.findMany({ where: { organizationId: o.id, objectType: 'WorkflowStage' }, select: { objectId: true, before: true, after: true } });
      expect(rows).toEqual(
        expect.arrayContaining([
          { objectId: o.a, before: { isInitial: true }, after: { isInitial: false } },
          expect.objectContaining({ objectId: o.b, before: expect.objectContaining({ isInitial: false }), after: expect.objectContaining({ isInitial: true }) }),
        ]),
      );
    });

    it('a save that leaves Initial and Final alone is not checked at all: a rename passes', async () => {
      const o = await org();
      await templates.updateStage(o.b, { nameEn: 'Terms Check', isInitial: false, isFinal: false } as never, o.id, o.admin);
      expect(await flagsOf(o.template)).toEqual({ Formation: 'I-', 'Terms Check': '--', Dissolved: '-F' });
    });
  });

  describe('addStage', () => {
    it('refuses a first stage that is not the starting stage, and accepts one that is', async () => {
      const o = await org({ stages: false });
      const add = (isInitial: boolean) =>
        templates.addStage(o.template, { nameEn: 'Formation', nameAr: 'التكوين', order: 10, isInitial, who: who(o.admin) } as never, o.id, o.admin);

      expect(await refusal(add(false))).toMatchObject({ status: 409, code: 'STAGE_INITIAL_REQUIRED' });
      expect(await prisma.workflowStage.count({ where: { workflowTemplateId: o.template } })).toBe(0);
      await add(true);
      expect(await flagsOf(o.template)).toEqual({ Formation: 'I-' });
    });

    it('a new starting stage takes over from the old one; a new stage both starting and final is refused', async () => {
      const o = await org();
      const saved = await templates.addStage(
        o.template,
        { nameEn: 'Intake', nameAr: 'الاستلام', order: 5, isInitial: true, who: who(o.admin) } as never,
        o.id,
        o.admin,
      );
      expect(saved.startingStageMovedFrom).toEqual([{ id: o.a, nameEn: 'Formation', nameAr: 'التكوين' }]);
      expect(await flagsOf(o.template)).toEqual({ Intake: 'I-', Formation: '--', 'Terms Review': '--', Dissolved: '-F' });

      expect(
        await refusal(
          templates.addStage(o.template, { nameEn: 'Both', nameAr: 'كلاهما', order: 50, isInitial: true, isFinal: true, who: who(o.admin) } as never, o.id, o.admin),
        ),
      ).toMatchObject({ code: 'STAGE_INITIAL_AND_FINAL' });
      // Rolled back whole: no new stage, and Intake is still the starting stage.
      expect(await flagsOf(o.template)).toEqual({ Intake: 'I-', Formation: '--', 'Terms Review': '--', Dissolved: '-F' });
    });
  });

  describe('removeStage', () => {
    it('refuses the starting stage while others remain (STAGE_INITIAL_REQUIRED), and removes another', async () => {
      const o = await org();
      expect(await refusal(templates.removeStage(o.a, o.id, o.admin))).toMatchObject({
        status: 409,
        code: 'STAGE_INITIAL_REQUIRED',
        stageIds: [o.a],
      });
      await templates.removeStage(o.b, o.id, o.admin);
      expect(await flagsOf(o.template)).toEqual({ Formation: 'I-', Dissolved: '-F' });
    });
  });

  describe('setDefault (Q2)', () => {
    it('refuses a template with no starting stage, or no stages, and accepts one with', async () => {
      const empty = await org({ stages: false });
      expect(await refusal(templates.setDefault(empty.template, empty.id, empty.admin))).toMatchObject({ status: 409, code: 'STAGE_INITIAL_REQUIRED' });
      expect(await refusal(templates.updateTemplate(empty.template, { isDefault: true } as never, empty.id, empty.admin))).toMatchObject({
        code: 'STAGE_INITIAL_REQUIRED',
      });
      expect((await prisma.workflowTemplate.findUniqueOrThrow({ where: { id: empty.template } })).isDefault).toBe(false);

      const built = await org();
      await templates.setDefault(built.template, built.id, built.admin);
      expect((await prisma.workflowTemplate.findUniqueOrThrow({ where: { id: built.template } })).isDefault).toBe(true);
    });
  });

  // ACC-120's root-role shape: a template put in breach some other way (a
  // script, a restore) is not locked: only a save that makes it worse is refused.
  describe('a template already in breach', () => {
    it('two starting stages: a rename passes, a save that adds a problem is refused, unticking one mends it', async () => {
      const o = await org();
      await prisma.workflowStage.update({ where: { id: o.b }, data: { isInitial: true } });

      await templates.updateStage(o.b, { nameEn: 'Terms Check' } as never, o.id, o.admin);
      // Final on a starting stage adds a stage both starting and final: worse.
      expect(await refusal(templates.updateStage(o.b, { isFinal: true } as never, o.id, o.admin))).toMatchObject({
        code: 'STAGE_INITIAL_AND_FINAL',
        stageIds: [o.b],
      });
      await templates.updateStage(o.b, { isInitial: false } as never, o.id, o.admin);
      expect(await flagsOf(o.template)).toEqual({ Formation: 'I-', 'Terms Check': '--', Dissolved: '-F' });
    });

    it('no starting stage: a rename passes, unticking Final passes, ticking Initial mends it', async () => {
      const o = await org();
      await prisma.workflowStage.update({ where: { id: o.a }, data: { isInitial: false } });

      await templates.updateStage(o.c, { isFinal: false } as never, o.id, o.admin);
      await templates.updateStage(o.c, { isFinal: true } as never, o.id, o.admin);
      await templates.updateStage(o.a, { isInitial: true } as never, o.id, o.admin);
      expect(await flagsOf(o.template)).toEqual({ Formation: 'I-', 'Terms Review': '--', Dissolved: '-F' });
    });
  });

  it('a protected template still refuses a changed Initial before anything is read (WORKFLOW_TEMPLATE_PROTECTED)', async () => {
    const o = await org();
    await prisma.workflowTemplate.update({ where: { id: o.template }, data: { objectType: 'COMMITTEE_CHANGE_REQUEST' } });
    expect(await refusal(templates.updateStage(o.b, { isInitial: true } as never, o.id, o.admin))).toMatchObject({ code: 'WORKFLOW_TEMPLATE_PROTECTED' });
  });

  // Q1 under concurrency: each save reads the template under its lock, so the
  // second sees the first's move and moves the start again. Without the lock
  // both read Formation as the start, and the second finds two and is refused.
  it('two saves ticking Initial on different stages at once both go through, ending with one starting stage', async () => {
    for (let run = 0; run < 10; run++) {
      const o = await org();
      const results = await Promise.allSettled([
        templates.updateStage(o.b, { isInitial: true } as never, o.id, o.admin),
        templates.updateStage(o.c, { isInitial: true, isFinal: false } as never, o.id, o.admin),
      ]);
      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
      expect((await prisma.workflowStage.findMany({ where: { workflowTemplateId: o.template, isInitial: true } })).length).toBe(1);
    }
  });
});
