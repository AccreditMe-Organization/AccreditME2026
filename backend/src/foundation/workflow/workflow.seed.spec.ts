import { SYSTEM_WORKFLOW_SEED } from './workflow.seed';
import { moverForTrigger, whoFromLegacy, decidesTogether } from './workflow-who';
import { PROTECTED_TEMPLATES } from './workflow-stage-keys';

// ACC-271 PR 2 (plan §5) — who works each seeded stage, pinned stage by stage.
// "CREATOR": the record's creator drives it. "START": no entry of its own; the
// tenant admin's starting assignment is written once the first admin is
// invited (assignStartingAssignments). SINGLE became ANY_ONE, PARALLEL ALL
// became ALL. A change here changes what every new organisation starts with,
// so it is a decision, not a refactor: change this table with it.
const PINNED: Record<string, string[]> = {
  DOCUMENT_REQUEST: ['submitted:ANY_ONE:CREATOR', 'unit_manager_review:ANY_ONE:START', 'quality_review:ANY_ONE:START', 'approved:ANY_ONE:START', 'rejected:ANY_ONE:START'],
  DOCUMENT: ['drafting:ANY_ONE:CREATOR', 'owners_review:ALL:START', 'stakeholders_review:ALL:START', 'final_approval:ALL:START', 'publish_approval:ANY_ONE:START', 'published:ANY_ONE:START', 'obsolete:ANY_ONE:START'],
  CHANGE_REQUEST: ['submitted:ANY_ONE:CREATOR', 'unit_manager_review:ANY_ONE:START', 'quality_review:ANY_ONE:START', 'approved:ANY_ONE:START', 'rejected:ANY_ONE:START'],
  INCIDENT: ['reported:ANY_ONE:START', 'investigating:ANY_ONE:START', 'root_cause_identified:ANY_ONE:START', 'closed:ANY_ONE:START', 'cancelled:ANY_ONE:START'],
  AUDIT: ['planning:ANY_ONE:START', 'announced:ANY_ONE:START', 'fieldwork:ANY_ONE:START', 'findings_draft:ANY_ONE:START', 'auditee_response:ANY_ONE:START', 'report_review:ANY_ONE:START', 'report_approved:ANY_ONE:START', 'corrective_action:ANY_ONE:START', 'verification:ANY_ONE:START', 'closed:ANY_ONE:START'],
  CORRECTIVE_ACTION: ['detection:ANY_ONE:START', 'investigation:ANY_ONE:START', 'root_cause_approved:ANY_ONE:START', 'action_planning:ANY_ONE:START', 'plan_approved:ANY_ONE:START', 'implementation:ANY_ONE:START', 'implementation_verified:ANY_ONE:START', 'effectiveness_check:ANY_ONE:START', 'effectiveness_approved:ANY_ONE:START', 'closed:ANY_ONE:START'],
  MEETING: ['planned:ANY_ONE:CREATOR', 'agenda_ready:ANY_ONE:CREATOR', 'minutes_draft:ANY_ONE:CREATOR', 'minutes_review:ALL:START', 'minutes_approved:ANY_ONE:START', 'cancelled:ANY_ONE:START'],
  COMMITTEE: ['formation:ANY_ONE:START', 'terms_review:ANY_ONE:START', 'active:ANY_ONE:START', 'suspended:ANY_ONE:START', 'dissolution_pending:ANY_ONE:START', 'dissolved:ANY_ONE:START'],
  COMMITTEE_CHANGE_REQUEST: ['draft:ANY_ONE:CREATOR', 'under_review:ANY_ONE:CREATOR', 'returned:ANY_ONE:CREATOR', 'approved:ANY_ONE:CREATOR', 'rejected:ANY_ONE:CREATOR', 'withdrawn:ANY_ONE:CREATOR'],
};

const pin = (who: (typeof SYSTEM_WORKFLOW_SEED)[number]['stages'][number]['who']): string =>
  `${who.mode}:${'entries' in who ? who.entries.map((e) => e.kind).join('+') : 'START'}`;

