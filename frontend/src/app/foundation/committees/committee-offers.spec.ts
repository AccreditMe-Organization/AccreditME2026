import { CommitteeOffers, CommitteePermissions, NO_MEMBER_ACTIONS, NO_STAGE_RULES, committeeOffers } from './committee-offers';
import { SEEDED_STAGE_RULES, tenantStageRules } from './testing';
import type { CommitteeMemberActionsDto, CommitteeStageRulesDto } from './services/committee.service';

// committeeOffers() is the one place the page's writes are decided.
//   - ACC-283: Edit and the locked line need the server's mayWrite.
//   - ACC-283 PR 6: Add member, Remove and Change seat come from the server's
//     memberActions (a seat can grant them) AND the stage (Request a change is
//     the header's, from the server's canRaise).
//   - ACC-320: Change seat on the viewer's OWN row is the server's
//     memberActions.change_own_seat AND the stage. The page keeps no copy of the
//     own-row rule (a seat never changes its holder's own seat).

const ALL_ACTIONS = ['edit_details', 'add_member', 'remove_member', 'change_member_role', 'request_change'] as const;
const EVERY_STAGE_ACTION = tenantStageRules([...ALL_ACTIONS]);

/** Every stage the page can meet: each seeded one, a tenant's, and none at all. */
const STAGES: readonly { name: string; rules: CommitteeStageRulesDto | null | undefined }[] = [
  ...SEEDED_STAGE_RULES.map(({ stage, rules }) => ({ name: stage, rules })),
  { name: 'a tenant stage allowing everything', rules: EVERY_STAGE_ACTION },
  { name: 'a tenant stage allowing everything, in force', rules: tenantStageRules([...ALL_ACTIONS], ['IN_FORCE']) },
  { name: 'a tenant stage allowing nothing', rules: tenantStageRules([]) },
  { name: 'no rules (null)', rules: null },
  { name: 'no rules (undefined)', rules: undefined },
  { name: 'NO_STAGE_RULES', rules: NO_STAGE_RULES },
];

const ALL_MEMBER: CommitteeMemberActionsDto = { add_member: true, remove_member: true, change_member_seat: true, request_change: true, change_own_seat: true };
/** All thirty-two answers the server can give for memberActions. */
const MEMBER_SETS: readonly CommitteeMemberActionsDto[] = Array.from({ length: 32 }, (_, n) => ({
  add_member: (n & 1) !== 0,
  remove_member: (n & 2) !== 0,
  change_member_seat: (n & 4) !== 0,
  request_change: (n & 8) !== 0,
  change_own_seat: (n & 16) !== 0,
}));
const PERMISSION_SETS: readonly CommitteePermissions[] = [{ editDetails: false }, { editDetails: true }];

type MemberOffers = Pick<CommitteeOffers, 'addMember' | 'removeMember' | 'changeMemberRole' | 'changeOwnSeat'>;
const memberOffers = (o: CommitteeOffers): MemberOffers => ({
  addMember: o.addMember,
  removeMember: o.removeMember,
  changeMemberRole: o.changeMemberRole,
  changeOwnSeat: o.changeOwnSeat,
});

