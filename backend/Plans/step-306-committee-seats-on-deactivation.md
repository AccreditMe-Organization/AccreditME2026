# Step 306 — deactivating a person and their committee seats (ACC-306)

Plan only. Lane B, with a hook in lane A's deactivation path. Builds on ACC-286
(required seats, members to go live, keeping required seats filled).

Measured against `dev` at `f9321b2` (19 Nov). Every claim below names its file.

---

## 1. Today, from the code

### 1.1 What makes a person inactive

| Path | Where | What it does to the person | What it does to `CommitteeMember` |
|---|---|---|---|
| **Deactivate** ("the departure flow") | `UserService.deactivate()`, `user/user.service.ts` | `status: 'INACTIVE'` inside one transaction. Also in it: sessions ended (ACC-216), the admin, root-head and account-owner invariants, stage-pool LEFT events (ACC-271), and the leaver's draft or returned change requests withdrawn (ACC-283 PR 2b). After commit: meeting invitees refreshed, head-role grant revoked, tasks reassigned, admins told. | **Nothing.** Every active membership stays `isActive: true`, `leftAt: null`. No `CommitteeMembershipEvent`. |
| **Revoke invitation** | `UserService.revokeInvitation()` | Deletes an INVITED user. | Nothing to end: an INVITED person with a membership row can't be deleted (the FK refuses), and the app answers "deactivate the user instead". |
| **Transfer** | `UserService.transferUser()` | Stays ACTIVE (unit or position change). | Nothing. Lane A's wizard may remove chosen seats afterwards (ACC-296), each through `removeMember()`. ACC-297 tells the person's committees. Not inactivity, so **out of scope**. |
| **SUSPENDED** | — | Set by nothing in the product (SYSTEM-REFERENCE 12.2; `reactivate()` says so). | — |
| **Organisation suspended** | `PlatformTenantService.suspendTenant()` | Organisation status only; users unchanged. | Nothing. **Out of scope.** |

**The one path is `deactivate()`.** Reactivation (`UserService.reactivate()`) flips `INACTIVE → ACTIVE` and touches no committee row.

### 1.2 What reads a seat, and whether an inactive member counts

**Readers that already ignore an inactive member** (they join `User.status = 'ACTIVE'`):

| Reader | File | Today |
|---|---|---|
| ACC-286 required seats (going live, keeping seats filled) | `committee-seat-rules.ts` `seatHolders()` / `seatHoldersFor()` | Ignores an inactive holder, so the seat reads **empty**. |
| ACC-286 going live: members ≥ quorum | `committee-seat-rules.ts` `activeMemberCount()` | Ignores them. |
| Setup health "Committee missing a required seat" | `setup-condition.detectors.ts` → `seatHoldersFor()` | **Already flags** a required seat held only by an inactive person. |
| Committee-vote and committee-seat stage pools | `workflow/stage-pool.service.ts` (members read, then `status === 'ACTIVE'`) | Ignores them. Deactivation already records `POOL_MEMBER_LEFT` (ACC-271). |
| Committee-vote quorum | `WorkflowInstanceStage.quorumCount`, snapshotted from `Committee.quorumCount` at stage entry (ACC-239) | A **number**, not a member count. An inactive member just never votes. |
| Committee-role task pools | `task/task-pool.ts`, `task/task-assignment.service.ts` | Ignores them. |
| Meeting authority (schedule, minutes, approve) | `workflow/meeting-authority.ts` | Ignores them. |
| Meeting invitees (Meetings PRs 1–3) | `meetings/invitees/meeting-invitee-sync.service.ts` `expectedMembers()` | Ignores them. `deactivate()` already calls `refreshMeetingInvitees(... forUser)`, so the leaver drops off future meetings (kept as a guest only where they present an agenda item). |
| Change-request deciders and chain (ACC-283) | `change-requests/change-request-chain.ts` | Ignores them. |
| SLA escalation to the chair | `workflow/sla-monitor.processor.ts` | Ignores them. |

