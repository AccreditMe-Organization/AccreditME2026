/**
 * ACC-283 — an overseeing head READS a committee (PR 2a, Q6) and is offered no write
 * the server refuses, against a REAL Postgres (npm run test:db).
 *
 * Two offers used to ignore the write precondition:
 *   - "Request a change": the open summary's canRaise had no write check, so an
 *     overseeing head was offered it and create() answered 404;
 *   - "New task" on the committee's Tasks panel: canCreate was the create key alone,
 *     but POST /tasks runs the record check with no oversight, so it answered 403.
 *
 * Three people, each holding Edit details and Create tasks on committees:
 *   - head    heads the committee's owning unit; not a member, no committees:view
 *             → reads the committee, offered neither write, and both writes refused
 *   - member  an active member, no committees:view → offered both
 *   - holder  committees:view, not a member        → offered both, at no new query
 *
 * The services are the real ones on the real rules; create() of a task is a spy,
 * because what is under test is the decision before it. Same guards as the other
 * db-specs: it FAILS, never skips, without a database, and refuses any database that
 * is not on this machine.
 */
import { randomUUID } from 'crypto';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { COMMITTEE_ACTIONS } from '../workflow/record-registry';
import { StageRulesService } from '../workflow/stage-rules.service';
import { WorkflowService } from '../workflow/workflow.service';
import { NotificationService } from '../notification/notification.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { CreateTaskDto } from '../task/dto/create-task.dto';
import { TaskService, TaskViewer } from '../task/task.service';
import { TaskAuthorityService } from '../task/task-authority.service';
import { TaskVisibilityService } from '../task/task-visibility.service';
import { TaskRecordListService } from '../task/task-record-list.service';
import { CommitteeChangeRequestService } from './change-requests/committee-change-request.service';
import { CreateChangeRequestDto } from './change-requests/dto/change-request.dto';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(120_000);

const WRITE_KEYS = ['committees:edit_details', 'committees:create_tasks'];
const VIEW = 'committees:view';

