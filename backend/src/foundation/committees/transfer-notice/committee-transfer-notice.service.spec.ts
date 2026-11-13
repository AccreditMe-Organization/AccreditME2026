import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { LookupService } from '../../lookup/lookup.service';
import type { NotificationService } from '../../notification/notification.service';
import {
  COMMITTEE_TRANSFER_NOTICE_DELAY_MS,
  COMMITTEE_TRANSFER_NOTICE_ENQUEUE_TIMEOUT_MS,
  COMMITTEE_TRANSFER_NOTICE_JOB,
  CommitteeTransferNoticeService,
  transferNoticeJobId,
  type TransferNoticeJob,
} from './committee-transfer-notice.service';

// ACC-297 — the notice after a transfer, run IN-PROCESS against a mocked Prisma:
// never through the shared Redis queue. The world below is one organisation with
// two committees: Quality Council (the person still holds Member) and Safety
// Committee (the person's Secretary seat was removed after the transfer).

const ORG = 'org-a';
const PERSON = 'person';
const ACTOR = 'admin';
const SINCE = Date.UTC(2026, 10, 12, 9, 0, 0);
const JOB: TransferNoticeJob = { organizationId: ORG, userId: PERSON, actorId: ACTOR, sinceMs: SINCE };

const SEATS = [
  { id: 'seat-chair', key: 'chairman', labelEn: 'Chairman', labelAr: 'رئيس اللجنة' },
  { id: 'seat-sec', key: 'secretary', labelEn: 'Secretary', labelAr: 'أمين السر' },
  { id: 'seat-member', key: 'member', labelEn: 'Member', labelAr: 'عضو' },
];
const QUALITY = { id: 'c-quality', nameEn: 'Quality Council', nameAr: 'مجلس الجودة', isActive: true, orgUnitId: 'u-quality' };
const SAFETY = { id: 'c-safety', nameEn: 'Safety Committee', nameAr: 'لجنة السلامة', orgUnitId: 'u-safety' };

interface World {
  held: { id: string; roleValueId: string; joinedAt: Date; committee: typeof QUALITY }[];
  left: { committeeId: string; roleValueId: string; reason: string | null; approvedBy: string | null; committee: Omit<typeof SAFETY, 'id'> }[];
  officers: { committeeId: string; userId: string }[];
  heads: { id: string; primaryOrgUnitId: string }[];
  covers: { orgUnitId: string; userId: string }[];
  inactive: string[];
  viewers: string[];
  memberOf: { userId: string; committeeId: string }[];
}

const baseWorld = (): World => ({
  held: [{ id: 'm1', roleValueId: 'seat-member', joinedAt: new Date('2026-01-01'), committee: QUALITY }],
  left: [{ committeeId: SAFETY.id, roleValueId: 'seat-sec', reason: 'Transferred to Pharmacy (admin wording)', approvedBy: ACTOR, committee: { nameEn: SAFETY.nameEn, nameAr: SAFETY.nameAr, orgUnitId: SAFETY.orgUnitId } }],
  officers: [
    { committeeId: QUALITY.id, userId: 'chair' },
    { committeeId: SAFETY.id, userId: 'chair' },
    { committeeId: QUALITY.id, userId: 'secretary' },
  ],
  heads: [
    { id: 'head-quality', primaryOrgUnitId: 'u-quality' },
    { id: 'head-safety', primaryOrgUnitId: 'u-safety' },
  ],
  covers: [{ orgUnitId: 'u-safety', userId: 'cover-safety' }],
  inactive: [],
  viewers: ['chair'],
  memberOf: [{ userId: 'head-quality', committeeId: QUALITY.id }],
});

type Rows = { userId: string; titleEn: string; titleAr: string | null; bodyEn: string; bodyAr: string | null; objectType: string | null; objectId: string | null }[];

