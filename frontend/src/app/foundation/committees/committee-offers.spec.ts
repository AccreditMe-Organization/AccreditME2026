import { CommitteeOffers, CommitteePermissions, NO_MEMBER_ACTIONS, NO_STAGE_RULES, committeeOffers } from './committee-offers';
import { SEEDED_STAGE_RULES, tenantStageRules } from './testing';
import type { CommitteeMemberActionsDto, CommitteeStageRulesDto } from './services/committee.service';

// committeeOffers() is the one place the page's writes are decided.
//   - ACC-283: Edit and the locked line need the server's mayWrite.
//   - ACC-283 PR 6: Add member, Remove and Change seat come from the server's
//     memberActions (a seat can grant them) AND the stage (Request a change is
//     the header's, from the server's canRaise);
//     Change seat on your OWN row also needs committees:change_member_role,
//     because a seat never changes its holder's own seat.

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

const ALL_MEMBER: CommitteeMemberActionsDto = { add_member: true, remove_member: true, change_member_seat: true, request_change: true };
/** All sixteen answers the server can give for memberActions. */
const MEMBER_SETS: readonly CommitteeMemberActionsDto[] = Array.from({ length: 16 }, (_, n) => ({
  add_member: (n & 1) !== 0,
  remove_member: (n & 2) !== 0,
  change_member_seat: (n & 4) !== 0,
  request_change: (n & 8) !== 0,
}));
const PERMISSION_SETS: readonly CommitteePermissions[] = [
  { editDetails: false, changeMemberRole: false },
  { editDetails: true, changeMemberRole: false },
  { editDetails: false, changeMemberRole: true },
  { editDetails: true, changeMemberRole: true },
];

describe('committeeOffers() — memberActions and the stage (ACC-283 PR 6)', () => {
  // The four people the server answers for (member-actions.ts). The page sees
  // only the server's memberActions and whether it holds change_member_role.
  const PEOPLE: {
    who: string;
    member: CommitteeMemberActionsDto;
    can: CommitteePermissions;
    expected: Pick<CommitteeOffers, 'addMember' | 'removeMember' | 'changeMemberRole' | 'changeOwnSeat'>;
  }[] = [
    {
      who: 'role only (the keys; a seat that allows nothing)',
      member: ALL_MEMBER,
      can: { editDetails: true, changeMemberRole: true },
      expected: { addMember: true, removeMember: true, changeMemberRole: true, changeOwnSeat: true },
    },
    {
      who: 'seat only (a Secretary holding no key)',
      member: ALL_MEMBER,
      can: { editDetails: false, changeMemberRole: false },
      // On their own row the seat cannot change their seat: absent.
      expected: { addMember: true, removeMember: true, changeMemberRole: true, changeOwnSeat: false },
    },
    {
      who: 'both (the keys and a seat that allows them)',
      member: ALL_MEMBER,
      can: { editDetails: true, changeMemberRole: true },
      expected: { addMember: true, removeMember: true, changeMemberRole: true, changeOwnSeat: true },
    },
    {
      who: 'neither (a plain member)',
      member: NO_MEMBER_ACTIONS,
      can: { editDetails: false, changeMemberRole: false },
      expected: { addMember: false, removeMember: false, changeMemberRole: false, changeOwnSeat: false },
    },
    {
      // The server says false: a key is not enough without the right to write
      // here (an overseeing head), so the page offers nothing either.
      who: 'neither, though holding change_member_role (the server answered false)',
      member: NO_MEMBER_ACTIONS,
      can: { editDetails: true, changeMemberRole: true },
      expected: { addMember: false, removeMember: false, changeMemberRole: false, changeOwnSeat: false },
    },
  ];

  for (const p of PEOPLE) {
    it(`${p.who}: offered as the server answered, where the stage allows everything`, () => {
      const o = committeeOffers(EVERY_STAGE_ACTION, p.can, true, p.member);
      expect({
        addMember: o.addMember,
        removeMember: o.removeMember,
        changeMemberRole: o.changeMemberRole,
        changeOwnSeat: o.changeOwnSeat,
      }).toEqual(p.expected);
    });
  }

  it('each memberActions key opens exactly its own offer, and nothing else', () => {
    const can = { editDetails: false, changeMemberRole: true };
    const one = (key: keyof CommitteeMemberActionsDto) => committeeOffers(EVERY_STAGE_ACTION, can, true, { ...NO_MEMBER_ACTIONS, [key]: true });
    expect(one('add_member')).toEqual(jasmine.objectContaining({ addMember: true, removeMember: false, changeMemberRole: false }));
    expect(one('remove_member')).toEqual(jasmine.objectContaining({ addMember: false, removeMember: true, changeMemberRole: false }));
    expect(one('change_member_seat')).toEqual(
      jasmine.objectContaining({ addMember: false, removeMember: false, changeMemberRole: true, changeOwnSeat: true }),
    );
    // Request a change is the header's, from the server's canRaise (ACC-240): no page offer.
    expect(one('request_change')).toEqual(jasmine.objectContaining({ addMember: false, removeMember: false, changeMemberRole: false, changeOwnSeat: false }));
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
          expect(o.changeOwnSeat).withContext(`own seat: ${at}`).toBe(member.change_member_seat && allows.change_member_role && can.changeMemberRole);
          checked++;
        }
      }
    }
    expect(checked).withContext('non-vacuity: every stage, answer and permission set').toBe(STAGES.length * 16 * 4);
  });

  it('a read with no memberActions offers none of the four (fail closed)', () => {
    for (const member of [null, undefined]) {
      const o = committeeOffers(EVERY_STAGE_ACTION, { editDetails: true, changeMemberRole: true }, true, member);
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
    expect(checked).withContext('non-vacuity: every stage and permission set was checked').toBe(STAGES.length * 4);
  });

  // Non-vacuity for the test above: with mayWrite, the same inputs do offer
  // Edit and the locked line, so "nothing" is the flag's doing.
  it('with mayWrite: Edit in Formation, the locked line in Terms Review', () => {
    const can = { editDetails: true, changeMemberRole: true };
    expect(committeeOffers(SEEDED_STAGE_RULES[0]!.rules, can, true, ALL_MEMBER).edit).withContext('Formation: Edit').toBeTrue();
    expect(committeeOffers(SEEDED_STAGE_RULES[1]!.rules, can, true, ALL_MEMBER).lockedLine).withContext('Terms Review: locked line').toBeTrue();
  });

  it('Edit is never granted by a seat: memberActions does not open it', () => {
    const o = committeeOffers(SEEDED_STAGE_RULES[0]!.rules, { editDetails: false, changeMemberRole: false }, true, ALL_MEMBER);
    expect(o.edit).toBeFalse();
    expect(o.lockedLine).toBeFalse();
  });

  it('each call returns its own object, so no caller can change what another is offered', () => {
    const can = { editDetails: true, changeMemberRole: true };
    const a = committeeOffers(null, can, false, ALL_MEMBER);
    a.edit = true;
    expect(committeeOffers(null, can, false, ALL_MEMBER).edit).toBeFalse();
  });
});
