import { PrismaService } from '../../prisma/prisma.service';
import { committeeStagesAndCounts } from './committee-stage-counts';

// ACC-255 — every committee response that names a committee's stage (the
// committees list, the record, Sub-committees and the org unit's committees)
// gets it from this one helper, so the helper is where "no response carries a
// stage key" is held: it neither reads the key nor returns it. What a stage
// means is its flags (isDissolving, isInForce); a key in a response is a rule
// waiting to be copied.
describe('committeeStagesAndCounts — no stage key (ACC-255)', () => {
  const prisma = {
    committeeMember: { groupBy: jest.fn() },
    workflowInstance: { findMany: jest.fn() },
    workflowStage: { findMany: jest.fn() },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.committeeMember.groupBy.mockResolvedValue([{ committeeId: 'c-1', _count: { committeeId: 4 } }]);
    prisma.workflowInstance.findMany.mockResolvedValue([{ objectId: 'c-1', currentStageId: 'st-dp' }]);
    // A stage row that still has a key, as every seeded committee stage does.
    prisma.workflowStage.findMany.mockResolvedValue([
      { id: 'st-dp', nameEn: 'Dissolution Pending', nameAr: 'قيد الحل', key: 'dissolution_pending', flags: ['DISSOLVING'] },
    ]);
  });

  it('reads no stage key, and returns exactly the name, the flags and the member count', async () => {
    const facts = await committeeStagesAndCounts(prisma as unknown as PrismaService, 'org-a', ['c-1']);

    expect(prisma.workflowStage.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['st-dp'] }, workflowTemplate: { organizationId: 'org-a' } },
      select: { id: true, nameEn: true, nameAr: true, flags: true },
    });
    const fact = facts.get('c-1')!;
    // Non-vacuity: the stage was read — its name and its flag reached the result.
    expect(fact).toEqual({
      memberCount: 4,
      stageNameEn: 'Dissolution Pending',
      stageNameAr: 'قيد الحل',
      isDissolving: true,
      isInForce: false,
    });
    expect(JSON.stringify([...facts.values()])).not.toContain('dissolution_pending');
  });
});
