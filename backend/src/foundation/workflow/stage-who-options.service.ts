import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '../../../generated/prisma/client';
import type { WhoOptionsQueryDto } from './dto/who-options-query.dto';

/** A page of a picker list (am-simple-list's contract): the rows, everyone there is, and how many the search matches. */
export interface WhoOptionsPage<T> {
  items: T[];
  total: number;
  matching: number;
}

export interface WhoPersonOption {
  id: string;
  name: string;
  status: 'ACTIVE' | 'INVITED';
}

export interface WhoCommitteeOption {
  id: string;
  nameEn: string;
  nameAr: string | null;
}

/**
 * The people a "Specific user" entry may name: exactly what the stage save
 * accepts (ACC-271 PR 3 / 5-be) — ACTIVE or INVITED; an invited person joins the
 * pool when they accept.
 */
const PICKABLE_STATUSES = ['ACTIVE', 'INVITED'] as const;

const PAGE = 50;

/**
 * ACC-271 PR 5a — what the stage editor's person and committee pickers choose
 * from, searched, sorted and paged ON THE SERVER, one read and two counts in
 * Promise.all per page, every one scoped by the organisation. Gated like the
 * other assignment pickers since ACC-208: workflows:manage (the controller).
 * It returns only what a picker row shows: no email, no other field.
 */
@Injectable()
export class StageWhoOptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async people(organizationId: string, query: WhoOptionsQueryDto): Promise<WhoOptionsPage<WhoPersonOption>> {
    const base: Prisma.UserWhereInput = { organizationId, status: { in: [...PICKABLE_STATUSES] } };
    const q = query.q?.trim();
    const where: Prisma.UserWhereInput = q ? { ...base, name: { contains: q, mode: 'insensitive' } } : base;
    const dir = query.dir === 'desc' ? 'desc' : 'asc';
    const [rows, total, matching] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: { id: true, name: true, status: true },
        orderBy: [{ name: dir }, { id: 'asc' }],
        take: query.take ?? PAGE,
        skip: query.skip ?? 0,
      }),
      this.prisma.user.count({ where: base }),
      q ? this.prisma.user.count({ where }) : null,
    ]);
    return {
      items: rows.map((r) => ({ id: r.id, name: r.name, status: r.status as WhoPersonOption['status'] })),
      total,
      matching: matching ?? total,
    };
  }

  async committees(organizationId: string, query: WhoOptionsQueryDto): Promise<WhoOptionsPage<WhoCommitteeOption>> {
    const base: Prisma.CommitteeWhereInput = { organizationId, isActive: true };
    const q = query.q?.trim();
    const where: Prisma.CommitteeWhereInput = q
      ? { ...base, OR: [{ nameEn: { contains: q, mode: 'insensitive' } }, { nameAr: { contains: q, mode: 'insensitive' } }] }
      : base;
    const dir = query.dir === 'desc' ? 'desc' : 'asc';
    // The name the reader sees: Arabic in Arabic (an unnamed one last, ACC-160), then English.
    const orderBy: Prisma.CommitteeOrderByWithRelationInput[] =
      query.lang === 'ar' ? [{ nameAr: { sort: dir, nulls: 'last' } }, { nameEn: dir }, { id: 'asc' }] : [{ nameEn: dir }, { id: 'asc' }];
    const [rows, total, matching] = await Promise.all([
      this.prisma.committee.findMany({
        where,
        select: { id: true, nameEn: true, nameAr: true },
        orderBy,
        take: query.take ?? PAGE,
        skip: query.skip ?? 0,
      }),
      this.prisma.committee.count({ where: base }),
      q ? this.prisma.committee.count({ where }) : null,
    ]);
    return { items: rows, total, matching: matching ?? total };
  }
}
