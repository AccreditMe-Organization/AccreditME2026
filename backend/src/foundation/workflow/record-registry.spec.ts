import { readFileSync } from 'fs';
import { join } from 'path';
import { WorkflowObjectType } from '../../../generated/prisma/client';
import {
  COMMITTEE_ACTIONS,
  RECORD_ACTIONS,
  RECORD_FIELDS,
  STAGE_FLAG,
  STAGE_FLAGS,
  isRecordAction,
  isStageFlag,
  newStageActionKeys,
  orderedActionKeys,
  recordActionsFor,
} from './record-registry';
import { SYSTEM_WORKFLOW_SEED } from './workflow.seed';

// ACC-255 — the registries. Every label the server sends as a key must exist in
// BOTH translation files (the frontend renders them; the server sends keys
// only), keys are unique per record type, and the seed names only what the
// registries list — and reproduces today's committee rules exactly.

const REPO = join(__dirname, '..', '..', '..', '..');
const i18n = (lang: 'en' | 'ar'): Record<string, unknown> =>
  JSON.parse(readFileSync(join(REPO, 'frontend', 'src', 'assets', 'i18n', `${lang}.json`), 'utf8')) as Record<string, unknown>;
const lookup = (tree: Record<string, unknown>, key: string): unknown =>
  key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), tree);

const allLabelKeys = (): string[] => [
  ...Object.values(RECORD_ACTIONS).flatMap((defs) => defs!.map((d) => d.labelKey)),
  ...Object.values(STAGE_FLAGS).flatMap((defs) => defs!.map((d) => d.labelKey)),
  ...Object.values(RECORD_FIELDS).flatMap((defs) => defs!.map((d) => d.labelKey)),
];

describe('record registries (ACC-255)', () => {
  it.each(['en', 'ar'] as const)('every label key exists in %s.json, as a non-empty string', (lang) => {
    const tree = i18n(lang);
    const keys = allLabelKeys();
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const value = lookup(tree, key);
      expect({ key, ok: typeof value === 'string' && value.trim().length > 0 }).toEqual({ key, ok: true });
    }
  });

  it('keys are unique within each record type', () => {
    for (const registry of [RECORD_ACTIONS, STAGE_FLAGS, RECORD_FIELDS]) {
      for (const [type, defs] of Object.entries(registry)) {
        const keys = (defs as readonly { key: string }[]).map((d) => d.key);
        expect({ type, keys }).toEqual({ type, keys: [...new Set(keys)] });
      }
    }
  });

  it('committees have exactly the five actions the design names, in screen order', () => {
    expect(recordActionsFor('COMMITTEE').map((a) => a.key)).toEqual([
      'edit_details',
      'add_member',
      'remove_member',
      'change_member_role',
      'request_change',
    ]);
  });

  it('fails closed: a type with no entry has no actions, no flags and no fields', () => {
    expect(recordActionsFor('DOCUMENT')).toEqual([]);
    expect(isRecordAction('DOCUMENT', 'edit_details')).toBe(false);
    expect(isStageFlag('DOCUMENT', 'DISSOLVING')).toBe(false);
    expect(isStageFlag('COMMITTEE', 'APPLIES_APPROVED_CHANGE')).toBe(false);
    expect(isRecordAction('COMMITTEE', 'not_an_action')).toBe(false);
  });

  it("a stage a tenant adds gets the committee's member actions, which no stage ever limited, and nothing else", () => {
    expect(newStageActionKeys('COMMITTEE')).toEqual(['add_member', 'remove_member', 'change_member_role']);
    expect(newStageActionKeys('COMMITTEE_CHANGE_REQUEST')).toEqual([]);
    expect(newStageActionKeys('DOCUMENT')).toEqual([]);
  });

  it('orders keys as the registry lists them, dropping unknown ones', () => {
    expect(orderedActionKeys('COMMITTEE', ['request_change', 'nope', 'edit_details'])).toEqual(['edit_details', 'request_change']);
  });

  describe('the seed', () => {
    const seeded = SYSTEM_WORKFLOW_SEED.flatMap((w) => w.stages.map((s) => ({ type: w.objectType as WorkflowObjectType, stage: s })));

    it('names only registered actions and flags', () => {
      for (const { type, stage } of seeded) {
        for (const action of stage.actions ?? []) expect({ type, stage: stage.key, action, known: isRecordAction(type, action) }).toMatchObject({ known: true });
        for (const flag of stage.flags ?? []) expect({ type, stage: stage.key, flag, known: isStageFlag(type, flag) }).toMatchObject({ known: true });
      }
    });

    it('puts every exactly-one flag on exactly one stage of its template', () => {
      for (const workflow of SYSTEM_WORKFLOW_SEED) {
        for (const def of STAGE_FLAGS[workflow.objectType as WorkflowObjectType] ?? []) {
          if (def.cardinality !== 'exactlyOne') continue;
          const holders = workflow.stages.filter((s) => (s.flags ?? []).includes(def.key)).map((s) => s.key);
          expect({ type: workflow.objectType, flag: def.key, holders }).toEqual({ type: workflow.objectType, flag: def.key, holders: [expect.any(String)] });
        }
      }
    });

    it("gives the committee stages the plan's §4.1 rules, with Dissolved's member changes removed (§16.2, Q-A)", () => {
      const committee = SYSTEM_WORKFLOW_SEED.find((w) => w.objectType === 'COMMITTEE')!;
      const rules = Object.fromEntries(committee.stages.map((s) => [s.key, { actions: [...(s.actions ?? [])].sort(), flags: [...(s.flags ?? [])] }]));
      const members = [COMMITTEE_ACTIONS.ADD_MEMBER, COMMITTEE_ACTIONS.CHANGE_MEMBER_ROLE, COMMITTEE_ACTIONS.REMOVE_MEMBER].sort();
      expect(rules).toEqual({
        formation: { actions: [COMMITTEE_ACTIONS.EDIT_DETAILS, ...members].sort(), flags: [] },
        terms_review: { actions: members, flags: [] },
        active: { actions: [...members, COMMITTEE_ACTIONS.REQUEST_CHANGE].sort(), flags: [STAGE_FLAG.IN_FORCE] },
        suspended: { actions: [...members, COMMITTEE_ACTIONS.REQUEST_CHANGE].sort(), flags: [STAGE_FLAG.IN_FORCE] },
        dissolution_pending: { actions: members, flags: [STAGE_FLAG.DISSOLVING] },
        dissolved: { actions: [], flags: [STAGE_FLAG.DISSOLVING] },
      });
    });

    it('flags the change request template\'s Approved stage, and nothing else there', () => {
      const request = SYSTEM_WORKFLOW_SEED.find((w) => w.objectType === 'COMMITTEE_CHANGE_REQUEST')!;
      expect(request.stages.filter((s) => s.flags?.length).map((s) => [s.key, s.flags])).toEqual([['approved', [STAGE_FLAG.APPLIES_APPROVED_CHANGE]]]);
      expect(request.stages.some((s) => s.actions?.length)).toBe(false);
    });
  });
});
