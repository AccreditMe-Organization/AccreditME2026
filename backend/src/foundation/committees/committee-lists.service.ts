import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LookupService } from '../lookup/lookup.service';
import { CommitteeMembersPageQueryDto, SubCommitteesQueryDto } from './dto/committee-list-query.dto';
import { ICommitteeMemberRow, ICommitteePage, ISubCommitteeRow } from './interfaces/committee.interface';
import { committeeStagesAndCounts } from './committee-stage-counts';

const COMMITTEE_MEMBER_ROLE_CATEGORY = 'committee_member_role';
const PAGE = 50;

/**
 * ACC-230 — a committee's Members and Sub-committees, capped on the record
 * page and in full behind "See all".
 *
 * WHO SEES THEM is the committee's own rule, unchanged: the routes require
 * committees:view (as GET /committees/:id/members does), and the committee is
 * read by `{ id, organizationId }` first, so another organisation's id is the
 * identical 404 a missing one is.
 *
 * A committee's members and children are few, so each list is read ONCE per
 * request, scoped by organisation, and searched, sorted and paged here —
 * never in the browser. The search is a case-insensitive substring of the
 * names, compared as plain text, so a typed % or _ means itself.
 */
@Injectable()
export class CommitteeListsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lookups: LookupService,
  ) {}

  async members(
    committeeId: string,
    query: CommitteeMembersPageQueryDto,
    organizationId: string,
  ): Promise<ICommitteePage<ICommitteeMemberRow>> {
    await this.assertCommittee(committeeId, organizationId);
    const [members, seats] = await Promise.all([
      this.prisma.committeeMember.findMany({
        where: { committeeId, organizationId, isActive: true },
        select: { id: true, userId: true, roleValueId: true, joinedAt: true, user: { select: { name: true } } },
      }),
      // The seats as THIS tenant names and orders them (hidden values and
      // label overrides applied) — the same resolution the rest of the app reads.
      this.lookups.getValues(COMMITTEE_MEMBER_ROLE_CATEGORY, organizationId),
    ]);
    const seatIndex = new Map(seats.map((s, i) => [s.id, i]));
    const seatById = new Map(seats.map((s) => [s.id, s]));

    const rows: ICommitteeMemberRow[] = members.map((m) => {
      const seat = seatById.get(m.roleValueId);
      return {
        id: m.id,
        userId: m.userId,
        name: m.user.name,
        roleValueId: m.roleValueId,
        roleLabelEn: seat?.labelEn ?? null,
        roleLabelAr: seat?.labelAr ?? null,
        joinedAt: m.joinedAt,
      };
    });

    const needle = normalise(query.q);
    const matching = needle ? rows.filter((r) => normalise(r.name).includes(needle)) : rows;
    const sign = query.dir === 'desc' ? -1 : 1;
    // A seat the tenant has hidden since sorts after every seat it still has.
    const seatOf = (r: ICommitteeMemberRow) => seatIndex.get(r.roleValueId) ?? Number.MAX_SAFE_INTEGER;
    const byName = (a: ICommitteeMemberRow, b: ICommitteeMemberRow) => a.name.localeCompare(b.name, query.lang ?? 'en');
    const bySince = (a: ICommitteeMemberRow, b: ICommitteeMemberRow) => a.joinedAt.getTime() - b.joinedAt.getTime();
    const sorted = [...matching].sort((a, b) => {
      switch (query.sort) {
        case 'name':
          return sign * byName(a, b) || a.id.localeCompare(b.id);
        case 'since':
          return sign * bySince(a, b) || a.id.localeCompare(b.id);
        case 'seat':
        default:
          // By seat (Chair, Secretary, Member, …), then the longest-serving first.
          return sign * (seatOf(a) - seatOf(b)) || bySince(a, b) || a.id.localeCompare(b.id);
      }
    });
    return { items: page(sorted, query), total: rows.length, matching: matching.length };
  }

  async subCommittees(
    committeeId: string,
    query: SubCommitteesQueryDto,
    organizationId: string,
  ): Promise<ICommitteePage<ISubCommitteeRow>> {
    await this.assertCommittee(committeeId, organizationId);
    const children = await this.prisma.committee.findMany({
      where: { organizationId, parentCommitteeId: committeeId },
      select: { id: true, nameEn: true, nameAr: true },
    });
    const facts = await committeeStagesAndCounts(this.prisma, organizationId, children.map((c) => c.id));
    const rows: ISubCommitteeRow[] = children.map((c) => {
      const fact = facts.get(c.id);
      return {
        id: c.id,
        nameEn: c.nameEn,
        nameAr: c.nameAr,
        stageNameEn: fact?.stageNameEn ?? null,
        stageNameAr: fact?.stageNameAr ?? null,
        memberCount: fact?.memberCount ?? 0,
      };
    });

    const needle = normalise(query.q);
    const matching = needle
      ? rows.filter((r) => normalise(r.nameEn).includes(needle) || normalise(r.nameAr).includes(needle))
      : rows;
    const lang = query.lang ?? 'en';
    // The name a reader sees: Arabic when there is one and they read Arabic (ACC-160).
    const shown = (r: ISubCommitteeRow) => (lang === 'ar' ? (r.nameAr ?? r.nameEn) : r.nameEn);
    const stageShown = (r: ISubCommitteeRow) => (lang === 'ar' ? (r.stageNameAr ?? r.stageNameEn) : r.stageNameEn);
    const byName = (a: ISubCommitteeRow, b: ISubCommitteeRow) => shown(a).localeCompare(shown(b), lang);
    const sign = query.dir === 'desc' ? -1 : 1;
    const sorted = [...matching].sort((a, b) => {
      switch (query.sort) {
        case 'status': {
          // A committee with no stage sorts last, whichever way.
          const sa = stageShown(a);
          const sb = stageShown(b);
          if (!sa && !sb) return byName(a, b);
          if (!sa) return 1;
          if (!sb) return -1;
          return sign * sa.localeCompare(sb, lang) || byName(a, b);
        }
        case 'members':
          return sign * (a.memberCount - b.memberCount) || byName(a, b);
        case 'name':
        default:
          return sign * byName(a, b) || a.id.localeCompare(b.id);
      }
    });
    return { items: page(sorted, query), total: rows.length, matching: matching.length };
  }

  /** The committee, in this organisation — or the identical 404 for any other id. */
  private async assertCommittee(id: string, organizationId: string): Promise<void> {
    const committee = await this.prisma.committee.findFirst({ where: { id, organizationId }, select: { id: true } });
    if (!committee) throw new NotFoundException('Committee not found');
  }
}

function normalise(value: string | null | undefined): string {
  return (value ?? '').trim().toLocaleLowerCase();
}

function page<T>(rows: T[], query: { take?: number; skip?: number }): T[] {
  const skip = query.skip ?? 0;
  return rows.slice(skip, skip + (query.take ?? PAGE));
}
