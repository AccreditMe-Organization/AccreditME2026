import { CommitteeOffers, CommitteePermissions, NO_STAGE_RULES, committeeOffers } from './committee-offers';
import { SEEDED_STAGE_RULES, tenantStageRules } from './testing';
import type { CommitteeStageRulesDto } from './services/committee.service';

// ACC-283 — committeeOffers() is the one place the page's writes are decided,
// and the server's mayWrite is its third term: without it, nothing is offered,
// whatever the stage allows and whatever the viewer holds.

const ALL_ACTIONS = ['edit_details', 'add_member', 'remove_member', 'change_member_role', 'request_change'] as const;

/** Every stage the page can meet: each seeded one, a tenant's, and none at all. */
const STAGES: readonly { name: string; rules: CommitteeStageRulesDto | null | undefined }[] = [
  ...SEEDED_STAGE_RULES.map(({ stage, rules }) => ({ name: stage, rules })),
  { name: 'a tenant stage allowing everything', rules: tenantStageRules([...ALL_ACTIONS]) },
  { name: 'a tenant stage allowing everything, in force', rules: tenantStageRules([...ALL_ACTIONS], ['IN_FORCE']) },
  { name: 'a tenant stage allowing nothing', rules: tenantStageRules([]) },
  { name: 'no rules (null)', rules: null },
  { name: 'no rules (undefined)', rules: undefined },
  { name: 'NO_STAGE_RULES', rules: NO_STAGE_RULES },
];

/** All sixteen combinations of the four permissions. */
const PERMISSION_SETS: readonly CommitteePermissions[] = Array.from({ length: 16 }, (_, n) => ({
  editDetails: (n & 1) !== 0,
  addMember: (n & 2) !== 0,
  removeMember: (n & 4) !== 0,
  changeMemberRole: (n & 8) !== 0,
}));

const NOTHING: CommitteeOffers = { edit: false, lockedLine: false, addMember: false, removeMember: false, changeMemberRole: false };
const EVERYTHING: CommitteePermissions = { editDetails: true, addMember: true, removeMember: true, changeMemberRole: true };

describe('committeeOffers() — the server\'s mayWrite (ACC-283)', () => {
  it('without mayWrite, every offer is false, in every stage, whatever the permissions', () => {
    let checked = 0;
    for (const { name, rules } of STAGES) {
      for (const can of PERMISSION_SETS) {
        expect(committeeOffers(rules, can, false)).withContext(`${name}, ${JSON.stringify(can)}`).toEqual(NOTHING);
        checked++;
      }
    }
    expect(checked).withContext('non-vacuity: every stage and permission set was checked').toBe(STAGES.length * 16);
  });

  // Non-vacuity for the test above: with mayWrite, the same inputs do offer
  // something, so "nothing" is the flag's doing and not the inputs'.
  it('with mayWrite, the same stages offer what their rules and the permissions allow', () => {
    const formation = committeeOffers(SEEDED_STAGE_RULES[0]!.rules, EVERYTHING, true);
    expect(formation.edit).withContext('Formation: Edit').toBeTrue();
    expect(formation.addMember).withContext('Formation: Add member').toBeTrue();
    expect(formation.removeMember).withContext('Formation: Remove').toBeTrue();
    expect(formation.changeMemberRole).withContext('Formation: Change role').toBeTrue();
    expect(committeeOffers(SEEDED_STAGE_RULES[1]!.rules, EVERYTHING, true).lockedLine).withContext('Terms Review: locked line').toBeTrue();
  });

  it('each call returns its own object, so no caller can change what another is offered', () => {
    const a = committeeOffers(null, EVERYTHING, false);
    a.edit = true;
    expect(committeeOffers(null, EVERYTHING, false).edit).toBeFalse();
  });
});
