/**
 * ACC-316 PR 2 — who may schedule, record and approve a meeting
 * (meeting-authority.ts), and the stage pools that read it, against a REAL
 * Postgres (npm run test:db). Plan: backend/Plans/step-316-meeting-management.md
 * §3.8 and §4.2.
 *
 * The organisation: Root → Clinical (C) → Ward (G), a committee owned by
 * Clinical, a committee meeting, and a unit meeting each for Clinical and Ward.
 *
 * Only a database proves the three predicates, each batched:
 *   - SCHEDULERS: a committee seat with schedule_meeting; meetings:schedule held
 *     by a person of the owning unit (a committee's unit too); a head or acting
 *     head of the owning unit or a unit above holding schedule_subunits;
 *   - RECORDERS: a committee seat with record_minutes; meetings:record_minutes
 *     in the unit — never for a committee meeting;
 *   - APPROVERS: nobody for a committee meeting; approve_minutes in the unit,
 *     or a head above holding approve_subunits;
 *   - only ACTIVE people holding the key through an ACTIVE role of THIS
 *     organisation count, and a key held in another unit does not;
 *   - the stage pool resolves the kinds for a meeting, and to nobody for any
 *     other record;
 *   - another organisation's meeting, role or people never appear.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a
 * database, and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { LookupService } from '../lookup/lookup.service';
import { MEETINGS_PERMISSIONS } from '../../common/constants/permissions';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { copyDefaultSeatActions } from '../committees/seat-actions';
import { resolveMeetingStageKinds, MEETING_STAGE_KINDS, type MeetingStageKind } from './meeting-authority';
import { StagePoolService } from './stage-pool.service';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(180_000);

describe('Meeting authority against a real database (ACC-316)', () => {
  const prisma = new PrismaService();
  const lookups = new LookupService(prisma, new AuditLogService(prisma));
  const pools = new StagePoolService(prisma);
  let seat: Record<string, string> = {};
  let meetingType = '';

  interface World {
    orgId: string;
    units: { root: string; clinical: string; ward: string };
    people: Record<string, string>;
    committeeId: string;
    meetings: { committee: string; clinical: string; ward: string };
  }

  async function permissionId(key: string): Promise<string> {
    const [module, action] = key.split(':') as [string, string];
    return (await prisma.permission.upsert({ where: { module_action: { module, action } }, create: { module, action }, update: {} })).id;
  }

  async function role(orgId: string, keys: string[], isActive = true): Promise<string> {
    const ids = await Promise.all(keys.map(permissionId));
    const r = await prisma.role.create({
      data: { organizationId: orgId, nameEn: `Role ${randomUUID().slice(0, 6)}`, isActive, rolePermissions: { create: ids.map((permissionId) => ({ permissionId })) } },
    });
    return r.id;
  }

  async function world(): Promise<World> {
    const slug = `acc316-${randomUUID().slice(0, 8)}`;
    const o = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    const unit = (nameEn: string, parentId?: string) =>
      prisma.orgUnit.create({ data: { organizationId: o.id, nameEn, code: `${nameEn}-${slug}`, ...(parentId && { parentId }) } });
    const root = await unit('Root');
    const clinical = await unit('Clinical', root.id);
    const ward = await unit('Ward', clinical.id);
    const headPosition = await prisma.orgPosition.create({ data: { organizationId: o.id, nameEn: `Head ${slug}`, grade: 1, isUnitHeadPosition: true } });

    const person = async (name: string, primaryOrgUnitId: string, extra: Record<string, unknown> = {}) =>
      (
        await prisma.user.create({
          data: { organizationId: o.id, email: `${name}-${slug}@example.test`, name, status: 'ACTIVE', primaryOrgUnitId, ...extra },
        })
      ).id;
    const grant = (userId: string, roleId: string) => prisma.userRole.create({ data: { userId, roleId } });

    const people: Record<string, string> = {
      rootHead: await person('rootHead', root.id, { positionId: headPosition.id }),
      clinicalScheduler: await person('clinicalScheduler', clinical.id),
      clinicalRecorder: await person('clinicalRecorder', clinical.id),
      clinicalApprover: await person('clinicalApprover', clinical.id),
      wardScheduler: await person('wardScheduler', ward.id),
      inactiveScheduler: await person('inactiveScheduler', clinical.id, { status: 'INACTIVE' }),
      inactiveRoleScheduler: await person('inactiveRoleScheduler', clinical.id),
      clinicalCover: await person('clinicalCover', ward.id),
      chair: await person('chair', clinical.id),
      secretary: await person('secretary', clinical.id),
      member: await person('member', clinical.id),
    };

    await grant(people['rootHead']!, await role(o.id, [MEETINGS_PERMISSIONS.SCHEDULE_SUBUNITS, MEETINGS_PERMISSIONS.APPROVE_SUBUNITS]));
    await grant(people['clinicalScheduler']!, await role(o.id, [MEETINGS_PERMISSIONS.SCHEDULE]));
    await grant(people['clinicalRecorder']!, await role(o.id, [MEETINGS_PERMISSIONS.RECORD_MINUTES]));
    await grant(people['clinicalApprover']!, await role(o.id, [MEETINGS_PERMISSIONS.APPROVE_MINUTES]));
    await grant(people['wardScheduler']!, await role(o.id, [MEETINGS_PERMISSIONS.SCHEDULE]));
    await grant(people['inactiveScheduler']!, await role(o.id, [MEETINGS_PERMISSIONS.SCHEDULE]));
    await grant(people['inactiveRoleScheduler']!, await role(o.id, [MEETINGS_PERMISSIONS.SCHEDULE], false));
    // An acting head of Clinical who holds only the scheduling key.
    await grant(people['clinicalCover']!, await role(o.id, [MEETINGS_PERMISSIONS.SCHEDULE_SUBUNITS]));
    await prisma.orgUnitHeadAssignment.create({
      data: {
        organizationId: o.id,
        orgUnitId: clinical.id,
        userId: people['clinicalCover']!,
        kind: 'ACTING',
        reason: 'VACANCY',
        validFrom: new Date(Date.now() - 86_400_000),
        createdById: people['rootHead']!,
      },
    });

    const committee = await prisma.committee.create({ data: { organizationId: o.id, nameEn: 'Quality Council', typeValueId: 'type', orgUnitId: clinical.id } });
    for (const [key, userId] of [
      ['chairman', people['chair']!],
      ['secretary', people['secretary']!],
      ['member', people['member']!],
    ] as const) {
      await prisma.committeeMember.create({ data: { organizationId: o.id, committeeId: committee.id, userId, roleValueId: seat[key]! } });
    }
    // The organisation's defaults: Chairman schedules; Secretary schedules and records.
    await prisma.$transaction((tx) => copyDefaultSeatActions(tx, o.id, committee.id));

    const meeting = (data: { committeeId?: string; orgUnitId?: string }) =>
      prisma.meeting.create({
        data: { organizationId: o.id, organizerId: people['rootHead']!, title: 'Monthly', typeValueId: meetingType, scheduledAt: new Date(), ...data },
      });
    const meetings = {
      committee: (await meeting({ committeeId: committee.id })).id,
      clinical: (await meeting({ orgUnitId: clinical.id })).id,
      ward: (await meeting({ orgUnitId: ward.id })).id,
    };
    return { orgId: o.id, units: { root: root.id, clinical: clinical.id, ward: ward.id }, people, committeeId: committee.id, meetings };
  }

  const all = new Set<MeetingStageKind>(MEETING_STAGE_KINDS);
  const names = (w: World, ids: readonly string[] | undefined): string[] =>
    (ids ?? []).map((id) => Object.entries(w.people).find(([, v]) => v === id)?.[0] ?? `OTHER:${id}`).sort();

  let a: World;
  let b: World;

  beforeAll(async () => {
    await prisma.onModuleInit();
    await lookups.seedSystemData();
    const seats = await prisma.lookupValue.findMany({
      where: { organizationId: null, category: { key: 'committee_member_role', organizationId: null } },
      select: { id: true, key: true },
    });
    seat = Object.fromEntries(seats.map((s) => [s.key, s.id]));
    meetingType = (await prisma.lookupValue.findFirstOrThrow({ where: { organizationId: null, category: { key: 'meeting_type', organizationId: null } } })).id;
    a = await world();
    b = await world();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('SCHEDULERS: the seats that schedule, the owning unit\'s key holders, and the heads above holding the sub-units key', async () => {
    const result = await resolveMeetingStageKinds(prisma, a.orgId, Object.values(a.meetings), all);
    const schedulers = result.get('MEETING_SCHEDULERS')!;
    // The committee is owned by Clinical: its seats, Clinical's key holder, the
    // acting head of Clinical and the head of Root (both with the sub-units key).
    expect(names(a, schedulers.get(a.meetings.committee))).toEqual(['chair', 'clinicalCover', 'clinicalScheduler', 'rootHead', 'secretary']);
    expect(names(a, schedulers.get(a.meetings.clinical))).toEqual(['clinicalCover', 'clinicalScheduler', 'rootHead']);
    // Ward is below Clinical: Ward's own key holder, and both heads above.
    expect(names(a, schedulers.get(a.meetings.ward))).toEqual(['clinicalCover', 'rootHead', 'wardScheduler']);
  });

  it('RECORDERS: the committee seat that records for a committee meeting, the unit\'s key holders for a unit meeting', async () => {
    const result = await resolveMeetingStageKinds(prisma, a.orgId, Object.values(a.meetings), all);
    const recorders = result.get('MEETING_RECORDERS')!;
    expect(names(a, recorders.get(a.meetings.committee))).toEqual(['secretary']);
    expect(names(a, recorders.get(a.meetings.clinical))).toEqual(['clinicalRecorder']);
    expect(names(a, recorders.get(a.meetings.ward))).toEqual([]);
  });

  it("APPROVERS: nobody for a committee meeting (the Chair's seat is on the stage); the unit's key holders and the heads above", async () => {
    const result = await resolveMeetingStageKinds(prisma, a.orgId, Object.values(a.meetings), all);
    const approvers = result.get('MEETING_APPROVERS')!;
    expect(approvers.get(a.meetings.committee)).toEqual([]);
    // The acting head of Clinical holds only the scheduling key, so is not here.
    expect(names(a, approvers.get(a.meetings.clinical))).toEqual(['clinicalApprover', 'rootHead']);
    expect(names(a, approvers.get(a.meetings.ward))).toEqual(['rootHead']);
  });

  it('fails closed: an inactive person, an inactive role and a key held in another unit never count', async () => {
    const result = await resolveMeetingStageKinds(prisma, a.orgId, Object.values(a.meetings), all);
    const everyone = new Set([...result.values()].flatMap((m) => [...m.values()].flat()));
    expect(everyone.has(a.people['inactiveScheduler']!)).toBe(false);
    expect(everyone.has(a.people['inactiveRoleScheduler']!)).toBe(false);
    expect(result.get('MEETING_SCHEDULERS')!.get(a.meetings.clinical)).not.toContain(a.people['wardScheduler']);
    // Only the kinds asked are answered.
    const one = await resolveMeetingStageKinds(prisma, a.orgId, [a.meetings.clinical], new Set<MeetingStageKind>(['MEETING_RECORDERS']));
    expect([...one.keys()]).toEqual(['MEETING_RECORDERS']);
  });

  it('the stage pool resolves the kinds for a meeting, and to nobody for a record that is not a meeting', async () => {
    const template = await prisma.workflowTemplate.create({ data: { organizationId: a.orgId, nameEn: 'Meetings (spec)', objectType: 'MEETING' } });
    const stage = await prisma.workflowStage.create({
      data: {
        workflowTemplateId: template.id,
        nameEn: 'Minutes Review (spec)',
        order: 40,
        whoMode: 'ANY_ONE',
        assignees: {
          create: [
            { organizationId: a.orgId, order: 1, kind: 'COMMITTEE', committeeRoleValueId: seat['chairman']! },
            { organizationId: a.orgId, order: 2, kind: 'MEETING_APPROVERS' },
          ],
        },
      },
    });
    const result = await pools.resolveMany(a.orgId, [
      { key: 'committee', stageId: stage.id, instance: { id: 'i-1', objectType: 'MEETING', objectId: a.meetings.committee } },
      { key: 'unit', stageId: stage.id, instance: { id: 'i-2', objectType: 'MEETING', objectId: a.meetings.clinical } },
      { key: 'notMeeting', stageId: stage.id, instance: { id: 'i-3', objectType: 'COMMITTEE', objectId: a.committeeId } },
    ]);
    // A committee meeting: its Chair (the seat entry, the meeting's committee).
    expect(names(a, result.get('committee')!.members)).toEqual(['chair']);
    // A unit meeting: no committee, so its approvers.
    expect(names(a, result.get('unit')!.members)).toEqual(['clinicalApprover', 'rootHead']);
    // A committee record: the seat entry reads ITS committee, the meeting kind nobody.
    expect(names(a, result.get('notMeeting')!.members)).toEqual(['chair']);
  });

  itEnforcesTenantIsolation("meeting authority — another organisation's meeting answers nobody, and its roles and people never count", async () => {
    // B's meetings asked in A's organisation: not found, so absent.
    const asked = await resolveMeetingStageKinds(prisma, a.orgId, Object.values(b.meetings), all);
    for (const kind of MEETING_STAGE_KINDS) expect(asked.get(kind)!.size).toBe(0);

    // An A person given B's scheduling role gains nothing in A.
    const outsider = await prisma.user.create({
      data: { organizationId: a.orgId, email: `outsider-${randomUUID().slice(0, 6)}@example.test`, name: 'Outsider', status: 'ACTIVE', primaryOrgUnitId: a.units.clinical },
    });
    await prisma.userRole.create({ data: { userId: outsider.id, roleId: await role(b.orgId, [MEETINGS_PERMISSIONS.SCHEDULE]) } });
    const result = await resolveMeetingStageKinds(prisma, a.orgId, Object.values(a.meetings), all);
    const everyone = new Set([...result.values()].flatMap((m) => [...m.values()].flat()));
    expect(everyone.has(outsider.id)).toBe(false);
    for (const id of Object.values(b.people)) expect(everyone.has(id)).toBe(false);
  });
});