function build(world: World) {
  // Mocks return promises rather than being async: none of them awaits anything.
  const prisma = {
    committeeMember: {
      findMany: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        if (where['roleValueId']) return Promise.resolve(world.officers);
        if (typeof where['userId'] === 'string') return Promise.resolve(world.held);
        return Promise.resolve(world.memberOf);
      }),
      count: jest.fn(() => Promise.resolve(world.held.length)),
    },
    committeeMembershipEvent: { findMany: jest.fn(() => Promise.resolve(world.left)) },
    user: {
      findFirst: jest.fn(() => Promise.resolve({ name: 'Sara Al-Mutairi', primaryOrgUnit: { nameEn: 'Pharmacy', nameAr: 'الصيدلية' } })),
      findMany: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        if (where['position']) {
          return Promise.resolve(world.heads.map((h) => ({ ...h, name: h.id, positionId: 'p', position: { nameEn: 'Head', nameAr: null } })));
        }
        const ids = (where['id'] as { in: string[] }).in;
        return Promise.resolve(ids.filter((id) => !world.inactive.includes(id)).map((id) => ({ id })));
      }),
    },
    orgUnitHeadAssignment: {
      findMany: jest.fn(() =>
        Promise.resolve(
          world.covers.map((c) => ({ id: `a-${c.userId}`, ...c, reason: 'ABSENCE', validFrom: new Date(0), validTo: null, user: { name: c.userId, primaryOrgUnitId: null } })),
        ),
      ),
    },
    userRole: { findMany: jest.fn(() => Promise.resolve(world.viewers.map((userId) => ({ userId })))) },
  };
  const lookups = { getValues: jest.fn(() => Promise.resolve(SEATS)) };
  const written: Rows = [];
  const notifications = {
    // (rows, organisationId, source): the spec reads the last two from mock.calls.
    createInAppMany: jest.fn((...args: [Rows, string, string]) => {
      written.push(...args[0]);
      return Promise.resolve(args[0].length);
    }),
  };
  const queue = { add: jest.fn(() => Promise.resolve(undefined)) };
  const service = new CommitteeTransferNoticeService(
    prisma as unknown as PrismaService,
    lookups as unknown as LookupService,
    notifications as unknown as NotificationService,
    queue as unknown as Queue,
  );
  const row = (userId: string) => written.find((r) => r.userId === userId)!;
  return { service, prisma, lookups, notifications, queue, written, row };
}

