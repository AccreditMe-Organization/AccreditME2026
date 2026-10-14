import { PrismaService } from '../../prisma/prisma.service';
import { draftRecordContext } from './draft-record-context';

// ACC-197 (Q2) — what a record contributes to a task draft. The service's spec
// covers the committee path end to end; this one pins every loader's own read,
// because a loader is reached only after the visibility check and a missing
// organizationId here would be hidden behind it.

const ORG = 'org-a';

function setup() {
  const prisma = {
    committee: {
      findFirst: jest.fn().mockImplementation(({ where }: { where: { id: string; organizationId?: string } }) =>
        Promise.resolve(where.id === 'cmt-1' && where.organizationId === ORG ? { nameEn: 'Infection Control Committee', nameAr: null, purpose: 'Oversees infection prevention.' } : null),
      ),
    },
    meeting: {
      findFirst: jest.fn().mockImplementation(({ where }: { where: { id: string; organizationId?: string } }) =>
        Promise.resolve(where.id === 'mtg-1' && where.organizationId === ORG ? { title: 'October infection control meeting' } : null),
      ),
    },
  };
  return { prisma, db: prisma as unknown as PrismaService };
}

describe('draftRecordContext (ACC-197)', () => {
  it('a committee gives its type, its name and its purpose', async () => {
    const { db } = setup();
    expect(await draftRecordContext(db, 'COMMITTEE', 'cmt-1', ORG, 'en')).toEqual({
      typeLabel: 'Committee',
      name: 'Infection Control Committee',
      purpose: 'Oversees infection prevention.',
    });
  });

  it('a committee with no Arabic name goes by its English one in Arabic (ACC-160)', async () => {
    const { db } = setup();
    expect((await draftRecordContext(db, 'COMMITTEE', 'cmt-1', ORG, 'ar'))?.name).toBe('Infection Control Committee');
  });

  it('a meeting gives its type and its title, and nothing else', async () => {
    const { db, prisma } = setup();
    expect(await draftRecordContext(db, 'MEETING', 'mtg-1', ORG, 'en')).toEqual({ typeLabel: 'Meeting', name: 'October infection control meeting' });
    expect((prisma.meeting.findFirst.mock.calls[0] as [{ select: unknown }])[0].select).toEqual({ title: true });
  });

  it.each([
    ['COMMITTEE', 'cmt-1', 'committee'],
    ['MEETING', 'mtg-1', 'meeting'],
  ] as const)('should NOT return records belonging to a different tenant (%s)', async (type, id, model) => {
    const { db, prisma } = setup();
    // The record exists in org-a; org-b asks for it by id.
    expect(await draftRecordContext(db, type, id, 'org-b', 'en')).toBeNull();
    expect((prisma[model].findFirst.mock.calls[0] as [{ where: unknown }])[0].where).toEqual({ id, organizationId: 'org-b' });
  });

  it('a record type with no entry contributes nothing, and reads nothing', async () => {
    const { db, prisma } = setup();
    expect(await draftRecordContext(db, 'DOCUMENT', 'doc-1', ORG, 'en')).toBeNull();
    expect(prisma.committee.findFirst).not.toHaveBeenCalled();
    expect(prisma.meeting.findFirst).not.toHaveBeenCalled();
  });
});