describe('committeeOffers() — memberActions and the stage (ACC-283 PR 6, ACC-320)', () => {
  // The people the server answers for (member-actions.ts); the page sees only its flags.
  const PEOPLE: { who: string; member: CommitteeMemberActionsDto; can: CommitteePermissions; expected: MemberOffers }[] = [
    {
      who: 'role only (the keys; a seat that allows nothing)',
      member: ALL_MEMBER,
      can: { editDetails: true },
      expected: { addMember: true, removeMember: true, changeMemberRole: true, changeOwnSeat: true },
    },
    {
      who: 'seat only (a Secretary holding no key): the server says change_own_seat false',
      member: { ...ALL_MEMBER, change_own_seat: false },
      can: { editDetails: false },
      expected: { addMember: true, removeMember: true, changeMemberRole: true, changeOwnSeat: false },
    },
    {
      who: 'neither (a plain member)',
      member: NO_MEMBER_ACTIONS,
      can: { editDetails: false },
      expected: { addMember: false, removeMember: false, changeMemberRole: false, changeOwnSeat: false },
    },
    {
      who: 'neither, though holding the keys (the server answered false)',
      member: NO_MEMBER_ACTIONS,
      can: { editDetails: true },
      expected: { addMember: false, removeMember: false, changeMemberRole: false, changeOwnSeat: false },
    },
  ];

  for (const p of PEOPLE) {
    it(`${p.who}: offered as the server answered, where the stage allows everything`, () => {
      expect(memberOffers(committeeOffers(EVERY_STAGE_ACTION, p.can, true, p.member))).toEqual(p.expected);
    });
  }

  // ACC-320 — the own row follows the server's flag, whatever the page could read.
  it('your own row: the server says change_own_seat true → offered', () => {
    expect(committeeOffers(EVERY_STAGE_ACTION, { editDetails: false }, true, { ...NO_MEMBER_ACTIONS, change_own_seat: true }).changeOwnSeat).toBeTrue();
  });

  it('your own row: the server says change_own_seat false → not offered, even beside change_member_seat true', () => {
    const o = committeeOffers(EVERY_STAGE_ACTION, { editDetails: true }, true, { ...ALL_MEMBER, change_own_seat: false });
    expect(o.changeMemberRole).withContext('another row').toBeTrue();
    expect(o.changeOwnSeat).withContext('your own row').toBeFalse();
  });

  it('each memberActions key opens exactly its own offer, and nothing else', () => {
    const one = (key: keyof CommitteeMemberActionsDto) => memberOffers(committeeOffers(EVERY_STAGE_ACTION, { editDetails: false }, true, { ...NO_MEMBER_ACTIONS, [key]: true }));
    const none: MemberOffers = { addMember: false, removeMember: false, changeMemberRole: false, changeOwnSeat: false };
    expect(one('add_member')).toEqual({ ...none, addMember: true });
    expect(one('remove_member')).toEqual({ ...none, removeMember: true });
    expect(one('change_member_seat')).toEqual({ ...none, changeMemberRole: true });
    expect(one('change_own_seat')).toEqual({ ...none, changeOwnSeat: true });
    // Request a change is the header's, from the server's canRaise (ACC-240): no page offer.
    expect(one('request_change')).toEqual(none);
  });

  it('the stage still narrows every one: never offered where the stage does not allow it, in every stage and for every answer', () => {
    let checked = 0;
    for (const { name, rules } of STAGES) {
      const allows = (rules ?? NO_STAGE_RULES).actions;
      for (const member of MEMBER_SETS) {
        for (const can of PERMISSION_SETS) {
          const o = committeeOffers(rules, can, true, member);
          const at = `${name}, ${JSON.stringify(member)}, ${JSON.stringify(can)}`;
          expect(o.addMember).withContext(`add: ${at}`).toBe(member.add_member && allows.add_member);
          expect(o.removeMember).withContext(`remove: ${at}`).toBe(member.remove_member && allows.remove_member);
          expect(o.changeMemberRole).withContext(`change seat: ${at}`).toBe(member.change_member_seat && allows.change_member_role);
          expect(o.changeOwnSeat).withContext(`own seat: ${at}`).toBe(member.change_own_seat && allows.change_member_role);
          checked++;
        }
      }
    }
    expect(checked).withContext('non-vacuity: every stage, answer and permission set').toBe(STAGES.length * 32 * 2);
  });

  it('a read with no memberActions offers none of the four (fail closed)', () => {
    for (const member of [null, undefined]) {
      const o = committeeOffers(EVERY_STAGE_ACTION, { editDetails: true }, true, member);
      expect([o.addMember, o.removeMember, o.changeMemberRole, o.changeOwnSeat]).toEqual([false, false, false, false]);
    }
  });
});

describe("committeeOffers() — Edit and the locked line keep the server's mayWrite (ACC-283)", () => {
  it('without mayWrite, no Edit and no locked line, in every stage, whatever the permissions', () => {
    let checked = 0;
    for (const { name, rules } of STAGES) {
      for (const can of PERMISSION_SETS) {
        const o = committeeOffers(rules, can, false, ALL_MEMBER);
        expect([o.edit, o.lockedLine]).withContext(`${name}, ${JSON.stringify(can)}`).toEqual([false, false]);
        checked++;
      }
    }
    expect(checked).withContext('non-vacuity: every stage and permission set was checked').toBe(STAGES.length * 2);
  });

  // Non-vacuity for the test above: with mayWrite, the same inputs do offer
  // Edit and the locked line, so "nothing" is the flag's doing.
  it('with mayWrite: Edit in Formation, the locked line in Terms Review', () => {
    const can = { editDetails: true };
    expect(committeeOffers(SEEDED_STAGE_RULES[0]!.rules, can, true, ALL_MEMBER).edit).withContext('Formation: Edit').toBeTrue();
    expect(committeeOffers(SEEDED_STAGE_RULES[1]!.rules, can, true, ALL_MEMBER).lockedLine).withContext('Terms Review: locked line').toBeTrue();
  });

  it('Edit is never granted by a seat: memberActions does not open it', () => {
    const o = committeeOffers(SEEDED_STAGE_RULES[0]!.rules, { editDetails: false }, true, ALL_MEMBER);
    expect(o.edit).toBeFalse();
    expect(o.lockedLine).toBeFalse();
  });

  it('each call returns its own object, so no caller can change what another is offered', () => {
    const can = { editDetails: true };
    const a = committeeOffers(null, can, false, ALL_MEMBER);
    a.edit = true;
    expect(committeeOffers(null, can, false, ALL_MEMBER).edit).toBeFalse();
  });
});
