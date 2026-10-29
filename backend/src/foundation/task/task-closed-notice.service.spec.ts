import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { TaskClosedNoticeService } from './task-closed-notice.service';

// ACC-271 PR 4 — who is told, what they read, and that one move is one batch.

const ORG = 'org-a';
const NOW = Date.now();
const DAY = 86_400_000;

interface Person {
  id: string;
  organizationId?: string;
  name?: string;
  status?: string;
  outOfOfficeFrom?: Date | null;
  outOfOfficeTo?: Date | null;
  actingUserId?: string | null;
}

function setup(people: Person[], viewers: string[] = []) {
  const rows = people.map((p) => ({ organizationId: ORG, name: p.id, status: 'ACTIVE', outOfOfficeFrom: null, outOfOfficeTo: null, actingUserId: null, ...p }));
  const prisma = {
    user: {
      findMany: jest.fn(async ({ where }: { where: { organizationId: string; id: { in: string[] } } }) =>
        rows
          .filter((r) => r.organizationId === where.organizationId && where.id.in.includes(r.id))
          .map((r) => {
            const acting = rows.find((a) => a.id === r.actingUserId);
            return { ...r, actingUser: acting ? { status: acting.status, organizationId: acting.organizationId } : null };
          }),
      ),
    },
    committee: { findFirst: jest.fn(async ({ where }: { where: { organizationId: string } }) => (where.organizationId === ORG ? { nameEn: 'Quality Committee', nameAr: 'لجنة الجودة' } : null)) },
    committeeChangeRequest: {
      findFirst: jest.fn(async () => ({ committeeId: 'c-1', committee: { nameEn: 'Quality Committee', nameAr: 'لجنة الجودة' } })),
    },
    meeting: { findFirst: jest.fn(async () => null) },
    userRole: {
      findMany: jest.fn(async ({ where }: { where: { userId: { in: string[] } } }) =>
        viewers.filter((v) => where.userId.in.includes(v)).map((userId) => ({ userId })),
      ),
    },
  };
  const notifications = { createInAppMany: jest.fn(async (r: unknown[]) => r.length) };
  const service = new TaskClosedNoticeService(prisma as unknown as PrismaService, notifications as unknown as NotificationService);
  const written = () => (notifications.createInAppMany.mock.calls[0]?.[0] ?? []) as { userId: string; titleEn: string; titleAr: string; objectType: string | null; objectId: string | null }[];
  return { prisma, notifications, service, written };
}

const move = (closed: { id: string; assigneeUserIds: string[] }[], kind: 'ADVANCE' | 'RETURN' | 'EXIT' = 'RETURN') => ({
  kind,
  record: { objectType: 'COMMITTEE', objectId: 'c-1' },
  toStage: { nameEn: 'Formation', nameAr: 'التكوين' },
  transition: { labelEn: 'Revise Terms', labelAr: 'مراجعة النظام' },
  closed: closed.map((c) => ({ title: `Task ${c.id}`, titleAr: null, ...c })),
});