describe('the workflow seed: who works each stage (ACC-271 PR 2)', () => {
  it('pins every seeded stage of every template', () => {
    const actual = Object.fromEntries(SYSTEM_WORKFLOW_SEED.map((w) => [w.objectType, w.stages.map((s) => `${s.key}:${pin(s.who)}`)]));
    expect(actual).toEqual(PINNED);
    expect(Object.values(actual).flat()).toHaveLength(60);
  });

  it('seeds a CREATOR entry exactly where the creator drove the stage, and a starting assignment everywhere else', () => {
    for (const workflow of SYSTEM_WORKFLOW_SEED) {
      for (const stage of workflow.stages) {
        const creator = 'entries' in stage.who && stage.who.entries.some((e) => e.kind === 'CREATOR');
        expect([`${workflow.objectType}.${stage.key}`, creator]).toEqual([`${workflow.objectType}.${stage.key}`, stage.assigneeStrategy === 'SELF']);
      }
    }
  });

  it('maps the approval mode: SINGLE to Any one of them, PARALLEL ALL to All of them', () => {
    for (const stage of SYSTEM_WORKFLOW_SEED.flatMap((w) => w.stages)) {
      const expected = stage.approvalMode === 'SINGLE' ? 'ANY_ONE' : stage.approvalMode === 'PARALLEL' && stage.parallelThreshold === 'ALL' ? 'ALL' : 'unmapped';
      expect([stage.key, stage.who.mode]).toEqual([stage.key, expected]);
    }
  });

  it('keeps a protected template on its creator: every committee change request stage is CREATOR', () => {
    for (const workflow of SYSTEM_WORKFLOW_SEED.filter((w) => PROTECTED_TEMPLATES.has(w.objectType))) {
      for (const stage of workflow.stages) expect([stage.key, pin(stage.who)]).toEqual([stage.key, 'ANY_ONE:CREATOR']);
    }
  });

  // PR 1 §11.1 — a stage whose people decide together advances only by its
  // approval path; a forward move off it would send the record on at the
  // first press.
  it('puts the one forward move of every All of them stage on the approval path', () => {
    let checked = 0;
    for (const workflow of SYSTEM_WORKFLOW_SEED) {
      for (const stage of workflow.stages.filter((s) => decidesTogether(s.who.mode))) {
        const advances = workflow.transitions.filter((t) => t.fromStageKey === stage.key && (t.kind ?? 'ADVANCE') === 'ADVANCE');
        expect([`${workflow.objectType}.${stage.key}`, advances.length, advances.every((t) => t.isApprovalPath === true)]).toEqual([
          `${workflow.objectType}.${stage.key}`,
          1,
          true,
        ]);
        checked++;
      }
    }
    expect(checked).toBe(4);
  });

  it('marks the app\'s own moves APP and every other move PERSON', () => {
    const movers = SYSTEM_WORKFLOW_SEED.flatMap((w) => w.transitions.map((t) => moverForTrigger(t.triggerCondition)));
    expect(movers.filter((m) => m === 'APP')).toHaveLength(8);
    expect(movers.filter((m) => m === 'PERSON')).toHaveLength(67);
  });

  // The backfill's mapping applied to the seed's own old columns gives the
  // seed's `who` — with one stated exception: an Org unit head stage becomes
  // "the head of the record's unit" for an EXISTING organisation (Ahmad, 28 Oct,
  // PR 2 item 3), while a NEW one starts it on the tenant admin (item 1).
  it('agrees with the backfill mapping, except Org unit head stages', () => {
    for (const workflow of SYSTEM_WORKFLOW_SEED) {
      for (const stage of workflow.stages) {
        const mapped = whoFromLegacy({
          assigneeStrategy: stage.assigneeStrategy,
          approvalMode: stage.approvalMode,
          parallelThreshold: stage.parallelThreshold ?? null,
          assigneeUserId: null,
          assigneePositionId: null,
          assigneeOrgUnitId: null,
          committeeId: null,
          assigneeCommitteeRoleValueId: null,
        });
        const asPin = `${mapped.whoMode}:${mapped.startingAssignment ? 'START' : mapped.entries.map((e) => e.kind).join('+')}`;
        const expected = stage.assigneeStrategy === 'ORG_UNIT_HEAD' ? `${stage.who.mode}:ORG_UNIT_HEAD` : pin(stage.who);
        expect([`${workflow.objectType}.${stage.key}`, asPin]).toEqual([`${workflow.objectType}.${stage.key}`, expected]);
      }
    }
  });
});

describe('whoFromLegacy (the backfill mapping, plan §6.1)', () => {
  const base = {
    assigneeStrategy: 'ROLE',
    approvalMode: 'SINGLE',
    parallelThreshold: null,
    assigneeUserId: null,
    assigneePositionId: null,
    assigneeOrgUnitId: null,
    committeeId: null,
    assigneeCommitteeRoleValueId: null,
  };

  it.each([
    ['SPECIFIC_USER', { assigneeUserId: 'u1' }, [{ kind: 'SPECIFIC_USER', userId: 'u1' }]],
    ['POSITION_FIXED', { assigneePositionId: 'p1', assigneeOrgUnitId: 'ou1' }, [{ kind: 'POSITION_IN_UNIT', positionId: 'p1', orgUnitId: 'ou1' }]],
    ['ORG_UNIT_HEAD', {}, [{ kind: 'ORG_UNIT_HEAD', orgUnitId: null }]],
    ['SELF', {}, [{ kind: 'CREATOR' }]],
    ['COMMITTEE', { committeeId: 'c1', assigneeCommitteeRoleValueId: 'chair' }, [{ kind: 'COMMITTEE', committeeId: 'c1', committeeRoleValueId: 'chair' }]],
    ['ROLE', {}, []],
    ['ROUND_ROBIN', {}, []],
  ])('%s', (strategy, extra, entries) => {
    const mapped = whoFromLegacy({ ...base, assigneeStrategy: strategy, ...extra });
    expect(mapped.entries).toEqual(entries);
    expect(mapped.startingAssignment).toBe(entries.length === 0);
  });

  it.each([
    ['SINGLE', null, 'ROLE', 'ANY_ONE'],
    ['PARALLEL', 'ANY', 'ROLE', 'ANY_ONE'],
    ['PARALLEL', 'ALL', 'ROLE', 'ALL'],
    ['PARALLEL', 'MAJORITY', 'ROLE', 'ALL'],
    ['PARALLEL', 'MAJORITY', 'COMMITTEE', 'COMMITTEE_VOTE'],
    ['SEQUENTIAL', null, 'ROLE', 'ALL'],
    ['COMMITTEE', null, 'COMMITTEE', 'COMMITTEE_VOTE'],
    ['COMMITTEE', null, 'ROLE', 'ANY_ONE'],
  ])('%s %s on a %s stage → %s', (approvalMode, parallelThreshold, assigneeStrategy, whoMode) => {
    expect(whoFromLegacy({ ...base, approvalMode, parallelThreshold, assigneeStrategy, committeeId: 'c1' }).whoMode).toBe(whoMode);
  });

  it('reports what it decided for the rare modes, so the dry run can name them', () => {
    expect(whoFromLegacy({ ...base, approvalMode: 'PARALLEL', parallelThreshold: 'MAJORITY' }).notes).toEqual(['Majority became All of them']);
    expect(whoFromLegacy({ ...base, approvalMode: 'COMMITTEE' }).notes).toEqual([
      'Committee approval with no single Committee entry became Any one of them',
    ]);
  });
});
