import { SetupConditionDetectors } from './setup-condition.detectors';
import { PrismaService } from '../../prisma/prisma.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';

/**
 * ACC-271 PR 3 (plan §9) — STAGE_ON_STARTING_ASSIGNMENT's detector. The query
 * is raw SQL (the assignee row names its user only by id), so this spec pins
 * the shape and what is bound; workflow/stage-who.db-spec.ts runs it against
 * a real database, two organisations included.
 */
describe('SetupConditionDetectors.stagesOnStartingAssignment (ACC-271 PR 3)', () => {
  const ORG_A = 'org-a';
  let queryRaw: jest.Mock;
  let detectors: SetupConditionDetectors;

  beforeEach(() => {
    queryRaw = jest.fn().mockResolvedValue([]);
    detectors = new SetupConditionDetectors({ $queryRaw: queryRaw } as unknown as PrismaService);
  });

  it('reads in ONE query, and maps each stage to an AT_RISK condition with what the row needs', async () => {
    const since = new Date('2026-10-28T09:00:00Z');
    queryRaw.mockResolvedValue([
      {
        stageId: 'stage-1',
        stageNameEn: 'Terms Review',
        stageNameAr: 'مراجعة الشروط',
        templateId: 'template-1',
        templateNameEn: 'Committee Management',
        templateNameAr: 'إدارة اللجان',
        adminName: 'Hessa',
        since,
      },
    ]);

    const found = await detectors.stagesOnStartingAssignment(ORG_A);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(found).toEqual([
      {
        objectId: 'stage-1',
        severity: 'AT_RISK',
        openedAt: since,
        subject: {
          nameEn: 'Terms Review',
          nameAr: 'مراجعة الشروط',
          templateId: 'template-1',
          templateNameEn: 'Committee Management',
          templateNameAr: 'إدارة اللجان',
          adminName: 'Hessa',
        },
      },
    ]);
  });

  itEnforcesTenantIsolation('stagesOnStartingAssignment binds only the organisation, on every table it reads', async () => {
    await detectors.stagesOnStartingAssignment(ORG_A);
    const [strings, ...values] = queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    const sql = strings.join('?');
    // The template, the user and the assignee are each scoped by organisation…
    expect(sql).toMatch(/t\."organizationId" = \?/);
    expect(sql).toMatch(/u\."organizationId" = \?/);
    expect(sql).toMatch(/a\."organizationId" = \?/);
    // …and every value bound is this organisation's id.
    expect(values).toEqual([ORG_A, ORG_A, ORG_A]);
    // Only starting entries, on active workflows.
    expect(sql).toMatch(/a\."isStartingAssignment" = true/);
    expect(sql).toMatch(/t\."isActive" = true/);
  });
});
