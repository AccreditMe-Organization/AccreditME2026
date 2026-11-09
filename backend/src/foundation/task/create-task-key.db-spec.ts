/**
 * ACC-280 — POST /tasks always needs the record type's Create tasks key, and a
 * record panel's canCreate says exactly what create allows, against a REAL Postgres
 * (npm run test:db).
 *
 * The gap this closes: createForViewer() checked the key only for a caller holding
 * committees:view. That was safe while the record check refused everyone else; since
 * ACC-281 it admits a committee's active members, so a member WITHOUT the key could
 * create a task on their committee.
 *
 * Four people, none of whom holds anything beyond what is named:
 *   - a member without the key                     → 403 naming the key
 *   - a member with the key, without committees:view → created (the route's 201)
 *   - a non-member with the key, without committees:view → today's refusal (committees:view)
 *   - a committees:view holder without the key     → 403 naming the key, as before
 * and for each, the panel's canCreate agrees (a panel it cannot open is refused the
 * same way create is).
 *
 * The record rule is the real ObjectVisibilityService, and the panel is the real
 * TaskRecordListService on the real task visibility rule. create() is a spy: what is
 * under test is the decision before it. Same guards as the other db-specs: it FAILS,
 * never skips, without a database, and refuses any database not on this machine.
 */
import { randomUUID } from 'crypto';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { TaskService, TaskViewer } from './task.service';
import { TaskAuthorityService } from './task-authority.service';
import { TaskVisibilityService } from './task-visibility.service';
import { TaskRecordListService } from './task-record-list.service';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(60_000);

const KEY = 'committees:create_tasks';
const VIEW = 'committees:view';

describe('POST /tasks needs Create tasks, and the panel agrees, on a real database (ACC-280)', () => {
  const prisma = new PrismaService();
  const visibility = new ObjectVisibilityService(prisma);
  const create = jest.fn();
  const createForViewer = TaskService.prototype.createForViewer.bind({ objectVisibility: visibility, create }) as (
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
  const people = { member: '', keyedMember: '', keyedStranger: '', viewer: '' };

  beforeAll(async () => {
    await prisma.onModuleInit();
    const slug = `acc280-${randomUUID().slice(0, 8)}`;
    org = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
    const unit = (await prisma.orgUnit.create({ data: { organizationId: org, nameEn: 'Quality', code: `Q${slug.slice(-4)}` } })).id;
    committee = (await prisma.committee.create({ data: { organizationId: org, nameEn: 'Quality Committee', typeValueId: 'type', orgUnitId: unit } })).id;
    for (const name of Object.keys(people) as (keyof typeof people)[]) {
      people[name] = (await prisma.user.create({ data: { organizationId: org, email: `${slug}-${name}@example.test`, name, status: 'ACTIVE' } })).id;
    }
    for (const userId of [people.member, people.keyedMember]) {
      await prisma.committeeMember.create({ data: { organizationId: org, committeeId: committee, userId, roleValueId: 'seat-member' } });
    }
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue({ id: 'new-task' });
  });

  const dto = () => ({ title: 'Collect the minutes', sourceType: 'COMMITTEE', sourceId: committee }) as CreateTaskDto;

  /** 'CREATED', or the refusal's status and message. */
  const outcome = (p: Promise<unknown>): Promise<string> =>
    p.then(
      () => 'CREATED',
      (e: unknown) => {
        if (e instanceof ForbiddenException || e instanceof NotFoundException) {
          return `${e.getStatus()} ${(e.getResponse() as { message: string }).message}`;
        }
        throw e;
      },
    );
  /** The panel's answer: its canCreate, or the refusal that stopped it. */
  const panel = (viewer: TaskViewer): Promise<string> =>
    panels.panel({ sourceType: 'COMMITTEE', sourceId: committee }, org, viewer).then(
      (p) => `canCreate=${p.canCreate}`,
      (e: unknown) => {
        if (e instanceof ForbiddenException || e instanceof NotFoundException) {
          return `${e.getStatus()} ${(e.getResponse() as { message: string }).message}`;
        }
        throw e;
      },
    );

  it('a member WITHOUT the key: 403 naming the key, and the panel offers no New task', async () => {
    const v: TaskViewer = { id: people.member, permissions: [] };
    expect(await outcome(createForViewer(dto(), org, v))).toBe(`403 Required permission: ${KEY}`);
    expect(create).not.toHaveBeenCalled();
    expect(await panel(v)).toBe('canCreate=false');
  });

  it('a member WITH the key, without committees:view: created on their own committee, and the panel offers it', async () => {
    const v: TaskViewer = { id: people.keyedMember, permissions: [KEY] };
    expect(await outcome(createForViewer(dto(), org, v))).toBe('CREATED');
    expect(create).toHaveBeenCalledWith(dto(), org, people.keyedMember);
    expect(await panel(v)).toBe('canCreate=true');
  });

  it("a non-member WITH the key, without committees:view: today's refusal, and the panel is refused the same way", async () => {
    const v: TaskViewer = { id: people.keyedStranger, permissions: [KEY] };
    expect(await outcome(createForViewer(dto(), org, v))).toBe(`403 Required permission: ${VIEW}`);
    expect(create).not.toHaveBeenCalled();
    expect(await panel(v)).toBe(`403 Required permission: ${VIEW}`);
  });

  it('a committees:view holder WITHOUT the key: still 403 naming the key, and no New task on the panel', async () => {
    const v: TaskViewer = { id: people.viewer, permissions: [VIEW] };
    expect(await outcome(createForViewer(dto(), org, v))).toBe(`403 Required permission: ${KEY}`);
    expect(create).not.toHaveBeenCalled();
    expect(await panel(v)).toBe('canCreate=false');
  });
});
