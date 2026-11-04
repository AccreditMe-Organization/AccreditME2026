import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { recordNameMatchSql, recordNamesOf, recordOf } from './task-record-names';

// ACC-120 slice 3 — the one gate that names a task's record: at most one
// batched, organisation-scoped lookup per record type, and only for a type the
// viewer may see. Its meaning on real rows is in the db-specs; this pins the
// shape of the reads.

const ORG = 'org-a';
const SEES_ALL = ['committees:view', 'meetings:view'];

function prisma() {
  return {
    committee: { findMany: jest.fn().mockResolvedValue([{ id: 'c1', nameEn: 'Quality Committee', nameAr: 'لجنة الجودة' }]) },
    meeting: { findMany: jest.fn().mockResolvedValue([{ id: 'm1', title: 'Board meeting' }]) },
  };
}
const client = (p: ReturnType<typeof prisma>) => p as unknown as PrismaService;

describe('recordNamesOf (ACC-120 slice 3)', () => {
  it('reads each type once, deduplicated, scoped by organisation', async () => {
    const p = prisma();
    const map = await recordNamesOf(
      client(p),
      [
        { sourceType: 'COMMITTEE', sourceId: 'c1' },
        { sourceType: 'COMMITTEE', sourceId: 'c1' },
        { sourceType: 'COMMITTEE', sourceId: 'c2' },
        { sourceType: 'MEETING', sourceId: 'm1' },
      ],
      ORG,
      SEES_ALL,
    );
    expect(p.committee.findMany).toHaveBeenCalledTimes(1);
    expect(p.committee.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['c1', 'c2'] }, organizationId: ORG } }));
    expect(p.meeting.findMany).toHaveBeenCalledTimes(1);
    expect(p.meeting.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['m1'] }, organizationId: ORG } }));
    expect(map.get('COMMITTEE:c1')).toEqual({ type: 'COMMITTEE', id: 'c1', nameEn: 'Quality Committee', nameAr: 'لجنة الجودة' });
    expect(map.get('MEETING:m1')).toEqual({ type: 'MEETING', id: 'm1', nameEn: 'Board meeting', nameAr: null });
  });

  it('looks up no type the viewer may not see — and no type with no ids', async () => {
    const p = prisma();
    const map = await recordNamesOf(client(p), [{ sourceType: 'COMMITTEE', sourceId: 'c1' }], ORG, ['meetings:view']);
    // Committees unseen; meetings seen but no meeting task here.
    expect(p.committee.findMany).not.toHaveBeenCalled();
    expect(p.meeting.findMany).not.toHaveBeenCalled();
    expect(map.size).toBe(0);
  });

  it('reads nothing at all for no tasks', async () => {
    const p = prisma();
    await recordNamesOf(client(p), [], ORG, SEES_ALL);
    expect(p.committee.findMany).not.toHaveBeenCalled();
    expect(p.meeting.findMany).not.toHaveBeenCalled();
  });

  itEnforcesTenantIsolation('recordNamesOf', async () => {
    const p = prisma();
    await recordNamesOf(client(p), [{ sourceType: 'COMMITTEE', sourceId: 'c1' }], 'org-b', SEES_ALL);
    expect(p.committee.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-b' }) }));
  });
});

describe('recordOf (ACC-120 slice 3)', () => {
  it('falls back to the type and id with no name', () => {
    expect(recordOf(new Map(), { sourceType: 'COMMITTEE', sourceId: 'c9' })).toEqual({ type: 'COMMITTEE', id: 'c9', nameEn: null, nameAr: null });
  });

  it('returns the named record when the map holds it', () => {
    const named = { type: 'MEETING', id: 'm1', nameEn: 'Board meeting', nameAr: null };
    expect(recordOf(new Map([['MEETING:m1', named]]), { sourceType: 'MEETING', sourceId: 'm1' })).toBe(named);
  });
});

describe('recordNameMatchSql (ACC-120 slice 3)', () => {
  const text = (sql: Prisma.Sql | null) => sql?.text ?? '';

  it('searches committee names and meeting titles, each in this organisation, for a viewer who sees both', () => {
    const sql = recordNameMatchSql('%qual%', ORG, SEES_ALL)!;
    expect(text(sql)).toContain('FROM "Committee" nc');
    expect(text(sql)).toContain('nc."organizationId" = $');
    expect(text(sql)).toContain('FROM "Meeting" nm');
    expect(text(sql)).toContain('nm."organizationId" = $');
    expect(sql.values).toEqual(expect.arrayContaining([ORG, '%qual%']));
  });

  it('leaves out a type the viewer may not see, and is null when they see neither', () => {
    const committeesOnly = recordNameMatchSql('%qual%', ORG, ['committees:view']);
    expect(text(committeesOnly)).toContain('"Committee"');
    expect(text(committeesOnly)).not.toContain('"Meeting"');
    expect(recordNameMatchSql('%qual%', ORG, [])).toBeNull();
  });
});
