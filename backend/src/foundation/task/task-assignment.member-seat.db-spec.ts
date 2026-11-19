/**
 * ACC-291 — a committee member can assign a task to a seat on their own
 * committee, against a REAL Postgres (npm run test:db).
 *
 * The assignee picker's committee route (the seats, the people in a seat, and the
 * seat catalogue counted on a committee) needed committees:view. It now follows
 * create.types' rule (ACC-280): committees:view, or an active member of THE
 * committee named, through the one membership rule (committee-membership.ts).
 *
 *   - a member with Create tasks and without committees:view: their own
 *     committee's seats and people, and the catalogue counted on it;
 *   - the same member, another committee of the same organisation: today's 403,
 *     identical to an invented id, before anything about it is read;
 *   - the same member, the catalogue with no committee: today's 403;
 *   - a member who has LEFT: today's 403, on the next request;
 *   - a committees:view holder: unchanged, and no membership query;
 *   - another organisation's committee: nothing of it, to anyone.
 *
 * And POST /tasks already applies the same rule (no change was needed): the
 * member creates a seat task on their own committee, is refused another
 * committee's (the record check's 403), and a seat can only be chosen on the
 * task's own committee (400).
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a database,
 * and refuses any database not on this machine.
 */
import { randomUUID } from 'crypto';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { LookupService } from '../lookup/lookup.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { TaskService, TaskViewer } from './task.service';
import { TaskAuthorityService } from './task-authority.service';
import { AssignmentViewer, TaskAssignmentService } from './task-assignment.service';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(60_000);

const KEY = 'committees:create_tasks';
const VIEW = 'committees:view';
const REFUSED = `403 Required permission: ${VIEW}`;

