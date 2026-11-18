import { NotFoundException } from '@nestjs/common';
import { MeetingsService } from './meetings.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import type { WorkflowService } from '../workflow/workflow.service';
import type { StageRulesService } from '../workflow/stage-rules.service';
import type { NotificationService } from '../notification/notification.service';
import type { WorkingCalendarService } from '../working-calendar/working-calendar.service';

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
