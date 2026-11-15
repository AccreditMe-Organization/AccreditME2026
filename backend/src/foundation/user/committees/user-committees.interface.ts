import type { LookupLayer } from '../../lookup/interfaces/lookup-value.interface';

/**
 * ACC-216 — one row of GET /users/:userId/committees: a membership of one
 * committee, current or past.
 */
export interface IUserCommitteeMembership {
  committee: { id: string; nameEn: string; nameAr: string | null };
  /**
   * The seat (a `committee_member_role` value). `id` and `layer` are the value the
   * membership points at; the labels are as THIS organisation names the seat (a
   * tenant label override applied). Null labels only when the value cannot be read.
   */
  seat: { id: string; labelEn: string | null; labelAr: string | null; layer: LookupLayer | null };
  joinedAt: Date;
  leftAt: Date | null;
  /**
   * ACC-281's one membership rule: an active member of an active committee, both
   * in the organisation. A former membership, or one of an inactive committee, is
   * listed with `current: false`.
   */
  current: boolean;
}

export interface IUserCommittees {
  /** Every membership the person has in this organisation, counted past the cap. */
  total: number;
  /** At most USER_COMMITTEES_CAP rows: current first, then past by left date. */
  rows: IUserCommitteeMembership[];
}