describe('An overseeing head is offered no write the server refuses, on a real database (ACC-283)', () => {
  const prisma = new PrismaService();
  const visibility = new ObjectVisibilityService(prisma);
  // The open summary and the refused create touch only Prisma and the stage rules:
  // create() refuses the head before it reaches the workflow or the tasks.
  const requests = new CommitteeChangeRequestService(
    prisma,
    {} as WorkflowService,
    {} as TaskService,
    new AuditLogService(prisma),
    {} as NotificationService,
    new StageRulesService(prisma),
  );
  const createTask = jest.fn();
  const createForViewer = TaskService.prototype.createForViewer.bind({ objectVisibility: visibility, prisma, create: createTask }) as (
    dto: CreateTaskDto,
    organizationId: string,
    viewer: TaskViewer,
  ) => Promise<unknown>;
  const authority = new TaskAuthorityService(prisma);
  const tasks = { mayManage: TaskService.prototype.mayManage.bind({ prisma, authority }) } as unknown as TaskService;
  const calendar = { getEffectiveTimeZone: () => Promise.resolve('Asia/Riyadh') } as unknown as WorkingCalendarService;
  const panels = new TaskRecordListService(prisma, visibility, tasks, new TaskVisibilityService(prisma, authority), calendar);

  let org = '';
  let committee = '';
  const v = {} as Record<'head' | 'member' | 'holder', TaskViewer>;

  beforeAll(async () => {
    await prisma.onModuleInit();
    const slug = `acc283w-${randomUUID().slice(0, 8)}`;
    org = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
    const root = (await prisma.orgUnit.create({ data: { organizationId: org, nameEn: 'Root', code: `R-${slug}` } })).id;
    const unit = (await prisma.orgUnit.create({ data: { organizationId: org, nameEn: 'Quality', code: `Q-${slug}`, parentId: root } })).id;
    const headPos = (await prisma.orgPosition.create({ data: { organizationId: org, nameEn: 'Head', grade: 10, isUnitHeadPosition: true } })).id;
    const person = async (name: string, positionId: string | null) =>
      (
        await prisma.user.create({
          data: { organizationId: org, email: `${slug}-${name}@example.test`, name, status: 'ACTIVE', positionId, primaryOrgUnitId: unit },
        })
      ).id;
    v.head = { id: await person('head', headPos), permissions: WRITE_KEYS };
    v.member = { id: await person('member', null), permissions: WRITE_KEYS };
    v.holder = { id: await person('holder', null), permissions: [VIEW, ...WRITE_KEYS] };

    // A live stage that allows a change request, as Active does.
    const template = await prisma.workflowTemplate.create({
      data: { organizationId: org, nameEn: 'Committee (spec)', objectType: 'COMMITTEE', isDefault: true, isActive: true },
    });
    const stage = await prisma.workflowStage.create({
      data: {
        workflowTemplateId: template.id,
        nameEn: 'Active (spec)',
        order: 10,
        isInitial: true,
        whoMode: 'ANY_ONE',
        flags: ['IN_FORCE'],
        recordActions: { create: [{ organizationId: org, actionKey: COMMITTEE_ACTIONS.REQUEST_CHANGE }] },
      },
    });
    committee = (await prisma.committee.create({ data: { organizationId: org, nameEn: 'Quality Committee', typeValueId: 'type', orgUnitId: unit } })).id;
    await prisma.workflowInstance.create({
      data: { organizationId: org, workflowTemplateId: template.id, objectType: 'COMMITTEE', objectId: committee, status: 'IN_PROGRESS', currentStageId: stage.id },
    });
    await prisma.committeeMember.create({ data: { organizationId: org, committeeId: committee, userId: v.member.id, roleValueId: 'seat-member' } });
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  beforeEach(() => {
    createTask.mockReset();
    createTask.mockResolvedValue({ id: 'new-task' });
  });

  const asRequester = (viewer: TaskViewer) => ({ userId: viewer.id, permissions: [...viewer.permissions] });

  /** 'OK', or the refusal's status and message. */
  const outcome = (p: Promise<unknown>): Promise<string> =>
    p.then(
      () => 'OK',
      (e: unknown) => {
        if (e instanceof ForbiddenException || e instanceof NotFoundException) {
          return `${e.getStatus()} ${(e.getResponse() as { message: string }).message}`;
        }
        throw e;
      },
    );

  /** How many membership reads `run` makes: the one query a non-holder pays. */
  async function membershipReads(run: () => Promise<unknown>): Promise<number> {
    const spy = jest.spyOn(prisma.committeeMember, 'findFirst');
    try {
      await run();
      return spy.mock.calls.length;
    } finally {
      spy.mockRestore();
    }
  }

  describe('"Request a change": canRaise', () => {
    it('an overseeing head reads the summary, canRaise is false, and create is still refused with the 404', async () => {
      const summary = await requests.openSummary(committee, org, asRequester(v.head));
      expect(summary).toEqual({ request: null, canRaise: false });
      const dto = { reason: 'Rename it', changes: { nameEn: 'Quality and Safety Committee' } } as unknown as CreateChangeRequestDto;
      expect(await outcome(requests.create(committee, dto, org, asRequester(v.head)))).toBe('404 Committee not found');
    });

    it('a member and a committees:view holder: canRaise is true', async () => {
      expect((await requests.openSummary(committee, org, asRequester(v.member))).canRaise).toBe(true);
      expect((await requests.openSummary(committee, org, asRequester(v.holder))).canRaise).toBe(true);
    });

    it('a committees:view holder pays no membership query for it', async () => {
      expect(await membershipReads(() => requests.openSummary(committee, org, asRequester(v.holder)))).toBe(0);
    });
  });

  describe('"New task" on the Tasks panel: canCreate', () => {
    const panel = (viewer: TaskViewer) => panels.panel({ sourceType: 'COMMITTEE', sourceId: committee }, org, viewer);
    const dto = () => ({ title: 'Collect the minutes', sourceType: 'COMMITTEE', sourceId: committee }) as CreateTaskDto;

    it("an overseeing head opens the panel, canCreate is false, and POST /tasks is still refused with today's 403", async () => {
      expect((await panel(v.head)).canCreate).toBe(false);
      expect(await outcome(createForViewer(dto(), org, v.head))).toBe(`403 Required permission: ${VIEW}`);
      expect(createTask).not.toHaveBeenCalled();
    });

    it('a member and a committees:view holder: canCreate is true, and create accepts them', async () => {
      for (const viewer of [v.member, v.holder]) {
        expect((await panel(viewer)).canCreate).toBe(true);
        expect(await outcome(createForViewer(dto(), org, viewer))).toBe('OK');
      }
    });

    it('a committees:view holder pays no membership query for it', async () => {
      expect(await membershipReads(() => panel(v.holder))).toBe(0);
    });
  });
});