describe('TaskClosedNoticeService (ACC-271 PR 4)', () => {
  it('tells everyone still on a closed task, never the actor, in ONE write for the move', async () => {
    const { service, notifications, written, prisma } = setup([{ id: 'actor' }, { id: 'nora' }, { id: 'omar' }], ['nora', 'omar']);

    const count = await service.afterStageExit(ORG, 'actor', move([{ id: 't1', assigneeUserIds: ['actor', 'nora'] }, { id: 't2', assigneeUserIds: ['omar'] }]));

    expect(count).toBe(2);
    expect(notifications.createInAppMany).toHaveBeenCalledTimes(1);
    expect(written().map((r) => r.userId)).toEqual(['nora', 'omar']);
    // Batched: one read of the people, one of who may open the record.
    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.userRole.findMany).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when only the actor was on the task', async () => {
    const { service, notifications } = setup([{ id: 'actor' }]);

    expect(await service.afterStageExit(ORG, 'actor', move([{ id: 't1', assigneeUserIds: ['actor'] }]))).toBe(0);
    expect(notifications.createInAppMany).not.toHaveBeenCalled();
  });

  it("tells an away member's ACTIVE acting user in their place, and nobody who is no longer ACTIVE", async () => {
    const away = { outOfOfficeFrom: new Date(NOW - DAY), outOfOfficeTo: new Date(NOW + DAY) };
    const { service, written } = setup(
      [
        { id: 'actor' },
        { id: 'away', ...away, actingUserId: 'stand-in' },
        { id: 'stand-in' },
        { id: 'left', status: 'INACTIVE' },
        { id: 'away-to-actor', ...away, actingUserId: 'actor' },
      ],
      [],
    );

    await service.afterStageExit(ORG, 'actor', move([{ id: 't1', assigneeUserIds: ['away', 'left', 'away-to-actor'] }]));

    // The acting user, once; the inactive person, never; an acting user who is the actor, never.
    expect(written().map((r) => r.userId)).toEqual(['stand-in']);
  });

  it("names the record and links it only for someone who may open it; the type and no link for anyone else", async () => {
    const { service, written } = setup([{ id: 'actor' }, { id: 'viewer' }, { id: 'outsider' }], ['viewer']);

    await service.afterStageExit(ORG, 'actor', move([{ id: 't1', assigneeUserIds: ['viewer', 'outsider'] }]));

    const [viewer, outsider] = written();
    expect(viewer).toMatchObject({ userId: 'viewer', objectType: 'COMMITTEE', objectId: 'c-1' });
    expect(viewer!.titleEn).toContain('Quality Committee');
    expect(viewer!.titleAr).toContain('«لجنة الجودة»');
    expect(outsider).toMatchObject({ userId: 'outsider', objectType: null, objectId: null });
    expect(outsider!.titleEn).toContain('The committee was sent back to Formation by actor.');
    expect(outsider!.titleEn).not.toContain('Quality Committee');
    expect(outsider!.titleAr).not.toContain('لجنة الجودة');
  });

  it.each([
    ['ADVANCE', 'so it moved to Formation'],
    ['RETURN', 'was sent back to Formation'],
    ['EXIT', 'was ended (Revise Terms)'],
  ] as const)('a %s gets its own wording', async (kind, fragment) => {
    const { service, written } = setup([{ id: 'actor' }, { id: 'nora' }], ['nora']);

    await service.afterStageExit(ORG, 'actor', move([{ id: 't1', assigneeUserIds: ['nora'] }], kind));

    expect(written()[0]!.titleEn).toContain(fragment);
  });

  it("a completion tells the others with the 4th wording, naming the actor who completed it", async () => {
    const { service, written } = setup([{ id: 'actor', name: 'Dr. Hessa' }, { id: 'nora' }], ['nora']);

    await service.afterCompletion(ORG, 'actor', { id: 't1', title: 'Check the terms', titleAr: null, sourceType: 'COMMITTEE', sourceId: 'c-1', assigneeUserIds: ['nora'] });

    expect(written()[0]!.titleEn).toBe('Your task "Check the terms" on Quality Committee is closed: Dr. Hessa completed it.');
  });

  it("a change request's notice names and opens its committee", async () => {
    const { service, written } = setup([{ id: 'actor' }, { id: 'nora' }], ['nora']);

    await service.afterStageExit(ORG, 'actor', { ...move([{ id: 't1', assigneeUserIds: ['nora'] }]), record: { objectType: 'COMMITTEE_CHANGE_REQUEST', objectId: 'r-1' } });

    expect(written()[0]).toMatchObject({ objectType: 'COMMITTEE', objectId: 'c-1' });
  });

  itEnforcesTenantIsolation("TaskClosedNoticeService — people, the record and permissions are read in the caller's organisation only", async () => {
    const { service, written, prisma } = setup([{ id: 'actor' }, { id: 'nora' }, { id: 'stranger', organizationId: 'org-b' }], ['nora', 'stranger']);

    await service.afterStageExit(ORG, 'actor', move([{ id: 't1', assigneeUserIds: ['nora', 'stranger'] }]));

    expect(written().map((r) => r.userId)).toEqual(['nora']);
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG }) }));
    expect(prisma.committee.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c-1', organizationId: ORG } }));
    expect(prisma.userRole.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ role: expect.objectContaining({ organizationId: ORG }) }) }),
    );
  });
});
