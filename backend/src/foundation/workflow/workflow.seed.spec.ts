import { SYSTEM_WORKFLOW_SEED } from './workflow.seed';
import { isVotingMove } from './workflow-vote';
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
  // ACC-316 — the meeting's own kinds; Minutes Review is the Chair's seat or the unit's approvers.
  MEETING: [
    'planned:ANY_ONE:MEETING_SCHEDULERS',
    'agenda_ready:ANY_ONE:MEETING_SCHEDULERS+MEETING_RECORDERS',
    'minutes_draft:ANY_ONE:MEETING_RECORDERS',
    'minutes_review:ANY_ONE:COMMITTEE+MEETING_APPROVERS',
    'minutes_approved:ANY_ONE:START',
    'cancelled:ANY_ONE:START',
  ],
  // ACC-283 PR 4 (plan §10) — Terms Review: the committee's own unit head, no unit named.
  COMMITTEE: ['formation:ANY_ONE:START', 'terms_review:ANY_ONE:ORG_UNIT_HEAD', 'active:ANY_ONE:START', 'suspended:ANY_ONE:START', 'dissolution_pending:ANY_ONE:START', 'dissolved:ANY_ONE:START'],
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

  it('seeds Terms Review on the committee’s own unit head, with no unit named (ACC-283 PR 4)', () => {
    const committee = SYSTEM_WORKFLOW_SEED.find((w) => w.objectType === 'COMMITTEE')!;
    const terms = committee.stages.find((s) => s.key === 'terms_review')!;
    expect(terms.who).toEqual({ mode: 'ANY_ONE', entries: [{ kind: 'ORG_UNIT_HEAD' }] });
    // No unit: the record's own (RECORD_ROUTES), so no starting assignment is written for it.
    expect('startingAssignment' in terms.who).toBe(false);
  });

  it('keeps a protected template on its creator: every committee change request stage is CREATOR', () => {
    for (const workflow of SYSTEM_WORKFLOW_SEED.filter((w) => PROTECTED_TEMPLATES.has(w.objectType))) {
      for (const stage of workflow.stages) expect([stage.key, pin(stage.who)]).toEqual([stage.key, 'ANY_ONE:CREATOR']);
    }
  });

  // PR 1 §11.1 — a stage whose people decide together has exactly ONE forward
  // move. Since ACC-284 the move's kind makes it a vote (isApprovalPath, which
  // used to mark it, is gone: ACC-294).
  it('gives every All of them stage exactly one forward move', () => {
    let checked = 0;
    for (const workflow of SYSTEM_WORKFLOW_SEED) {
      for (const stage of workflow.stages.filter((s) => isVotingMove(s.who.mode, 'ADVANCE'))) {
        const advances = workflow.transitions.filter((t) => t.fromStageKey === stage.key && (t.kind ?? 'ADVANCE') === 'ADVANCE');
        expect([`${workflow.objectType}.${stage.key}`, advances.length]).toEqual([
          `${workflow.objectType}.${stage.key}`,
          1,
        ]);
        checked++;
      }
    }
    expect(checked).toBe(3); // ACC-316: Minutes Review is no longer All of them
  });

  // ACC-271 PR 6a — the seed states each move's mover (seed-apply writes it);
  // PR 6b — the only people field a seeded move has. The APP moves are exactly today's: the
  // committee change request's eight, which its service fires. On the shared
  // database that is 8 per organisation (16 in its 2 organisations, 29 Oct).
  // ACC-316 — and the meeting's two, which the meeting endpoints fire (PR 4).
  it('states a mover on every move, and the APP moves are exactly the change request\'s eight and the meeting\'s two', () => {
    const all = SYSTEM_WORKFLOW_SEED.flatMap((w) => w.transitions.map((t) => ({ w: w.objectType, t })));
    expect(all).toHaveLength(74); // ACC-316: the meeting's draft-to-draft Return is gone
    for (const { t } of all) expect(['PERSON', 'APP']).toContain(t.mover);

    const app = all.filter(({ t }) => t.mover === 'APP').map(({ w, t }) => `${w}:${t.fromStageKey}>${t.toStageKey}`);
    expect(app.sort()).toEqual(
      [
        'COMMITTEE_CHANGE_REQUEST:draft>under_review',
        'COMMITTEE_CHANGE_REQUEST:returned>under_review',
        'COMMITTEE_CHANGE_REQUEST:under_review>approved',
        'COMMITTEE_CHANGE_REQUEST:under_review>returned',
        'COMMITTEE_CHANGE_REQUEST:under_review>rejected',
        'COMMITTEE_CHANGE_REQUEST:draft>withdrawn',
        'COMMITTEE_CHANGE_REQUEST:under_review>withdrawn',
        'COMMITTEE_CHANGE_REQUEST:returned>withdrawn',
        'MEETING:minutes_draft>minutes_review',
        'MEETING:minutes_review>minutes_draft',
      ].sort(),
    );
    expect(all.filter(({ t }) => t.mover === 'PERSON')).toHaveLength(64);
  });

});

// ACC-57 — what a new organisation starts with must already obey the rule a
// stage save is held to: exactly one starting stage, and it is not also final.
// The seed is static data, so this pin is its check; nothing checks it at run time.
describe('the workflow seed: start and end (ACC-57)', () => {
  it.each(SYSTEM_WORKFLOW_SEED.map((w) => [w.objectType, w] as const))('%s has exactly one starting stage, and it is not final', (_type, workflow) => {
    const starting = workflow.stages.filter((s) => s.isInitial);
    expect(starting).toHaveLength(1);
    expect(starting[0]!.isFinal).toBe(false);
    expect(workflow.stages.filter((s) => s.isInitial && s.isFinal)).toEqual([]);
  });
});
