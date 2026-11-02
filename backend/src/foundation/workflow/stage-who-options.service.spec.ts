import { StageWhoOptionsService } from './stage-who-options.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';

/**
 * ACC-271 PR 5a — the stage editor's person and committee pickers: searched,
 * sorted and paged on the server; scoped by the organisation; only what a
 * picker row shows.
 */
const ORG = 'org-a';

/** A read's argument, as far as these specs look at it. */
type ReadArgs = [{ where: { organizationId: string } }];

function build() {
  const prisma = {
    user: {
      findMany: jest.fn<Promise<unknown[]>, ReadArgs>().mockResolvedValue([]),
      count: jest.fn<Promise<number>, ReadArgs>().mockResolvedValue(0),
    },
    committee: {
      findMany: jest.fn<Promise<unknown[]>, ReadArgs>().mockResolvedValue([]),
      count: jest.fn<Promise<number>, ReadArgs>().mockResolvedValue(0),
    },
  };
  return {
    prisma,
    service: new StageWhoOptionsService(prisma as unknown as PrismaService),
  };
}

describe('StageWhoOptionsService (ACC-271 PR 5a)', () => {
  describe('people', () => {
    it('offers exactly ACTIVE and INVITED people, by name, one page, with the totals', async () => {
      const { prisma, service } = build();
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', name: 'Huda', status: 'INVITED' },
      ]);
      prisma.user.count.mockResolvedValueOnce(12).mockResolvedValueOnce(1);
      const page = await service.people(ORG, {
        q: ' hu ',
        take: 50,
        skip: 50,
        dir: 'desc',
      });
      expect(page).toEqual({
        items: [{ id: 'u1', name: 'Huda', status: 'INVITED' }],
        total: 12,
        matching: 1,
      });
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: ORG,
          status: { in: ['ACTIVE', 'INVITED'] },
          name: { contains: 'hu', mode: 'insensitive' },
        },
        select: { id: true, name: true, status: true },
        orderBy: [{ name: 'desc' }, { id: 'asc' }],
        take: 50,
        skip: 50,
      });
    });

    it('without a search, makes one count and reports it as both totals', async () => {
      const { prisma, service } = build();
      prisma.user.count.mockResolvedValue(7);
      expect(await service.people(ORG, {})).toEqual({
        items: [],
        total: 7,
        matching: 7,
      });
      expect(prisma.user.count).toHaveBeenCalledTimes(1);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 50,
          skip: 0,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        }),
      );
    });

    itEnforcesTenantIsolation(
      'people: every read is scoped by the organisation',
      async () => {
        const { prisma, service } = build();
        await service.people(ORG, { q: 'x' });
        for (const call of [
          ...prisma.user.findMany.mock.calls,
          ...prisma.user.count.mock.calls,
        ]) {
          expect(call[0].where.organizationId).toBe(ORG);
        }
      },
    );
  });

  describe('committees', () => {
    it('offers active committees, searched in either name, sorted by the name the reader sees', async () => {
      const { prisma, service } = build();
      prisma.committee.findMany.mockResolvedValue([
        { id: 'c1', nameEn: 'Quality Committee', nameAr: 'لجنة الجودة' },
      ]);
      prisma.committee.count.mockResolvedValueOnce(3).mockResolvedValueOnce(1);
      const page = await service.committees(ORG, { q: 'جود', lang: 'ar' });
      expect(page).toEqual({
        items: [
          { id: 'c1', nameEn: 'Quality Committee', nameAr: 'لجنة الجودة' },
        ],
        total: 3,
        matching: 1,
      });
      expect(prisma.committee.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: ORG,
          isActive: true,
          OR: [
            { nameEn: { contains: 'جود', mode: 'insensitive' } },
            { nameAr: { contains: 'جود', mode: 'insensitive' } },
          ],
        },
        select: { id: true, nameEn: true, nameAr: true },
        orderBy: [
          { nameAr: { sort: 'asc', nulls: 'last' } },
          { nameEn: 'asc' },
          { id: 'asc' },
        ],
        take: 50,
        skip: 0,
      });
    });

    it('in English, sorts by the English name', async () => {
      const { prisma, service } = build();
      await service.committees(ORG, { lang: 'en', dir: 'desc' });
      expect(prisma.committee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ nameEn: 'desc' }, { id: 'asc' }],
        }),
      );
    });

    itEnforcesTenantIsolation(
      'committees: every read is scoped by the organisation',
      async () => {
        const { prisma, service } = build();
        await service.committees(ORG, { q: 'x' });
        for (const call of [
          ...prisma.committee.findMany.mock.calls,
          ...prisma.committee.count.mock.calls,
        ]) {
          expect(call[0].where.organizationId).toBe(ORG);
        }
      },
    );
  });
});
