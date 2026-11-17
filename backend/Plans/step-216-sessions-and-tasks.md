# ACC-216 parts 3 and 4: Sessions and Tasks on the user record page

Plan only, written 17 Nov 2026 (CC-299) against `origin/dev` at `292ce32`. No code in this
change. Parts 1 (Committees, #303) and 2 (Access history, #323) are the pattern.

Every statement about today's behaviour cites the code it was read from. The questions for
Ahmad are at the end (§9). **He accepted every recommendation on 17 Nov ("agree to all"),
so the design below is decided**; the answers are in the next table.

## Ahmad's answers (17 Nov)

| Q | Decision |
|---|---|
| 1 | Ending sessions is in this ticket, not only the list. |
| 2 | Seeing someone else's sessions needs a new key, `users:manage_sessions` (Organization Administrator only), plus `users:view`. **Who adds the key** (the permission catalogue is lane B's area) is being agreed between the lanes; it is said in PR 1's prompt, and nobody adds it before then. |
| 3 | The IP address is shown to the person and to that key's holder. |
| 4 | An administrator only "Signs out everywhere", which takes effect at once. No ending one device of someone else's. |
| 5 | The person is emailed when an administrator signs them out everywhere. |
| 6 | Deactivation revokes the person's sessions through `endEverySessionInTx()`, as its own PR (PR 3). |
| 7 | Ending one of your own devices may take up to 15 minutes to bite. No check per request. |
| 8 | Tasks: **Option A**, the viewer's own rule filtered to the person. Nobody sees a task they couldn't already open. |
| 9 | The Tasks panel lists tasks the person is an active assignee on, not ones they created. |
| 10 | No New task button on a person's Tasks panel. |
| 11 | The Sessions panel is built on `am-capped-panel` now; the design thread checks it afterwards. |

---

## 1. Sessions: what the code does today

### 1.1 The session table is `RefreshToken`

`backend/prisma/schema.prisma:2411-2441`. Its header says rows are "Never deleted, only
revokedAt-stamped … giving a full device/session history per user."

| field | type | note |
|---|---|---|
| `id`, `userId`, `organizationId` | String | indexes on `userId` and `organizationId` only |
| `tokenHash` | String, unique | SHA-256 of the raw refresh token |
| `tokenVersion` | Int? | ACC-122; null = predates the column |
| `sessionStartedAt` | DateTime? | ACC-126; copied unchanged onto every rotated row |
| `expiresAt` | DateTime | `min(now + 7 d, start + 12 h)` (`session-limit.ts:65-72`) |
| `createdAt` | DateTime | for a live row, the time of its last rotation |
| `revokedAt` | DateTime? | |
| `deviceInfo` | String? | the raw `User-Agent` header (`auth.service.ts:284`) |
| `ipAddress` | String? | `req.ip` (`auth.service.ts:285`), through `trust proxy` = 2 (`common/config/http.config.ts:38,42`) |

It has no `lastUsedAt`, no `replacedBy` and no family id.

- **`AuthSession`** (Better Auth, `schema.prisma:2321-2334`) is not the app's session.
  `auth.service.ts:3-10` says Better Auth "NEVER becomes the app's session mechanism"; its rows
  are side effects of `signInEmail` and `verifyTOTP`.
- **`LoginAttempt`** is an append-only attempt log with no link to `RefreshToken`.

### 1.2 Who writes `RefreshToken`

| where | what |
|---|---|
| `auth.service.ts:276` `issueRefreshToken()` | the ONE create: sign-in (`completeLogin`), MFA verify, every rotation |
| `auth.service.ts:741` | 12-hour limit reached inside `refresh()`: `revokedAt` |
| `auth.service.ts:776` | rotation revokes the presented row |
| `auth.service.ts:863` | sign-out: `updateManyAndReturn({ tokenHash, revokedAt: null })` |
| `session-revocation.ts:34` `endEverySessionInTx()` | every live row of a person, plus `tokenVersion + 1` and their `AuthSession` rows |

