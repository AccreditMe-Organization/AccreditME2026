import { NotFoundException } from '@nestjs/common';
import { CommitteeListsService } from './committee-lists.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LookupService } from '../lookup/lookup.service';

// ACC-230 — a committee's Members and Sub-committees, searched, sorted and
// paged on the server.

const ORG = 'org-a';
const day = (n: number) => new Date(Date.UTC(2026, 0, n));

const SEATS = [
  { id: 'chair', labelEn: 'Chairman', labelAr: 'الرئيس' },
  { id: 'secretary', labelEn: 'Secretary', labelAr: null },
  { id: 'member', labelEn: 'Member', labelAr: 'عضو' },
];

function setup() {
  const prisma = {
    committee: {
      findFirst: jest.fn().mockResolvedValue({ id: 'c-1' }),
      findMany: jest.fn().mockResolvedValue([
        { id: 's1', nameEn: 'Hand Hygiene', nameAr: 'نظافة الأيدي' },
        { id: 's2', nameEn: 'Antimicrobial Stewardship', nameAr: null },
        { id: 's3', nameEn: 'Ventilator Bundle', nameAr: 'حزمة أجهزة التنفس' },
      ]),
    },
    committeeMember: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'm1', userId: 'u1', roleValueId: 'member', joinedAt: day(3), user: { name: 'Zainab Al-Harbi' } },
        { id: 'm2', userId: 'u2', roleValueId: 'chair', joinedAt: day(9), user: { name: 'Dr. Sara Al-Qahtani' } },
        { id: 'm3', userId: 'u3', roleValueId: 'member', joinedAt: day(1), user: { name: 'Huda 50%_Test' } },
        { id: 'm4', userId: 'u4', roleValueId: 'secretary', joinedAt: day(5), user: { name: 'Mohammed Al-Otaibi' } },
        { id: 'm5', userId: 'u5', roleValueId: 'retired-seat', joinedAt: day(2), user: { name: 'Ahmed Saleh' } },
      ]),
      groupBy: jest.fn().mockResolvedValue([
        { committeeId: 's1', _count: { committeeId: 4 } },
        { committeeId: 's3', _count: { committeeId: 9 } },
      ]),
    },
    workflowInstance: {
      findMany: jest.fn().mockResolvedValue([
        { objectId: 's1', currentStageId: 'st-active' },
        { objectId: 's3', currentStageId: 'st-formation' },
      ]),
    },
    workflowStage: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'st-active', nameEn: 'Active', nameAr: 'نشطة' },
        { id: 'st-formation', nameEn: 'Formation', nameAr: 'التشكيل' },
      ]),
    },
  };
  const lookups = { getValues: jest.fn().mockResolvedValue(SEATS) };
  const service = new CommitteeListsService(prisma as unknown as PrismaService, lookups as unknown as LookupService);
  return { service, prisma, lookups };
}

