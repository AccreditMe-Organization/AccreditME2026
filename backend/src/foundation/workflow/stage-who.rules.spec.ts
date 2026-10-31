import { HttpException } from '@nestjs/common';
import {
  assertWhoShape,
  assigneeKindsFor,
  DEFAULT_WHO_MODE,
  KIND_FIELDS,
  STAGE_ASSIGNEE_KINDS,
  STAGE_WHO_MODES,
  whoRulesFor,
  type WhoEntryField,
  type WhoEntryInput,
} from './stage-who';
import type { StageAssigneeKind, StageWhoMode, WorkflowObjectType } from '../../../generated/prisma/client';

/**
 * ACC-271 PR 5-be — the rules the stage screens are served (`whoRules` on the
 * template read) and the rules the save checks (assertWhoShape) must be one set.
 * This spec never restates a rule: it reads the served rules and asks the
 * validator, for every record type, kind and mode, so the two cannot drift.
 */

const ROUTES = { unit: true, committee: true };
const OBJECT_TYPES = Object.keys(STAGE_ASSIGNEE_KINDS) as WorkflowObjectType[];

function code(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    if (e instanceof HttpException) return (e.getResponse() as { code: string }).code;
    throw e;
  }
}

/** An entry of this kind with every field the SERVED rules say it requires, and nothing else. */
function entryFrom(kind: StageAssigneeKind, requires: WhoEntryField[], tag = ''): WhoEntryInput {
  const entry: WhoEntryInput = { kind };
  for (const field of requires) entry[field] = `${field}-${kind}${tag}`;
  return entry;
}

describe('whoRules: what the stage screens are served agrees with what the save checks (ACC-271 PR 5-be)', () => {
  it('non-vacuity: every record type has kinds, and there are three modes', () => {
    expect(OBJECT_TYPES.length).toBeGreaterThan(0);
    for (const type of OBJECT_TYPES) expect(Object.keys(whoRulesFor(type).kinds).length).toBeGreaterThan(0);
    expect(whoRulesFor('COMMITTEE').modes.map((m) => m.key)).toEqual([...STAGE_WHO_MODES]);
  });

  describe.each(OBJECT_TYPES)('%s', (type) => {
    const rules = whoRulesFor(type);

    it('serves exactly the kinds a stage of this type may use, with their fields', () => {
      expect(Object.keys(rules.kinds)).toEqual(assigneeKindsFor(type));
      for (const kind of assigneeKindsFor(type)) {
        expect(rules.kinds[kind]).toEqual({ uses: [...KIND_FIELDS[kind].uses], requires: [...KIND_FIELDS[kind].requires] });
      }
    });

    it.each(STAGE_ASSIGNEE_KINDS[type].map((k) => [k]))('%s: the served required fields are enough, and each one is needed', (kind) => {
      const { uses, requires } = rules.kinds[kind]!;
      // With exactly the served required fields, the validator accepts it…
      expect(code(() => assertWhoShape(type, { mode: 'ANY_ONE', entries: [entryFrom(kind, requires)] }, ROUTES))).toBeUndefined();
      // …without any one of them, it refuses naming that field…
      for (const missing of requires) {
        const entry = entryFrom(kind, requires.filter((f) => f !== missing));
        expect(code(() => assertWhoShape(type, { mode: 'ANY_ONE', entries: [entry] }, ROUTES))).toBe('WHO_ENTRY_INCOMPLETE');
      }
      // …every field it is served as using may be set…
      expect(code(() => assertWhoShape(type, { mode: 'ANY_ONE', entries: [entryFrom(kind, uses)] }, ROUTES))).toBeUndefined();
      // …and a field it is not served as using is refused.
      const unused = (['userId', 'positionId', 'orgUnitId', 'committeeId', 'committeeRoleValueId'] as WhoEntryField[]).filter((f) => !uses.includes(f));
      for (const field of unused) {
        const entry = { ...entryFrom(kind, requires), [field]: 'stray' };
        expect(code(() => assertWhoShape(type, { mode: 'ANY_ONE', entries: [entry] }, ROUTES))).toBe('WHO_ENTRY_FIELD_NOT_USED');
      }
    });

    it.each(rules.modes.map((m) => [m.key, m] as const))('mode %s: allowed exactly where the served rule says', (_key, mode) => {
      for (const kind of STAGE_ASSIGNEE_KINDS[type]) {
        const one = [entryFrom(kind, rules.kinds[kind]!.requires)];
        const allowedForOne = mode.onlyWithSingle === undefined || mode.onlyWithSingle === kind;
        const got = code(() => assertWhoShape(type, { mode: mode.key as StageWhoMode, entries: one }, ROUTES));
        expect({ mode: mode.key, kind, got }).toEqual({ mode: mode.key, kind, got: allowedForOne ? undefined : 'COMMITTEE_VOTE_NEEDS_ONE_COMMITTEE' });
      }
      // Two entries: a mode limited to a single entry is never allowed.
      const kinds = STAGE_ASSIGNEE_KINDS[type];
      const two = [entryFrom(kinds[0]!, rules.kinds[kinds[0]!]!.requires, 'a'), entryFrom(kinds[1]!, rules.kinds[kinds[1]!]!.requires, 'b')];
      expect(code(() => assertWhoShape(type, { mode: mode.key as StageWhoMode, entries: two }, ROUTES))).toBe(
        mode.onlyWithSingle === undefined ? undefined : 'COMMITTEE_VOTE_NEEDS_ONE_COMMITTEE',
      );
    });

    it('the default mode is always valid where the screen shows no choice (one entry that is not the single-entry kind)', () => {
      expect(rules.defaultMode).toBe(DEFAULT_WHO_MODE);
      expect(rules.modes.find((m) => m.key === rules.defaultMode)?.onlyWithSingle).toBeUndefined();
      for (const kind of STAGE_ASSIGNEE_KINDS[type]) {
        const hidesChoice = rules.modeChoiceShownWhen.minEntries > 1 && kind !== rules.modeChoiceShownWhen.orSingleKind;
        if (!hidesChoice) continue;
        const one = [entryFrom(kind, rules.kinds[kind]!.requires)];
        expect(code(() => assertWhoShape(type, { mode: rules.defaultMode, entries: one }, ROUTES))).toBeUndefined();
      }
    });

    it('the mode choice is shown for the single entry the vote needs, so Committee vote can always be reached', () => {
      for (const mode of rules.modes) {
        if (mode.onlyWithSingle === undefined) continue;
        expect(rules.modeChoiceShownWhen.orSingleKind).toBe(mode.onlyWithSingle);
      }
      expect(rules.modeChoiceShownWhen.minEntries).toBe(2);
    });
  });

  it('serves copies: changing what a reader was given changes no rule', () => {
    const served = whoRulesFor('COMMITTEE');
    served.kinds.COMMITTEE!.requires.push('committeeId');
    served.modes.pop();
    served.modeChoiceShownWhen.minEntries = 9;
    expect(KIND_FIELDS.COMMITTEE.requires).toEqual([]);
    expect(whoRulesFor('COMMITTEE').modes).toHaveLength(3);
    expect(whoRulesFor('COMMITTEE').modeChoiceShownWhen.minEntries).toBe(2);
  });
});
