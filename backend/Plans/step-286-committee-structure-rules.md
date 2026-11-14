# ACC-286: committee structure rules

Required seats, members to go live, live parents only. **Plan only, no code
yet.**
- Branch: `feature/ACC-286-committee-structure-rules`, from `dev` at `8a0a0b9`.
- Rules: Ahmad's four, 10 Nov, on ACC-286.
- Read for this plan: SYSTEM-REFERENCE §3.15 (reference checks), §3.17
  (committee edits), §2.18 (stage rules and flags), §13 (Setup health).
- Built before ACC-283, whose chain of authority relies on these rules.
- Questions for Ahmad are at the end (§9), each with a recommendation.

---

## 1. What the data says today (shared database, 14 Nov, read only)

Read from `D:\Accredit-me-2\backend` inside a READ ONLY transaction.
Definitions used:
- **Live:** `Committee.isActive`, and the current stage of the committee's
  newest instance carries the `IN_FORCE` flag.
- **Filled seat:** an active membership whose user is `ACTIVE`.

| Organisation | Committees | Live | Live, no Chairman | Live, no Secretary | Live, below quorum | Parent / Reports-to links | Link to a non-live committee |
|---|---|---|---|---|---|---|---|
| al-manara | 3 | 0 | 0 | 0 | 0 | 1 Reports-to | **1** (the target is not yet in force; the linking committee is not live either) |
| al-nakheel | 5 | 2 | **1** | **1** | **1** | 1 Reports-to | 0 |

- **One live al-nakheel committee has neither a Chairman nor a Secretary.** On
  the day the rules ship, it becomes the first Setup health row (§6). Rule 3
  refuses nothing for it, because there is no last holder to protect.
- **One live al-nakheel committee has fewer active members than its quorum.**
  Rule 2 checks only on the way in, so a live committee below quorum is not a
  refusal anywhere. Whether to show it is Q6.