- **No code deletes a row.**
- **`refresh-token-writes.scan.spec.ts`** polices creates only (`:36-37`, `:61-63`): the one
  allowed create is `issueRefreshToken()`, and it must write `sessionStartedAt`.
- **Nothing ends ONE session by id today.** Sign-out works by the presented cookie's hash.

### 1.3 How a session ends today

- **Sign-out** (`POST /auth/logout`, public, `auth.service.ts:858-892`): revokes the presented
  row, clears cookies, audits `LOGOUT`.
- **30-minute idle** is frontend only (`idle.service.ts:38`). On timeout it calls
  `/auth/logout` (`:203`). A browser simply closed leaves its row live until `expiresAt`, at most
  12 hours from sign-in.
- **12-hour absolute limit** (`session-limit.ts`): the row's `expiresAt` is capped at
  `start + 12 h`, and `refresh()` revokes and refuses with `SESSION_TIME_LIMIT` (`:739-747`).
- **Rotation** (`refresh()`): revokes the presented row (`:776`), **before** the status,
  organisation and `tokenVersion` checks (`:781-821`), then creates the next row with the same
  `sessionStartedAt` and a fresh `deviceInfo`, `ipAddress` and `expiresAt` (`:827`). So one
  session is a CHAIN of rows with at most one live row; the only value the chain shares is
  `(userId, sessionStartedAt)`.
- **`endEverySessionInTx()`** is called by password reset (`password-reset.service.ts:234`) and
  the administrator's two-step reset (`user-mfa-reset.service.ts:133`).
- **Deactivation does NOT revoke rows.** `UserService.deactivate()` calls
  `authProvider.invalidateUserSessions()` (`user.service.ts:1568`), which only increments
  `tokenVersion` (`better-auth.provider.ts:69-74`). The rows stay `revokedAt: null`, and
  `refresh()` refuses them by version.
- **A role change ends nothing** (`tenant.guard.ts:206-209`): permissions are resolved per
  request (ACC-101).

### 1.4 What a live session is

**A row is a current sign-in when all of these hold:**

```
revokedAt IS NULL
AND expiresAt > now                                   -- also covers 12 h for rows with a start
AND coalesce(sessionStartedAt, createdAt) + 12 h > now -- the rows with no start
AND (tokenVersion IS NULL OR tokenVersion = User.tokenVersion)
AND User.status = 'ACTIVE'
```

The last two clauses are needed because deactivation and a stale version leave rows that look
live but that `refresh()` would refuse (§1.3). Listing them as "signed in" would be false.

