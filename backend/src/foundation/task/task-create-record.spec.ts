// ACC-244 — POST /tasks checks the task's record before anything else.
//
// Until ACC-244, TaskService.create() accepted any sourceId: an invented id, or
// another organisation's committee, made a task about a record the caller's
// organisation does not hold. createForViewer() is the route's path now; it
// runs the record rule (ObjectVisibilityService, ACC-101 clause a) and only then
// the trusted create(). The real rule runs here, on a stubbed Prisma that knows
// one committee in each of two organisations; the db-spec of the same name
// proves it again on real rows.
//
// Every refusal asserts that create() was never reached, so "refused" cannot be
// a thrown error from somewhere later in the create path.
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { PrismaService } from '../../prisma/prisma.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { CreateTaskDto } from './dto/create-task.dto';
import { TaskService, TaskViewer } from './task.service';

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const COMMITTEE_A = 'committee-in-a';
const COMMITTEE_B = 'committee-in-b';

describe('TaskService.createForViewer — the task\'s record comes first (ACC-244)', () => {
  const committees = [
    { id: COMMITTEE_A, organizationId: ORG_A },
    { id: COMMITTEE_B, organizationId: ORG_B },
  ];
  let findFirst: jest.Mock;
  let create: jest.Mock;
  let createForViewer: (dto: CreateTaskDto, organizationId: string, viewer: TaskViewer) => Promise<unknown>;

  beforeEach(() => {
    // Answers only a row matching BOTH the id and the organisation, as the
    // real committee read does. A read that dropped organizationId would find
    // the other organisation's committee here and the isolation test would fail.
    findFirst = jest.fn(async ({ where }: { where: { id: string; organizationId?: string } }) => {
      const row = committees.find((c) => c.id === where.id && c.organizationId === where.organizationId);
      return row ? { id: row.id } : null;
    });
    const prisma = { committee: { findFirst } } as unknown as PrismaService;
    create = jest.fn().mockResolvedValue({ id: 'new-task' });
    createForViewer = TaskService.prototype.createForViewer.bind({
      objectVisibility: new ObjectVisibilityService(prisma),
      create,
    }) as typeof createForViewer;
  });

  const dto = (sourceId: string, sourceType: CreateTaskDto['sourceType'] = 'COMMITTEE') =>
    ({ title: 'Collect the minutes', sourceType, sourceId }) as CreateTaskDto;
  // ACC-244 PR 2 — Create tasks on committees, the per-type key.
  const seesCommittees: TaskViewer = { id: 'creator', permissions: ['committees:create_tasks', 'committees:view'] };
  const cannotSeeCommittees: TaskViewer = { id: 'creator', permissions: ['committees:create_tasks'] };

  /** The refusal's status and body, for comparing two refusals by content. */
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

  it('a visible committee in the caller\'s organisation: the task is created, by the caller', async () => {
    await expect(createForViewer(dto(COMMITTEE_A), ORG_A, seesCommittees)).resolves.toEqual({ id: 'new-task' });
    expect(create).toHaveBeenCalledWith(dto(COMMITTEE_A), ORG_A, 'creator');
  });

  it('an invented record id: the 404, and no task', async () => {
    expect(await refusal(createForViewer(dto('no-such-committee'), ORG_A, seesCommittees))).toBe(
      `404 ${JSON.stringify({ message: 'COMMITTEE not found', error: 'Not Found', statusCode: 404 })}`,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('a record the caller may not see: 403 naming the permission, decided before any read', async () => {
    expect(await refusal(createForViewer(dto(COMMITTEE_A), ORG_A, cannotSeeCommittees))).toBe(
      `403 ${JSON.stringify({ message: 'Required permission: committees:view', error: 'Forbidden', statusCode: 403 })}`,
    );
    // Existence-neutral: the refusal costs no read, so it is the same for a real
    // committee and an invented one.
    expect(findFirst).not.toHaveBeenCalled();
    expect(await refusal(createForViewer(dto('no-such-committee'), ORG_A, cannotSeeCommittees))).toBe(
      await refusal(createForViewer(dto(COMMITTEE_A), ORG_A, cannotSeeCommittees)),
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('sees committees but lacks Create tasks on them: 403 naming the key, before any read', async () => {
    const reader: TaskViewer = { id: 'creator', permissions: ['committees:view'] };
    expect(await refusal(createForViewer(dto(COMMITTEE_A), ORG_A, reader))).toBe(
      `403 ${JSON.stringify({ message: 'Required permission: committees:create_tasks', error: 'Forbidden', statusCode: 403 })}`,
    );
    expect(findFirst).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('a record type with no visibility rule is refused (fail closed), and no task is made', async () => {
    expect(await refusal(createForViewer(dto('doc-1', 'DOCUMENT'), ORG_A, seesCommittees))).toMatch(/^403 /);
    expect(create).not.toHaveBeenCalled();
  });

  itEnforcesTenantIsolation('createForViewer: another organisation\'s committee is the invented id\'s 404', async () => {
    const foreign = await refusal(createForViewer(dto(COMMITTEE_B), ORG_A, seesCommittees));
    const invented = await refusal(createForViewer(dto('no-such-committee'), ORG_A, seesCommittees));
    expect(foreign).toBe(invented);
    expect(foreign).toMatch(/^404 /);
    // The read was scoped to the CALLER's organisation, never the record's.
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: COMMITTEE_B, organizationId: ORG_A } }));
    expect(create).not.toHaveBeenCalled();
  });
});
