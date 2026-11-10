# Step 284: a press on a stage decided together is a vote when it moves the record forward

**Ticket:** [ACC-284](https://linear.app/accreditme/issue/ACC-284), "workflow: seeded committee Approve
moves count as votes on an All-of-them stage". Found in ACC-282 (`pool-member-moves.db-spec.ts`).

**Status:** plan only, no code. Branch `fix/ACC-284-vote-on-advance` from `origin/dev` at `6c1aa62`.

**Recommendation: fix B.** The engine decides by the move's `kind` (ACC-190), not by `isApprovalPath`.
On a stage decided together (whoMode ALL or COMMITTEE_VOTE):
- an ADVANCE press is a vote, and the record waits for the threshold;
- RETURN and EXIT act at once.

`isApprovalPath` then has no reader that changes behaviour. It is hidden on the screens now and
dropped later, expand-then-contract. **No backfill:** on the shared database fix B changes the
behaviour of 0 moves today (§3.3).

---

## Decisions (Ahmad, 10 Nov)

These override the plan below where they differ.

1. **Q1 (i): every vote records which move it is for.** One nullable column,
   `WorkflowApproval.transitionId` (additive migration, `acc284_vote_move`). Votes count per move:
   a move goes through when ITS OWN threshold is met.
2. **Q2: RETURN acts at once on every group stage.** EXIT acts at once on an "All of them" stage,
   **but on a committee vote stage EXIT is a vote, like ADVANCE**, and needs the committee's
   threshold. Specs for both, with mutation checks.
3. **Q3: hide** the approval-path checkbox and the "Approval Path" tag now. The API still accepts
   the field, so nothing breaks, but the engine does not read it.
4. **Q4:** lane B opens the follow-up ticket that drops `isApprovalPath`.
5. **The migration** must not reach the shared database before the deploy. It runs in the
   pre-deploy step as usual. Locally it is created and applied on 55432 only.

### The rules, as built

**Which press is a vote** (a "group stage" is whoMode ALL or COMMITTEE_VOTE; ANY_ONE stages are
unchanged, and one press moves the record):

| kind | "All of them" (ALL) | Committee vote (COMMITTEE_VOTE) |
| -- | -- | -- |
| ADVANCE | a vote for this move | a vote for this move |
| RETURN | acts at once | acts at once |
| EXIT | acts at once | **a vote for this move** |

- **A vote** is the member's one `WorkflowApproval` row in this stage entry: decision APPROVED,
  `transitionId` = the move pressed.
  - Pressing again, on the same or another voting move, replaces their vote (the existing upsert
    on entry + member). So a member can change their mind, and is never counted twice.
- **Acting at once** writes the member's row as RETURNED (`transitionId` = the move) and moves the
  record with outcome REJECTED, as a send-back does today.
- **The outcome stored on the stage entry:** ADVANCE → APPROVED; RETURN and EXIT (at once or by
  vote) → REJECTED.

**When a voting move M goes through** (`isApprovalThresholdMet(stage, entry, M)`). The votes
counted are the entry's APPROVED rows, after the pressing member's new vote replaces their old one.

- **"All of them":** every CURRENT pool member has a vote for M. A member standing in for someone
  away covers them, as today, and someone who left is no longer waited for (ACC-271 Q6).
  - "Everyone has voted" is not enough on its own: members who voted for different moves block
    each move until they agree. This is the per-move rule (decision 1).
  - An empty pool decides nothing, as today.
- **Committee vote:**
  - **quorum:** the votes cast in the entry, for ANY move, reach the quorum saved at stage entry
    (`quorumCount`, ACC-239; else the live one);
  - **majority:** the votes for M are MORE than half of the votes cast;
  - so with quorum 3 and votes 2 for ADVANCE and 1 for EXIT, ADVANCE goes through (3 cast, 2 > 1.5);
  - a vote for another move counts toward the quorum, never toward M;
  - a stage whose committee resolves to none decides nothing, as today.
- **A vote cast before this deploy** (`transitionId` null) counts for the stage's ADVANCE moves, as
  it did. On the shared database there are none: 0 open entries on group stages, 0 votes (§3.3).

**The gate (ACC-190 J):** for an ADVANCE, the deciding vote (the one that makes M's threshold) is
refused before it is recorded while a mandatory task is open, and the record's preconditions are
checked, as today. RETURN and EXIT have no task gate.

**`submitApproval()`** (no frontend caller): APPROVED / APPROVED_WITH_COMMENTS is a vote for the
stage's ADVANCE; RETURNED / REJECTED acts at once along its RETURN. When a stage has not exactly
one such move, the answer is 409 `VOTE_MOVE_AMBIGUOUS`, naming the stage. ABSTAINED is recorded and
decides nothing, as today.

---

## 1. What was read

- **The ticket:** ACC-284 (Todo, Medium). It proposes fix A: set `isApprovalPath` on the seeded
  committee moves, plus a backfill.
- **The engine:** `WorkflowService.triggerTransition()`, `submitApproval()`,
  `maybeAdvanceAfterApproval()`, `assertDecidingVoteMayAdvance()`, `isApprovalThresholdMet()`,
  `performTransition()` and `decidesAlone()` (`backend/src/foundation/workflow/workflow.service.ts`).
- **The seed:** `workflow.seed.ts` (`SYSTEM_WORKFLOW_SEED`, every template) and
  `workflow-seed-apply.ts`.
- **The ACC-271 backfill:** `backend/prisma/backfill-acc271-stage-assignees.ts`, which marked
  `isApprovalPath` on conversion.
- **The screens:** the transition panel and the transition editor.
- **SYSTEM-REFERENCE:** §2.15 (the gate) and §2.19 / §2.19.1 (the pool, ACC-282's note on this
  quirk).

Line numbers are `dev` at `6c1aa62`.

---

## 2. Answers

### 2a. What a press does today on an ALL or COMMITTEE_VOTE stage

`decidesAlone()` is `whoMode === 'ANY_ONE'` (`workflow.service.ts:1550-1551`), so for these stages
`triggerTransition()` takes the multi-person branch:

- The vote is written as APPROVED when `isApprovalPath` is true, else RETURNED (`:653`, upsert at
  `:660-683`).
- A non-approval-path press moves the record at once, with outcome REJECTED (`:685-697`).
- An approval-path press waits for `isApprovalThresholdMet()` (`:702-706`), then moves with outcome
  APPROVED (`:708-718`).
- The early gate (mandatory tasks, then the record's preconditions) runs only for an ADVANCE, and
  only when the press would fire (`:619-635`). For a non-approval-path ADVANCE it always fires
  (`:622`).

| kind | `isApprovalPath` | Today, on ALL or COMMITTEE_VOTE | Right? |
| -- | -- | -- | -- |
| ADVANCE | true | A vote (APPROVED). The record waits; the deciding vote moves it with outcome APPROVED. The gate runs on the deciding vote only. | yes |
| **ADVANCE** | **false** | **Recorded as a RETURNED vote, then the record moves forward at once with outcome REJECTED.** The gate runs, because the move fires. | **no**: one person decides alone, and the forward move is stored as a rejection |
| RETURN / EXIT | false | A RETURNED vote; the record moves at once with outcome REJECTED. No gate (not an ADVANCE). | yes: a send-back needs no threshold (§2.19 Q-rule) |
| RETURN / EXIT | true | **An APPROVED vote that waits for the threshold**; once met, the record goes back or ends with outcome APPROVED. | no: a send-back that needs everyone, stored as an approval |

`submitApproval()` (`:721-799`, `POST /workflows/instance-stages/:id/approvals`) also finds its
move by the flag:
- an approval looks up the stage's `isApprovalPath: true` move (`:846-848`);
- a return looks up its `false` move (`:823-826`);
- its deciding-vote gate does the same (`:868-893`).

**It has no frontend caller** (grep of `frontend/src`: none). Every press is
`triggerTransition()`.

### 2b. Seeded ADVANCE moves with `isApprovalPath` false

All nine templates (`workflow.seed.ts`; listed by a script over `SYSTEM_WORKFLOW_SEED`): 44 such
moves. **Every one starts from an ANY_ONE stage**, where the flag is not read.

| Template | Stages (who) | ADVANCE moves with `isApprovalPath` false (from → to) |
| -- | -- | -- |
| DOCUMENT_REQUEST | 5 ANY_ONE | submitted → unit_manager_review; unit_manager_review → quality_review; quality_review → approved |
| DOCUMENT | 4 ANY_ONE, **3 ALL** | drafting → owners_review; publish_approval → published; published → obsolete. **The 3 ALL stages' ADVANCEs are already `true`** (`:132`, `:134`, `:136`) |
| INCIDENT | 5 ANY_ONE | reported → investigating; investigating → root_cause_identified; investigating → closed; root_cause_identified → closed |
| AUDIT | 10 ANY_ONE | planning → announced; announced → fieldwork; fieldwork → findings_draft; findings_draft → auditee_response; auditee_response → report_review; report_review → report_approved; report_approved → corrective_action; corrective_action → verification; verification → closed |
| CORRECTIVE_ACTION | 10 ANY_ONE | detection → investigation; investigation → root_cause_approved; root_cause_approved → action_planning; action_planning → plan_approved; plan_approved → implementation; implementation → implementation_verified; implementation_verified → effectiveness_check; effectiveness_check → effectiveness_approved; effectiveness_approved → closed |
| MEETING | 5 ANY_ONE, **1 ALL** | planned → agenda_ready; agenda_ready → minutes_draft; minutes_draft → minutes_review. **The ALL stage's ADVANCE (minutes_review → minutes_approved) is `true`** (`:252`) |
| COMMITTEE | 6 ANY_ONE | formation → terms_review; terms_review → active; active → suspended; suspended → active; active → dissolution_pending; suspended → dissolution_pending; dissolution_pending → dissolved |
| COMMITTEE_CHANGE_REQUEST | 6 ANY_ONE (protected) | draft → under_review; returned → under_review; under_review → approved (all mover APP) |
| CHANGE_REQUEST | 5 ANY_ONE | submitted → unit_manager_review; unit_manager_review → quality_review; quality_review → approved |

**The rule the seed already follows:** a stage decided together has exactly one ADVANCE, and it is
on the approval path. The bug appears only when a tenant changes a stage's who mode to ALL or
COMMITTEE_VOTE later. **Nothing marks the move then:**
- the stage editor neither sets the flag nor warns;
- only the ACC-271 backfill marked it, once, at conversion (`backfill-acc271-stage-assignees.ts:168-172`, `:304-305`).

**Not only COMMITTEE:** the same switch on any template's stage, such as AUDIT's report_review,
hits the same bug. Fix A, as the ticket scopes it, covers the committee moves only.

### 2c. Who else reads `isApprovalPath`

- **The engine:**
  - `triggerTransition()`: the gate (`workflow.service.ts:622`), the vote's decision (`:653`) and the move-at-once branch (`:685`);
  - `submitApproval()`'s helpers (`:824`, `:847`, `:886`).
  - Nothing else in `backend/src` reads it.
- **The moves read:** no. `GET /workflows/instances/:id/moves` selects `id, mover, labelEn,
  labelAr, kind, toStageId, toStage` (`:302-313`). The record page's buttons never see it.
- **The screens:**
  - the transition panel's "This is the approval path (advances the workflow)" checkbox
    (`transition-panel.component.ts:218-219`, form `:506`, `:656`, `:718`);
  - the transition list's "Approval Path" tag (`workflow-transition-editor.component.ts:100-102`);
  - both are display and edit only.
- **The template API:**
  - written on create and update (`workflow-template.service.ts:1024`, `:1061`);
  - returned on the template read (`:1310`);
  - recorded in the transition's audit before and after (`:1076`, `:1084`).
- **The approval records:** `WorkflowApproval.decision` is derived from it (APPROVED or RETURNED,
  `:653`). The vote stores no move id (see §2e).
- **The seed and the backfill:** `workflow.seed.ts:36` and the four `true` moves;
  `workflow-seed-apply.ts:134`; the ACC-271 backfill (a historical script, run 29 Oct).

### 2d. Is there a real case where an ADVANCE on a multi-person stage should NOT wait?

**No.** ACC-190's kinds already name the moves that act at once:
- RETURN sends the record back;
- EXIT ends it.

An ADVANCE is the stage's decision to move forward, which is what "All of them" and a committee
vote exist to require. Every seeded stage decided together already treats its ADVANCE as a vote
(§2b), so the seed and fix B agree. A tenant who wants one person to move the record forward sets
the stage to "Any one of them".

### 2e. Found while answering: a vote does not say which move it is for

`WorkflowApproval` has `decision`, but no `transitionId`. So on a stage decided together with two
or more ADVANCE moves, every APPROVED vote counts toward the threshold whichever ADVANCE it was
pressed on, and the deciding press's move wins.

For example, COMMITTEE `active` has Suspend and Initiate Dissolution. Set it to "All of them": one
member presses Suspend and the other Initiate Dissolution, and the committee goes to Dissolution
Pending, although nobody agreed on that.

- **Today** this cannot arise: both moves are `false`, so the first press moves the record (the bug
  above).
- **Under either fix it would.** It needs a decision (§6, Q1).
- **Live:** on the shared database, 0 stages decided together have more than one ADVANCE (§3.3).

---

## 3. Two fixes

### 3.1 Fix A: the ticket's (mark the seeded moves, plus a backfill)

- **Seed:** `isApprovalPath: true` on the committee's ADVANCE moves (the ticket: at least Submit
  for Approval and Approve Committee). For coverage, the other templates' 37 too.
- **Backfill** (`backfill-acc284-committee-approval-path.ts`): seeded moves still `false`, matched
  by stage key and target; dry run, `-- --execute`, dry run 0; after the deploy.
- **The engine is unchanged.**

**What it leaves broken:**
- **Any move a tenant adds or edits** stays `false` unless they tick the checkbox, which reads
  "This is the approval path" and says nothing about votes. Switching such a stage to "All of
  them" reintroduces the bug.
- **Unticking the box** on a seeded move does the same.
- **The second wrong row of §2a** stays (a RETURN or EXIT marked `true` waits for everyone).
- **The ADVANCE stored as REJECTED** stays, for any `false` ADVANCE.
- **§2e** is not addressed.

**For a tenant who has edited their moves:**
- the backfill skips edited and added moves (it matches seeded keys only), so they keep today's
  behaviour, bug included;
- a seeded move they left alone becomes a vote on a stage decided together.

### 3.2 Fix B (recommended): the engine decides by `kind`

On a stage decided together (`!decidesAlone(stage)`):
- **ADVANCE:** an APPROVED vote. The record waits for `isApprovalThresholdMet()`; the deciding vote
  moves it with outcome APPROVED. The gate runs on the deciding vote, as today.
- **RETURN / EXIT:** a RETURNED vote, and the record moves at once with outcome REJECTED, as today
  for a `false` move.
- **ANY_ONE stages: unchanged** (the press moves the record; the flag was never read there).

**`submitApproval()`** looks its moves up by kind:
- approval: the stage's ADVANCE;
- return: its RETURN, else its EXIT.

Several of one kind become a 409 naming the stage, not a silent first pick. It has no caller, so
this only keeps it honest.

**`isApprovalPath` becomes dead:** no reader changes behaviour.
- **Expand (this ticket):**
  - stop reading it in the engine;
  - hide the checkbox and the tag on the screens;
  - the API keeps accepting it and storing it, so nothing deployed breaks;
  - the seed keeps writing it;
  - the template read keeps returning it.
- **Contract (a later ticket, after this deploys):**
  - drop it from the DTO, the template read and the seed;
  - then a migration drops `WorkflowTransition.isApprovalPath`;
  - nothing deployed reads it by then.

**Backfill: none.** The decision comes from `kind`, which every seeded move already has (ACC-190
set every seeded RETURN and EXIT), and §3.3 shows no stored move changes behaviour.

**For a tenant who has edited their moves:**
- **An ADVANCE they marked `false`, on a stage decided together:** today the first press moves the
  record; under B it is a vote and waits. This is the fix itself.
- **A RETURN or EXIT they marked `true`, on such a stage:** today it waits for everyone; under B it
  acts at once.
- **Edited labels, targets, validators, actions:** untouched.
- **Moves on ANY_ONE stages:** untouched.

### 3.3 What changes on the shared database today

Read-only, from `D:\Accredit-me-2\backend`, 10 Nov:

| | al-manara | al-nakheel |
| -- | -- | -- |
| Stages | 60 | 60 |
| Decided together (ALL or COMMITTEE_VOTE), per template | DOCUMENT ALL 3, MEETING ALL 1 | DOCUMENT ALL 3, MEETING ALL 1 |
| COMMITTEE_VOTE stages | 0 | 0 |
| Their ADVANCE moves | 4, all `true` | 4, all `true` |
| Their ADVANCE moves with `false` (B makes them votes) | **0** | **0** |
| Their RETURN / EXIT moves marked `true` (B makes them act at once) | **0** | **0** |
| Of them with more than one ADVANCE (§2e) | 0 | 0 |
| Open entries on them, and votes recorded | 0, 0 | 0, 0 |
| ADVANCE moves with `false`, every template (fix A's scope) | 44 | 44 |

The platform organisation has no stages.

- **Fix B changes the behaviour of nothing stored today.** It changes what happens the moment a
  stage is set to ALL or COMMITTEE_VOTE.
- **Fix A changes 7 committee rows per organisation** (44 if widened), all on ANY_ONE stages, so it
  too changes nothing a person sees today, and it leaves the trap in place.

### 3.4 Why B

1. **It fixes the class, not the seeded instances.** A move added tomorrow, on any template, is
   right without anyone ticking a box.
2. **One field, one meaning.**
   - `kind` already says forward, back or end, and the gate, the stage-exit cancel and the closed
     notices read it (ACC-190, ACC-271 PR 4).
   - `isApprovalPath` was a second, older answer to the same question (its own header note,
     `workflow.service.ts:79-84`), and the two disagreed in 44 rows.
3. **No backfill and no data write** on a shared database.
4. **It also fixes §2a's other two wrong rows:**
   - a forward move stored as REJECTED;
   - a send-back that waits for everyone.

---

## 4. The plan (fix B)

### 4.1 Backend

- **`workflow.service.ts`:**
  - **`triggerTransition()`:**
    - the multi-person branch decides by `transition.kind === 'ADVANCE'`, never by
      `isApprovalPath`;
    - the early gate's `fires` uses the same test (`:619-635`).
  - **`maybeAdvanceAfterApproval()` / `assertDecidingVoteMayAdvance()`:** find the move by kind
    (ADVANCE for an approval; RETURN, else EXIT, for a return). Several of one kind: 409
    `VOTE_MOVE_AMBIGUOUS`, naming the stage, from the code (`workflow-refusal.ts`).
  - **The NOTE at `:79-84`:** rewritten to say `kind` decides.
- **`workflow-template.service.ts`:** unchanged. The flag is still accepted, stored, returned and
  audited (expand).
- **§2e, per Q1:**
  - **recommended: (i)**, the vote records its move:
    - **schema:** a nullable `WorkflowApproval.transitionId` (FK to `WorkflowTransition`,
      `onDelete: SetNull`), additive; `migrate dev --name acc284_vote_move`;
    - **the vote:** written on every `triggerTransition()` upsert;
    - **the threshold:** counts only APPROVED votes for the pressed ADVANCE. A vote with no move
      (cast before this deploy) still counts, as today;
    - **a member who presses another ADVANCE** changes their vote (the upsert already keeps one
      vote per member per entry);
  - **(ii)**, the alternative: refuse a stage decided together with more than one ADVANCE, at
    save (`STAGE_VOTE_SEVERAL_FORWARD_MOVES`), both when the who mode changes and when a second
    ADVANCE is added. No migration, but it forbids, for example, "All of them" on the committee's
    Active stage.
- **Performance:**
  - `kind` is on the transition row already read, so no query is added;
  - (i) adds a column to a write that already happens, and a filter to a read that already
    happens;
  - nothing on the per-request path.

### 4.2 Frontend (lane B's workflow screens, ACC-255 PR 4)

- **`transition-panel.component.ts`:** the approval-path checkbox is removed from the form. The
  form stops sending the field, so the stored value stays as it is (expand).
- **`workflow-transition-editor.component.ts`:** the "Approval Path" tag is removed. Kind already
  shows as a chip.
- **The i18n keys `workflow.approvalPath` and `workflow.isApprovalPath`** stay until the contract
  ticket (no existing string changes).
- **No new string,** unless Q1 is (ii), which adds the refusal sentence in en/ar.

### 4.3 Specs

- **New `vote-on-advance.db-spec.ts`** (real Postgres on 55432, `test:db`). The seeded COMMITTEE
  template, provisioned by the seed's own code (`applyWorkflowSeed`); every move left exactly as
  seeded, so Approve Committee keeps `isApprovalPath` false:
  1. **"All of them" (Terms Review set to ALL, two pool members):**
     - the first press of the seeded Approve Committee is an APPROVED vote, and the committee stays
       in Terms Review;
     - the second press moves it to Active, with outcome APPROVED.
  2. **A committee vote with a quorum (Terms Review set to COMMITTEE_VOTE on a committee of three,
     quorum 2):**
     - the first press is a vote and the committee waits;
     - the second press makes quorum with a majority and moves it.
  3. **RETURN still acts at once:**
     - on the ALL stage, one member's press of the seeded RETURN, Terms Review → Formation
       "Revise Terms" (`workflow.seed.ts:276`), sends the committee back immediately, outcome
       REJECTED, with no other vote;
     - the same with that move's `isApprovalPath` set to true, which proves the flag is no longer
       read.
  4. **EXIT acts at once:** DOCUMENT_REQUEST's seeded EXIT, quality_review → rejected "Reject
     Request" (`workflow.seed.ts:112`), on that stage set to ALL.
  5. **The gate on the deciding vote only:** with a mandatory stage task open, the first ADVANCE
     vote is recorded, and the deciding one is refused `STAGE_TASKS_OPEN` before it is recorded
     (ACC-190 J, now by kind).
  6. **If Q1 is (i):**
     - two members press two different ADVANCEs, and the record waits;
     - the second changes their vote to the first's move, and it moves along that one;
     - a vote with a null `transitionId` still counts.
  7. **Isolation** (`itEnforcesTenantIsolation`): another organisation's transition id is the
     identical 404, unchanged.
- **`pool-member-moves.db-spec.ts`:** remove its "mark Approve as an approval-path move" line
  (`:250-254`). The ALL case must pass on the seeded move as it is.
- **Unit:**
  - `workflow.service` specs for `submitApproval()` by kind, including the 409 for several of one
    kind;
  - the transition panel and editor specs lose the checkbox and the tag.
- **Mutation-checked:**
  - read `isApprovalPath` again in the decision: cases 1 and 2 go red;
  - treat RETURN as a vote: case 3 goes red;
  - drop the move filter from the threshold (if Q1 is (i)): case 6 goes red.

### 4.4 Backfill

**None** (§3.2, §3.3). If Q1 is (i), the new column starts null everywhere, which reads as today
(§4.1); nothing is written to existing rows.

The contract ticket (dropping `isApprovalPath`) needs no backfill either: it removes a column
nothing reads.

### 4.5 Docs

- **SYSTEM-REFERENCE:**
  - §2.19, the decision table and "kind decides";
  - §2.19.1, the "seed quirk, not changed" line becomes "fixed by ACC-284";
  - the history lines at §2.x (`:1825`) get a pointer.
- **CLAUDE.md:** Key Architecture Decisions (ACC-284):
  - on a stage decided together, an ADVANCE is a vote, and RETURN and EXIT act at once;
  - `isApprovalPath` is not read, and is dropped later.

---

## 5. Files

| File | Change |
| -- | -- |
| `backend/src/foundation/workflow/workflow.service.ts` | decide by `kind` (§4.1) |
| `backend/src/foundation/workflow/workflow-refusal.ts` | `VOTE_MOVE_AMBIGUOUS` (and, for Q1 (ii), its stage refusal) |
| `backend/prisma/schema.prisma` + a migration | Q1 (i) only: `WorkflowApproval.transitionId`, nullable, additive |
| `backend/src/foundation/workflow/vote-on-advance.db-spec.ts` (new) | §4.3 |
| `backend/src/foundation/workflow/pool-member-moves.db-spec.ts` | remove the workaround |
| `backend/src/foundation/workflow/*.spec.ts` | `submitApproval()` by kind |
| `frontend/src/app/foundation/workflow/components/transition-panel/*` | remove the checkbox |
| `frontend/src/app/foundation/workflow/components/workflow-transition-editor/*` | remove the tag |
| `frontend/src/assets/i18n/en.json`, `ar.json` | Q1 (ii) only: the refusal sentence |
| `SYSTEM-REFERENCE.md`, `CLAUDE.md` | §4.5 |

---

## 6. Questions for Ahmad (the recommendation is marked)

1. **Two forward moves on a stage decided together (§2e).** **(i) The vote records its move**
   (recommended: an additive nullable column; votes count per move) / (ii) refuse that
   configuration at save / (iii) leave it for later (it cannot arise on today's data).
2. **A send-back on a committee vote acts at once on one member's press.** **Keep**
   (recommended: today's rule, "a send-back needs no threshold"; fix B does not change it) /
   Needs a vote too.
3. **The approval-path checkbox and tag.** **Hide them now** (recommended: they would describe
   nothing) / Keep them until the contract ticket.
4. **The contract ticket** (drop `isApprovalPath` from the API, the seed and the schema). **Open it
   now** (recommended), to run after this deploys / Later.

---

## 7. Progress

- [x] Plan (this file), committed, not pushed
- [x] Ahmad's answers to §6 (10 Nov, "Decisions" above)
- [x] Backend: decide by kind; votes per move (`WorkflowApproval.transitionId`); specs (db-spec on 55432), mutation checks
- [x] Frontend: the checkbox and the tag
- [x] Docs: SYSTEM-REFERENCE §2.19 and §2.19.1; CLAUDE.md
- [ ] Gate, PR

### As built (10 Nov)

- **The migration** `20261110181510_acc284_vote_move`: `WorkflowApproval.transitionId`,
  nullable, indexed, SET NULL on the move's delete. Created and applied on 55432 only.
- **`workflow-vote.ts`:** `isVotingMove()`, `moveOutcome()`, `votesFor()`.
- **The engine:**
  - `triggerTransition()` decides by `isVotingMove()`;
  - `isApprovalThresholdMet()` takes the move and counts `votesFor()` it;
  - `submitApproval()` finds its move by kind (`voteMoveFor()`, 409 `VOTE_MOVE_AMBIGUOUS`).
- **`VOTE_MOVE_AMBIGUOUS`** has no screen string: `submitApproval()` has no frontend caller.
- **A replaced vote is audited** (Ahmad, 10 Nov), by `recordVote()`, the one writer of a vote:
  - CREATE for a first vote;
  - UPDATE with the old move and decision before, and the new ones after;
  - nothing for the same move pressed again;
  - db-spec case added; removing the write turns it red.
- **Specs:** `vote-on-advance.db-spec.ts`, 12 cases.
- **Mutation-checked:**

  | Mutation | Tests red |
  | -- | -- |
  | reading `isApprovalPath` again | 7 |
  | RETURN as a vote | 3 |
  | EXIT acting at once on a committee vote | 2 |
  | EXIT as a vote on "All of them" | 1 |
  | no per-move filter | 2 |
  | the old transition panel put back | 3 |
  | the old transition list put back | 1 |
