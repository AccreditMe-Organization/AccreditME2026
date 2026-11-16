import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { DEFERRED_SETUP_CONDITION_TYPES, SetupConditionDetectors } from './setup-condition.detectors';
import { SetupConditionReconciler } from './setup-condition.reconciler';

// ACC-283 PR 1 — CHANGE_REQUEST_WITHOUT_DECIDER exists in the enum and NOTHING
// WRITES IT (CLAUDE.md's enum rule: the value must be deployed before the code
// that writes it). PR 3 adds the detector and takes it off the deferred list;
// until then each of these must hold.

const TYPE = 'CHANGE_REQUEST_WITHOUT_DECIDER';

/** Every non-spec TypeScript file under `dir`, recursively. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.ts$/.test(name) && !/\.(db-)?spec\.ts$/.test(name) ? [path] : [];
  });
}

describe('CHANGE_REQUEST_WITHOUT_DECIDER is deferred: nothing writes it (ACC-283 PR 1)', () => {
  it('is on the deferred list', () => {
    expect(DEFERRED_SETUP_CONDITION_TYPES).toContain(TYPE);
  });

  it('has no detector', () => {
    const detectors = new SetupConditionDetectors({} as PrismaService);
    expect(Object.keys(detectors.byType)).not.toContain(TYPE);
  });

  it('the reconciler — the only writer of SetupCondition — never reconciles it', async () => {
    const reconciler = new SetupConditionReconciler({} as PrismaService, new SetupConditionDetectors({} as PrismaService));
    const reconcileType = jest
      .spyOn(reconciler, 'reconcileType')
      .mockImplementation(async (_org, type) => ({ type, outcome: 'SUCCEEDED', opened: 0, refreshed: 0, cleared: 0 }) as never);

    await reconciler.reconcileTenant('org-1', new Date('2026-11-16T09:00:00.000Z'));

    expect(reconcileType).toHaveBeenCalled();
    expect(reconcileType.mock.calls.map(([, type]) => type)).not.toContain(TYPE);
  });

  it('no backend source names it except the deferred list (and the schema that declares it)', () => {
    const backend = join(__dirname, '..', '..', '..');
    const naming = [...sources(join(backend, 'src')), ...sources(join(backend, 'prisma'))]
      .filter((path) => readFileSync(path, 'utf8').includes(TYPE))
      .map((path) => relative(backend, path).split('\\').join('/'));
    expect(naming).toEqual(['src/foundation/setup-health/setup-condition.detectors.ts']);
  });
});
