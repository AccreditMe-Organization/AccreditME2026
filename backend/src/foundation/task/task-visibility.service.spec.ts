import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { TaskAuthorityService } from './task-authority.service';
import { TaskVisibilityContext } from './task-visibility';
import { TaskVisibilityService } from './task-visibility.service';

/**
 * ACC-244 — TaskVisibilityService's own two queries. The rule itself is proved
 * on a real database (task-visibility.db-spec.ts); this pins that both reads
 * are scoped to the viewer's organisation, which CI's isolation gate runs.
 */
describe('TaskVisibilityService', () => {
  const ORG_A = 'org-a';
  const ctx: TaskVisibilityContext = {
    organizationId: ORG_A,
    viewerId: 'user-1',
    now: new Date('2026-10-20T08:00:00Z'),
    coveredCreatorIds: ['user-1'],
    pools: [],
    recordTypes: ['COMMITTEE'],
    viewAllTypes: ['COMMITTEE'],
    manageTypes: [],
    createTypes: [],
    unitScope: [],
    unitRoots: [],
  };

  function setup(rows: unknown[]) {
    const queryRaw = jest.fn((..._args: unknown[]) => Promise.resolve(rows));
    const service = new TaskVisibilityService({ $queryRaw: queryRaw } as unknown as PrismaService, {} as TaskAuthorityService);
    /** The bound values of the one query made. */
    const values = (): unknown[] => {
      const [strings, ...vals] = queryRaw.mock.calls[0]! as [TemplateStringsArray, ...unknown[]];
      return Prisma.sql(strings, ...vals).values;
    };
    return { service, values };
  }

  itEnforcesTenantIsolation('TaskVisibilityService.countVisible', async () => {
    const { service, values } = setup([{ n: BigInt(7) }]);
    expect(await service.countVisible(ctx)).toBe(7);
    // The organisation is bound as the count's own first condition.
    expect(values()[0]).toBe(ORG_A);
  });

  itEnforcesTenantIsolation('TaskVisibilityService.isVisible', async () => {
    const { service, values } = setup([{ ok: true }]);
    expect(await service.isVisible(ctx, 'task-1')).toBe(true);
    expect(values().slice(0, 2)).toEqual(['task-1', ORG_A]);
  });

  it('a count with no row reads as 0', async () => {
    const { service } = setup([]);
    expect(await service.countVisible(ctx)).toBe(0);
  });
});