**Readers that still count an inactive member** (no user-status filter):

| Reader | File | Today |
|---|---|---|
| A committee's Members panel and its count | `committee-lists.service.ts` | **Lists the inactive person as a member.** |
| Committees list member counts | `committee-stage-counts.ts` | **Counts them.** |
| Home admin summary, "below quorum" | `committee-home.service.ts` (`members` CTE) | **Counts them toward quorum**, unlike ACC-286's `activeMemberCount()`. |
| A user's Committees panel | `user/committees/user-committees.service.ts` | Shows the seats as current. |
| Membership access (ACC-281) and meeting membership | `common/services/committee-membership.ts`, `meeting-membership.ts` | Irrelevant: an inactive person can't sign in. |

**So today a deactivated person is half-gone from a committee.**
- Every rule that decides anything already treats their seat as empty.
- The screens that show the roster (the members panel, the committee list, Home's below-quorum count, the person's own record) still show them seated.
- No membership event says they left, so a committee's Membership history has no "left" entry.

### 1.3 The shared database today (read-only, counts and slugs only)

Run in a `BEGIN READ ONLY` transaction (`acc306-counts.js` in the session scratchpad):

| Organisation | Users | INACTIVE | SUSPENDED | Active committees | Active memberships | LEFT events |
|---|---|---|---|---|---|---|
| al-manara | 23 | 1 | 0 | 3 | 13 | 0 |
| al-nakheel | 26 | 2 | 0 | 5 | 13 | 4 |

- **Active seats held by an INACTIVE or SUSPENDED person: 0** in both. Required seats among them, on a committee in force: **0**.
- **In-force committees below quorum:** al-nakheel 1, counted either way (by memberships or by ACTIVE people); al-manara 0.
- **Open committee-vote entries on a committee with an inactive seat-holder:** 0.

**What this change does to existing data: nothing.** No seat would be ended retroactively today. It changes what happens at the next deactivation.

---

## 2. The questions

### Q1. Does deactivation end the person's committee seats?

- **(a) Yes: every active membership on an active committee ends at the deactivation**, as part of it.
- **(b) No:** keep today's half-gone state, and make the remaining readers (§1.2, second table) filter by user status instead.
- **(c) Ask:** the deactivate confirm lists the seats and offers to end them.

**Recommendation: (a).**
- A person who can't sign in can't sit on a committee. Every rule that decides anything already says so (§1.2), and only the roster screens disagree.
- Ending the seat makes the record say what the rules already act on, and gives the committee's history its "left" entry.
- (b) leaves four readers to remember a filter forever (the ACC-82 shape), and the roster keeps lying.
- (c) asks a question with only one sensible answer.

**Two sub-decisions:**
- **Which committees.**
  - **Recommendation:** every active membership on an **active** committee (`Committee.isActive`), **whatever its stage**. That includes Formation, Terms Review and Dissolution Pending.
  - **Exception:** a committee whose current stage is **final and DISSOLVING** (Dissolved). Its roster is a closed record (Ahmad, ACC-255 Q-A: a dissolved committee's members can't be changed). Those memberships are left as they were.
  - The inactive-committee case is the same reasoning: left as is.
- **The effective date.** The moment of the deactivation (the transaction's `now`), not a date the admin picks. Deactivation has no date field, and it takes effect at once.

### Q2. How is it recorded?

Per ended membership, inside the deactivation's transaction:
- `CommitteeMember`: `leftAt = now`, `isActive = false`. The `removeMember()` write, so `isActive` is still derived strictly from `leftAt`.
- One `CommitteeMembershipEvent` per membership: `action: LEFT`, `effectiveDate: now`, `approvedBy: <the person deactivating>`, the seat's `roleValueId`.

**What the event says its cause is.** The options:
- **(a) A new nullable column, `CommitteeMembershipEvent.cause`**, enum `CommitteeMembershipCause { DEACTIVATION }`. Null means a by-hand change, as every existing row.
  - Additive migration, expand only.
  - The history and the transfer notice read the cause as a fact, and the screens say it in both languages.
- **(b) `reason` set to an English sentence** ("Account deactivated"). That's server English stored as data: the Arabic screen would show English (CLAUDE.md's rule against it).
- **(c) `reason: null` as the signal.** Implicit, and ambiguous with events written before ACC-298 made a reason required.