describe('CommitteeListsService (ACC-230)', () => {
  describe('members', () => {
    it('orders by seat — the tenant\'s own seat order — then the longest-serving first; a hidden seat goes last', async () => {
      const { service, lookups } = setup();
      const page = await service.members('c-1', {}, ORG);
      expect(lookups.getValues).toHaveBeenCalledWith('committee_member_role', ORG);
      expect(page.items.map((m) => m.id)).toEqual(['m2', 'm4', 'm3', 'm1', 'm5']);
      expect(page.items[0]).toEqual(
        expect.objectContaining({ name: 'Dr. Sara Al-Qahtani', roleLabelEn: 'Chairman', roleLabelAr: 'الرئيس', userId: 'u2' }),
      );
      expect(page.items[4]!.roleLabelEn).toBeNull();
      expect(page.total).toBe(5);
    });

    it('reads ACTIVE members of THIS committee in THIS organisation only', async () => {
      const { service, prisma } = setup();
      await service.members('c-1', {}, ORG);
      expect(prisma.committeeMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { committeeId: 'c-1', organizationId: ORG, isActive: true } }),
      );
    });

    it('sorts by name and by since, either way', async () => {
      const { service } = setup();
      expect((await service.members('c-1', { sort: 'name' }, ORG)).items.map((m) => m.id)).toEqual(['m5', 'm2', 'm3', 'm4', 'm1']);
      expect((await service.members('c-1', { sort: 'since', dir: 'desc' }, ORG)).items.map((m) => m.id)).toEqual(['m2', 'm4', 'm1', 'm5', 'm3']);
    });

    it('searches names case-insensitively, a typed % or _ meaning itself; total stays, matching counts', async () => {
      const { service } = setup();
      const page = await service.members('c-1', { q: 'AL-' }, ORG);
      expect(page.items.map((m) => m.id)).toEqual(['m2', 'm4', 'm1']);
      expect(page.total).toBe(5);
      expect(page.matching).toBe(3);
      expect((await service.members('c-1', { q: '50%_' }, ORG)).items.map((m) => m.id)).toEqual(['m3']);
      expect((await service.members('c-1', { q: '%' }, ORG)).items.map((m) => m.id)).toEqual(['m3']);
    });

    it('pages: take and skip over the one order', async () => {
      const { service } = setup();
      const first = await service.members('c-1', { take: 2 }, ORG);
      const rest = await service.members('c-1', { take: 2, skip: 2 }, ORG);
      expect([...first.items, ...rest.items].map((m) => m.id)).toEqual(['m2', 'm4', 'm3', 'm1']);
    });
  });

  describe('sub-committees', () => {
    it('lists the children by name, with each one\'s live stage and active member count', async () => {
      const { service } = setup();
      const page = await service.subCommittees('c-1', {}, ORG);
      expect(page.items.map((s) => s.id)).toEqual(['s2', 's1', 's3']);
      expect(page.items[1]).toEqual({
        id: 's1',
        nameEn: 'Hand Hygiene',
        nameAr: 'نظافة الأيدي',
        stageNameEn: 'Active',
        stageNameAr: 'نشطة',
        memberCount: 4,
      });
      expect(page.items[0]).toEqual(expect.objectContaining({ stageNameEn: null, memberCount: 0 }));
    });

    it('sorts by members, and by status with a committee that has none last', async () => {
      const { service } = setup();
      expect((await service.subCommittees('c-1', { sort: 'members', dir: 'desc' }, ORG)).items.map((s) => s.id)).toEqual(['s3', 's1', 's2']);
      expect((await service.subCommittees('c-1', { sort: 'status' }, ORG)).items.map((s) => s.id)).toEqual(['s1', 's3', 's2']);
      expect((await service.subCommittees('c-1', { sort: 'status', dir: 'desc' }, ORG)).items.map((s) => s.id)).toEqual(['s3', 's1', 's2']);
    });

    it('searches the English and the Arabic names', async () => {
      const { service } = setup();
      expect((await service.subCommittees('c-1', { q: 'hygiene' }, ORG)).items.map((s) => s.id)).toEqual(['s1']);
      expect((await service.subCommittees('c-1', { q: 'حزمة' }, ORG)).items.map((s) => s.id)).toEqual(['s3']);
    });

    it('sorts by the name an Arabic reader sees, falling back to English', async () => {
      const { service } = setup();
      const ar = (await service.subCommittees('c-1', { lang: 'ar' }, ORG)).items.map((s) => s.id);
      // Arabic collation: Arabic names in Arabic order, then the English-only
      // one (which an Arabic reader sees in English, ACC-160).
      expect(ar).toEqual(['s3', 's1', 's2']);
    });
  });

  it('another organisation\'s committee, or a missing one, is the same 404 — and nothing else is read', async () => {
    const { service, prisma, lookups } = setup();
    prisma.committee.findFirst.mockResolvedValue(null);
    await expect(service.members('c-1', {}, 'org-b')).rejects.toThrow(new NotFoundException('Committee not found'));
    await expect(service.subCommittees('c-1', {}, 'org-b')).rejects.toThrow(new NotFoundException('Committee not found'));
    expect(prisma.committeeMember.findMany).not.toHaveBeenCalled();
    expect(prisma.committee.findMany).not.toHaveBeenCalled();
    expect(lookups.getValues).not.toHaveBeenCalled();
  });

  it('should NOT return records belonging to a different tenant', async () => {
    // Every read is scoped by the CALLER's organisation: the committee check,
    // the members, the seats, the children and their counts and stages.
    const { service, prisma, lookups } = setup();
    await service.members('c-1', {}, 'org-b');
    await service.subCommittees('c-1', {}, 'org-b');
    expect(prisma.committee.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c-1', organizationId: 'org-b' } }));
    expect(prisma.committeeMember.findMany.mock.calls[0]![0].where.organizationId).toBe('org-b');
    expect(lookups.getValues).toHaveBeenCalledWith('committee_member_role', 'org-b');
    expect(prisma.committee.findMany.mock.calls[0]![0].where).toEqual({ organizationId: 'org-b', parentCommitteeId: 'c-1' });
    expect(prisma.committeeMember.groupBy.mock.calls[0]![0].where.organizationId).toBe('org-b');
    expect(prisma.workflowInstance.findMany.mock.calls[0]![0].where.organizationId).toBe('org-b');
  });
});