**Two consequences for what can be shown:**
- **"Signed in" is `sessionStartedAt`** (or the row's `createdAt` for a row with no start).
- **"Last active" is the live row's `createdAt`**: the last rotation, so accurate to about 15
  minutes. There is no better column. The screen says "about".

### 1.5 What ending a session can and cannot do

- The access token carries `{ sub, organizationId, tokenVersion, sst }` (`auth.service.ts:250`),
  with no row id. TenantGuard checks `tokenVersion` per request, nothing about refresh rows.
- **Revoking ONE row** stops that device at its next refresh: up to 15 minutes later. Making it
  immediate would need a row id in the token and a refresh-row read in TenantGuard on every
  request, which the performance rule forbids (CLAUDE.md, ACC-271 PR 1: "no query is added to
  TenantGuard").
- **Ending EVERY session** is immediate, through `endEverySessionInTx()`'s `tokenVersion + 1`.
  It also ends the caller's own session when used on yourself.

### 1.6 Design references

Searched all 24 `frontend/design-reference/*.dc.html` files and `frontend/DESIGN-REFERENCE.md`.
**No Sessions panel is drawn.** The only mention is the record-page template's instance list in
`AccreditMe Templates.dc.html:3093`: User record "… plus Committees, Tasks, Sessions and Access
history panels." It draws no column, label or button for it. Two related lines elsewhere:
- `Sign-in Pages.dc.html:316`: "Setting the password signs the person out everywhere."
- `Two-step Sign-in.dc.html:267`: turning two-step off does not sign you out elsewhere.

**So this panel needs a design decision:** it can be built on `am-capped-panel` like parts 1
and 2, and checked by the design thread afterwards (Q11).

### 1.7 Endpoints and permissions today

- No route lists or ends sessions (`auth.controller.ts:46-219`).
- No permission key mentions sessions (`permissions.ts:14-47`). The nearest is `users:reset_mfa`
  (ACC-164): Organization Administrator only, in Users' "Account access" group.
- `user-record.component.spec.ts:474,483` pins Sessions as absent (test 14).

---

## 2. Sessions: the design (decided, 17 Nov)

### 2.1 The read: `GET /users/:userId/sessions`

- **Gate, before any read, with no query (ACC-101 clause a):**
  - yourself: always;
  - someone else: `users:view` AND the child's own key, `users:manage_sessions` (Q2; who adds it is agreed between the lanes).
  - Each refusal is a 403 naming the missing key, identical for a real colleague and an invented
    id. Another organisation's person is the 404 an invented id gets (`getById`).
- **Rows:** the live predicate of §1.4, `{ organizationId, userId }`, newest `createdAt` first,
  **capped at 20** (a person has a handful; the cap is the performance rule's hard cap).
- **Each row returns:**
  - `id` (the live row's id, so a row can be ended);
  - `startedAt`, `lastActiveAt`, `expiresAt`;
  - `device`: `{ browser, os }`, parsed on the SERVER from `deviceInfo` by a small in-house
    function (no parser is installed in either package; `file-content.ts` is the precedent for an
    in-house reader). An unrecognised agent reads "Unknown browser". The raw
    user-agent is never returned.
  - `address`: `ipAddress`, **only to yourself and to the key holder** (Q3);
  - `current: true` on the caller's own session (§2.3).
- **Cost:** the person (1) and the rows (1). `tokenVersion` and `status` come with the person,
  so the live predicate needs no third read. Nothing on the per-request path.
- **Index:** the read uses `@@index([userId])`. Rows are never deleted, so a long-lived account
  has many revoked rows. An `@@index([userId, revokedAt])` (an additive migration) is added
  only if the read measures slow on the seeded data. Not in the first PR.

### 2.2 Ending sessions (Q1)

**Decided (Q1, Q4, Q7):**

| Who | Action | Route | Effect | Takes effect |
|---|---|---|---|---|
| yourself | End one other session | `POST /auth/sessions/:id/end` | revokes that live row | at its next refresh, ≤ 15 min |
| yourself | Sign out other sessions | `POST /auth/sessions/end-others` | revokes every live row but yours | ≤ 15 min |
| administrator (key, Q2) | Sign out everywhere | `POST /users/:id/sessions/end-all` | `endEverySessionInTx()` | immediately (`tokenVersion + 1`) |

- **The self routes live under `/auth`** on purpose. The refresh cookie's path is
  `/api/v1/auth` (§15.14), so only there does the server receive it and know, by hash, which row
  is the caller's own. Elsewhere it would have to guess from `sst`.
- **The administrator only signs a person out everywhere (Q4).** It is immediate, it reuses the
  one function that already does it, and there is no 15-minute window to explain. Ending one
  device of someone else's offers little over that.
- **The administrator's rule is ACC-164's `mfa-reset-rule.ts`, generalised** (one rule, read by
  the route, which refuses, and by the record read, which hides):
  1. not yourself (409; use your own panel);
  2. not while impersonating;
  3. not the account owner (ACC-221);
  4. the floor: a holder without Organization Administrator cannot sign out someone who has it.
  The shared part is extracted rather than copied. That is the point of ACC-164's
  "never a second copy".
- **Audit:** one `AuditLog` row, objectType `User`, objectId the person, action `UPDATE`,
  `metadata: { event: 'sessions_ended', scope: 'one' | 'others' | 'all', count }`. No address or
  device goes in the audit.
  - **This needs a new kind in part 2's classifier** (`SESSIONS_ENDED`), or #323's history shows
    it as the neutral "Changed". The kind is added in the same PR.
- **Telling the person (Q5):** when an administrator signs them out everywhere, a
  `security-notice` email `sessions_ended` (`security-notice.ts`, an email only, never a
  Notification row; the `mfa_reset` precedent). Ending your own sessions sends nothing.
- **Concurrency:** every write is a conditional `updateMany` on `revokedAt: null`, so a rotation
  and an end race to one result: the row is revoked once. The end-one route scopes by
  `{ id, userId: caller, organizationId }`, so ending another person's row is the 404 a missing
  row gets.

### 2.3 "This device"

The read at `/users/:id/sessions` does not receive the refresh cookie. It marks the
caller's own session by matching the access token's `sst` to `sessionStartedAt`. Collisions are
not impossible (two sign-ins in the same millisecond) but harmless here: the mark only hides that
row's "End" button, and ending your own session is Sign out. The self END routes use the cookie's
hash, so they are exact.

### 2.4 The panel

- **Frame:** `am-capped-panel` "Signed-in devices" / «الأجهزة المسجَّل دخولها», five rows; See
  all into `am-list-dialog` compact. With a cap of 20 there is no Load more.
- **Each row:**
  - line 1: browser on OS, plus "This device" for your own;
  - line 2: "Signed in {date-time} · active about {relative}", then the address where shown.
- **Actions:**
  - yourself: a ⋯ per row with "Sign out this device", and "Sign out other devices" in the panel
    header, each confirmed through `AmConfirmService` with the 15-minute sentence;
  - the administrator: "Sign out everywhere" in the header, confirmed, with the person told.
- **Outcome:** its own request outcome (skeleton, error with Retry, empty "Not signed in
  anywhere"); absent, never empty, for a viewer without the read.
- **Dates and text:** dates through `FormatService`; Arabic as verbal nouns, singular and
  gender-neutral.

### 2.5 The deactivation gap (Q6)

Deactivation leaves rows live-looking (§1.3). The read's predicate hides them, so the panel is
correct either way. **Decided (Q6):** a separate small fix (PR 3) where `deactivate()` uses
`endEverySessionInTx()`, so the table says what is true. It is lane A's `user.service.ts`, one
call, with a db-spec.

### 2.6 Specs and isolation (Sessions)

- **Gate:** before any read (no query at all), for yourself and someone else, with and without
  each key; the 404 for another organisation's person.
- **Isolation tests, named to the gate string:**
  - another organisation's row with the same `userId` shape is never listed;
  - an end-one on another organisation's or another person's row id is the 404.
- **The live predicate:** a table of rows covering revoked, expired, past 12 h with a null start,
  a stale `tokenVersion`, a deactivated user, and a live one.
- **Never in the response:** the raw user-agent or the token hash. Without the key, no address.
- **Device parse:** a table of real agents (Chrome, Edge, Safari on iOS, Firefox, an unknown one).
- **Ending:**
  - end-one and end-others leave the caller's row live;
  - end-all bumps `tokenVersion`;
  - the account-owner, self and floor refusals;
  - the audit row and the notice;
  - a mutation list.
- **Frontend:** the panel's states, the actions per viewer, Arabic, and test 14's absence pin
  updated.

### 2.7 The new key, `users:manage_sessions` (lane B's conditions, CC-302)

Agreed between the lanes on 17 Nov: **lane A adds the key itself, in the Sessions backend PR
(PR 1), and lane B reviews it.** Nobody adds it before that PR.

**In that same PR:**
- **The catalogue:** the key in `USERS_PERMISSIONS` (`permissions.ts`), beside `users:reset_mfa`.
- **Its sentences:** English and Arabic, and its entry in `permission-groups.ts` (Users' "Account
  access" group, with Deactivate, Reactivate and Reset two-step sign-in), so
  `check:permission-sentences` passes. That check requires a sentence for every in-use key and
  none for a key not in use.
- **The seed:** on Organization Administrator ONLY. `role.seed.spec.ts`'s pinned sets are updated
  to say so; no other role's set changes.
- **The CLAUDE.md permission list:** the key added, 74 to 75 keys. Lane B's count is 74 today,
  after #322 retired `committees:approve`. The list's header sentence still reads "75 keys since
  ACC-164", which predates #322, so it is corrected in the same PR.

**The grant-only backfill**, `npm run backfill:acc216-manage-sessions-permission`:
- **It writes `RolePermission` directly**, because the root role's permission set is frozen
  through `assignPermissions()` (it refuses Organization Administrator, ACC-120), so the API path
  would refuse it. It adds the one key to each organisation's Organization Administrator role
  that lacks it, and touches nothing else.
- **One audit row per tenant** (ACC-101's rule for a backfill that changes tenant data).
- **It refuses customers** (ACC-101: a backfill may grant only while no customer tenant exists,
  and this one is still checked rather than assumed). The platform organisation is skipped.
- **Order, after PR 1 deploys and only on Ahmad's go:** dry run, then `-- --execute`, then a dry
  run reporting 0.

---

## 3. Tasks: what the code does today

### 3.1 The rule knows only the viewer

`taskVisibleSql(ctx)` (`task-visibility.ts:175-188`) ORs, over task `t`:

1. `t.createdById = ANY(coveredCreatorIds)`: the viewer, and creators they cover (out-of-office,
   acting head for absence; `task-authority.service.ts:126-151`);
2. the viewer is or was an assignee: any `TaskAssignee` row, removed ones included (`:178`);
3. a pool member while the task waits (`:181`);
4. **View all** on a record type the viewer may see (`:182`);
5. **Manage**, while the task needs managing (`:183-185`);
6. **unit scope** (`:186`): the RECORD's owning unit (`Committee.orgUnitId`, `ownerUnitSql`,
   `task-record-types.ts:70`), from headship, acting cover, or View unit tasks on the viewer's
   own primary unit, sub-units included. Never the assignee's unit.

- **Only COMMITTEE has task keys** (`task-record-types.ts:61-97`). A type without an entry gives
  no key access at all (fail closed, `:20-21`).
- **No parameter names a subject person.** "X's tasks" can only be an extra AND beside the rule.

### 3.2 That extra AND already exists

`GET /tasks/record-list` takes `assignee=<userId>` ("A user id: tasks that person is on now",
`dto/record-list-query.dto.ts:106-110`). It is applied as `activeAssignee()`
(`task-record-list.service.ts:257, 500-502`: an assignee row with `removedAt IS NULL`) and is
ANDed with the view and with `taskVisibleSql()`. `view=all|unit|unassigned` needs the matching
key (403 otherwise, `:216-222`); `mine` and `created` never 403 (`:201-210`).

- The SQL already sits in `WHERE` before `LIMIT`; rows and actions are batched (`:144-174`,
  `:294-307`). "X's tasks that this viewer may see" is therefore one SQL condition away.
- **No code lists another person's tasks today.**
  - `reassignAllForUser()` (`task.service.ts:1782`) is a write inside deactivation that returns
    counts.
  - The workload hint counts per person on ONE record, behind `seesWholeRecord`
    (`task-workload.service.ts:84-100`).
- **"X's tasks" in data:** active assignee rows (`removedAt IS NULL`, picked pool rows included).
  That is what My tasks, `view=mine`, `assignee=` and the people facet all mean. Created-by and
  ever-assigned are different questions.
- **The user-record plan held this back:** "tasks only after a decision on whose tasks an admin
  may see" (`step-120-5-user-record.md:163-165`). `step-244` says nothing more.

---

## 4. Tasks: the visibility question, and three options

On someone else's record, which of their tasks may an administrator see? Each option starts
from the parent gate: the record page itself needs yourself or `users:view` (+ `admin:access` for
the page, `ownProfileGuard`).

### Option A: the viewer's own rule, filtered to the person (chosen, Q8)

`activeAssignee(X) AND taskVisibleSql(viewer)`.

- **Who gains what: nobody sees a task they could not already open.** The panel is a filtered
  view of what All tasks, a record's Tasks panel or the task page already show the viewer.
  - A View all holder (committees) sees every committee task X is on.
  - A unit head sees X's tasks on records owned by their units.
  - Someone with `users:view` and no task key sees only X's tasks they are related to (they
    created, were on, or could pick).
- **One rule, no second copy** (ACC-244's "never a second copy").
- **Cost:** the person's own record panel can look thin to an administrator without task keys.
  It is honest: the count is "the tasks you may see", and the panel says so.

### Option B: `users:view` reveals all of X's tasks

`activeAssignee(X)` alone, for any `users:view` holder.

- **Who gains:** every holder of `users:view` (Organization Administrator, and any custom role
  given it to manage people) sees every task title and record type X is on, across every record
  type. That includes tasks on committees they cannot open, and every future module's tasks.
- **It bypasses** ACC-244's per-record-type keys and ACC-101's parent rule (a child read wider
  than its record). Not recommended.

### Option C: a new key, `users:view_tasks` (Organization Administrator only)

`activeAssignee(X)` for its holders, the rule for everyone else.

- **Who gains:** the key's holders see all of X's tasks, every type, regardless of task keys.
  Record names are still shown only where the record is visible (§3.12's rule).
- **It is the clean way to grant B's power deliberately**, but it is a second visibility path
  beside `taskVisibleSql`, which the ACC-244 design exists to prevent. Worth it only if
  administrators must see work they have no other right to.

**Recommendation: Option A.** It adds no power and needs no new key. If administrators later need
more, it can become C with one permission.

---

## 5. Tasks: the design (Option A, decided)

### 5.1 The read

Extend `GET /tasks/record-list` with a person scope rather than add an endpoint, so paging,
filters, rows, per-row actions (`taskActionsFor()`), the facets and the batching are reused:

- **The request:** `?person=<userId>` (no `view`, no record).
- **The gate, before any read:** yourself, or `users:view` (403 naming it, identical for an
  invented id); then the person is read with `{ id, organizationId }` (the 404 an invented id
  gets).
- **The SQL:** `AND activeAssignee(person) AND taskVisibleSql(ctx)`. Exactly today's rule, one
  more condition.
- **Self:** `person` = yourself is `view=mine`'s condition; the panel on your own record shows
  your own tasks.
- **Panel endpoint:** the first five through the same service (`record-panel`'s shape: `total`
  is every task the viewer may see that X is on).

### 5.2 The panel

`am-capped-panel` "Tasks", five rows in the Tasks panel's order:
- **Order:** open by soonest due, overdue first, undated last; then On hold; then recently
  closed.
- **Rows:** the shared task row (`am-task-link`, status, due).
- **See all:** opens the shared task list in `am-list-dialog`, pre-filtered to the person, with
  the toolbar's filters and Load more by 50.
- **When it shows:** yourself or `users:view`; absent otherwise. Its own outcome.
- **No New task here:** a person is not a record (Q10).

### 5.3 Specs and isolation (Tasks)

- **The gate:** before any read; another organisation's person is the 404.
- **Isolation tests named to the gate string:**
  - another organisation's task with an assignee row for the same user id is never listed;
  - a committee task of another organisation never reaches a View all holder.
- **A real-Postgres db-spec (`test:db`):** five kinds of viewer (View all, unit head, unrelated
  `users:view`, the person, a pool member) get exactly `taskVisibleSql ∩ activeAssignee(X)`. It
  is checked against the task page's own admission for every row (ACC-229's "a row's actions are
  the task page's" proof).
- **Mutations:**
  - the `taskVisibleSql` AND removed;
  - the gate removed;
  - `removedAt` dropped.

---

## 6. Performance (both parts)

- **Nothing on the per-request path.** No query in TenantGuard, PermissionGuard, the throttler
  or the interceptors. Ending one session is deliberately not immediate for that reason (§1.5).
- **Sessions:** two queries per read; cap 20; no loop.
- **Tasks:** today's record-list: the visibility context (a handful of reads in one
  `Promise.all`), the page SQL with the rule before `LIMIT`, then batched rows. `take` ≤ 50.
- **Indexes relied on:**
  - `RefreshToken(userId)`;
  - `TaskAssignee(userId)` and `Task(sourceType, sourceId)` (step-244 §9);
  - `Committee(orgUnitId)`.

---

## 7. PR split

| PR | Content | Backend slot | Depends on |
|---|---|---|---|
| 1 | Sessions read + self end routes + `users:manage_sessions` (added by lane A, reviewed by lane B; catalogue, sentences, group, seed and pinned sets, CLAUDE.md list: §2.7); the generalised reset rule; `SESSIONS_ENDED` in the access-history classifier | yes | #323 merged (the classifier) |
| 2 | Sessions panel | no | PR 1 deployed |
| 3 | Deactivation uses `endEverySessionInTx()` (Q6): #326, in #317's transaction | yes | none |
| 4 | Tasks person scope on `record-list` + db-spec | yes | none |
| 5 | Tasks panel | no | PR 4 deployed |

- **No migration in any PR** (the optional index in §2.1 is not planned).
- **A new key** follows ACC-164: `npm run backfill:acc216-manage-sessions-permission`, grant-only,
  writing `RolePermission` directly, one audit row per organisation, refusing customers, the
  platform organisation skipped (§2.7). Dry run, `-- --execute` after the deploy, then a dry run
  reporting 0. It needs Ahmad's "go".

---

## 8. What this plan does not change

- Sign-in, refresh, the idle timeout and the 12-hour limit are untouched.
- Impersonation creates no row (§1.11) and is not listed.
- Task visibility (`taskVisibleSql`) is unchanged under Option A.

---

## 9. Questions for Ahmad

Each is answerable in one word. **Recommended** answers are marked ★. **Answered 17 Nov:
every ★ accepted** (see "Ahmad's answers (17 Nov)" at the top).

1. Build ending sessions in this ticket, not only the list? **Yes ★** / No
2. Someone else's sessions need a new key, `users:manage_sessions` (Organization Administrator
   only), as well as `users:view`? **Yes ★** / No (users:view alone)
3. Show the sign-in address (IP) to that key's holder, as well as to the person? **Yes ★** / No
   (the person only)
4. An administrator can only "Sign out everywhere" (immediate), not end one device? **Yes ★** / No
5. Email the person when an administrator signs them out everywhere? **Yes ★** / No
6. Fix deactivation to revoke its sessions (`endEverySessionInTx()`) as its own PR? **Yes ★** / No
7. Accept that ending one of your own devices takes up to 15 minutes (no check per request)?
   **Yes ★** / No
8. Tasks: which option, A (the viewer's own rule), B (`users:view` shows all) or C (a new key)?
   **A ★** / B / C
9. Tasks on the panel are those the person is on now (active assignee), not ones they created?
   **Yes ★** / No
10. No New task button on a person's Tasks panel? **Yes ★** / No
11. Build the Sessions panel on `am-capped-panel` now and have the design thread check it after,
    since nothing is drawn? **Yes ★** / No (wait for a drawing)