- **The al-manara link** is left alone until someone edits it (ACC-233's rule).
- **No member is held by a deactivated user on a live committee today**
  (`live_with_inactive_user_members` = 0).
- **Seats are SYSTEM lookup values**: chairman, vice_chairman, secretary,
  member, observer and advisor, one shared row each, with no tenant rows.

**Nothing breaks a refusal on deploy.** The rules refuse writes and new
moves. The two existing al-nakheel gaps become visible (Setup health); they are
not blocked.

---

## 2. Rule 1: required seats

### 2.1 Where "required" lives

- **On the seat lookup, as an attribute.** `committee_member_role` gets an
  `attributeSchema`:

  ```json
  { "type": "object", "properties": { "required": { "type": "boolean", "label": "Required seat" } } }
  ```

- **The SYSTEM values carry the default.** `chairman` and `secretary` get
  `attributes: { "required": true }` in `lookup.seed.ts`; the other four get
  none, which reads as not required.
- **The seed reaches every organisation without a backfill.**
  `seedSystemData()` runs in every pre-deploy (`backend/scripts/pre-deploy.sh`,
  `seed-system-lookups.cli`). It overwrites each SYSTEM category's
  `attributeSchema` and each SYSTEM value's `attributes`, so the deploy itself
  writes them, and every organisation inherits them because the values are
  shared rows.
- **No backfill is needed for this rule** (Q1). Writing the shared SYSTEM rows
  in pre-deploy is safe while the old container serves: the old code never
  reads `attributes` on this category.
- **An organisation unticks a seat with its own override row.** That is the
  tenant `LookupValue` row (layer `TENANT`, same `categoryId` and `key`) that
  already carries hide and label overrides. Two backend changes are needed,
  both in `lookup.service.ts`:
  - **`getValues()` merges the override's `attributes` over the SYSTEM
    value's.** Today it spreads the SYSTEM row and reads only the override's
    labels and `isHidden`. No override row carries `attributes` today, because
    no path could set them, so the merge changes nothing for any existing
    category.
  - **A new endpoint sets an override's attributes on a SYSTEM value:**
    `PATCH /lookups/values/:id/attributes` with `{ attributes }`, guarded by
    `lookups:manage` and audited like `overrideLabel`. It upserts the tenant
    row, the way `hideSystemValue` and `overrideLabel` do.
    - Only keys the category's `attributeSchema` declares are accepted, each
      of its declared type, else 400 `LOOKUP_ATTRIBUTE_INVALID`. This is the
      first time the backend checks attributes against the schema. It applies
      to this endpoint only, so `document_type` is untouched.
- **A seat an organisation adds** (TENANT value, category is extensible) sets
  `required` on its own `attributes`, through the existing value form, which
  already renders a boolean property as a checkbox.
- **A hidden seat is never required.** `getValues()` drops hidden values, so a
  hidden Chairman simply is not in the organisation's seat list.

### 2.2 One reader: `committee-seat-rules.ts` (new, `foundation/committees/`)

Every rule reads required seats and their holders through this one file.
Never a second copy.

- **`requiredSeats(client, organizationId)`** returns
  `{ id, key, labelEn, labelAr }[]`.
  - It is ONE raw query: SYSTEM values of `committee_member_role`, left-joined
    to the organisation's override row by `key`, plus the organisation's own
    TENANT values.
  - It keeps values that are not hidden, are active, and whose merged
    `attributes ->> 'required'` is `'true'`.
  - It takes a raw-query client, so it runs inside a transition precondition
    (which only has `$queryRaw`) and inside a member write's transaction.
  - Its result must equal `getValues()` filtered by `required`; a db-spec pins
    the two together.
- **`seatHolders(client, organizationId, committeeId, seatIds)`** returns, per
  seat, the active members whose user is `ACTIVE`. Also one query.
- **`activeMemberCount(client, organizationId, committeeId)`** counts active
  members whose user is `ACTIVE`.

**Who counts (Q3):** an active membership AND a user with `status = 'ACTIVE'`.
- An INVITED user does not count; holding a seat is not being able to act
  (ACC-43's reasoning).
- A deactivated user does not count either. Their membership is still active,
  because deactivation ends no seat (§4.2).

---

## 3. Rule 2: going live

**Where:** the `COMMITTEE` entry in `foundation/workflow/transition-preconditions.ts`.
- It already runs twice: early, from `triggerTransition` and
  `assertDecidingVoteMayAdvance`, and authoritatively inside `performTransition`'s
  stage-change transaction, after the instance lock (`FOR UPDATE`).
- Today the entry refuses an `ADVANCE` out of the stage keyed `formation` when
  `quorumCount < 1` (`COMMITTEE_QUORUM_NOT_SET`).
- `committee-stage-keys.scan.spec.ts` already allows this file to read a stage
  key.

**When it runs:**
- The decided rule is "leaves Formation": an `ADVANCE` from the stage keyed
  `formation`, as today.
- **Recommendation (Q2):** ALSO any move into an `IN_FORCE` stage from a stage
  without that flag.
  - On the seed, that adds Terms Review → Active.
  - Why: members can still be removed in Terms Review (rule 3 protects live
    committees only), so a committee could otherwise reach Active with an
    empty Chairman seat.
  - This needs `fromStageFlags` and `toStageFlags` in the precondition's
    context; `performTransition()` already has both stages loaded.
  - Suspended → Active is not affected: both stages are `IN_FORCE`.

**What it checks, in this order, all under the same lock:**
1. **`quorumCount < 1` → `COMMITTEE_QUORUM_NOT_SET`.** Unchanged.
2. **Fewer active members than the quorum → `COMMITTEE_MEMBERS_BELOW_QUORUM`**,
   409, with `{ quorum, members }`.
3. **Any required seat empty → `COMMITTEE_REQUIRED_SEATS_EMPTY`**, 409, with
   `{ seats: [{ id, labelEn, labelAr }] }`, in seat order.

**Locking:**
- The committee row is already read `FOR SHARE` in the precondition.
- Member writes will take the committee row `FOR UPDATE` (§4), so a removal
  and a transition cannot interleave between the check and the move.
- Both sides take the workflow instance first, so there is no deadlock (§7.2).

**Codes:** new values in `WorkflowRefusalCode` (`workflow-refusal.ts`), with
their statuses and English log messages. The English is never shown on
screen.

---

## 4. Rule 3: keeping required seats filled

### 4.1 Where

`committees.service.ts`, in the two member writes that can empty a seat:
- **`removeMember`**: the member leaves.
- **`changeMemberRole`**: the member moves to another seat.

`addMember` cannot empty a seat.

### 4.2 How

Inside each write's existing transaction:
1. `assertStage(...)` (unchanged). It reads the stage `FOR SHARE OF wi` and
   returns the stage's flags.
2. **New: lock the committee row**:
   `SELECT id FROM "Committee" WHERE id = $1 AND "organizationId" = $2 FOR UPDATE`.
   - The member writes take no committee lock today. This one is what makes
     "the last holder" a fact rather than a race: two removals of two Chairmen
     at once would otherwise both see one other holder.
   - Order: instance (`FOR SHARE`), then committee (`FOR UPDATE`), the order
     `updateCommittee()` already takes.
3. **New: only when the stage carries `IN_FORCE`**, read from the flags step 1
   returned, never a stage name or key:
   - the member's current seat is in `requiredSeats()`;
   - and after the write no other holder would remain (`seatHolders()`
     without this member; for a seat change, only when the seat actually
     changes);

   → 409 **`COMMITTEE_REQUIRED_SEAT_LAST_HOLDER`**, with
   `{ seat: { id, labelEn, labelAr } }`. Nothing is written.
4. The write, the membership event and the audit row, unchanged.

### 4.3 What a departure does instead

- **The seat may empty, and nothing refuses it.** Deactivating a user
  (`UserService.deactivate()`) ends no committee membership today; the person
  stays in the seat with an inactive user.
- Because rule 3 counts only `ACTIVE` users (§2.2), that seat is then empty for
  every rule, and Setup health shows it (§6).
- Blocking a deactivation on a committee seat would contradict "a departure
  can still empty the seat".
- Whether deactivation should also end memberships is a separate question (Q4).

### 4.4 The transfer wizard (lane A)

- The wizard removes seats through the same `removeMember`, one per seat, after
  the transfer (ACC-296). So rule 3 refuses removing the last Chairman of a
  live committee there too.
- The wizard must say the refusal from its code and let the admin carry on
  (§8). Q5 asks whether the wizard should be exempt; the recommendation is no.

---

## 5. Rule 4: live parents only

**Where:** `committee-reference-checks.ts`, `assertCommitteeReferences()`, after
the existing dissolving check.

**What it checks:**
- A parent or Reports-to that is not live is refused:
  - **`COMMITTEE_PARENT_NOT_LIVE`**, 400;
  - **`COMMITTEE_REPORTS_TO_NOT_LIVE`**, 400.
- **"Not live" means** the target's stage lacks `IN_FORCE`, or the target is
  inactive.
- **Dissolving keeps its own codes**, first, because its sentence is more
  specific (ACC-233).
- **One query for both checks:** `isDissolving()` becomes `targetStageFacts()`.
  It is the same single query (newest instance, `FOR SHARE OF wi`), plus
  `Committee.isActive`, and returns the flags and whether the target is active.
  The dissolving and not-live checks both read that one result.

**Only a changed value is checked** (ACC-233): the existing `changed()` helper
in `updateCommittee()`. So:
- the al-manara committee whose Reports-to is not yet in force stays editable
  for its name;
- clearing a parent or Reports-to (`null`) is always allowed.

**Create:** a new committee's parent and Reports-to are checked the same way.

**Change requests:**
- The apply path runs the same checks at Submit and Approve (ACC-239), so a
  request naming a non-live parent is refused there with the same codes.
- The change-request form's pickers share `referenceOptions()`, so they also
  stop offering non-live committees.

---

## 6. Setup health: "Committee missing a required seat"

**The new condition type is `COMMITTEE_MISSING_REQUIRED_SEAT`**:
- one row per live committee with at least one empty required seat;
- `objectId` is the committee id;
- `subject` is `{ nameEn, nameAr, seats: [{ id, labelEn, labelAr }] }`;
- severity is `AT_RISK` (Q7).

It is reconciled hourly by the existing single writer (ACC-82).

### 6.1 Two deploys (CLAUDE.md's enum rule)

The enum value must not be written in the deploy that adds it. Prisma 7's
client throws on a value it was not generated with, so a rollback, or the
deploy overlap, would break `GET /setup-health` and the Home admin slice.

| | PR 1 (ours) | PR 2 (ours, after PR 1 is live) | Lane A |
|---|---|---|---|
| Enum value + migration | ✅ `acc286_setup_committee_missing_seat` | — | — |
| Detector | listed in `DEFERRED_SETUP_CONDITION_TYPES`, so it is not detected and nothing writes it | ✅ `committeesMissingRequiredSeat()`, one batched query per organisation through `committee-seat-rules.ts` | — |
| `AGE_BASIS` (exhaustive Record) | ✅ (compile requires it) | — | — |
| Reported (`SETUP_CONDITION_TYPES`) | — | ✅ | — |
| Frontend type union, `TYPE_ORDER`, `fixTargetFor`, i18n `setupHealth.types/fix/fixNeeds/consequence` | ✅ ours (the reader learns it in deploy 1) | — | the row's wording review (§8) |

- **Rollback safety:** rolling PR 2 back lands on PR 1, whose client knows the
  value.
- **Before PR 2 deploys:** no row exists, so nothing anywhere has to read it
  early.
- **Proof before PR 2 merges:** the same scratch rollback check as ACC-202, with
  PR 1's backend reading `GET /setup-health` against a database holding PR 2's
  rows.

### 6.2 Migration number

- **63** is lane A's #290; **64 and 65** go to ACC-188 and ACC-278 PR B.
- This PR claims the next free number when it is built (expected **66**), with
  a timestamp later than all three.
- PR 1 has the only migration in ACC-286. PR 2 has none.

---

## 7. PR split, lock order, performance

### 7.1 PRs

**PR 1** (backend and the committee screens):
- **Lookups:** the seed's schema and default attributes, the attribute merge in
  `getValues()`, and the new override endpoint.
- **Rules:** `committee-seat-rules.ts`, and rules 2, 3 and 4 with their
  refusal codes.
- **The enum value:** its migration, listed as deferred.
- **The committee screens** we own: the dialog wording for every new code (§8).
- **The Setup health reader:** taught the type (frontend type union,
  `TYPE_ORDER`, row, Fix).
- **Docs.**

**PR 2** (after PR 1 is live):
- the detector, and reporting the type;
- the rollback check.

**Lane A** (separate PRs, sent from §8):
- the Lookups attribute toggle on SYSTEM values;
- the transfer wizard handling the new refusal;
- reviewing the Setup health row wording.

### 7.2 Lock order (never a cycle)

| Path | Order |
|---|---|
| A transition (rule 2) | instance `FOR UPDATE` → committee `FOR SHARE` → members (read) |
| A member write (rule 3) | instance `FOR SHARE` → committee `FOR UPDATE` → member row |
| A committee edit (rule 4) | instance `FOR SHARE` → hierarchy advisory lock → committee `FOR UPDATE` → each target's newest instance `FOR SHARE` |

- All three paths take the instance first.
- The target-instance `FOR SHARE` in rule 4 conflicts only with a transition
  on that target. A transition there takes its own instance and then its own
  committee row, never the editing committee's, so no cycle can form.

### 7.3 Performance (Ahmad's standing rule)

- **Nothing runs on the per-request path:** no guard, interceptor, middleware or
  throttler change.
- **Every check runs only on the write that needs it:**

  | Write | Added queries |
  |---|---|
  | Committee transition | 2 (required seats + holders, in one query; then the member count) |
  | Member removal or seat change on a live committee | 1 lock + 2 queries |
  | Committee edit that changes a parent or Reports-to | none; the existing one query gains two columns |
  | The detector | one query per organisation, through the existing hourly job |
  | `getValues()` | none (it already reads the override rows) |

- No polling and no new list.

### 7.4 Specs, each with the mutation that must turn it red

| Spec | Proves | Mutation |
|---|---|---|
| `committee-seat-rules.db-spec.ts` | SYSTEM default; override unticks; a tenant seat ticks; a hidden seat is not required; an INVITED or inactive holder does not fill a seat; equals `getValues()` filtered | drop the override merge; count INVITED users |
| `lookup.service.spec.ts` (+ db) | `getValues()` merges override attributes; the endpoint accepts only schema keys of the right type; audited | drop the merge; drop the type check |
| `transition-preconditions` db-spec | leaving Formation refused below quorum and with an empty required seat; passes when filled; Terms Review → Active refused too (if Q2); refused again inside the transaction | drop either check; run only the early check |
| `committee-member-required-seat.db-spec.ts` | removing or reseating the last Chairman of a live committee is refused with the seat; allowed with two Chairmen, on a not-live committee, and for a non-required seat; two concurrent removals of two Chairmen: one succeeds, one is refused | drop the IN_FORCE condition; drop the committee row lock (the concurrency case goes red) |
| `committee-reference-checks.db-spec.ts` (extended) | parent or Reports-to not in force, or inactive, refused with its code; an unchanged non-live link passes a rename; clearing passes | check the unchanged value too; read the stage key instead of the flag (the key scan also fails) |
| `setup-condition` specs (PR 2) | one row per live committee with an empty required seat; closes when filled | ignore the user's status |
| Frontend: committee refusals screens spec | each code's sentence in both languages, under its field or in its dialog | map to the generic sentence |
| `committee-stage-keys.scan.spec.ts` | unchanged: no committee stage key outside the allowed files | (existing) |

---

## 8. Screens

### 8.1 Wording, per refusal code

The rule for the wording: a singular noun phrase or an imperative, and no
gendered verb about a person. Every sentence is said from its code. A
`{{seat}}` or `{{seats}}` is the seat's label in the reader's language
(`LanguageService.bilingual`), and a list is joined by `، ` in Arabic and `, `
in English.

| Code | Where | EN | AR |
|---|---|---|---|
| `COMMITTEE_REQUIRED_SEATS_EMPTY` | the record page's move buttons (workflow refusal) | "Fill the required seats first: {{seats}}." | «يلزم شغل المقاعد المطلوبة أولاً: {{seats}}.» |
| `COMMITTEE_MEMBERS_BELOW_QUORUM` | the same | "Add members first: {{members}} of the {{quorum}} the quorum needs." (counts through plural objects) | «يلزم إضافة أعضاء أولاً: {{members}} من أصل {{quorum}} يتطلبها النصاب.» |
| `COMMITTEE_REQUIRED_SEAT_LAST_HOLDER` | Remove member and Change role dialogs | "Appoint another {{seat}} first." | «يلزم تعيين عضو آخر في مقعد «{{seat}}» أولاً.» |
| `COMMITTEE_PARENT_NOT_LIVE` | the committee form, under Parent | "Choose a parent committee that is in force." | «يلزم اختيار لجنة أم سارية.» |
| `COMMITTEE_REPORTS_TO_NOT_LIVE` | the committee form, under Reports to | "Choose a committee that is in force to report to." | «يلزم اختيار لجنة سارية تُرفع إليها التقارير.» |

**Ours:**
- **The record page's move refusals:** `workflow-refusal.ts`, which already
  says `COMMITTEE_QUORUM_NOT_SET`.
- **The two member dialogs:** `committee-member-form`, `committee-remove-member-dialog`.
- **The committee form:** `committee-references.ts`, which maps the reference
  codes to fields.
- **The change-request form:** same mapping.
- **The committee form's pickers:** `referenceOptions()` stops offering a
  non-live committee, from the list rows' `stageRules.flags` and `isActive`;
  the saved value is still kept.

### 8.2 Lane A's part (to send to them)

1. **Lookups → Committee Member Role**: a "Required seat" toggle on each seat.
   - **SYSTEM values:** Chairman and Secretary ticked by default. The toggle
     calls the new endpoint, `PATCH /lookups/values/:id/attributes` with
     `{ attributes: { required } }`; refusal code `LOOKUP_ATTRIBUTE_INVALID`.
   - **The organisation's own seats:** the existing value form already shows a
     boolean attribute as a checkbox.
   - **The label:** the schema's `label` is English only, so the form needs
     translation keys: `lookup.attribute.required` = "Required seat" /
     «مقعد مطلوب».
2. **Setup health**: review the row wording for `COMMITTEE_MISSING_REQUIRED_SEAT`.
   - Title: "Committee missing a required seat" / «لجنة ينقصها مقعد مطلوب».
   - Detail: "{{committee}}: {{seats}}".
   - Fix: "Appoint members" → the committee page (`/committees/:id`); it needs
     `committees:view` + `committees:add_member`.
   - We add the keys in PR 1; lane A owns the page's look.
3. **Transfer wizard** (ACC-296's step): `removeSeats()` must say
   `COMMITTEE_REQUIRED_SEAT_LAST_HOLDER` from its code for that seat, leave the
   person in it, and carry on with the other seats. The admin appoints a
   successor, then removes the seat from the committee page.

---

## 9. Questions for Ahmad (recommendation first)

**Q1. Where "required" lives.**
- **Recommendation:** an attribute on the shared SYSTEM seat values, seeded
  (Chairman and Secretary), so every organisation inherits it at deploy with
  no backfill. An organisation unticks through its override row.
- **Alternative:** write a per-organisation copy for every existing
  organisation with a backfill (dry run, `--execute` after the deploy, dry run
  0, an audit row per organisation). This only adds a script and rows to
  maintain.
- **The trade:** with the recommendation, an organisation's default changes
  whenever AccreditMe changes the seed. That is acceptable for a default.

**Q2. When rule 2 runs.**
- **Recommendation:** leaving Formation (as decided) AND any move into an
  `IN_FORCE` stage from a stage without it (Terms Review → Active), so a seat
  emptied during Terms Review cannot slip through.
- **Alternative:** leaving Formation only.

**Q3. Who fills a seat and counts toward the quorum.**
- **Recommendation:** an active membership of a user whose status is `ACTIVE`.
  INVITED and deactivated users do not count.

**Q4. Should deactivating a user end their committee memberships?**
- **Recommendation:** no, not in this ticket. The seat is already treated as
  empty, and Setup health shows it. Ending memberships on departure is its own
  decision, since it changes membership history.

**Q5. The transfer wizard.**
- **Recommendation:** rule 3 applies there too. Lane A shows the refusal for
  that seat and the rest of the wizard carries on.
- **Alternative:** exempt the wizard. That would let a transfer silently leave
  a live committee without a Chairman, which rule 3 exists to prevent.

**Q6. A live committee below its quorum** (al-nakheel has one today).
- **Recommendation:** nothing in this ticket. Rule 2 checks it on the way in;
  showing it on Setup health would be a second condition type, with the same
  two-deploy cost.
- **Alternative:** add `COMMITTEE_BELOW_QUORUM` alongside, in the same two PRs.

**Q7. The severity of "Committee missing a required seat".**
- **Recommendation:** `AT_RISK`. The committee still works, and pool
  escalation already falls back to the owning unit's head when there is no
  Chairman (`sla-monitor.processor.ts`).

**Q8. The English for rule 3.**
- **Recommendation:** keep your wording, "Appoint another {{seat}} first."
- The Arabic avoids a gendered adjective on the seat label: «يلزم تعيين عضو آخر
  في مقعد «{{seat}}» أولاً.»
