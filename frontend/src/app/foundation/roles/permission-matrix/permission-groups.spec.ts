import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';
import { GROUP_THRESHOLD, PERMISSION_GROUPS } from './permission-groups';

// ACC-272 — the groups table against every key the list can show.
//
// WHERE THE KEYS COME FROM: the sentence table, roles.matrix.sentence.
// check:permission-sentences fails when an in-use key has no sentence AND when
// a sentence names a key that is not in use, so the table IS the catalogue's
// in-use list, readable from here. Platform keys never show in a tenant; a
// root-role-only key shows on the root role, so it counts like any other.

type Matrix = { roles: { matrix: { sentence: Record<string, string>; group?: Record<string, Record<string, string>> } } };
const SHOWN = Object.keys((en as Matrix).roles.matrix.sentence).filter((k) => !k.startsWith('platform:'));
const byModule = new Map<string, string[]>();
for (const key of SHOWN) {
  const module = key.split(':')[0]!;
  byModule.set(module, [...(byModule.get(module) ?? []), key]);
}

describe('permission groups (ACC-272)', () => {
  it('reads a real catalogue (non-vacuity)', () => {
    expect(SHOWN.length).toBeGreaterThan(20);
    expect(byModule.get('committees')?.length).toBeGreaterThan(GROUP_THRESHOLD);
  });

  it(`every module with more than ${GROUP_THRESHOLD} shown permissions has groups`, () => {
    const missing = [...byModule].filter(([m, keys]) => keys.length > GROUP_THRESHOLD && !PERMISSION_GROUPS[m]).map(([m]) => m);
    expect(missing).withContext('add its groups to permission-groups.ts').toEqual([]);
  });

  it("a module's groups cover its shown keys exactly once", () => {
    for (const [module, defs] of Object.entries(PERMISSION_GROUPS)) {
      const named = defs.flatMap((d) => [...d.keys]);
      const shown = byModule.get(module) ?? [];
      expect(named.filter((k, i) => named.indexOf(k) !== i)).withContext(`${module}: named twice`).toEqual([]);
      expect(shown.filter((k) => !named.includes(k))).withContext(`${module}: shown but in no group`).toEqual([]);
      expect(named.filter((k) => !shown.includes(k))).withContext(`${module}: in a group but not shown`).toEqual([]);
    }
  });

  it('every group has a name in both languages', () => {
    for (const [module, defs] of Object.entries(PERMISSION_GROUPS)) {
      for (const d of defs) {
        expect((en as Matrix).roles.matrix.group?.[module]?.[d.id]).withContext(`en ${module}.${d.id}`).toBeTruthy();
        expect((ar as Matrix).roles.matrix.group?.[module]?.[d.id]).withContext(`ar ${module}.${d.id}`).toMatch(/[؀-ۿ]/);
      }
    }
  });
});
