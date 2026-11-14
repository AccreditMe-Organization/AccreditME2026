import { DateTime } from 'luxon';
import { PrismaService } from '../../../prisma/prisma.service';
import { ObjectVisibilityService, recordTypesVisibleTo } from '../../../common/services/object-visibility.service';
import { WorkingCalendarService } from '../../working-calendar/working-calendar.service';
import { AiService } from '../../ai/ai.service';
import { TaskAssignmentService } from '../task-assignment.service';
import { IAssignableHolder } from '../interfaces/task-assignment.interface';
import { WorkloadHintDto } from '../dto/workload-hint.dto';
import { TaskVisibilityService } from '../task-visibility.service';
import type { TaskVisibilityContext } from '../task-visibility';
import { typesHolding } from '../task-record-types';
import { IWorkloadPerson, TaskWorkloadService, canSuggestFor } from './task-workload.service';
import { WorkloadHintService } from './workload-hint.service';

/**
 * ACC-302 (Ahmad, 14 Nov, Q6) — "✦ Suggest someone" never offers, or answers,
 * for a person a new task would not reach: someone covered hands it to their
 * cover. Their picker row says canSuggest: false (the screen hides the
 * button), and suggest() refuses them with WORKLOAD_NO_SUGGESTION before any
 * call or charge. The threshold's own cases stay in task-workload.service.spec.ts.
 */

const ORG = 'org-a';
const holder = (id: string, cover: IAssignableHolder['cover'] = null): IAssignableHolder => ({
  id,
  name: id,
  positionNameEn: 'Quality Officer',
  positionNameAr: null,
  workload: null,
  cover,
});
const person = (h: IAssignableHolder, open: number, outOfOffice = false): IWorkloadPerson => ({
  holder: h,
  workload: { open, overdue: 0, dueSoon: 0, urgent: 0, onHold: 0 },
  outOfOffice,
});
const COVER = { userId: 'cover', name: 'The Cover' };

describe('canSuggestFor and a covered person (ACC-302)', () => {
  it('is false for someone covered, however far past the threshold', () => {
    const nora = person(holder('nora', COVER), 12, true);
    const everyone = [nora, person(holder('sara'), 4), person(holder('khalid'), 7)];
    expect(canSuggestFor(nora, everyone)).toBe(false);
  });

  it('is unchanged for someone not covered (the same counts suggest)', () => {
    const nora = person(holder('nora'), 12);
    expect(canSuggestFor(nora, [nora, person(holder('sara'), 4), person(holder('khalid'), 7)])).toBe(true);
  });
});

describe('WorkloadHintService.suggest for a covered person (ACC-302)', () => {
  const VIEWER = { id: 'assigner', permissions: ['committees:create_tasks', 'committees:view_all_tasks', 'committees:view'] };
  const DTO: WorkloadHintDto = {
    orgUnitId: 'unit-cardio',
    positionId: 'pos-qo',
    chosenUserId: 'nora',
    sourceType: 'COMMITTEE',
    sourceId: 'cmt-1',
    priority: 'HIGH',
  };

  it('refuses WORKLOAD_NO_SUGGESTION before any call, so nothing is charged', async () => {
    const counts: Record<string, number> = { nora: 12, sara: 4, khalid: 7 };
    const rows = Object.entries(counts).flatMap(([userId, n]) =>
      Array.from({ length: n }, () => ({ userId, task: { status: 'PENDING', dueAt: null, priority: 'MEDIUM' } })),
    );
    const prisma = {
      committeeMember: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
      committee: { findFirst: jest.fn().mockResolvedValue({ id: 'cmt-1' }) },
      meeting: { findFirst: jest.fn().mockResolvedValue(null) },
      taskAssignee: { findMany: jest.fn().mockResolvedValue(rows) },
      user: { findMany: jest.fn().mockResolvedValue(['nora', 'sara', 'khalid'].map((id) => ({ id, outOfOfficeFrom: null, outOfOfficeTo: null }))) },
    };
    const holders = [holder('nora', COVER), holder('sara'), holder('khalid')];
    const assignment = { listHolders: jest.fn().mockResolvedValue(holders), listCommitteeMembers: jest.fn().mockResolvedValue(holders) };
    const ruleStub = {
      contextFor: async (v: { id: string; permissions: readonly string[] }) =>
        ({ viewerId: v.id, recordTypes: recordTypesVisibleTo(v.permissions), viewAllTypes: typesHolding(v.permissions, 'VIEW_ALL'), unitScope: [] }) as unknown as TaskVisibilityContext,
      seesWholeRecord: async (ctx: TaskVisibilityContext, type: string) => ctx.viewAllTypes.includes(type),
    };
    const workingCalendar = {
      getOrCreate: jest.fn().mockResolvedValue({ workingHoursStart: '08:00', workingHoursEnd: '16:00' }),
      calculateDeadline: jest.fn().mockResolvedValue(DateTime.fromISO('2099-01-01T00:00:00Z')),
    };
    const ai = { run: jest.fn() };
    const db = prisma as unknown as PrismaService;
    const workload = new TaskWorkloadService(
      db,
      assignment as unknown as TaskAssignmentService,
      new ObjectVisibilityService(db),
      workingCalendar as unknown as WorkingCalendarService,
      ruleStub as unknown as TaskVisibilityService,
    );
    const service = new WorkloadHintService(db, ai as unknown as AiService, workload);

    await expect(service.suggest(VIEWER, ORG, DTO)).rejects.toMatchObject({ response: { code: 'WORKLOAD_NO_SUGGESTION' } });
    expect(ai.run).not.toHaveBeenCalled();
  });
});