**Recommendation: (a).**

**Audit.**
- One `UPDATE` audit row per ended membership, after commit. This is the `removeMember()` shape (before and after of the `CommitteeMember`), with `metadata: { cause: 'DEACTIVATION', userId }`.
- The person's existing `deactivated` audit row gains `endedCommitteeSeats: n`.

### Q3. Who is told?

- **(a) Nobody new.** The admins' existing departure notice gains a clause.
- **(b) Each committee's officers**, by ACC-297's recipient rule:
  - who: chair and secretary, and the owning unit's head (or the cover in force instead);
  - never the leaver or the person deactivating, ACTIVE people only;
  - one notice per recipient, listing their committees;
  - a committee is named and linked only for a reader who may open it.
- **(c) Both.**

**Recommendation: (c).**
- **The admins' departure notice** (`notifyTenantAdminsOfDeparture()`) gains one counted clause, in both languages: "Their seats on 3 committees ended." / «وانتهت العضوية في 3 لجان», with no pronoun about the person, and all six forms.
- **The officers get one notice each**, built from the same recipient rule as ACC-297, never a second copy of it (§3.3).
  - Sent **after commit, directly**. No delayed job: the data is final at commit, unlike a transfer, whose wizard removes seats afterwards.
  - Never fatal: a failure is logged with ids and the error's kind.
- **What the bell doesn't carry:** a required seat left empty is a *condition*, not an event. Setup health's existing "Committee missing a required seat" already lists it on the next hourly pass (ACC-82: the bell holds events, Setup health conditions).

### Q4. Does reactivating the person restore anything?

- **(a) Nothing.** An administrator re-adds them where wanted. `addMember()` reuses the same row (reactivate-in-place, ACC-32) and writes a `JOINED` event.
- **(b) Restore every seat ended by the deactivation** (`cause = DEACTIVATION`, after the last JOINED).
- **(c) Restore nothing, but tell the admin which seats they held**, with links, on reactivation.