describe('A committee member chooses a seat on their own committee, on a real database (ACC-291)', () => {
  const prisma = new PrismaService();
  const assignment = new TaskAssignmentService(
    prisma,
    new TaskAuthorityService(prisma),
    new LookupService(prisma, {} as AuditLogService),
  );
  const visibility = new ObjectVisibilityService(prisma);
  const create = jest.fn();
  const createForViewer = TaskService.prototype.createForViewer.bind({ objectVisibility: visibility, prisma, create }) as (
    dto: CreateTaskDto,
    organizationId: string,
    viewer: TaskViewer,
  ) => Promise<unknown>;

  let org = '';
  let otherOrg = '';
  let own = '';
  let other = '';
  let foreign = '';
  let inactive = '';
  let secretary = '';
  let member = '';
  const people = { keyedMember: '', colleague: '', otherMember: '', viewer: '', leaver: '' };
  let foreignPerson = '';

  beforeAll(async () => {
    await prisma.onModuleInit();
    const slug = `acc291-${randomUUID().slice(0, 8)}`;
    org = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
    otherOrg = (await prisma.organization.create({ data: { name: `${slug}-b`, slug: `${slug}-b`, country: 'SA' } })).id;

    // The seats are real committee_member_role values, so the lists carry their labels.
    const category =
      (await prisma.lookupCategory.findFirst({ where: { key: 'committee_member_role', organizationId: null } })) ??
      (await prisma.lookupCategory.create({ data: { key: 'committee_member_role', labelEn: 'Committee member role', labelAr: 'دور العضو' } }));
    const seat = async (organizationId: string, labelEn: string, sortOrder: number) =>
      (
        await prisma.lookupValue.create({
          data: { organizationId, categoryId: category.id, key: `s-${randomUUID().slice(0, 8)}`, labelEn, labelAr: labelEn, layer: 'TENANT', sortOrder } as never,
        })
      ).id;
    secretary = await seat(org, 'Secretary', 1);
    member = await seat(org, 'Member', 2);
    const foreignSeat = await seat(otherOrg, 'Member', 1);

    const unit = (await prisma.orgUnit.create({ data: { organizationId: org, nameEn: 'Quality', code: `Q${slug.slice(-4)}` } })).id;
    const foreignUnit = (await prisma.orgUnit.create({ data: { organizationId: otherOrg, nameEn: 'Quality', code: `B${slug.slice(-4)}` } })).id;
    own = (await prisma.committee.create({ data: { organizationId: org, nameEn: 'Quality Committee', typeValueId: 'type', orgUnitId: unit } })).id;
    other = (await prisma.committee.create({ data: { organizationId: org, nameEn: 'Safety Committee', typeValueId: 'type', orgUnitId: unit } })).id;
    foreign = (await prisma.committee.create({ data: { organizationId: otherOrg, nameEn: 'Board', typeValueId: 'type', orgUnitId: foreignUnit } })).id;
    // P178 — an INACTIVE committee on which the member still holds an active seat.
    inactive = (await prisma.committee.create({ data: { organizationId: org, nameEn: 'Old Committee', typeValueId: 'type', orgUnitId: unit, isActive: false } })).id;

    for (const name of Object.keys(people) as (keyof typeof people)[]) {
      people[name] = (await prisma.user.create({ data: { organizationId: org, email: `${slug}-${name}@example.test`, name, status: 'ACTIVE' } })).id;
    }
    foreignPerson = (await prisma.user.create({ data: { organizationId: otherOrg, email: `${slug}-foreign@example.test`, name: 'foreign', status: 'ACTIVE' } })).id;

    const seatOn = (organizationId: string, committeeId: string, userId: string, roleValueId: string, isActive = true) =>
      prisma.committeeMember.create({
        data: { organizationId, committeeId, userId, roleValueId, isActive, ...(isActive ? {} : { leftAt: new Date() }) },
      });
    await seatOn(org, own, people.keyedMember, member);
    await seatOn(org, inactive, people.keyedMember, secretary);
    await seatOn(org, inactive, people.colleague, member);
    await seatOn(org, own, people.colleague, secretary);
    await seatOn(org, own, people.leaver, member, false);
    await seatOn(org, other, people.otherMember, secretary);
    await seatOn(otherOrg, foreign, foreignPerson, foreignSeat);
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue({ id: 'new-task' });
  });

  const keyedMember = (): AssignmentViewer => ({ id: people.keyedMember, permissions: [KEY] });
  const viewer = (): AssignmentViewer => ({ id: people.viewer, permissions: [KEY, VIEW] });

  /** The answer, or the refusal's status and message. */
  const outcome = <T>(p: Promise<T>, show: (v: T) => string = () => 'OK'): Promise<string> =>
    p.then(show, (e: unknown) => {
      if (e instanceof ForbiddenException || e instanceof NotFoundException || e instanceof BadRequestException) {
        return `${e.getStatus()} ${(e.getResponse() as { message: string }).message}`;
      }
      throw e;
    });
  const roles = (v: AssignmentViewer, committeeId: string) =>
    outcome(assignment.listCommitteeRoles(v, org, committeeId), (r) => r.map((x) => `${x.labelEn}:${x.memberCount}`).join(','));
  const holders = (v: AssignmentViewer, committeeId: string, roleValueId: string) =>
    outcome(assignment.listCommitteeMembers(v, org, committeeId, roleValueId), (r) => r.map((x) => x.name).join(','));
  const catalogue = (v: AssignmentViewer, committeeId: string | undefined) =>
    outcome(assignment.listCommitteeRoleCatalogue(v, org, committeeId), (r) =>
      r.filter((x) => x.id === secretary || x.id === member).map((x) => `${x.labelEn}:${x.memberCount}`).join(','),
    );

  it('a member without committees:view chooses among their own committee’s seats and people', async () => {
    expect(await roles(keyedMember(), own)).toBe('Secretary:1,Member:1');
    expect(await holders(keyedMember(), own, secretary)).toBe('colleague');
    expect(await catalogue(keyedMember(), own)).toBe('Secretary:1,Member:1');
  });

  it('the same member is refused another committee’s seats, exactly as an invented id is', async () => {
    const invented = randomUUID();
    for (const committeeId of [other, invented]) {
      expect(await roles(keyedMember(), committeeId)).toBe(REFUSED);
      expect(await holders(keyedMember(), committeeId, secretary)).toBe(REFUSED);
      expect(await catalogue(keyedMember(), committeeId)).toBe(REFUSED);
    }
  });

  it('the same member is refused the whole catalogue with no committee named: only their own seats', async () => {
    expect(await catalogue(keyedMember(), undefined)).toBe(REFUSED);
  });

  // P178 — the membership rule counts an ACTIVE seat on an ACTIVE committee only.
  // The member's seat on the inactive committee is still active, so only the
  // committee's own isActive refuses them: the same 403 on all three routes.
  it('a member of an INACTIVE committee is refused on all three routes, with the same 403', async () => {
    expect(await prisma.committeeMember.count({ where: { committeeId: inactive, userId: people.keyedMember, isActive: true } })).toBe(1); // non-vacuity
    expect(await roles(keyedMember(), inactive)).toBe(REFUSED);
    expect(await holders(keyedMember(), inactive, member)).toBe(REFUSED);
    expect(await catalogue(keyedMember(), inactive)).toBe(REFUSED);
  });

  it('a member who has left is refused, on the next request', async () => {
    const leaver: AssignmentViewer = { id: people.leaver, permissions: [KEY] };
    expect(await roles(leaver, own)).toBe(REFUSED);
    expect(await holders(leaver, own, member)).toBe(REFUSED);
  });

  it('a committees:view holder is unchanged, and pays no membership query', async () => {
    const spy = jest.spyOn(prisma.committeeMember, 'findFirst');
    try {
      expect(await roles(viewer(), own)).toBe('Secretary:1,Member:1');
      expect(await roles(viewer(), other)).toBe('Secretary:1');
      expect(await holders(viewer(), other, secretary)).toBe('otherMember');
      expect(await catalogue(viewer(), undefined)).toBe('Secretary:null,Member:null');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('should NOT return records belonging to a different tenant: another organisation’s committee and its people', async () => {
    // A member of this organisation: the membership rule's 403, as for an invented id.
    expect(await roles(keyedMember(), foreign)).toBe(REFUSED);
    expect(await holders(keyedMember(), foreign, member)).toBe(REFUSED);
    // A committees:view holder: the committee is not found here, and its people are not listed.
    expect(await roles(viewer(), foreign)).toBe('404 Committee not found');
    expect(await holders(viewer(), foreign, member)).toBe('');
  });

  describe('POST /tasks applies the same rule (unchanged)', () => {
    const seatTask = (sourceId: string, committeeId: string, roleValueId: string) =>
      ({
        title: 'Collect the minutes',
        sourceType: 'COMMITTEE',
        sourceId,
        assignTo: { kind: 'COMMITTEE_ROLE', committeeId, roleValueId },
      }) as unknown as CreateTaskDto;

    it('the member creates a task for a seat on their own committee', async () => {
      const v: TaskViewer = { id: people.keyedMember, permissions: [KEY] };
      expect(await outcome(createForViewer(seatTask(own, own, secretary), org, v))).toBe('OK');
      expect(create).toHaveBeenCalledTimes(1);
      const placement = await assignment.resolvePlacement(seatTask(own, own, secretary).assignTo!, org, { sourceType: 'COMMITTEE', sourceId: own });
      expect(placement.target).toEqual({ kind: 'COMMITTEE_ROLE', committeeId: own, roleValueId: secretary });
    });

    it('the member is refused another committee’s task (the record check), and nothing is created', async () => {
      const v: TaskViewer = { id: people.keyedMember, permissions: [KEY] };
      expect(await outcome(createForViewer(seatTask(other, other, secretary), org, v))).toBe(REFUSED);
      expect(create).not.toHaveBeenCalled();
    });

    it('a seat can only be chosen on the task’s own committee', async () => {
      expect(
        await outcome(assignment.resolvePlacement(seatTask(own, other, secretary).assignTo!, org, { sourceType: 'COMMITTEE', sourceId: own })),
      ).toBe('400 A committee role can only be chosen for a task on that committee');
    });
  });
});