describe('CommitteeTransferNoticeService.schedule (ACC-297)', () => {
  it('adds one delayed job, two minutes out, with the organisation + user + transfer time as its id, and one attempt', async () => {
    const { service, queue } = build(baseWorld());
    await service.schedule({ organizationId: ORG, userId: PERSON, actorId: ACTOR, since: new Date(SINCE) });
    expect(COMMITTEE_TRANSFER_NOTICE_DELAY_MS).toBe(120_000);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(COMMITTEE_TRANSFER_NOTICE_JOB, JOB, expect.objectContaining({
      jobId: `transfer-notice_${ORG}_${PERSON}_${SINCE}`,
      delay: 120_000,
      attempts: 1,
    }));
  });

  it('the same transfer gives the same id (so a second schedule is ignored); another time, another id; and no ":" (BullMQ refuses it)', () => {
    const a = transferNoticeJobId(JOB);
    expect(transferNoticeJobId({ ...JOB })).toBe(a);
    expect(transferNoticeJobId({ ...JOB, sinceMs: SINCE + 1 })).not.toBe(a);
    expect(transferNoticeJobId({ ...JOB, userId: 'other' })).not.toBe(a);
    expect(a).not.toContain(':');
  });

  it('gives up with a TimeoutError when the queue does not answer in time: the transfer is never held by it', async () => {
    jest.useFakeTimers();
    try {
      const { service, queue } = build(baseWorld());
      queue.add.mockImplementation(() => new Promise(() => undefined));
      const scheduled = service.schedule({ organizationId: ORG, userId: PERSON, actorId: ACTOR, since: new Date(SINCE) });
      const settled = expect(scheduled).rejects.toMatchObject({ name: 'TimeoutError', message: 'enqueue timed out' });
      await jest.advanceTimersByTimeAsync(COMMITTEE_TRANSFER_NOTICE_ENQUEUE_TIMEOUT_MS);
      await settled;
    } finally {
      jest.useRealTimers();
    }
  });

  it('clears its timer when add() wins', async () => {
    jest.useFakeTimers();
    try {
      const { service } = build(baseWorld());
      await service.schedule({ organizationId: ORG, userId: PERSON, actorId: ACTOR, since: new Date(SINCE) });
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('a failure from add() IN time reaches the caller, which logs it, and the timer is cleared', async () => {
    jest.useFakeTimers();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const { service, queue } = build(baseWorld());
      const refused = Object.assign(new Error('connect ECONNREFUSED secret-host'), { code: 'ECONNREFUSED' });
      queue.add.mockImplementation(() => Promise.reject(refused));
      await expect(service.schedule({ organizationId: ORG, userId: PERSON, actorId: ACTOR, since: new Date(SINCE) })).rejects.toBe(refused);
      expect(jest.getTimerCount()).toBe(0);
      expect(warn).not.toHaveBeenCalled(); // the caller logs this one, not schedule()
    } finally {
      warn.mockRestore();
      jest.useRealTimers();
    }
  });

  // Lane A's review. How "never unhandled" is checked: Jest itself fails the test
  // that leaves a rejection unhandled, with that rejection as the error. Checked
  // on 13 Nov with a deliberate orphan Promise.reject(): the test failed with it,
  // and a process.on('unhandledRejection') listener added in the test was NEVER
  // called (Jest takes the event first). So such a listener would be silent
  // either way, and this spec relies on Jest instead. The mutation that leaves
  // add() with no handler at all turns this test red through exactly that.
  describe('a rejection from add() AFTER the time limit (lane A\'s review)', () => {
    // Two macrotask turns: long enough for Node, and Jest, to decide a rejection is unhandled.
    const nodeHasDecided = async () => {
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
    };

    it('is never unhandled: it is logged by kind with ids only, and swallowed', async () => {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      try {
        const { service, queue } = build(baseWorld());
        let rejectAdd: (e: unknown) => void = () => undefined;
        queue.add.mockImplementation(() => new Promise((_, reject) => (rejectAdd = reject)));
        const scheduled = service.schedule({ organizationId: ORG, userId: PERSON, actorId: ACTOR, since: new Date(SINCE) });
        const settled = expect(scheduled).rejects.toMatchObject({ name: 'TimeoutError' });
        await jest.advanceTimersByTimeAsync(COMMITTEE_TRANSFER_NOTICE_ENQUEUE_TIMEOUT_MS);
        await settled;

        // The time limit has answered; now add() fails, late.
        rejectAdd(Object.assign(new Error('connect ECONNREFUSED secret-host:6379'), { code: 'ECONNREFUSED' }));
        await nodeHasDecided();

        expect(warn).toHaveBeenCalledTimes(1);
        const message = String(warn.mock.calls[0]![0]);
        expect(message).toBe(`Committee transfer notice: the enqueue failed after its time limit (Error / ECONNREFUSED): organisation ${ORG}, user ${PERSON}.`);
        expect(message).not.toContain('secret-host');
      } finally {
        warn.mockRestore();
        jest.useRealTimers();
      }
    });
  });
});

describe('CommitteeTransferNoticeService.run (ACC-297), in-process', () => {
  it("tells each committee's chair, secretary and unit head, the cover INSTEAD of the head, once each", async () => {
    const { service, written } = build(baseWorld());
    await expect(service.run(JOB)).resolves.toBe(4);
    expect(written.map((r) => r.userId).sort()).toEqual(['chair', 'cover-safety', 'head-quality', 'secretary']);
    // The cover in force on Safety's unit is told; its head is not.
    expect(written.find((r) => r.userId === 'head-safety')).toBeUndefined();
  });

  it('deduplicates across committees: the chair of both gets ONE notice listing both, in order', async () => {
    const { service, written, row } = build(baseWorld());
    await service.run(JOB);
    expect(written.filter((r) => r.userId === 'chair')).toHaveLength(1);
    const body = row('chair').bodyEn;
    expect(body.indexOf('Quality Council: still holds Member.')).toBeGreaterThan(-1);
    expect(body.indexOf('Safety Committee: was removed from Secretary')).toBeGreaterThan(body.indexOf('Quality Council'));
  });

  it('never tells the transferred person or the actor, even holding a seat or the headship', async () => {
    const world = baseWorld();
    world.officers.push({ committeeId: QUALITY.id, userId: PERSON }, { committeeId: QUALITY.id, userId: ACTOR });
    world.heads = [{ id: ACTOR, primaryOrgUnitId: 'u-quality' }];
    world.viewers.push(ACTOR, PERSON);
    const { service, written } = build(world);
    await service.run(JOB);
    expect(written.map((r) => r.userId)).not.toContain(PERSON);
    expect(written.map((r) => r.userId)).not.toContain(ACTOR);
  });

  it('a recipient who is not ACTIVE is told nothing', async () => {
    const world = baseWorld();
    world.inactive = ['secretary', 'cover-safety'];
    const { service, written } = build(world);
    await service.run(JOB);
    expect(written.map((r) => r.userId).sort()).toEqual(['chair', 'head-quality']);
  });

  describe('the removed wordings, and still-holds', () => {
    const withLeft = (approvedBy: string | null, reason: string | null) => {
      const world = baseWorld();
      world.left = [{ ...world.left[0]!, approvedBy, reason }];
      return world;
    };

    it('removed by the transfer actor: "as part of the transfer to {new unit}", and the stored reason is NOT quoted', async () => {
      const { service, row } = build(withLeft(ACTOR, 'Transferred to Pharmacy (admin wording)'));
      await service.run(JOB);
      expect(row('chair').bodyEn).toContain('Safety Committee: was removed from Secretary as part of the transfer to Pharmacy.');
      expect(row('chair').bodyEn).not.toContain('admin wording');
      expect(row('chair').bodyAr).toContain('«لجنة السلامة»: أُنهيت العضوية بصفة «أمين السر» ضمن النقل إلى «الصيدلية».');
    });

    it('removed by someone else with a reason: quoted as written', async () => {
      const { service, row } = build(withLeft('someone-else', 'Left for the night roster'));
      await service.run(JOB);
      expect(row('chair').bodyEn).toContain('Safety Committee: was removed from Secretary. Reason given: "Left for the night roster".');
      expect(row('chair').bodyAr).toContain('السبب المذكور: «Left for the night roster».');
    });

    it('removed by someone else with no reason: "no reason was given"', async () => {
      const { service, row } = build(withLeft('someone-else', null));
      await service.run(JOB);
      expect(row('chair').bodyEn).toContain('Safety Committee: was removed from Secretary; no reason was given.');
      expect(row('chair').bodyAr).toContain('«لجنة السلامة»: أُنهيت العضوية بصفة «أمين السر» دون ذكر سبب.');
    });

    it('still holds: the seat held now', async () => {
      const { service, row } = build(baseWorld());
      await service.run(JOB);
      expect(row('chair').bodyEn).toContain('Quality Council: still holds Member.');
    });

    it('a seat held now wins over an earlier removal from the same committee (removed, then added back)', async () => {
      const world = baseWorld();
      world.left = [{ committeeId: QUALITY.id, roleValueId: 'seat-member', reason: null, approvedBy: 'someone-else', committee: { nameEn: QUALITY.nameEn, nameAr: QUALITY.nameAr, orgUnitId: QUALITY.orgUnitId } }];
      const { service, row } = build(world);
      await service.run(JOB);
      expect(row('chair').bodyEn).toContain('Quality Council: still holds Member.');
      expect(row('chair').bodyEn).not.toContain('was removed');
    });
  });

  it("each reader's notice is stored in both languages, and the reader sees their own", async () => {
    const { service, row } = build(baseWorld());
    await service.run(JOB);
    const r = row('chair');
    expect(r.titleEn).toBe('Sara Al-Mutairi was transferred to Pharmacy');
    expect(r.titleAr).toBe('تم نقل Sara Al-Mutairi إلى «الصيدلية»');
    expect(r.bodyAr).toContain('«مجلس الجودة»: ما زالت العضوية بصفة «عضو» قائمة.');
    expect(r.bodyAr).toContain('تتيح صلاحية «إزالة أعضاء من اللجنة» إزالة المقعد.');
  });

  describe("a committee's name and link: only for a reader who may open it", () => {
    it('committees:view: every name, and a link to the first committee listed', async () => {
      const { service, row } = build(baseWorld());
      await service.run(JOB);
      expect(row('chair').bodyEn).toContain('Quality Council');
      expect(row('chair').bodyEn).toContain('Safety Committee');
      expect([row('chair').objectType, row('chair').objectId]).toEqual(['COMMITTEE', QUALITY.id]);
    });

    it("an active member of that committee: its name and its link", async () => {
      const { service, row } = build(baseWorld());
      await service.run(JOB);
      expect(row('head-quality').bodyEn).toContain('Quality Council: still holds Member.');
      expect([row('head-quality').objectType, row('head-quality').objectId]).toEqual(['COMMITTEE', QUALITY.id]);
    });

    it('anyone else: "a committee", no name in either language, and no link', async () => {
      const { service, row } = build(baseWorld());
      await service.run(JOB);
      const r = row('cover-safety');
      expect(r.bodyEn).toContain('A committee: was removed from Secretary');
      expect(r.bodyEn).not.toContain('Safety Committee');
      expect(r.bodyAr).not.toContain('لجنة السلامة');
      expect([r.objectType, r.objectId]).toEqual([null, null]);
    });
  });

  it('with no lines at all (no seat now, nothing removed since the transfer), nothing is sent and nothing more is read', async () => {
    const world = baseWorld();
    world.held = [];
    world.left = [];
    const { service, notifications, prisma } = build(world);
    await expect(service.run(JOB)).resolves.toBe(0);
    expect(notifications.createInAppMany).not.toHaveBeenCalled();
    expect(prisma.userRole.findMany).not.toHaveBeenCalled();
    expect(prisma.orgUnitHeadAssignment.findMany).not.toHaveBeenCalled();
  });

  it("reads only the removals made at or after the transfer's start (`since`)", async () => {
    const { service, prisma } = build(baseWorld());
    await service.run(JOB);
    const where = (prisma.committeeMembershipEvent.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where).toMatchObject({ organizationId: ORG, userId: PERSON, action: 'LEFT', createdAt: { gte: new Date(SINCE) } });
  });

  it('writes once, for every reader, after all the reads', async () => {
    const { service, notifications } = build(baseWorld());
    await service.run(JOB);
    expect(notifications.createInAppMany).toHaveBeenCalledTimes(1);
    expect(notifications.createInAppMany).toHaveBeenCalledWith(expect.any(Array), ORG, 'committee-transfer-notice');
  });

  it('should NOT return records belonging to a different tenant', async () => {
    // Every read is scoped by the job's organisation, so another organisation's
    // seats, removals, heads, covers and people are never read.
    const { service, prisma, lookups, notifications } = build(baseWorld());
    await service.run(JOB);
    const wheres = (mock: jest.Mock) => (mock.mock.calls as [{ where: Record<string, unknown> }][]).map(([args]) => args.where);
    for (const where of [
      ...wheres(prisma.committeeMember.findMany),
      ...wheres(prisma.committeeMember.count),
      ...wheres(prisma.committeeMembershipEvent.findMany),
      ...wheres(prisma.user.findFirst),
      ...wheres(prisma.user.findMany),
      ...wheres(prisma.orgUnitHeadAssignment.findMany),
    ]) {
      expect(where['organizationId']).toBe(ORG);
    }
    for (const where of wheres(prisma.userRole.findMany)) expect((where['role'] as { organizationId: string }).organizationId).toBe(ORG);
    // The committee behind a seat or a removal is scoped too.
    expect((wheres(prisma.committeeMembershipEvent.findMany)[0]!['committee'] as { organizationId: string }).organizationId).toBe(ORG);
    expect(lookups.getValues).toHaveBeenCalledWith('committee_member_role', ORG);
    expect(notifications.createInAppMany.mock.calls[0]![1]).toBe(ORG);

    // A person who is not in this organisation (another tenant's id): nothing is read past the person, nothing sent.
    const other = build(baseWorld());
    other.prisma.user.findFirst.mockResolvedValue(null as never);
    await expect(other.service.run({ ...JOB, userId: 'org-b-person' })).resolves.toBe(0);
    expect(other.notifications.createInAppMany).not.toHaveBeenCalled();
    expect(other.prisma.userRole.findMany).not.toHaveBeenCalled();
  });
});
