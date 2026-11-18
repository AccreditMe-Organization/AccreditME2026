import { MANAGE_UMBRELLAS, missingSpecifics } from './manage-umbrellas';
import { SYSTEM_ROLE_SEED } from './role.seed';
import {
  COMMITTEES_PERMISSIONS,
  COMMITTEE_TASKS_PERMISSIONS,
  MEETINGS_PERMISSIONS,
  MEETING_TASKS_PERMISSIONS,
  PERMISSIONS_NOT_YET_CHECKED,
} from '../../common/constants/permissions';

// ACC-77 — ACC-44's rule, enforced on the seed: a role that holds a module's
// umbrella (`{module}:manage`, or a type's `{type}:manage_tasks`) holds every one
// of that module's specific keys DIRECTLY. Nothing implies anything at runtime.

describe('Every seeded umbrella holds its module\'s specific keys (ACC-77)', () => {
  it.each(SYSTEM_ROLE_SEED.map((r) => [r.key, r] as const))('%s', (_key, role) => {
    expect(missingSpecifics(new Set(role.permissions))).toEqual([]);
  });

  // Non-vacuity: the rule reads the real catalogue, and a role other than the
  // two administrators (which hold everything) carries umbrellas it must satisfy.
  it('reads every umbrella in the catalogue, the task umbrellas included', () => {
    expect([...MANAGE_UMBRELLAS.keys()]).toEqual(
      expect.arrayContaining([COMMITTEES_PERMISSIONS.MANAGE, MEETINGS_PERMISSIONS.MANAGE, COMMITTEE_TASKS_PERMISSIONS.MANAGE, MEETING_TASKS_PERMISSIONS.MANAGE]),
    );
    expect(MANAGE_UMBRELLAS.size).toBeGreaterThanOrEqual(14);
    const qualityManager = SYSTEM_ROLE_SEED.find((r) => r.key === 'QUALITY_MANAGER')!;
    expect([...MANAGE_UMBRELLAS.keys()].filter((u) => qualityManager.permissions.includes(u)).length).toBeGreaterThanOrEqual(4);
  });

  it("an umbrella's specifics are the rest of its own group: committees, its task keys, meetings", () => {
    const { MANAGE: _c, ...committee } = COMMITTEES_PERMISSIONS;
    expect([...(MANAGE_UMBRELLAS.get(COMMITTEES_PERMISSIONS.MANAGE) ?? [])].sort()).toEqual(Object.values(committee).sort());
    const { MANAGE: _t, ...committeeTasks } = COMMITTEE_TASKS_PERMISSIONS;
    expect([...(MANAGE_UMBRELLAS.get(COMMITTEE_TASKS_PERMISSIONS.MANAGE) ?? [])].sort()).toEqual(Object.values(committeeTasks).sort());
    const { MANAGE: _m, ...meeting } = MEETINGS_PERMISSIONS;
    expect([...(MANAGE_UMBRELLAS.get(MEETINGS_PERMISSIONS.MANAGE) ?? [])].sort()).toEqual(Object.values(meeting).sort());
  });

  it('never requires a key no code checks yet: one that cannot be granted is never seeded by this rule', () => {
    const notYetChecked = new Set(PERMISSIONS_NOT_YET_CHECKED);
    expect([...MANAGE_UMBRELLAS.values()].flat().filter((k) => notYetChecked.has(k))).toEqual([]);
  });

  it('names a gap when a role holds an umbrella without a specific (the check is real)', () => {
    expect(missingSpecifics(new Set([COMMITTEE_TASKS_PERMISSIONS.MANAGE, COMMITTEE_TASKS_PERMISSIONS.VIEW_ALL]))).toEqual([
      { umbrella: COMMITTEE_TASKS_PERMISSIONS.MANAGE, missing: [COMMITTEE_TASKS_PERMISSIONS.CREATE, COMMITTEE_TASKS_PERMISSIONS.VIEW_UNIT] },
    ]);
  });
});
