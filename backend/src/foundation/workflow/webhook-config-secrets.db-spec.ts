/**
 * ACC-277 — webhook action secrets against a REAL Postgres (npm run test:db).
 *
 * Only a database proves that what was STORED, read back through the service,
 * never reaches a caller; that an untouched masked save leaves the stored row
 * byte-for-byte as it was; and that no audit row the save writes holds a value.
 * The marker is synthetic test data, never a real secret, and is never printed.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a database,
 * and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
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

const MARKER = 'acc277-test-marker-value';
const STORED = {
  webhookUrl: 'https://hooks.example.test/in',
  headers: { Authorization: `Bearer ${MARKER}-auth`, 'X-Api-Key': `${MARKER}-key` },
  signingSecret: `${MARKER}-signing`,
};
const leaks = (value: unknown): boolean => JSON.stringify(value ?? null).includes(MARKER);

describe('Webhook action secrets, against a real database (ACC-277)', () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const templates = new WorkflowTemplateService(prisma, audit, new StageTaskDefinitionService(prisma, audit, {} as TaskService));

  /** An organisation with one template, one move, and one webhook action holding the marker. */
  async function org() {
    const slug = `acc277-${randomUUID().slice(0, 8)}`;
    const o = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    const admin = await prisma.user.create({ data: { organizationId: o.id, email: `${slug}@example.test`, name: 'Admin', status: 'ACTIVE' } });
    const template = await prisma.workflowTemplate.create({
      data: { organizationId: o.id, nameEn: 'Documents', objectType: 'DOCUMENT_REQUEST', isDefault: true, isActive: true },
    });
    const from = await prisma.workflowStage.create({
      data: { workflowTemplateId: template.id, nameEn: 'Submitted', order: 10, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', whoMode: 'ANY_ONE' },
    });
    const to = await prisma.workflowStage.create({
      data: { workflowTemplateId: template.id, nameEn: 'Approved', order: 20, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE', isFinal: true },
    });
    const transition = await prisma.workflowTransition.create({ data: { fromStageId: from.id, toStageId: to.id, labelEn: 'Approve', mover: 'PERSON' } });
    const action = await prisma.workflowTransitionAction.create({
      data: { workflowTransitionId: transition.id, actionType: 'WEBHOOK', order: 10, configJson: STORED },
    });
    return { id: o.id, admin: admin.id, template: template.id, action: action.id, transition: transition.id };
  }

  const storedConfig = async (actionId: string) =>
    (await prisma.workflowTransitionAction.findUniqueOrThrow({ where: { id: actionId } })).configJson as Record<string, unknown>;

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('the template read returns no stored value anywhere, only names with empty values and valueSet', async () => {
    const o = await org();
    const read = await templates.getTemplateById(o.template, o.id);
    expect(leaks(read)).toBe(false);
    const config = read.stages!.flatMap((s) => s.transitions ?? []).flatMap((t) => t.actions ?? [])[0]!.configJson;
    expect(config).toEqual({
      webhookUrl: STORED.webhookUrl,
      headers: { Authorization: '', 'X-Api-Key': '' },
      headersValueSet: { Authorization: true, 'X-Api-Key': true },
      signingSecret: '',
      signingSecretSet: true,
    });
  });

  it('the masked read saved back untouched leaves the stored row exactly as it was, and the response is masked', async () => {
    const o = await org();
    const read = await templates.getTemplateById(o.template, o.id);
    const masked = read.stages!.flatMap((s) => s.transitions ?? []).flatMap((t) => t.actions ?? [])[0]!.configJson!;
    // What today's Actions dialog sends: its URL, the headers it showed, and no signing-secret field.
    const response = await templates.updateTransitionAction(
      o.action,
      { configJson: { webhookUrl: masked['webhookUrl'], headers: masked['headers'], signingSecret: masked['signingSecret'] } } as never,
      o.id,
      o.admin,
    );
    expect(leaks(response)).toBe(false);
    expect(await storedConfig(o.action)).toEqual(STORED);
  });

  it('a value replaces, a header left out is removed, and the audit row names them without a value', async () => {
    const o = await org();
    await templates.updateTransitionAction(
      o.action,
      { configJson: { webhookUrl: STORED.webhookUrl, headers: { Authorization: `Bearer ${MARKER}-replaced` }, signingSecret: '' } } as never,
      o.id,
      o.admin,
    );
    const stored = await storedConfig(o.action);
    expect(stored['headers']).toEqual({ Authorization: `Bearer ${MARKER}-replaced` });
    expect(stored['signingSecret']).toBe(STORED.signingSecret);

    const rows = await prisma.auditLog.findMany({ where: { organizationId: o.id, objectType: 'WorkflowTransitionAction', objectId: o.action } });
    expect(rows).toHaveLength(1);
    expect(leaks(rows)).toBe(false);
    expect(rows[0]!.after).toEqual(
      expect.objectContaining({ headers: ['Authorization'], headersChanged: { Authorization: 'changed', 'X-Api-Key': 'removed' } }),
    );
  });

  it('adding an action stores what was sent, returns it masked, and audits names only', async () => {
    const o = await org();
    const added = await templates.addTransitionAction(
      o.transition,
      { actionType: 'WEBHOOK', order: 20, configJson: { webhookUrl: 'https://hooks.example.test/two', headers: { 'X-Token': `${MARKER}-token` } } } as never,
      o.id,
      o.admin,
    );
    expect(leaks(added)).toBe(false);
    expect((await storedConfig(added.id))['headers']).toEqual({ 'X-Token': `${MARKER}-token` });
    const rows = await prisma.auditLog.findMany({ where: { organizationId: o.id, objectId: added.id } });
    expect(leaks(rows)).toBe(false);
  });

  it("should NOT return records belonging to a different tenant — another organisation's action is not found, and its stored secrets are untouched", async () => {
    const a = await org();
    const b = await org();
    await expect(
      templates.updateTransitionAction(b.action, { configJson: { webhookUrl: 'x', headers: {} } } as never, a.id, a.admin),
    ).rejects.toThrow('Workflow transition action not found');
    expect(await storedConfig(b.action)).toEqual(STORED);
    const readA = await templates.getTemplateById(a.template, a.id);
    expect(JSON.stringify(readA)).not.toContain(b.action);
  });
});