**Recommendation: (a) now; (c) as a later screen if asked for.**
- Rejoining a committee is a decision. The seat may have been filled, the committee may have moved on or be dissolving, and seats are "a judgement with consequences, not a mechanical step" (ACC-64's principle).
- `reactivate()` already documents what it undoes and what it doesn't. This adds one line: "committee seats ended ... not undone".

### Q5. A departure is never blocked

The seat ending must never refuse or roll back a deactivation that would otherwise succeed:
- **No stage rule:** it doesn't call `assertStageAllows(... remove_member)`. Terms Review and Dissolution Pending don't stop it.
- **No ACC-286 rule 3:** it doesn't call `assertSeatStaysFilled()`. A departure may empty the last Chairman, as ACC-286 itself says.
- **No quorum check.**
- **A membership that moved since `prepare()`** (removed by hand meanwhile) is skipped, never an error. This is the ACC-283 departure shape.

**The refusals that can still roll the deactivation back are the existing ones only:**
- account owner;
- last administrator;
- root unit's last head.

When one of them refuses, the ended seats roll back with it.

---

## 3. The hook in lane A's deactivation path

### 3.1 Its smallest shape (the ACC-283 PR 2b pattern, a second time)

A lane B service, `CommitteeSeatDepartureService` (`foundation/committees/departure/`):

```ts
prepare(organizationId, leaverId, actorId): Promise<PreparedSeatDeparture>
  // BEFORE the transaction, while the leaver is still ACTIVE: ONE indexed query
  // (CommitteeMember @@index([userId])), scoped by organisation: the leaver's
  // active memberships on active committees not Dissolved, with each committee's
  // id. Nothing else when there are none.
endSeatsInTx(tx, prepared): Promise<void>
  // INSIDE the caller's transaction, LAST: per committee in id order, its row
  // FOR UPDATE, then the membership row re-read (skipped if no longer active),
  // the leftAt/isActive write and the LEFT event with cause DEACTIVATION.
  // Records what it applied on `prepared`.
finish(prepared): Promise<void>
  // AFTER commit: audit rows, the officers' notices, and the count for the admins'
  // notice. Never throws to the caller.
```

The change in `user.service.ts` is three lines, beside `changeRequestDeparture`:
- `prepare()` before the transaction;
- `endSeatsInTx()` as the transaction's **last** statement, after `changeRequestDeparture.withdrawInTx()`;
- `finish()` in the existing after-commit `try`, with the meeting-invitee refresh unchanged, since it already runs after commit.

The admins' notice takes the applied count.

### 3.2 Lock order

**Inside the transaction**, as it stands, in order:
1. the root-head advisory lock;
2. the account-owner and admin reads;
3. the person's `User` row (`FOR NO KEY UPDATE`, from the status update);
4. sessions;
5. invariants;
6. pool events;
7. per withdrawn change request, its **instance FOR UPDATE**, its request row, then its finish task.

**The seat ending goes last:** per committee in **id order**, the **`Committee` row FOR UPDATE**, then its membership row.

- **No committee instance lock.** The seat ending consults no stage rule, so it needs none.
- **Why the committee row:**
  - It serialises with `removeMember()`, `addMember()` and `changeMemberRole()`, which take the committee instance FOR SHARE, then this row FOR UPDATE.
  - It serialises with a going-live transition, which reads this row FOR SHARE after its own instance lock.
  - So "the last holder" stays a fact, and a removal by hand at the same moment can't write a second LEFT event: whoever is second re-reads the membership and finds it ended.
- **Why last:**
  - Change-request approve locks the request's instance, then the committee's instance, then the committee row (ACC-239).
  - Taking committee rows after the request instances keeps "request instance before committee row".
  - Taking no committee instance means no instance↔instance cycle can form.
- **No deadlock with the User row.** `addMember()` inserts a `CommitteeMember` whose FK takes `FOR KEY SHARE` on the `User` row, and that doesn't conflict with the deactivation's `FOR NO KEY UPDATE`.
- **The lock-order test** (§5) runs these at once, against a real database: deactivate the person, remove their seat by hand, take the committee live, and approve a change request on the committee. All finish, with one LEFT event per seat.

### 3.3 What lane B adds, and what lane A owns

| | Owner |
|---|---|
| `CommitteeSeatDepartureService`, the migration, the notices' recipient rule (extracted from ACC-297's service so both read one function) | Lane B |
| The three-line hook in `user.service.ts`, and the admins' notice clause | Lane A's file. Lane B writes it, as in ACC-283 PR 2b and ACC-297, and names it in the PR for lane A's review. |
| The deactivate confirm's wording ("Their committee seats end.") | Lane A's screen (`user-status-actions.service.ts`). A one-line, separate change. |

