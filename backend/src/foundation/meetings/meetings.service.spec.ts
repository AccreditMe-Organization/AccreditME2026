import { NotFoundException } from '@nestjs/common';
import { MeetingsService } from './meetings.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import type { WorkflowService } from '../workflow/workflow.service';
import type { StageRulesService } from '../workflow/stage-rules.service';
import type { NotificationService } from '../notification/notification.service';
import type { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import type { StoredFileService } from '../file-storage/stored-file.service';
import type { AuditLogService } from '../../common/services/audit-log.service';
import { MeetingPeopleService } from './meeting-people.service';
import { MeetingAgendaService } from './meeting-agenda.service';
import { MeetingFilesService } from './meeting-files.service';
import { MeetingClashService } from './meeting-clash.service';
import { MeetingRefusal } from './meeting-refusal';

// The oversight read is meeting-membership's own (proved in meetings.db-spec.ts):
// here, nobody heads anything.
jest.mock('../../common/services/meeting-membership', () => ({
  ...jest.requireActual('../../common/services/meeting-membership'),
  meetingOversightUnitIds: jest.fn(async () => new Set<string>()),
}));

/**
 * ACC-316 PR 3a — the meeting reads and writes are scoped by organisation. The
 * behaviour is proved against a real Postgres in meetings.db-spec.ts; this file
 * pins the scoping where CI's tenant-isolation gate (a name match over the unit
 * suite) can see it.
 */
describe('MeetingsService — tenant scoping (ACC-316 PR 3a)', () => {
  const ORG_A = 'org-a';
  const ORG_B = 'org-b';
  const THEIRS = 'meeting-of-b';

  function build() {
    // Only org B's meeting exists: every read made with org A must miss it.
    const owned = (where: { id?: string; organizationId?: string }) => where.id === THEIRS && where.organizationId === ORG_B;
    const meeting = {
      findFirst: jest.fn(async ({ where }: { where: { id?: string; organizationId?: string } }) =>
        owned(where) ? { id: THEIRS, committeeId: null, orgUnitId: 'unit-b', committee: null } : null,
      ),
    };
    const queryRaw = jest.fn(async () => []);
    const prisma = { meeting, $queryRaw: queryRaw } as unknown as PrismaService;
    const visibility = {
      assertCanViewOrNotFound: jest.fn(async (_type: string, id: string, organizationId: string) => {
        if (!owned({ id, organizationId })) throw new NotFoundException('Meeting not found');
      }),
    } as unknown as ObjectVisibilityService;
    const service = new MeetingsService(
      prisma,
      visibility,
      {} as WorkflowService,
      {} as StageRulesService,
      {} as NotificationService,
      {} as WorkingCalendarService,
    );
    return { service, meeting, visibility, queryRaw };
  }

  const viewer = { id: 'viewer-a', permissions: ['meetings:view'] };

  itEnforcesTenantIsolation("MeetingsService.getForViewer — another organisation's meeting is not found", async () => {
    const { service, visibility, meeting } = build();
    await expect(service.getForViewer(THEIRS, ORG_A, viewer)).rejects.toThrow('Meeting not found');
    expect((visibility.assertCanViewOrNotFound as jest.Mock).mock.calls[0]?.[2]).toBe(ORG_A);
    expect(meeting.findFirst).not.toHaveBeenCalled();
  });

  itEnforcesTenantIsolation("MeetingsService.update and reschedule — another organisation's meeting is not found, and nothing is written", async () => {
    const { service, queryRaw } = build();
    await expect(service.update(THEIRS, { title: 'X' } as never, ORG_A, viewer)).rejects.toThrow('Meeting not found');
    await expect(
      service.reschedule(THEIRS, { scheduledAt: new Date(Date.UTC(2099, 0, 1)).toISOString(), reason: 'X' } as never, ORG_A, viewer, new Date(Date.UTC(2026, 10, 18))),
    ).rejects.toThrow('Meeting not found');
    expect(queryRaw).not.toHaveBeenCalled();
  });

  itEnforcesTenantIsolation('MeetingsService.list — every query binds the organisation', async () => {
    const { service, queryRaw } = build();
    await service.list({ view: 'all' } as never, ORG_A, viewer, new Date(Date.UTC(2026, 10, 18))).catch(() => undefined);
    const calls = (queryRaw as jest.Mock).mock.calls as unknown[][];
    const meetingQueries = calls.filter((c) => (c[0] as readonly string[]).join('?').includes('FROM "Meeting" m'));
    expect(meetingQueries.length).toBe(2);
    for (const c of meetingQueries) expect(c.slice(1).flatMap((v) => (v && typeof v === 'object' && 'values' in v ? (v as { values: unknown[] }).values : [v]))).toContain(ORG_A);
  });
});

/**
 * ACC-316 PR 3b — the people, agenda, files and clash routes: another
 * organisation's meeting is the same 404 at the first check, and nothing is
 * written or read past it. Proved against a real Postgres in meetings.db-spec.ts.
 */
describe('Meeting people, agenda, files and clashes — tenant scoping (ACC-316 PR 3b)', () => {
  const ORG_A = 'org-a';
  const ORG_B = 'org-b';
  const THEIRS = 'meeting-of-b';
  const viewer = { id: 'viewer-a', permissions: ['meetings:view'] };

  function build() {
    const owned = (where: { id?: string; organizationId?: string }) => where.id === THEIRS && where.organizationId === ORG_B;
    const prisma = {
      meeting: { findFirst: jest.fn(async ({ where }: { where: { id?: string; organizationId?: string } }) => (owned(where) ? { id: THEIRS } : null)) },
      committee: { findFirst: jest.fn(async ({ where }: { where: { id?: string; organizationId?: string } }) => (where.organizationId === ORG_B ? { id: where.id } : null)) },
      meetingAttendee: { create: jest.fn(), findMany: jest.fn(async () => []) },
      agendaItem: { findMany: jest.fn(async () => []) },
      storedFile: { findFirst: jest.fn(), findMany: jest.fn(async () => []) },
      $transaction: jest.fn(),
      $queryRaw: jest.fn(async () => []),
    };
    const visibility = {
      assertCanViewOrNotFound: jest.fn(async (_type: string, id: string, organizationId: string) => {
        if (!owned({ id, organizationId })) throw new NotFoundException('Meeting not found');
      }),
    } as unknown as ObjectVisibilityService;
    const p = prisma as unknown as PrismaService;
    return {
      prisma,
      people: new MeetingPeopleService(p, visibility, {} as StageRulesService, {} as NotificationService, {} as WorkingCalendarService),
      agenda: new MeetingAgendaService(p, visibility, {} as StageRulesService, {} as NotificationService, {} as WorkingCalendarService, {} as StoredFileService),
      files: new MeetingFilesService(p, visibility, {} as StageRulesService, {} as StoredFileService, {} as AuditLogService),
      clashes: new MeetingClashService(p, visibility),
    };
  }

  itEnforcesTenantIsolation("MeetingPeopleService — another organisation's meeting is not found, and no invitee is written", async () => {
    const { people, prisma } = build();
    await expect(people.attendees(THEIRS, ORG_A, viewer)).rejects.toThrow('Meeting not found');
    await expect(people.addGuest(THEIRS, { userId: 'person-a' } as never, ORG_A, viewer)).rejects.toThrow('Meeting not found');
    await expect(people.answer(THEIRS, { answer: 'ATTENDING' } as never, ORG_A, viewer)).rejects.toThrow('Meeting not found');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.meetingAttendee.create).not.toHaveBeenCalled();
  });

  itEnforcesTenantIsolation("MeetingAgendaService and MeetingFilesService — another organisation's meeting is not found, and no file is read", async () => {
    const { agenda, files, prisma } = build();
    await expect(agenda.list(THEIRS, ORG_A, viewer)).rejects.toThrow('Meeting not found');
    await expect(agenda.create(THEIRS, { title: 'X' } as never, ORG_A, viewer)).rejects.toThrow('Meeting not found');
    await expect(files.list(THEIRS, ORG_A, viewer)).rejects.toThrow('Meeting not found');
    await expect(files.openView(THEIRS, 'file-b', ORG_A, viewer)).rejects.toThrow('Meeting not found');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.storedFile.findFirst).not.toHaveBeenCalled();
  });

  itEnforcesTenantIsolation("MeetingClashService — another organisation's committee is not found, and no clash is read", async () => {
    const { clashes, prisma } = build();
    await expect(clashes.check({ committeeId: 'committee-b', times: [] } as never, ORG_A, viewer)).rejects.toThrow(MeetingRefusal);
    expect(prisma.committee.findFirst.mock.calls[0]?.[0]).toMatchObject({ where: { organizationId: ORG_A } });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
