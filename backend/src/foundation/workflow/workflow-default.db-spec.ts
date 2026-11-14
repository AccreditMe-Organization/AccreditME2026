/**
 * ACC-303 — exactly one default template per record type, per organisation,
 * against a REAL Postgres (npm run test:db).
 *
 * Only a database proves:
 *
 *   - Set as default and an update to the default clear the old default in the
 *     same transaction, and touch no other organisation's default and no other
 *     type's;
 *   - every refusal (create as default, the default's type change, giving up
 *     the default, deactivating it, a deactivated template as the default)
 *     writes nothing;
 *   - concurrent promotions of DIFFERENT templates of one type all succeed and
 *     end with exactly one default. Each promotion locks only its own row, so
 *     only the per-type lock (workflow-default.ts) queues them: without it they
 *     end with two defaults, or deadlock.
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
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import type { TaskService } from '../task/task.service';
import type { WorkflowObjectType } from '../../../generated/prisma/client';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(180_000);

describe('One default template per record type, against a real database (ACC-303)', () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const templates = new WorkflowTemplateService(prisma, audit, new StageTaskDefinitionService(prisma, audit, {} as TaskService));

  /** The refusal's status and code, or undefined when it did not throw. */
  async function refusal(p: Promise<unknown>): Promise<Record<string, unknown> | undefined> {
    try {
      await p;
      return undefined;
    } catch (e) {
      if (e instanceof HttpException) {
        const body = e.getResponse() as Record<string, unknown>;
        return { status: e.getStatus(), code: body['code'] };
      }
      throw e;
    }
  }

  /**
   * An organisation whose DOCUMENT type has a default with a starting stage,
   * `candidates` other templates with one too, an empty template and a
   * deactivated one; and an INCIDENT default (another type).
   */
  async function org(candidates = 2) {
    const slug = `acc303-${randomUUID().slice(0, 8)}`;
    const o = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    const admin = await prisma.user.create({ data: { organizationId: o.id, email: `${slug}-admin@example.test`, name: 'Admin', status: 'ACTIVE' } });
    const template = async (nameEn: string, objectType: WorkflowObjectType, opts: { isDefault?: boolean; isActive?: boolean; stage?: boolean } = {}) => {
      const t = await prisma.workflowTemplate.create({
        data: { organizationId: o.id, nameEn, objectType, isDefault: opts.isDefault ?? false, isActive: opts.isActive ?? true },
      });
      if (opts.stage !== false) {
        await prisma.workflowStage.create({ data: { workflowTemplateId: t.id, nameEn: 'Start', order: 1, isInitial: true, whoMode: 'ANY_ONE' } });
      }
      return t.id;
    };
    const current = await template('Current default', 'DOCUMENT', { isDefault: true });
    const others: string[] = [];
    for (let i = 0; i < candidates; i++) others.push(await template(`Candidate ${i + 1}`, 'DOCUMENT'));
    const empty = await template('Empty', 'DOCUMENT', { stage: false });
    const inactive = await template('Switched off', 'DOCUMENT', { isActive: false });
    const incident = await template('Incident default', 'INCIDENT', { isDefault: true });
    return { id: o.id, admin: admin.id, current, others, empty, inactive, incident };
  }

  /** The ids of the organisation's default templates of one type. */
  const defaultsOf = async (organizationId: string, objectType: WorkflowObjectType) =>
    (await prisma.workflowTemplate.findMany({ where: { organizationId, objectType, isDefault: true }, select: { id: true } })).map((t) => t.id);
  const snapshot = async (organizationId: string) =>
    prisma.workflowTemplate.findMany({
      where: { organizationId },
      select: { id: true, nameEn: true, objectType: true, isDefault: true, isActive: true },
      orderBy: { id: 'asc' },
    });
  const audits = (organizationId: string) => prisma.auditLog.count({ where: { organizationId, objectType: 'WorkflowTemplate' } });

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  describe('exactly one default per record type, per organisation', () => {
    it('Set as default makes it the one default of its type, clearing the old one', async () => {
      const o = await org();
      await templates.setDefault(o.others[0]!, o.id, o.admin);
      expect(await defaultsOf(o.id, 'DOCUMENT')).toEqual([o.others[0]]);
      expect(await defaultsOf(o.id, 'INCIDENT')).toEqual([o.incident]);
    });

    it('an update to the default clears the old default too', async () => {
      const o = await org();
      const updated = await templates.updateTemplate(o.others[0]!, { isDefault: true } as never, o.id, o.admin);
      expect(updated.isDefault).toBe(true);
      expect(await defaultsOf(o.id, 'DOCUMENT')).toEqual([o.others[0]]);
      expect(await defaultsOf(o.id, 'INCIDENT')).toEqual([o.incident]);
    });

    it('a template created without isDefault leaves the type with its one default', async () => {
      const o = await org();
      const created = await templates.createTemplate({ nameEn: 'New', nameAr: '', objectType: 'DOCUMENT' } as never, o.id, o.admin);
      expect(created.isDefault).toBe(false);
      expect(await defaultsOf(o.id, 'DOCUMENT')).toEqual([o.current]);
    });

    itEnforcesTenantIsolation("another organisation's default of the same type is never cleared", async () => {
      const a = await org();
      const b = await org();
      await templates.setDefault(a.others[0]!, a.id, a.admin);
      await templates.updateTemplate(a.others[1]!, { isDefault: true } as never, a.id, a.admin);
      expect(await defaultsOf(a.id, 'DOCUMENT')).toEqual([a.others[1]]);
      expect(await defaultsOf(b.id, 'DOCUMENT')).toEqual([b.current]);
      expect(await defaultsOf(b.id, 'INCIDENT')).toEqual([b.incident]);
    });
  });

  describe('each refusal writes nothing', () => {
    it.each([
      ['create as the default', 'DEFAULT_NEEDS_STAGES', (o: Awaited<ReturnType<typeof org>>) =>
        templates.createTemplate({ nameEn: 'New', nameAr: '', objectType: 'DOCUMENT', isDefault: true } as never, o.id, o.admin)],
      ["change the default's type", 'DEFAULT_TEMPLATE_TYPE_CHANGE', (o: Awaited<ReturnType<typeof org>>) =>
        templates.updateTemplate(o.current, { objectType: 'INCIDENT' } as never, o.id, o.admin)],
      ['give up the default', 'DEFAULT_TEMPLATE_REQUIRED', (o: Awaited<ReturnType<typeof org>>) =>
        templates.updateTemplate(o.current, { isDefault: false } as never, o.id, o.admin)],
      ['deactivate the default', 'DEFAULT_TEMPLATE_REQUIRED', (o: Awaited<ReturnType<typeof org>>) =>
        templates.deactivateTemplate(o.current, o.id, o.admin)],
      ['set a deactivated template as the default', 'DEFAULT_TEMPLATE_INACTIVE', (o: Awaited<ReturnType<typeof org>>) =>
        templates.setDefault(o.inactive, o.id, o.admin)],
      ['update a deactivated template to the default', 'DEFAULT_TEMPLATE_INACTIVE', (o: Awaited<ReturnType<typeof org>>) =>
        templates.updateTemplate(o.inactive, { isDefault: true } as never, o.id, o.admin)],
      ['set an empty template as the default (ACC-57)', 'STAGE_INITIAL_REQUIRED', (o: Awaited<ReturnType<typeof org>>) =>
        templates.setDefault(o.empty, o.id, o.admin)],
    ])('%s: 409 %s', async (_what, code, act) => {
      const o = await org();
      const before = await snapshot(o.id);
      const auditsBefore = await audits(o.id);
      expect(await refusal(act(o))).toEqual({ status: 409, code });
      expect(await snapshot(o.id)).toEqual(before);
      expect(await audits(o.id)).toBe(auditsBefore);
    });

    it('a type change and a rename of a template that is not the default still go through', async () => {
      const o = await org();
      const moved = await templates.updateTemplate(o.others[0]!, { objectType: 'INCIDENT', nameEn: 'Moved' } as never, o.id, o.admin);
      expect([moved.objectType, moved.nameEn, moved.isDefault]).toEqual(['INCIDENT', 'Moved', false]);
      expect(await defaultsOf(o.id, 'DOCUMENT')).toEqual([o.current]);
      expect(await defaultsOf(o.id, 'INCIDENT')).toEqual([o.incident]);
    });
  });

  describe('at the same time', () => {
    // Several rounds, each in a fresh organisation, so one lucky ordering
    // cannot pass it: without the per-type lock most rounds end with two
    // defaults, or one promotion dies in a deadlock.
    it('concurrent Set as default on different templates of one type all succeed, ending with exactly one default', async () => {
      for (let round = 0; round < 6; round++) {
        const o = await org(4);
        const results = await Promise.allSettled(o.others.map((id) => templates.setDefault(id, o.id, o.admin)));
        expect(results.map((r) => (r.status === 'rejected' ? String((r.reason as Error).message).slice(0, 80) : 'ok'))).toEqual(o.others.map(() => 'ok'));
        const defaults = await defaultsOf(o.id, 'DOCUMENT');
        expect(defaults).toHaveLength(1);
        expect(o.others).toContain(defaults[0]);
        expect(await defaultsOf(o.id, 'INCIDENT')).toEqual([o.incident]);
      }
    });

    it('Set as default and an update to the default at once end with exactly one default', async () => {
      for (let round = 0; round < 4; round++) {
        const o = await org(2);
        const results = await Promise.allSettled([
          templates.setDefault(o.others[0]!, o.id, o.admin),
          templates.updateTemplate(o.others[1]!, { isDefault: true } as never, o.id, o.admin),
        ]);
        expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
        expect(await defaultsOf(o.id, 'DOCUMENT')).toHaveLength(1);
      }
    });

    it('two creates as the default at once are both refused, and nothing is written', async () => {
      const o = await org();
      const before = await snapshot(o.id);
      const create = () => refusal(templates.createTemplate({ nameEn: 'New', nameAr: '', objectType: 'DOCUMENT', isDefault: true } as never, o.id, o.admin));
      expect(await Promise.all([create(), create()])).toEqual([
        { status: 409, code: 'DEFAULT_NEEDS_STAGES' },
        { status: 409, code: 'DEFAULT_NEEDS_STAGES' },
      ]);
      expect(await snapshot(o.id)).toEqual(before);
    });
  });
});