**No query is added to the per-request path** (ACC-271's performance rule). `prepare()` runs only inside a deactivation.

---

## 4. What it changes for people

**Existing data: nothing.** 0 seats held by inactive people (§1.3), so no backfill is needed. The plan records the query. If a later count before a customer finds any, a backfill (dry run, execute after deploy, dry run 0) is a follow-up, not this ticket.

**At the next deactivation:**
- **The leaver's seats end:**
  - the committee's Members panel and list count stop showing them;
  - Home's below-quorum count agrees with ACC-286's;
  - the person's own Committees panel shows the seats as ended.
- **Membership history:** each committee's history shows "Left — account deactivated", by whom and when.
- **Who hears about it:**
  - the officers of each committee are told once, per recipient;
  - the admins' notice says how many committees;
  - an emptied required seat appears on Setup health within the hour, as today.
- **Votes and pools:** unchanged. They already ignored the leaver.
- **Reactivation:** returns no seat.

---

## 5. Proposed PRs and tests

### PR 1 — backend (lane B, plus the hook in lane A's file)

1. **Migration, additive:** enum `CommitteeMembershipCause { DEACTIVATION }`, and a nullable `CommitteeMembershipEvent.cause`. It runs in the pre-deploy step. No row is written with it before the deploy (ACC-173's enum rule).
2. **The service:** `CommitteeSeatDepartureService` (prepare / endSeatsInTx / finish), with the recipient rule extracted from `CommitteeTransferNoticeService` into one shared function.
3. **The hook** in `UserService.deactivate()`, and the admins' notice clause. Two plural objects, en and ar, all six Arabic forms.
4. **`reactivate()`'s table** gains its line. No behaviour change.
5. **Every LEFT-event reader reads `cause`**: the Membership history response, and ACC-297's transfer notice, which must not describe a deactivation as "removed by the actor".
6. **SYSTEM-REFERENCE:** the departure flow, §3.21 (membership), and the readers table above.

**Tests: real database (`committee-seat-departure.db-spec.ts`):**
- **What ends:**
  - deactivation ends every active seat on active committees: each row `leftAt` = the deactivation time, one LEFT event per seat with `cause: DEACTIVATION` and `approvedBy` = the actor;
  - a Dissolved committee's seat and an inactive committee's seat are left as they were;
  - a seat already left is untouched.
- **Never blocked:**
  - the last Chairman of an in-force committee still ends;
  - the committee then reads as missing its required seat, through the Setup health detector's own function;
  - Terms Review and Dissolution Pending seats end too.
- **Rolled back with a refusal:** an account-owner, last-administrator or root-unit-head refusal leaves every seat active and writes no event.
- **Races:**
  - a `removeMember()` of the same seat at the same moment writes one LEFT event in total, whichever wins;
  - the lock-order test of §3.2 (deactivate, remove by hand, take live, approve a change request, all at once) finishes with no deadlock, under a timeout.
- **Isolation:** `should NOT return records belonging to a different tenant`. Another organisation's memberships of a person with the same name, and of that person's id if crafted, are untouched. `prepare()` is scoped by organisation.
- **Reactivation** returns no seat, and a later `addMember()` reuses the row with a JOINED event.

**Tests: unit:**
- **The hook:**
  - order is `prepare()` before the transaction, `endSeatsInTx()` after `withdrawInTx()`, `finish()` after commit;
  - a `finish()` failure is logged, not thrown;
  - a person with no seats costs one query and nothing else.
- **The notices:**
  - the recipient rule (chair, secretary, unit head or cover; never the leaver or actor; ACTIVE only), one per recipient;
  - both languages, gender-neutral Arabic;
  - a committee is named only for a reader who may open it.
- **The admins' clause:** left out at 0; plural forms.
- **Mutations:**
  - skip the committee row lock: the race test goes red;
  - drop the Dissolved exception;
  - call `assertSeatStaysFilled()`: the never-blocked test goes red;
  - write no event;
  - end seats outside the transaction: the rollback test goes red.

### PR 2 — frontend (lane B), after PR 1 deploys

- **Membership history:** a `cause: DEACTIVATION` LEFT event reads "Left — account deactivated" / Arabic, from the code, never a stored sentence.
- **The person's Committees panel:** ended seats show as ended (it reads the API, so it may need no change; check).
- **Tests and layout:** unit tests in both languages, and a layout check if the history row grows.

### Lane A, separately

- The deactivate confirm's one sentence.
- The transfer wizard is unchanged.

**No backfill. One additive migration.**
