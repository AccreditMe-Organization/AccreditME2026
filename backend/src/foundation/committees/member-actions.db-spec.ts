/**
 * ACC-283 PR 6 — on their own committee, a member may add, remove, change a seat
 * and request a change where their SEAT allows it OR their role does, against a
 * REAL Postgres (npm run test:db). Plan: backend/Plans/step-283-change-request-
 * chain.md §17.
 *
 * The world, one organisation:
 *   committee C, in a live stage that allows every member action
 *     seats on C: Chairman (all five), Secretary (the four member actions),
 *     Member (none) — the seeded defaults (Q10)
 *   committee F, the same seats, in a stage that allows NOTHING
 *   committee D, where the Member seat allows add_member (C's Member must not gain it)
 *   committee E, like C with no change request, for canRaise
 *
 *   secretary   Secretary of C and F; no committees key
 *   member      Member of C;           no committees key
 *   keyed       Member of C;           every member key (the seat allows nothing)
 *   holder      committees:view and every member key; not a member
 *   head        heads C's owning unit; every member key; not a member, no view
 *   former      a Secretary of C whose membership has ended
 *
 * Writes run through the real CommitteesService on the real stage rules; a change
 * request's create runs to the engine and stops there (a stub that throws "PAST
 * THE RULE"), which is all this needs to prove. Same guards as the other db-specs:
 * it FAILS, never skips, without a database, and refuses any database not on this
 * machine.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { CommitteeViewer } from '../../common/services/committee-membership';
import { COMMITTEE_ACTIONS } from '../workflow/record-registry';
import { StageRulesService } from '../workflow/stage-rules.service';
import { WorkflowService } from '../workflow/workflow.service';
import { TaskService } from '../task/task.service';
import { NotificationService } from '../notification/notification.service';
import { CommitteesService } from './committees.service';
import { CommitteeChangeRequestService } from './change-requests/committee-change-request.service';
import { CreateChangeRequestDto, UpdateChangeRequestDto } from './change-requests/dto/change-request.dto';
import { MEMBER_ACTION_KEYS, MemberAction, MEMBER_ACTIONS, assertMemberAction, memberActionsFor } from './member-actions';
import { SEAT_ACTIONS } from './seat-actions';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(180_000);

const VIEW = 'committees:view';
const KEYS = MEMBER_ACTION_KEYS.map((a) => MEMBER_ACTIONS[a].permission);
const SEAT = { chairman: 'seat-chairman', secretary: 'seat-secretary', member: 'seat-member', observer: 'seat-observer' };
const PAST = 'PAST THE RULE';

describe('Seats grant members their committee actions, on a real database (ACC-283 PR 6)', () => {
  const prisma = new PrismaService();
  const stageRules = new StageRulesService(prisma);
  const workflow = { startInstance: async () => undefined } as unknown as WorkflowService;
  const committees = new CommitteesService(prisma, new AuditLogService(prisma), workflow, stageRules);
  const requests = new CommitteeChangeRequestService(
    prisma,
    { prepareInstanceStart: () => Promise.reject(new Error(PAST)) } as unknown as WorkflowService,
    {} as TaskService,
    new AuditLogService(prisma),
    {} as NotificationService,
    stageRules,
  );

  type Who = 'secretary' | 'member' | 'keyed' | 'holder' | 'head' | 'former' | 'stranger';
  let org = '';
  let c = '';
  let f = '';
  let d = '';
  let inactive = '';
  let e = '';
  let draft = '';
  const v = {} as Record<Who, CommitteeViewer>;
  const row = {} as Record<'secretary' | 'member' | 'keyed', string>;
  let newcomer = '';

  async function seatActions(organizationId: string, committeeId: string, seats: Record<string, string[]>) {
    for (const [roleValueId, keys] of Object.entries(seats)) {
      for (const actionKey of keys) await prisma.committeeSeatAction.create({ data: { organizationId, committeeId, roleValueId, actionKey } });
    }
  }

  beforeAll(async () => {
    await prisma.onModuleInit();
    const slug = `acc283s-${randomUUID().slice(0, 8)}`;
    org = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
    const root = (await prisma.orgUnit.create({ data: { organizationId: org, nameEn: 'Root', code: `R-${slug}` } })).id;
    const unit = (await prisma.orgUnit.create({ data: { organizationId: org, nameEn: 'Quality', code: `Q-${slug}`, parentId: root } })).id;
    const headPos = (await prisma.orgPosition.create({ data: { organizationId: org, nameEn: 'Head', grade: 10, isUnitHeadPosition: true } })).id;
    const person = async (name: string, positionId: string | null = null) =>
      (await prisma.user.create({ data: { organizationId: org, email: `${slug}-${name}@example.test`, name, status: 'ACTIVE', positionId, primaryOrgUnitId: unit } })).id;
    v.secretary = { id: await person('secretary'), permissions: [] };
    v.member = { id: await person('member'), permissions: [] };
    v.keyed = { id: await person('keyed'), permissions: KEYS };
    v.holder = { id: await person('holder'), permissions: [VIEW, ...KEYS] };
    v.head = { id: await person('head', headPos), permissions: KEYS };
    v.former = { id: await person('former'), permissions: [] };
    v.stranger = { id: await person('stranger'), permissions: [] };
    newcomer = await person('newcomer');

    // Two live stages: one allows every member action, the other nothing.
    const template = await prisma.workflowTemplate.create({
      data: { organizationId: org, nameEn: 'Committee (spec)', objectType: 'COMMITTEE', isDefault: true, isActive: true },
    });
    const stage = async (nameEn: string, order: number, actions: string[]) =>
      (
        await prisma.workflowStage.create({
          data: {
            workflowTemplateId: template.id,
            nameEn,
            order,
            isInitial: order === 10,
            whoMode: 'ANY_ONE',
            recordActions: { create: actions.map((actionKey) => ({ organizationId: org, actionKey })) },
          },
        })
      ).id;
    const open = await stage('Open (spec)', 10, [
      COMMITTEE_ACTIONS.ADD_MEMBER,
      COMMITTEE_ACTIONS.REMOVE_MEMBER,
      COMMITTEE_ACTIONS.CHANGE_MEMBER_ROLE,
      COMMITTEE_ACTIONS.REQUEST_CHANGE,
    ]);
    const frozen = await stage('Frozen (spec)', 20, []);
    const committee = async (nameEn: string, stageId: string, isActive = true) => {
      const id = (await prisma.committee.create({ data: { organizationId: org, nameEn, typeValueId: 'type', orgUnitId: unit, isActive } })).id;
      await prisma.workflowInstance.create({
        data: { organizationId: org, workflowTemplateId: template.id, objectType: 'COMMITTEE', objectId: id, status: 'IN_PROGRESS', currentStageId: stageId },
      });
      return id;
    };
    c = await committee('Quality Committee', open);
    f = await committee('Frozen Committee', frozen);
    d = await committee('Other Committee', open);
    inactive = await committee('Closed Committee', open, false);
    e = await committee('Raising Committee', open);

    const MEMBER_FOUR = [SEAT_ACTIONS.ADD_MEMBER, SEAT_ACTIONS.REMOVE_MEMBER, SEAT_ACTIONS.CHANGE_MEMBER_SEAT, SEAT_ACTIONS.REQUEST_CHANGE];
    for (const id of [c, f, inactive, e]) {
      await seatActions(org, id, { [SEAT.chairman]: [...MEMBER_FOUR, SEAT_ACTIONS.DECIDE_REPORTING_CHANGES], [SEAT.secretary]: MEMBER_FOUR });
    }
    await seatActions(org, d, { [SEAT.member]: [SEAT_ACTIONS.ADD_MEMBER] });

    const seat = (committeeId: string, userId: string, roleValueId: string, isActive = true) =>
      prisma.committeeMember.create({ data: { organizationId: org, committeeId, userId, roleValueId, isActive, leftAt: isActive ? null : new Date() } });
    row.secretary = (await seat(c, v.secretary.id, SEAT.secretary)).id;
    row.member = (await seat(c, v.member.id, SEAT.member)).id;
    row.keyed = (await seat(c, v.keyed.id, SEAT.member)).id;
    await seat(c, v.former.id, SEAT.secretary, false);
    await seat(f, v.secretary.id, SEAT.secretary);
    await seat(d, v.member.id, SEAT.member);
    await seat(inactive, v.secretary.id, SEAT.secretary);
    await seat(e, v.secretary.id, SEAT.secretary);
    await seat(e, v.member.id, SEAT.member);

    // A draft change request on C, raised by the secretary, for the by-id paths.
    const crTemplate = await prisma.workflowTemplate.create({
      data: { organizationId: org, nameEn: 'Change request (spec)', objectType: 'COMMITTEE_CHANGE_REQUEST', isDefault: true, isActive: true },
    });
    const crStage = await prisma.workflowStage.create({
      data: { workflowTemplateId: crTemplate.id, nameEn: 'Draft', key: 'draft', order: 10, isInitial: true, whoMode: 'ANY_ONE' },
    });
    draft = (
      await prisma.committeeChangeRequest.create({
        data: { organizationId: org, committeeId: c, number: 1, requestedById: v.secretary.id, reason: 'Rename', changes: { nameEn: 'Quality and Safety Committee' } },
      })
    ).id;
    await prisma.workflowInstance.create({
      data: { organizationId: org, workflowTemplateId: crTemplate.id, objectType: 'COMMITTEE_CHANGE_REQUEST', objectId: draft, status: 'IN_PROGRESS', currentStageId: crStage.id },
    });
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  /** 'OK', or the refusal's code, else its status and message. */
  const outcome = (p: Promise<unknown>): Promise<string> =>
    p.then(
      () => 'OK',
      (e: { message?: string; getStatus?: () => number; getResponse?: () => unknown }) => {
        if (e.message === PAST) return PAST;
        const r = e.getResponse?.();
        if (r && typeof r === 'object' && 'code' in r) return String((r as { code: string }).code);
        if (e.getStatus) return `${e.getStatus()} ${e.message}`;
        throw e;
      },
    );
  const asRequester = (viewer: CommitteeViewer) => ({ userId: viewer.id, permissions: [...viewer.permissions] });
  const rename = { reason: 'Rename it', changes: { nameEn: 'A new name' } } as unknown as CreateChangeRequestDto;

  describe('the member writes, through the real service', () => {
    it('a Secretary with no committees key adds, changes a seat and removes, as their seat allows', async () => {
      const added = await committees.addMember(c, { userId: newcomer, roleValueId: SEAT.member } as never, org, v.secretary.id, v.secretary.permissions);
      expect(await outcome(committees.changeMemberRole(c, added.id, { roleValueId: SEAT.observer } as never, org, v.secretary.id, v.secretary.permissions))).toBe('OK');
      expect(await outcome(committees.removeMember(c, added.id, { reason: 'Moved on' } as never, org, v.secretary.id, v.secretary.permissions))).toBe('OK');
    });

    it("a Member whose seat allows nothing and who holds no key: today's 403 naming each key", async () => {
      expect(await outcome(committees.addMember(c, { userId: newcomer, roleValueId: SEAT.member } as never, org, v.member.id, []))).toBe(
        '403 Required permission: committees:add_member',
      );
      expect(await outcome(committees.changeMemberRole(c, row.keyed, { roleValueId: SEAT.observer } as never, org, v.member.id, []))).toBe(
        '403 Required permission: committees:change_member_role',
      );
      expect(await outcome(committees.removeMember(c, row.keyed, { reason: 'Moved on' } as never, org, v.member.id, []))).toBe('403 Required permission: committees:remove_member');
    });

    it('a member holding the keys whose seat allows nothing still may: the seat never takes away', async () => {
      expect(await outcome(committees.changeMemberRole(c, row.member, { roleValueId: SEAT.member } as never, org, v.keyed.id, v.keyed.permissions))).toBe('OK');
    });

    it("an overseeing head with every key, not a member: the committee's 404, every time", async () => {
      expect(await outcome(committees.addMember(c, { userId: newcomer, roleValueId: SEAT.member } as never, org, v.head.id, v.head.permissions))).toBe(
        '404 Committee not found',
      );
      expect(await outcome(committees.removeMember(c, row.member, { reason: 'Moved on' } as never, org, v.head.id, v.head.permissions))).toBe('404 Committee not found');
    });

    it('a Secretary in a stage that allows nothing: STAGE_ACTION_NOT_ALLOWED, after the rule admitted them', async () => {
      expect(await outcome(committees.addMember(f, { userId: newcomer, roleValueId: SEAT.member } as never, org, v.secretary.id, []))).toBe(
        'STAGE_ACTION_NOT_ALLOWED',
      );
    });

    it("Q-A — a seat never changes the actor's OWN seat (removing oneself: member-actions.spec.ts)", async () => {
      expect(await outcome(committees.changeMemberRole(c, row.secretary, { roleValueId: SEAT.chairman } as never, org, v.secretary.id, []))).toBe(
        '403 Required permission: committees:change_member_role',
      );
      expect((await prisma.committeeMember.findUniqueOrThrow({ where: { id: row.secretary } })).roleValueId).toBe(SEAT.secretary);
    });
  });

  describe('the rule on its edges', () => {
    it('a seat that allows the action on ANOTHER committee does not count here', async () => {
      // The Member seat allows add_member on D; on C it allows nothing.
      expect((await memberActionsFor(prisma, org, d, v.member)).add_member).toBe(true);
      expect((await memberActionsFor(prisma, org, c, v.member)).add_member).toBe(false);
    });

    it('an ended membership, or an inactive committee, grants nothing', async () => {
      expect(Object.values(await memberActionsFor(prisma, org, c, v.former))).toEqual([false, false, false, false]);
      expect(Object.values(await memberActionsFor(prisma, org, inactive, v.secretary))).toEqual([false, false, false, false]);
    });

    it('a committees:view holder with every key: all true, with no membership and no seat read', async () => {
      const members = jest.spyOn(prisma.committeeMember, 'findFirst');
      const seats = jest.spyOn(prisma.committeeSeatAction, 'findMany');
      try {
        const detail = await committees.getCommitteeDetail(c, org, v.holder);
        expect(Object.values(detail.memberActions)).toEqual([true, true, true, true]);
        expect([members.mock.calls.length, seats.mock.calls.length]).toEqual([0, 0]);
      } finally {
        members.mockRestore();
        seats.mockRestore();
      }
    });
  });

  describe('request a change', () => {
    it('a Secretary with no key gets past the rule; a Member and an overseeing head are refused as before', async () => {
      expect(await outcome(requests.create(c, rename, org, asRequester(v.secretary)))).toBe(PAST);
      expect(await outcome(requests.create(c, rename, org, asRequester(v.member)))).toBe('CHANGE_REQUEST_NOT_ALLOWED');
      expect(await outcome(requests.create(c, rename, org, asRequester(v.head)))).toBe('404 Committee not found');
    });

    it('by id, a non-member gets "Change request not found" key or not; a keyless member CHANGE_REQUEST_NOT_ALLOWED', async () => {
      const edit = { reason: 'Rename it again' } as unknown as UpdateChangeRequestDto;
      expect(await outcome(requests.update(draft, edit, org, asRequester(v.stranger)))).toBe('404 Change request not found');
      expect(await outcome(requests.update(draft, edit, org, asRequester(v.head)))).toBe('404 Change request not found');
      expect(await outcome(requests.update(draft, edit, org, asRequester(v.member)))).toBe('CHANGE_REQUEST_NOT_ALLOWED');
    });

    it("the open summary's canRaise is the rule's request_change, and agrees with create", async () => {
      expect((await requests.openSummary(f, org, asRequester(v.secretary))).canRaise).toBe(false); // the stage refuses
      // E has no request. The head reads the summary (oversight) but may not raise.
      for (const [who, expected] of [
        ['secretary', true],
        ['member', false],
        ['holder', true],
        ['head', false],
      ] as const) {
        expect({ who, canRaise: (await requests.openSummary(e, org, asRequester(v[who]))).canRaise }).toEqual({ who, canRaise: expected });
        expect({ who, past: (await outcome(requests.create(e, rename, org, asRequester(v[who])))) === PAST }).toEqual({ who, past: expected });
      }
    });
  });

  describe('parity: the read says exactly what the writes do', () => {
    it.each(['secretary', 'member', 'keyed', 'holder', 'head'] as const)("%s: GET /committees/:id's memberActions equals the write's check, action by action", async (who) => {
      const viewer = v[who];
      const read = await committees.getCommitteeDetail(c, org, viewer).then(
        (detail) => detail.memberActions,
        () => null,
      );
      for (const action of MEMBER_ACTION_KEYS as readonly MemberAction[]) {
        const write = await outcome(assertMemberAction(prisma, org, c, viewer, action));
        expect({ who, action, read: read?.[action] ?? false }).toEqual({ who, action, read: write === 'OK' });
      }
    });
  });

  it('should NOT return records belonging to a different tenant — member actions — another organisation\'s seat rows and memberships never admit', async () => {
    const slugB = `acc283s-b-${randomUUID().slice(0, 8)}`;
    const orgB = (await prisma.organization.create({ data: { name: slugB, slug: slugB, country: 'SA' } })).id;
    // Rows naming committee C but belonging to another organisation.
    await prisma.committeeSeatAction.create({ data: { organizationId: orgB, committeeId: c, roleValueId: SEAT.member, actionKey: SEAT_ACTIONS.ADD_MEMBER } });
    await prisma.committeeMember.create({ data: { organizationId: orgB, committeeId: c, userId: v.stranger.id, roleValueId: SEAT.secretary, isActive: true } });
    expect((await memberActionsFor(prisma, org, c, v.member)).add_member).toBe(false);
    expect(Object.values(await memberActionsFor(prisma, org, c, v.stranger))).toEqual([false, false, false, false]);
    expect(await outcome(committees.addMember(c, { userId: newcomer, roleValueId: SEAT.member } as never, org, v.stranger.id, []))).toBe(
      '403 Required permission: committees:add_member',
    );
  });
});
