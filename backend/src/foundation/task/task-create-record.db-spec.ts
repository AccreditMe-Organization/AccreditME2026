/**
 * ACC-244 — POST /tasks checks the task's record first, against a REAL Postgres
 * (npm run test:db). The unit spec of the same name runs the rule on a stub;
 * this proves it on real rows, two organisations, a committee in each.
 *
 * The record rule is the real ObjectVisibilityService. create() itself is a
 * spy: what is under test is that the check runs, answers, and stops the
 * request before create() is reached. Nothing is written by a refused call.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a
 * database, and refuses any database that is not on this machine. (CI's
 * tenant-isolation gate runs the unit config, so the gate-named test that it
 * sees lives in task-create-record.spec.ts; the one here is the same claim on
 * real rows.)
 */
import { randomUUID } from 'crypto';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { TENANT_ISOLATION_GATE_STRING } from '../../common/testing/tenant-isolation';
import { CreateTaskDto } from './dto/create-task.dto';
import { TaskService, TaskViewer } from './task.service';

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
}
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(60_000);

describe('POST /tasks checks the record first, on a real database (ACC-244)', () => {
  const prisma = new PrismaService();
  const create = jest.fn();
  const createForViewer = TaskService.prototype.createForViewer.bind({
    objectVisibility: new ObjectVisibilityService(prisma),
    create,
  }) as (dto: CreateTaskDto, organizationId: string, viewer: TaskViewer) => Promise<unknown>;

  let A = '';
  let B = '';
  let committeeA = '';
  let committeeB = '';
  let creatorA = '';

  beforeAll(async () => {
    await prisma.onModuleInit();
    const slug = `acc244-${randomUUID().slice(0, 8)}`;
    A = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
    B = (await prisma.organization.create({ data: { name: `${slug}-b`, slug: `${slug}-b`, country: 'SA' } })).id;
    const unit = async (organizationId: string, code: string) =>
      (await prisma.orgUnit.create({ data: { organizationId, nameEn: 'Quality', code } })).id;
    committeeA = (
      await prisma.committee.create({
        data: { organizationId: A, nameEn: 'Quality Committee', typeValueId: 'type', orgUnitId: await unit(A, `QA${slug.slice(-4)}`) },
      })
    ).id;
    committeeB = (
      await prisma.committee.create({
        data: { organizationId: B, nameEn: 'Their Committee', typeValueId: 'type', orgUnitId: await unit(B, `QB${slug.slice(-4)}`) },
      })
    ).id;
    creatorA = (await prisma.user.create({ data: { organizationId: A, email: `${slug}@example.test`, name: 'Creator', status: 'ACTIVE' } })).id;
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue({ id: 'new-task' });
  });

  const dto = (sourceId: string) => ({ title: 'Collect the minutes', sourceType: 'COMMITTEE', sourceId }) as CreateTaskDto;
  const seesCommittees = (): TaskViewer => ({ id: creatorA, permissions: ['tasks:create', 'committees:view'] });

  async function refusal(p: Promise<unknown>): Promise<string> {
    try {
      await p;
    } catch (e) {
      if (e instanceof NotFoundException || e instanceof ForbiddenException) {
        return `${e.getStatus()} ${JSON.stringify(e.getResponse())}`;
      }
      throw e;
    }
    throw new Error('expected a refusal, and the task was created');
  }

  it('creates on the caller\'s own visible committee', async () => {
    await expect(createForViewer(dto(committeeA), A, seesCommittees())).resolves.toEqual({ id: 'new-task' });
    expect(create).toHaveBeenCalledWith(dto(committeeA), A, creatorA);
  });

  it('an invented id: 404, no task', async () => {
    expect(await refusal(createForViewer(dto(randomUUID()), A, seesCommittees()))).toMatch(/^404 .*COMMITTEE not found/);
    expect(create).not.toHaveBeenCalled();
  });

  it('a committee the caller may not see: 403 naming committees:view, no task', async () => {
    const viewer: TaskViewer = { id: creatorA, permissions: ['tasks:create'] };
    expect(await refusal(createForViewer(dto(committeeA), A, viewer))).toMatch(/^403 .*Required permission: committees:view/);
    // The same answer for an invented id: the refusal never depended on the row.
    expect(await refusal(createForViewer(dto(randomUUID()), A, viewer))).toBe(await refusal(createForViewer(dto(committeeA), A, viewer)));
    expect(create).not.toHaveBeenCalled();
  });

  it(`${TENANT_ISOLATION_GATE_STRING} — create on another organisation's committee is the invented id's 404`, async () => {
    const foreign = await refusal(createForViewer(dto(committeeB), A, seesCommittees()));
    const invented = await refusal(createForViewer(dto(randomUUID()), A, seesCommittees()));
    expect(foreign).toBe(invented);
    expect(foreign).toMatch(/^404 /);
    expect(create).not.toHaveBeenCalled();
    // And the committee is real in its own organisation: the refusal is about whose it is.
    expect(await prisma.committee.count({ where: { id: committeeB, organizationId: B } })).toBe(1);
  });
});
