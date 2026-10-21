# Step 240 — The committee change request screens (ACC-240)

**Ticket:** ACC-240, PR 3 of the committee changes plan
(`backend/Plans/step-238-committee-changes.md`). This file replaces that plan's
§6, which was written before ACC-239 was built. §6 there now points here.

**Lane:** B.

**Drawing:** sections 2 to 4 of
`frontend/design-reference/AccreditMe Committee Changes.dc.html`. Line numbers
below (`L…`) are that file's.

**Built on:** `origin/dev` at `6a1d728`, which includes ACC-239 (`8fa444e`)
and ACC-244 (`86c4296`).

**Status:** PLAN ONLY. Nothing is built until Ahmad answers §12.

Every database read behind this plan was read-only (`BEGIN READ ONLY`, then
`ROLLBACK`). Nothing was written.

---

## 1. What ACC-239 shipped, and what these screens still need

### 1.1 The endpoints on dev

Both controllers are in
`backend/src/foundation/committees/change-requests/committee-change-request.controller.ts`.
Every route carries `@Permissions(committees:view)` at the guard. Everything
else (edit_details, approve, being the requester) is the service's, because
only the request says who raised it.

| Route | Controller | Service | Answers |
|---|---|---|---|
| `GET /committees/:committeeId/change-requests` | `:35` | `list()` `:555` | `{ items: IChangeRequest[], total, matching }`; `q` (a number, or the requester's name), `sort` number / status / requested, `dir`, `take` (50), `skip` |
| `GET /committees/:committeeId/change-requests/open` | `:47` | `openSummary()` `:584` | `{ request: IChangeRequest \| null }` |
| `POST /committees/:committeeId/change-requests/preview` | `:58` | `preview()` `:607` | `{ changedFields, impacts: ChangeImpact[] }`; no write |
| `POST /committees/:committeeId/change-requests` | `:68` | `create()` `:168` | a draft; `submit: true` submits it too |
| `GET /committee-change-requests/awaiting-decision` | `:88` | `awaitingDecision()` `:590` | under review, not raised by the viewer; needs committees:approve |
| `GET /committee-change-requests/:id` | `:98` | `getOne()` `:544` | one request, with the viewer's `actions` |
| `PATCH /committee-change-requests/:id` | `:109` | `update()` `:230` | requester, draft or returned; `expectedUpdatedAt` |
| `POST /committee-change-requests/:id/submit` | `:121` | `submit()` `:277` | requester |
| `POST /committee-change-requests/:id/withdraw` | `:132` | `withdraw()` `:338` | requester at any open stage; an approver for a draft or returned request |
| `POST /committee-change-requests/:id/approve` | `:143` | `approve()` `:381` | committees:approve, never the requester |
| `POST /committee-change-requests/:id/return` | `:154` | `returnForChanges()` `:478` | the same; `note` required |
| `POST /committee-change-requests/:id/reject` | `:166` | `reject()` `:511` | the same; `reason` required |

Reads these screens also use, all existing:

| Route | Where | Used for |
|---|---|---|
| `GET /committees/:id` | `committees.service.ts:100–101` (`currentStageKey`, `isDissolving`) | the page header; a draft's "Current" values; the dissolving banner |
| `GET /workflows/instances?objectType=COMMITTEE_CHANGE_REQUEST&objectId=` | `workflow.controller.ts:37` | the stepper (needs `workflows:view`, plus the request's committee: `object-visibility.service.ts:72`) |
| `GET /workflows/instances/:id/stage-history` | `workflow.controller.ts:57` | stage history; Return and Reject pass their note as the transition comment (`service.ts:146`, `:179`), so the history's Note column already has it |
| `GET /committees/:id/members` | existing | "of 9 members" under Quorum |
| `GET /tasks/requests/awaiting-decision` | `task.controller.ts:286` | Home's task-request rows (self-scoped) |

**Who reads what.** Every seeded role holding `committees:view` also holds
`workflows:view`, `org:view` and `lookups:view`. Without `workflows:view` the
stepper and history render nothing, exactly as they do on the committee page
today (`workflow.controller.ts:50–56`).

### 1.2 The reads that are MISSING — a backend change, so a Railway rebuild

| # | Missing | Why the screens need it | Proposal |
|---|---|---|---|
| **G1** | **May this viewer raise a request now?** | "Request a change" shows in Active and Suspended, for `committees:edit_details`, with no open request (drawing L350–351, L355). The stage half is `COMMITTEE_STAGE_POLICY.raise` (`change-request-policy.ts:99`), a BACKEND map. The brief forbids re-coding it in the frontend, and `COMMITTEE_HEADER_POLICY` (`committee-stage.ts:53`) must not grow a copy. | `GET …/change-requests/open` answers `{ request, canRaise }`. `canRaise` = holds `committees:edit_details` AND `committeeStagePolicy(key).raise` AND no open request. That is the same three refusals `create()` makes, read from the same functions. The drawing already ties the button to this read: "Request a change appears once the open-request check returns, never before" (L482). |
| **G2** | **Who decided or withdrew it.** `IChangeRequest` has `decidedById` and `withdrawnById` as bare ids (`service.ts:79–112`). Neither has a relation in the schema. | "Returned by A. Al-Harbi", "Approved by …", "Rejected by … on …", "Withdrawn by …" (L444–446). | `decidedBy: { id, name } \| null` and `withdrawnBy: { id, name } \| null`, read by id AND `organizationId` in one `user.findMany` per response. No migration. `requestedBy.name` is already returned to every `committees:view` holder, so naming the decider discloses nothing new. |
| **G3** | **Labels for the id-valued fields.** `changes`, `fromValues` and the preview's `OWNING_UNIT` / `PARENT` / `REPORTS_TO` impacts carry ids (`typeValueId`, `orgUnitId`, `parentCommitteeId`, `reportingToCommitteeId`). | The What changes table, the Approve dialog's lines and the impact lines all name the value. The client lists need `lookups:view` (`lookup.controller.ts:81–82`) and `org:view` (`organization.controller.ts:46–47`), and they leave out deactivated values, which a closed request can still name. | `labels: Record<id, { en: string; ar: string \| null }>` on `IChangeRequest` and `IChangeRequestPreview`. It covers every id in `changes`, `fromValues` and the impacts, scoped by `organizationId`, inactive values included. Three reads (lookup values, org units, committees), one each. Shown through `LanguageService.bilingual()` (ACC-160). |

Each gap is **additive** to a response. No route, permission or refusal changes,
and no migration is needed.

**Not gaps, and why:**
- **Impact lines on the request page.** `getOne()` returns none. The page calls
  `preview` with the request's `changes` while the request is open, so the
  lines are worked out against the committee as it is now. That is what
  approving would do. A closed request shows no impact lines (drawing R4/R5
  show none).
- **The approver's name in the banner** ("· with A. Al-Harbi", L344). ACC-239
  sends a submitted request to EVERY active `committees:approve` holder
  (§5.7 of step 238), so there is no single reviewer to name. The wording drops
  the name (§9). No read is needed.
- **The drawing's "Partial: applied but the task couldn't be created"** (L501).
  `approve()` writes the committee and the task in one transaction
  (`service.ts:381–477`), so this state cannot occur. Not built.
- **Notices opening the request.** ACC-239's notices open the committee
  (`service.ts:690–700`), where the banner is. That stays, and no backend change
  is made for it.

---

## 2. The rules, each read from where it lives

**The screens never decide who may act.** Every action button renders from the
server's `actions` flags, computed in `toDto()` (`service.ts:777`, flags
`:806–813`). Each flag is the policy maps AND who is asking.

| Button | Flag | The server's rule |
|---|---|---|
| Request a change (header) | `canRaise` (G1) | `committees:edit_details`, `COMMITTEE_STAGE_POLICY[key].raise` (active, suspended only), no open request |
| Edit (draft) | `actions.edit` | requester AND edit_details AND `stagesAllow(…, 'edit')` (`policy.ts:143`): request `draft` or `returned` (`:41–43`); committee not dissolving |
| Submit for review | `actions.submit` | requester AND edit_details AND request `draft` / `returned` AND committee `active` / `suspended` |
| Withdraw… | `actions.withdraw` | request open; the requester at any open stage, or an approver while `othersMayWithdraw` (`draft`, `returned` only, `:41–43`) |
| Approve… | `actions.approve` | approver AND not the requester AND request `under_review` AND committee `active` / `suspended` |
| Return for changes… | `actions.return` | as Approve |
| Reject… | `actions.reject` | approver AND not the requester AND request `under_review`; allowed while the committee dissolves (`DISSOLVING`, `:97`) |

- **No self-approval.** `deciding = approver && !own` (`service.ts:803`). The
  requester never sees Approve, Return or Reject, and the server refuses
  `CHANGE_REQUEST_OWN_DECISION` if they are sent anyway.
- **One open request per committee.** The header button follows `canRaise`. A
  direct link to `…/change-requests/new` reads `open` first and, with a request
  open, lands on that request (drawing L491, "Denied"). The server refuses
  `CHANGE_REQUEST_ALREADY_OPEN` with the open request's id and number, and the
  page links to it.
- **Dissolution Pending and Dissolved** (`COMMITTEE_STAGE_POLICY`,
  `policy.ts:99`): no new request; an open one can only be rejected or
  withdrawn. The page shows the dissolving banner when `GET /committees/:id`
  says `isDissolving`. The buttons are absent because their flags are false.
- **Absent, never disabled** (drawing note, L495). A flag that is false removes
  its button.
- **`COMMITTEE_HEADER_POLICY` is not touched**, except its comment line
  "active, suspended … Request a change arrives with ACC-240", which now says
  the button follows the server's `canRaise`.

---

## 3. The screens

### 3.1 The committee page (`committee-detail.component.ts`)

**Header — "Request a change".**
- It sits after `app-workflow-transition-actions` (`:143`), where Edit sits for
  Formation (`:153`). It is an outlined small button, as Edit is.
- It renders only when `canRaise` is true, and only after the open read
  returns. It routes to `/committees/:id/change-requests/new`.
- **No header ⋯** (step 238, Q16, decided).

**The open-request banner** — new `committee-change-banner`, between the header
card and the Lifecycle row (drawing L355).
- Reads `GET …/open` (`controller :47`).
- Present only while a request is open. Its title follows the request's stage
  KEY (under review, draft, returned).
- Fields named by the fixed nine keys, through translations.
- Link: "View request".
- **Error state:** "Couldn't check for an open change request." with Retry. The
  header button stays absent.
- **Partial state:** a request that names no field the screen knows (a key
  outside the nine) shows "A change request is open." with View request.
- The phone layout (L357) shortens the body to "requester · date".

**The Change requests panel** — new `committee-change-requests-panel` on
`am-capped-panel`, LAST in the grid after Membership history (`:331`; drawing
L364–368).
- Reads `GET …/change-requests?sort=number&dir=desc&take=5` (`controller :35`).
- The header count is `total`.
- Rows:
  - line 1: "Change request N · fields", with the status at the end;
  - line 2: requester and date, by status (§9).
  - A row links to its request page. **No row ⋯ and no action column** (Q17,
    decided).
- Order: newest first (the drawing's "newest first", L481). The server sorts by
  number, which is the same thing.
- Empty, Loading (5 skeleton rows) and Error with Retry are the frame's own
  states.
- **See all:** `am-list-dialog size="compact"` (720 × 560), `am-simple-list`,
  `am-sort-header`.
  - Request (number), Status and Requested sort by header; it opens on
    Requested ▼.
  - Fields and Requested by are plain text.
  - Search: number or requester name, the server's `q`.
  - Load more by 50. Phone cards keep the compact sort menu (760, Q19).

### 3.2 Request a change — a page (`/committees/:id/change-requests/new`)

Plus its draft edit (`/committees/:id/change-requests/:requestId/edit`), one
component: new `committee-change-request-form`.

- **Opening it:**
  - It reads `GET /committees/:id` (current values and the stage),
    `GET …/open` (G1's `canRaise`; with a request open, it navigates to that
    request), and `GET /committees/:id/members` (the member count).
  - Edit mode reads `GET /committee-change-requests/:id` and opens only when
    `actions.edit` is true; otherwise it goes to the request page.
  - **The pickers' lists:** the Edit dialog's own loaders (types, units,
    committees), with ACC-233's `referenceOptions()` for Parent and Reports to,
    and active units only for Owning unit.
- **Every field** starts at the committee's current value.
  - Three groups, using the Edit dialog's tab names as headings: Identity,
    Governance, Structure.
  - A field that differs from today is marked three ways (drawing L194–201):
    "✎ Changed" beside the label, the 2px border, and "was …" in its message
    slot.
  - The message slot is `am-field`'s `hint` (`field.component.ts:334`). An
    unchanged field's slot says "Current".
- **The summary banner** reads "Changing: Quorum, Reports to". It sits above the
  reason, and only while at least one field changes.
- **Reason:** "Why is this change needed?", required, `am-field` with
  `[control]`.
- **Impact list:** "What this change does".
  - It calls `POST …/preview` (`controller :58`) after a field changes,
    debounced at 400 ms and cancelled by the next change.
  - Each `ChangeImpact` code is said in words (§9).
  - Loading: "Working out what this change does…". Failed: "Couldn't work out
    what this change does." with Retry, and submitting is still allowed (L491,
    "Partial").
  - A preview refused by an ACC-233 reference rule shows that rule's sentence
    under the field it names.
- **Footer:**
  - Left: "Goes to everyone who can approve committee changes."
  - Buttons: Cancel (text) · Save as draft (secondary) · Submit for review
    (primary).
  - `POST …/change-requests` (`controller :68`) with `submit: false` or `true`.
    Edit mode sends `PATCH` with `expectedUpdatedAt`, and then `POST …/submit`
    for Submit.
- **Validation is rule 5.2:**
  - Submit and Save as draft are never disabled.
  - With nothing changed, pressing either says "Change at least one field."
    above the form.
  - A missing reason fills its slot, and focus moves there.
  - **The drawing's "Submit disabled until …" (L491) is not followed** (step
    238, Q18, decided).
- **Leaving with unsaved work:** a `canDeactivate` guard asks Keep editing ·
  Discard, as `roles.routes.ts:41`'s `leaveGuard` does. Cancel asks the same.
- **After saving:** the page goes to the request page, and the panel and banner
  reload when the committee page is shown again.

### 3.3 The request page (`/committees/:id/change-requests/:requestId`)

New `committee-change-request-page`.

- **Reads:**
  - `GET /committee-change-requests/:id` (`controller :98`);
  - `GET /committees/:id` (live values, `isDissolving`);
  - the request's instance and stage history (§1.1);
  - and, while the request is open, `POST …/preview` with its `changes`.
- **Header:**
  - Breadcrumb parent: the committee, through `BreadcrumbParentService`, named
    only for a viewer who may open it.
  - Eyebrow "Change request N"; H1 "Change request N · {committee}".
  - The status chip, and a chip naming who and when (§9: requested, returned,
    approved, withdrawn).
- **Stepper:** `app-workflow-stage-indicator` `sequence` (Q-A, §12), with the
  tenant's stage names.
- **What changes:** Field, Current and Proposed. Changed fields only.
  - **Current:**
    - an open request shows the committee's live value;
    - an applied one shows its stored `fromValues`, struck through;
    - a rejected or withdrawn one shows its `fromValues` if it was submitted,
      else the live value.
  - **Drift:** while under review, a field whose live value differs from its
    `fromValues` is marked "Changed since it was submitted". The page shows the
    drift banner, because approving will be refused with
    `CHANGE_REQUEST_COMMITTEE_CHANGED`.
  - **Empty values:**
    - an empty Arabic name is "—", the slot whose job is the Arabic name
      (ACC-160);
    - an empty Parent or Reports to is "None";
    - an empty Purpose is "—".
  - **Long Purpose:** the cell shows two lines with an ellipsis, and the whole
    text in a tooltip (artboard 14, rule 2.3).
- **Reason, impact lines** (open only) and **Stage history** (`history` mode).
- **Banners by stage key and viewer:**
  - Returned: the note, who returned it and when.
  - Applied: when, and the terms task line.
  - Rejected: who, when and the reason.
  - Withdrawn: who and when.
  - Dissolving.
  - Drift.
  - Waiting: shown to the requester under review.
- **The terms task:** the Applied banner names it. "Open the task" links to
  `/tasks/{termsTaskId}` only for the requester (its assignee) and the decider
  (its creator). Both are admitted by the task page's rule (ACC-244). Anyone
  else gets the sentence without a link, never a link that 404s.
- **Actions** follow `actions` (§2).
  - On a phone (below 760, `LIST_DIALOG_SHEET_BELOW_PX`) the approver's three,
    and the requester's Edit, Submit and Withdraw, sit in a sticky bottom bar
    (drawing note L500).
  - The bar is a `<div role="region">` named "Actions for change request N".
    The body gets bottom padding equal to the bar's height, so nothing hides
    behind it.
- **States:**
  - Loading: skeletons for the header, the comparison and the history.
  - Error: "Couldn't load this change request." with Retry.
  - Not found (another organisation, an invented id): "Change request not
    found", the identical page for both.
  - Denied (no `committees:view`): the route guard sends them to the landing
    page, as for the committee page.

### 3.4 The four dialogs

| Dialog | Kind | Width | Body (drawing) | Calls |
|---|---|---|---|---|
| Approve | confirm, through `AmConfirmService.ask()` | 420 | 126 EN / 138 AR; typo-only 98 / 108 | `POST …/approve` (`:143`) |
| Return for changes | form, `app-edit-dialog`, footer, `[dirty]` | 560 | 152 / 166 | `POST …/return` (`:154`), `{ note }` 1–1000 |
| Reject | form, `app-edit-dialog`, footer, `[dirty]`, danger action | 560 | 152 / 166 | `POST …/reject` (`:166`), `{ reason }` 1–1000 |
| Withdraw | confirm, through `AmConfirmService.ask()`, destructive | 420 | 42 / 48 | `POST …/withdraw` (`:132`) |

- **Approve needs one addition to `ask()`.**
  - ASK today takes one `message` string, and its contract is "one question,
    two buttons, no fields" (`am-confirm.service.ts:13–29`, `:38–41`).
    Approve has no field, so it IS a confirm. But it lists the changes in
    words: "Quorum: 5 → 6" (drawing L454).
  - **Proposal:** an optional `details?: string[]` on `AmConfirmOptions`,
    rendered by `confirm-host.component.ts` as a list between the message and
    the buttons. Every existing caller is unchanged.
  - The alternative, an `app-edit-dialog` confirm built by hand, would break
    "every confirm through ask()" and `check:confirm-through-helper`'s purpose.
  - **More than six changed fields** collapse to "Quorum, Reports to and 5
    more" (step 238, Q14, decided). The full table is on the page.
  - The sentence underneath: "A task to revise the terms of reference will be
    created for {requester}."
  - Arabic mirrors the arrow (←), so the old value reads before the new.
- **Return and Reject** each carry a required textarea in `am-field`. Return or
  Reject is never disabled; pressing it with an empty note fills the slot. A
  dirty form asks Keep editing · Discard on Cancel or Escape.
- **After any decision:** the page reloads the request, the history and the
  banner. A refusal is said from its code (§9) inside the dialog; it offers no
  Retry. Retry appears only when the server could not be reached (rule 5.5).

### 3.5 Home — "Awaiting my action" (an open question, §12 Q-B)

- **My pick: one card, "Awaiting my action"**, rendered when it has at least one
  row. It holds:
  - change requests under review that the viewer may decide (only for holders
    of `committees:approve`, `GET /committee-change-requests/awaiting-decision`,
    `controller :88`);
  - task requests the viewer may decide (`GET /tasks/requests/awaiting-decision`,
    `task.controller.ts:286`, self-scoped).
  - Oldest first, five rows, each opening its own page. "See all" goes to My
    Tasks' "Waiting for your decision" for task requests.
  - This is step 238's Q13 pick, accepted on 18 Oct. It is restated because the
    ticket calls the shape open.
- **The one alternative:** a card for change requests only, beside My Tasks.
  Task requests stay on My Tasks alone. It is simpler, but a decider then looks
  in two places for the same kind of work.

### 3.6 Two confirm wordings handed over by lane A

Both already go through `AmConfirmService.ask()`. Only the header, message and
button change.

**Remove member** (`committee-detail.component.ts:728–734`, destructive)

| | English | Arabic |
|---|---|---|
| header | Remove {{name}} from this committee? | إزالة {{name}} من هذه اللجنة؟ |
| message | Their membership ends today and stays in the committee's history. | تنتهي العضوية اليوم وتبقى في سجل اللجنة. |
| button | Remove | إزالة |

- **The proof:**
  - The page sends no date (`removeMember(this.committeeId, member.id, {})`),
    and the server then ends the membership now:
    `effectiveDate = dto.effectiveDate ? … : new Date()`
    (`committees.service.ts:397`) and `leftAt: effectiveDate, isActive: false`
    (`:401–403`).
  - "Stays in the history": a `CommitteeMembershipEvent` with `action: 'LEFT'`
    (`:406–413`). The event table is append-only and is what the Membership
    history panel lists.
- **The name:** a person has one `name` (`User.name`, no Arabic field), so
  `{{name}}` is that name in both languages. The bilingual-name helper (ACC-160)
  has nothing to choose between here. The committee is "this committee", so no
  committee name is needed.
- **No new read:** the page already holds its users (`userName()`, `:603`).
- `committee.confirmRemoveMember` keeps its key and becomes the header. The
  message is a new key. `common.remove` stays the button.

**Complete task** (`task-action-host.component.ts:140–151`, neutral)

| | English | Arabic |
|---|---|---|
| header | Complete “{{title}}”? | إنجاز «{{title}}»؟ |
| message | It's marked done for everyone on it, and any open request for more time or a hold is cancelled. | تُعلَّم منجزةً لكل من أُسندت إليه، ويُلغى أي طلب مفتوح لمزيد من الوقت أو للتعليق. |
| button | Complete | إنجاز |

- **The proof** (`task.service.ts:708`, `complete()`):
  - every other active assignee is taken off it (`:720–723`);
  - the task becomes COMPLETED (`:725–727`);
  - open requests are cancelled (`:730`).
  - The old message ("no longer see it as outstanding") said less than this.
- **The name:** `titleOf(row)` already uses `LanguageService.bilingual(row.title,
  row.titleAr)` (`:221–222`). No new read.
- "إنجاز" is the app's existing word (`task.complete`), not the handover's
  "إكمال", so the button and the header agree.

**Tests for both** (`confirm-wording.spec.ts` already pins confirm wording):
header, message and button in English and in Arabic, plus the tone
(destructive / neutral) and the bilingual title with an empty `titleAr`.

### 3.7 The Edit dialog's pickers, when their list fails to load

- `committee-form.component.ts:647–667` releases a picker with an empty list
  when its read fails (the ACC-246 fix), and says nothing.
- **Plan:** one failure flag per list (types, units, committees). While it is
  set, the field's hint slot reads "Couldn't load the list." with a Retry link
  that reloads only that list. The picker stays usable for typing.
- A spec per list: the failed read, the line, then Retry and the list
  arriving.

---

## 4. Layout rules, as they apply

- **Dialog bodies never scroll, and the 420px form cap is not raised.** Every
  dialog here is far under it (§3.4). Approve's longest case (six lines, then
  the collapse) is measured in both languages by a layout spec, against the
  420 confirm.
- **At least 20px of room:** each layout spec asserts `cap − body ≥ 20`.
- **Request a change is a page**, so the cap does not apply (drawing L484), but
  its footer is fixed and the page itself scrolls.
- **Every confirm goes through `AmConfirmService.ask()`**: Approve (with
  `details`), Withdraw, Remove member, Complete task.
- **Lists sort by column header** (`am-sort-header`), with a compact sort menu
  on phone cards. The capped panel has no sort (artboard 14, rule 1.7).
- **Attachments:** a change request has none, so the in-app viewer rule has
  nothing to apply to.
- **Columns defined once, no content-sized track** (ACC-234). The See all
  list's Fields cell ends in an ellipsis with a tooltip.

---

## 5. Routes

In `frontend/src/app/foundation/committees/committees.routes.ts`, with literal
paths before parameters (ACC-79):

```
''                                        list (existing)
':id/change-requests/new'                 Request a change   canDeactivate: [leaveGuard]
':id/change-requests/:requestId/edit'     draft edit         canDeactivate: [leaveGuard]
':id/change-requests/:requestId'          the request page
':id'                                     committee page (existing)
```

Each child inherits the parent `committees` route's `permissionGuard`
(`app.routes.ts:99–101`, `committees:view`). The new pages need nothing
stricter at the route: who may DO anything is the server's `actions`.

---

## 6. Tests

| Screen | Specs |
|---|---|
| Backend G1–G3 | `canRaise` true and false for each of its three halves; names of the decider and withdrawer; labels for every id field, inactive values included, and another organisation's ids never resolved (named for CI's tenant-isolation gate); a real-database spec for `canRaise` under an open request |
| Header button | present for Active and Suspended with `canRaise`; absent for every other key, for a missing permission and with a request open; absent before the read returns |
| Banner | each stage key's title; Error with Retry; Partial; absent when no request is open |
| Panel + See all | five rows, the count, the empty state, the error state; sort by header both ways; search; Load more; a layout spec at the three widths (1280 / 1440 / 1920) and in the popup, both languages (ACC-234's shape) |
| Request a change | the three marks on a changed field; the summary; Save as draft and Submit never disabled; "Change at least one field."; a missing reason; preview debounce, cancel and failure; `ALREADY_OPEN` lands on the open request; the leave guard; Arabic |
| Draft edit | opens only with `actions.edit`; `CHANGE_REQUEST_CHANGED` offers Reload |
| Request page | each stage key × viewer (requester, approver, reader) renders exactly the buttons its flags allow; banners; drift; the struck-through Current; phone bar below 760; the terms task link only for the requester and the decider |
| Dialogs | each refusal code said in both languages; Retry only when unreachable; Return and Reject never disabled; layout specs for all four, both languages, `≥ 20px` room |
| `ask()` details | rendered as a list; absent changes nothing for existing callers |
| Home | rendered for an approver with rows; absent with none; task-request rows; oldest first |
| Confirm wordings | §3.6 |
| Edit dialog load error | §3.7 |

**Mutation checks** (each must turn a spec red):
- the header button reading the stage key instead of `canRaise`;
- an action button rendered with its flag false;
- `details` dropped from Approve;
- the Approve collapse threshold;
- the drift mark;
- a hard-coded name in a banner.

**Scans:**
- **Expected to bite:**
  - `check:formatting` (every date through `amDate` / `amDateTime`);
  - `check:icon-labels` (the sticky bar, the banner link, See all);
  - `check:dialog-overlays` and `check:dialog-density` (Return, Reject);
  - `check:action-gating` (every write button behind its flag);
  - `check:field-control` (every `am-field` gets `[control]`);
  - `check:confirm-translated` and `check:confirm-through-helper` (the four
    confirms).
- **Run, expected unchanged:**
  - `check:create-gating` (Request a change is in the record header, not a
    list page's create slot; the scan's rule is checked when built);
  - `check:contrast`;
  - `check:permission-sentences` (no new key);
  - `check:reserved-slugs`, `check:vercel-config`;
  - backend `check:ai-gateway`, `check:worker-gate`.

---

## 7. One PR or two

**Two.**

1. **PR 3a — the reads, and two small items lane A handed over.**
   - **Backend:** G1, G2 and G3, with their specs.
   - **Frontend:** the Remove member and Complete task wordings (§3.6), and the
     Edit dialog's load-error line (§3.7).
   - This deploys first, because a backend change needs its Railway rebuild
     before the screens can rely on it. It is additive, so the running frontend
     ignores the new fields.
2. **PR 3b — the screens.**
   - The header button, the banner, the panel and See all, Request a change and
     its draft edit, the request page, the four dialogs, `ask()`'s `details`
     and Home.
   - **Frontend only**, so no Railway rebuild.

Why not one PR: 3b is large (two pages, a panel, a list, four dialogs, a Home
card), and its live proof needs 3a's reads already on the API. Splitting lets
the backend land and be read back alone. Why not split 3b further: the screens
reach one another (banner → request page; panel → request page; header →
form → request page), and none is useful alone.

---

## 8. The live proof

**A real proof needs a change request on the shared database.** None exists in
any organisation today (measured, read-only, 21 Oct). The screens cannot be
shown populated without one.

**Proposal, for Ahmad to decide** (after PR 3b deploys):

- **Organisation:** al-nakheel.
- **Committee:** "ACC-208 proof committee". It is Active, already test data,
  has 0 members and quorum 1. The seeded committees are left alone.
- **What changes:** Meeting frequency, As needed → Monthly. It touches no
  member, reference or task.
- **Who:**
  - Yasser (Quality Manager, holds edit_details and approve) raises it.
  - Hessa (Tenant Admin) decides it. The requester can never decide their own,
    which is the check that matters.
- **Steps:**
  1. Yasser: Request a change, save as draft, edit the draft, submit.
  2. Hessa: open it from the banner and from Home. Open Approve and Reject and
     read them, then Cancel both. Return it with a note.
  3. Yasser: read the Returned banner, edit, submit again.
  4. **Yasser withdraws it.** Nothing is applied, and no terms task is created.
- **What it leaves behind:**
  - one Withdrawn request (#1) on that committee, which cannot be deleted;
  - its audit rows;
  - notices sent to Hessa on each submit (step 238, §5.7);
  - the request's workflow instance.
  The committee itself is unchanged.
- **Read back:**
  - the committee's frequency is still As needed;
  - the request is withdrawn;
  - no task was created on the committee (its task count stays 3);
  - al-nakheel's other committees are untouched.
- **Approve is proved by the specs, not live** (ACC-239's real-database spec
  applies a request). A live Approve would change the committee and create a
  terms task. If Ahmad wants it, the same committee's frequency could go As
  needed → Monthly through Approve, with a second request returning it, which
  leaves two applied requests and two terms tasks. My pick is not to.
- **Without Ahmad's go-ahead,** the proof stays read-only: the empty panel, the
  absent banner, "Request a change" present for Yasser and absent for Fatima
  (Viewer), and Approve's absence for a requester, proved by specs.

---

## 9. Every string, in both languages

Keys live under `committee.changeRequest.*` unless noted. `{{…}}` values are
data. Committee and person names are data (person names have no Arabic form).
Stage names shown as stage data use the tenant's `nameEn` / `nameAr` through
`bilingual()`. Field labels in sentences use the short forms in 9.1. Numbers
use Latin digits in both languages, and dates go through `amDate` (ACC-94).

### 9.1 Field names, as a change list names them

| key | English | Arabic |
|---|---|---|
| field.nameEn | Name (English) | الاسم (بالإنجليزية) |
| field.nameAr | Name (Arabic) | الاسم (بالعربية) |
| field.typeValueId | Type | النوع |
| field.purpose | Purpose | الغرض |
| field.quorumCount | Quorum | النصاب |
| field.meetingFrequency | Meeting frequency | تكرار الاجتماعات |
| field.orgUnitId | Owning unit | الوحدة المالكة |
| field.parentCommitteeId | Parent committee | اللجنة الرئيسية |
| field.reportingToCommitteeId | Reports to | ترفع تقاريرها إلى |
| list.and (joins the last two) | {{a}} and {{b}} | {{a}} و{{b}} |
| list.separator | , | ، |
| list.andMore (plural) | {{fields}} and {{count}} more | {{fields}} و{{count}} غيرها |

`list.andMore` is a plural object (ACC-94): English one / other; Arabic zero,
one, two, few, many, other, all reading "و{{count}} غيرها" except two
"وحقلان آخران" and one "وحقل آخر".

The Request a change page's field LABELS are the Edit dialog's existing keys
(`committee.nameEn` "Committee Name (English)" / "اسم اللجنة (بالإنجليزية)",
and the rest), so one field keeps one name. Its group headings are the dialog's
tab keys.

### 9.2 Status, by stage key

| key | English | Arabic |
|---|---|---|
| status.draft | Draft | مسودة |
| status.under_review | Under review | قيد المراجعة |
| status.returned | Returned for changes | أُعيد للتعديل |
| status.approved | ✓ Applied | ✓ طُبّق |
| status.rejected | Rejected | مرفوض |
| status.withdrawn | Withdrawn | مسحوب |
| status.unknown (a stage with no key) | Open | مفتوح |

### 9.3 Committee page

| key | English | Arabic |
|---|---|---|
| requestChange | Request a change | طلب تغيير |
| banner.under_review | Change request {{n}} is under review: {{fields}} | طلب التغيير {{n}} قيد المراجعة: {{fields}} |
| banner.draft | Change request {{n}} is a draft: {{fields}} | طلب التغيير {{n}} مسودة: {{fields}} |
| banner.returned | Change request {{n}} was returned for changes: {{fields}} | أُعيد طلب التغيير {{n}} للتعديل: {{fields}} |
| banner.bodyUnderReview | Submitted by {{name}} on {{date}}. Until it is decided, the committee carries on as it is. | قدّمه {{name}} في {{date}}. إلى أن يُبتّ فيه، تستمر اللجنة على حالها. |
| banner.bodyDraft | Started by {{name}} on {{date}} and not yet submitted. | بدأه {{name}} في {{date}} ولم يُقدَّم بعد. |
| banner.bodyReturned | Returned to {{name}} on {{date}} for changes. | أُعيد إلى {{name}} في {{date}} للتعديل. |
| banner.bodyPhone | {{name}} · {{date}} | {{name}} · {{date}} |
| banner.view | View request | عرض الطلب |
| banner.error | Couldn't check for an open change request. | تعذّر التحقق من وجود طلب تغيير مفتوح. |
| banner.partial | A change request is open. | يوجد طلب تغيير مفتوح. |
| panel.title | Change requests | طلبات التغيير |
| panel.rowTitle | Change request {{n}} · {{fields}} | طلب التغيير {{n}} · {{fields}} |
| panel.metaSubmitted | {{name}} · submitted {{date}} | {{name}} · قُدّم في {{date}} |
| panel.metaStarted | {{name}} · started {{date}} | {{name}} · أُنشئ في {{date}} |
| panel.metaDecided | {{name}} · {{from}} to {{to}} | {{name}} · من {{from}} إلى {{to}} |
| panel.metaOn | {{name}} · {{date}} | {{name}} · {{date}} |
| panel.empty | No change requests yet. Changes to this committee's details after approval are listed here. | لا توجد طلبات تغيير بعد. تُدرج هنا التغييرات على تفاصيل هذه اللجنة بعد اعتمادها. |
| panel.error | Couldn't load the change requests. | تعذّر تحميل طلبات التغيير. |
| list.title | All change requests · {{committee}} | جميع طلبات التغيير · {{committee}} |
| list.close | Close change requests | إغلاق طلبات التغيير |
| list.search | Search change requests | البحث في طلبات التغيير |
| list.searchPlaceholder | Number or requester | الرقم أو مقدّم الطلب |
| list.col.request | Request | الطلب |
| list.col.fields | Fields | الحقول |
| list.col.status | Status | الحالة |
| list.col.requestedBy | Requested by | مقدّم الطلب |
| list.col.requested | Requested | تاريخ الطلب |
| list.noMatch | No change request matches. | لا يطابق البحث أي طلب تغيير. |

The footer ("Showing 5 of N · See all") is the shared `record.showing` /
`record.seeAll` (ACC-230). Retry is `common.retry`.

### 9.4 Request a change (page)

| key | English | Arabic |
|---|---|---|
| form.eyebrowNew | Change request · new | طلب تغيير · جديد |
| form.eyebrowDraft | Change request {{n}} · draft | طلب التغيير {{n}} · مسودة |
| form.title | Request a change | طلب تغيير |
| form.titleEdit | Edit change request {{n}} | تعديل طلب التغيير {{n}} |
| form.intro | Change only what needs changing. Every value shown is current until you edit it. | غيّر ما يلزم تغييره فقط. كل قيمة معروضة هي القيمة الحالية إلى أن تعدّلها. |
| form.changed | ✎ Changed | ✎ تغيّر |
| form.current | Current | الحالي |
| form.was | was {{value}} | كان: {{value}} |
| form.ofMembers (plural) | of {{count}} members | من {{count}} أعضاء |
| form.summary | Changing: {{fields}} | يتغيّر: {{fields}} |
| form.reason | Why is this change needed? | لماذا يلزم هذا التغيير؟ |
| form.reasonRequired | Say why this change is needed. | اذكر سبب الحاجة إلى هذا التغيير. |
| form.noChanges | Change at least one field. | غيّر حقلًا واحدًا على الأقل. |
| form.goesTo | Goes to everyone who can approve committee changes. | يُرسَل إلى كل من يمكنه اعتماد تغييرات اللجان. |
| form.saveDraft | Save as draft | حفظ كمسودة |
| form.submit | Submit for review | إرسال للمراجعة |
| form.unreachable | Nothing was sent: the server couldn't be reached. | لم يُرسَل شيء: تعذّر الاتصال بالخادم. |
| form.failed | Something went wrong, so nothing was sent. | حدث خطأ، فلم يُرسَل شيء. |

`form.ofMembers` is a plural object:
- **English:** one "of {{count}} member", other "of {{count}} members".
- **Arabic:** zero "من دون أعضاء", one "من عضو واحد", two "من عضوين", few
  "من {{count}} أعضاء", many "من {{count}} عضوًا", other "من {{count}} عضو".

### 9.5 Impact lines (page and request page)

| key | English | Arabic |
|---|---|---|
| impact.title | What this change does | أثر هذا التغيير |
| impact.loading | Working out what this change does… | جارٍ حساب أثر هذا التغيير… |
| impact.failed | Couldn't work out what this change does. | تعذّر حساب أثر هذا التغيير. |
| impact.none | Change a field to see what it does. | غيّر حقلًا لترى أثره. |
| impact.span | {{field}}: {{from}} → {{to}} | {{field}}: {{from}} ← {{to}} |
| impact.QUORUM | Approvals already in progress keep quorum {{from}}; approvals that start after this change need {{to}}. | الاعتمادات الجارية تحتفظ بنصاب {{from}}، والاعتمادات التي تبدأ بعد هذا التغيير تحتاج إلى {{to}}. |
| impact.QUORUM_NONE (inProgress = 0) | Approvals that start after this change need {{to}}. None is in progress now. | تحتاج الاعتمادات التي تبدأ بعد هذا التغيير إلى {{to}}، ولا يوجد اعتماد جارٍ الآن. |
| impact.NAME | Shown everywhere from approval. | يظهر في كل مكان من وقت الاعتماد. |
| impact.TYPE | The committee is listed under its new type from approval. | تُدرج اللجنة تحت نوعها الجديد من وقت الاعتماد. |
| impact.PURPOSE | The new purpose shows on the committee from approval. | يظهر الغرض الجديد على اللجنة من وقت الاعتماد. |
| impact.MEETING_FREQUENCY | No meetings are scheduled yet, so only the frequency changes. | لا توجد اجتماعات مجدولة بعد، لذا يتغيّر التكرار فقط. |
| impact.OWNING_UNIT | From approval, the new unit's head sees the committee's tasks, and new tasks routed to the committee's unit go there. Open tasks keep their assignee. | من وقت الاعتماد، يرى رئيس الوحدة الجديدة مهام اللجنة، وتذهب إليها المهام الجديدة الموجّهة إلى وحدة اللجنة. وتبقى المهام المفتوحة لدى المسندة إليهم. |
| impact.PARENT | It is listed among the new parent's sub-committees. | تُدرج ضمن اللجان التابعة للجنة الرئيسية الجديدة. |
| impact.PARENT_NONE | It is no longer a sub-committee. | لم تعد لجنة تابعة. |
| impact.REPORTS_TO | It reports to the new committee from approval. | ترفع تقاريرها إلى اللجنة الجديدة من وقت الاعتماد. |
| impact.REPORTS_TO_NONE | It reports to no committee from approval. | لا ترفع تقاريرها إلى أي لجنة من وقت الاعتماد. |
| impact.TERMS_TASK.key | Terms of reference | الاختصاصات |
| impact.TERMS_TASK | A task to revise them is created for {{name}} on approval. | تُنشأ مهمة لمراجعتها لـ{{name}} عند الاعتماد. |

**Each line is checked against the code it promises:**
- The QUORUM sentence is ACC-239's snapshot. A vote counts against the quorum
  saved at entry (`workflow.service.ts:952`, `quorumCount ?? committee`).
- **The drawing's own sentence (L392, "Applies from approval, including …
  approvals already in progress") is its Q3 default, which was not built.** It
  is replaced.
- OWNING_UNIT is ACC-244's unit scope (a head sees the owning unit's tasks) and
  ACC-190's record-unit route. Open tasks keep their assignee because nothing
  re-routes them.
- MEETING_FREQUENCY holds while Meetings do not exist.

### 9.6 The request page

| key | English | Arabic |
|---|---|---|
| page.eyebrow | Change request {{n}} | طلب التغيير {{n}} |
| page.title | Change request {{n}} · {{committee}} | طلب التغيير {{n}} · {{committee}} |
| page.requestedBy | Requested by {{name}} · {{date}} | قدّمه {{name}} · {{date}} |
| page.returnedBy | Returned by {{name}} · {{date}} | أعاده {{name}} · {{date}} |
| page.approvedBy | Approved by {{name}} | اعتمده {{name}} |
| page.appliedOn | ✓ Applied {{date}} | ✓ طُبّق في {{date}} |
| page.withdrawnBy | Withdrawn by {{name}} · {{date}} | سحبه {{name}} · {{date}} |
| page.whatChanges | What changes | ما يتغيّر |
| page.changedOnly | Changed fields only | الحقول المتغيرة فقط |
| page.whatItAsked | What it asked to change | ما طلب تغييره |
| page.col.field | Field | الحقل |
| page.col.current | Current | الحالي |
| page.col.proposed | Proposed | المقترح |
| page.col.phone | Current → Proposed | الحالي ← المقترح |
| page.was | was {{value}} | كان: {{value}} |
| page.driftMark | Changed since it was submitted | تغيّر منذ تقديمه |
| page.none | None | بدون |
| page.reason | Reason | السبب |
| page.waiting | Waiting for a decision since {{date}}. You can withdraw it until it's decided. | بانتظار القرار منذ {{date}}. يمكنك سحبه إلى أن يُبتّ فيه. |
| page.returnedTitle | Returned for changes | أُعيد للتعديل |
| page.returnedBody | “{{note}}” · {{name}}, {{date}} | «{{note}}» · {{name}}، {{date}} |
| page.appliedTitle | Applied {{date}} | طُبّق في {{date}} |
| page.appliedBody | The committee now shows these values. A task to revise the terms of reference was created for {{name}}. | تعرض اللجنة الآن هذه القيم، وأُنشئت مهمة لمراجعة الاختصاصات لـ{{name}}. |
| page.openTask | Open the task | فتح المهمة |
| page.rejectedTitle | Rejected by {{name}} on {{date}} | رفضه {{name}} في {{date}} |
| page.rejectedBody | “{{reason}}” Nothing was changed. | «{{reason}}» لم يتغيّر شيء. |
| page.withdrawnTitle | Withdrawn by {{name}} on {{date}} | سحبه {{name}} في {{date}} |
| page.nothingChanged | Nothing was changed. | لم يتغيّر شيء. |
| page.dissolvingTitle | This committee is being dissolved, so these changes can't be applied. | هذه اللجنة قيد الحل، لذا لا يمكن تطبيق هذه التغييرات. |
| page.dissolvingBody | The request can only be rejected or withdrawn. | لا يمكن إلا رفض الطلب أو سحبه. |
| page.driftTitle | The committee has changed since this request was submitted. | تغيّرت اللجنة منذ تقديم هذا الطلب. |
| page.driftBody | It can't be applied as it is. Return it to the requester. | لا يمكن تطبيقه كما هو. أعده إلى مقدّمه. |
| page.actionsRegion | Actions for change request {{n}} | إجراءات طلب التغيير {{n}} |
| page.error | Couldn't load this change request. | تعذّر تحميل طلب التغيير هذا. |
| page.notFound | Change request not found | لم يُعثر على طلب التغيير |
| action.edit | Edit | تعديل |
| action.submit | Submit for review | إرسال للمراجعة |
| action.withdraw | Withdraw… | سحب… |
| action.approve | Approve… | اعتماد… |
| action.return | Return for changes… | إعادة للتعديل… |
| action.reject | Reject… | رفض… |

`action.edit` reuses `common.edit`.

### 9.7 The dialogs

| key | English | Arabic |
|---|---|---|
| approve.header | Approve and apply these changes? | اعتماد هذه التغييرات وتطبيقها؟ |
| approve.headerOne | Approve and apply this change? | اعتماد هذا التغيير وتطبيقه؟ |
| approve.context | Change request {{n}} · {{committee}} | طلب التغيير {{n}} · {{committee}} |
| approve.changedText (a long-text field: Purpose) | {{field}}: changed | {{field}}: تغيّر |
| approve.task | A task to revise the terms of reference will be created for {{name}}. | ستُنشأ مهمة لمراجعة الاختصاصات لـ{{name}}. |
| approve.button | Approve | اعتماد |
| return.header | Return for changes | إعادة للتعديل |
| return.context | Change request {{n}} · back to {{name}} as a draft | طلب التغيير {{n}} · يعود إلى {{name}} كمسودة |
| return.sentence | {{name}} can edit and resubmit it. | يمكن لـ{{name}} تعديله وإعادة تقديمه. |
| return.note | Note | ملاحظة |
| return.noteRequired | Say what needs changing. | اذكر ما يلزم تغييره. |
| return.button | Return | إعادة |
| reject.header | Reject change request {{n}} | رفض طلب التغيير {{n}} |
| reject.context | Nothing is changed | لا يتغيّر شيء |
| reject.sentence | {{name}} is told, with your reason. | يُبلَّغ {{name}} بالرفض مع سببك. |
| reject.reason | Reason | السبب |
| reject.reasonRequired | Say why it is rejected. | اذكر سبب الرفض. |
| reject.button | Reject | رفض |
| withdraw.header | Withdraw change request {{n}}? | سحب طلب التغيير {{n}}؟ |
| withdraw.message | It ends here and nothing is changed. You can start a new request afterwards. | ينتهي الطلب هنا ولا يتغيّر شيء. يمكنك تقديم طلب جديد بعد ذلك. |
| withdraw.keep | Keep it | الإبقاء عليه |
| withdraw.button | Withdraw | سحب |

### 9.8 Refusals, by code (never the server's English `message`)

| code | English | Arabic |
|---|---|---|
| CHANGE_REQUEST_STAGE_NOT_ALLOWED | A change can't be requested in this committee's current stage. | لا يمكن طلب تغيير في المرحلة الحالية لهذه اللجنة. |
| CHANGE_REQUEST_ALREADY_OPEN | Change request {{n}} is already open for this committee. Finish or withdraw it first. | طلب التغيير {{n}} مفتوح بالفعل لهذه اللجنة. أكمله أو اسحبه أولًا. |
| CHANGE_REQUEST_NO_CHANGES | Change at least one field. | غيّر حقلًا واحدًا على الأقل. |
| CHANGE_REQUEST_QUORUM_MIN | The quorum must be at least 1. | يجب ألا يقل النصاب عن 1. |
| CHANGE_REQUEST_NOT_REQUESTER | Only the person who raised this change request can do this. | لا يمكن القيام بذلك إلا لمن قدّم طلب التغيير هذا. |
| CHANGE_REQUEST_NOT_ALLOWED | You can't do this to this change request. | لا يمكنك القيام بذلك على طلب التغيير هذا. |
| CHANGE_REQUEST_OWN_DECISION | You raised this change request, so someone else must decide it. | أنت من قدّم طلب التغيير هذا، لذا يجب أن يبتّ فيه شخص آخر. |
| CHANGE_REQUEST_NOT_EDITABLE | Only a draft or returned change request can be changed or submitted. | لا يمكن تعديل طلب التغيير أو تقديمه إلا إذا كان مسودة أو أُعيد للتعديل. |
| CHANGE_REQUEST_NOT_UNDER_REVIEW | Only a change request under review can be approved, returned or rejected. | لا يمكن اعتماد طلب التغيير أو إعادته أو رفضه إلا إذا كان قيد المراجعة. |
| CHANGE_REQUEST_NOT_OPEN | This change request is already closed. | طلب التغيير هذا مغلق بالفعل. |
| CHANGE_REQUEST_COMMITTEE_DISSOLVING | This committee is being dissolved, or has been, so its change request can only be rejected or withdrawn. | هذه اللجنة قيد الحل أو منحلّة، لذا لا يمكن إلا رفض طلب التغيير أو سحبه. |
| CHANGE_REQUEST_COMMITTEE_CHANGED | The committee has changed since this request was submitted, so it can't be applied. Return it to the requester. Nothing was changed. | تغيّرت اللجنة منذ تقديم هذا الطلب، لذا لا يمكن تطبيقه. أعده إلى مقدّمه. لم يتغيّر شيء. |
| CHANGE_REQUEST_CHANGED | Change request {{n}} was changed by someone else since you opened it. Nothing was saved. | غيّر شخص آخر طلب التغيير {{n}} منذ أن فتحته. لم يُحفظ شيء. |
| (any `COMMITTEE_*` reference code) | the existing `committee.refusal.*` sentence (ACC-233) | as existing |
| (server unreachable or timed out) | Nothing was changed: the server couldn't be reached. | لم يتغيّر شيء: تعذّر الاتصال بالخادم. |

`CHANGE_REQUEST_CHANGED` offers Reload (`committee.form.reload`).
`CHANGE_REQUEST_ALREADY_OPEN` offers View request. Nothing else offers Retry
except "unreachable" (rule 5.5).

### 9.9 Home, the two confirms, the Edit dialog

| key | English | Arabic |
|---|---|---|
| home.awaiting | Awaiting my action | بانتظار إجرائي |
| home.awaitingChange | Change request {{n}} · {{committee}} | طلب التغيير {{n}} · {{committee}} |
| home.awaitingChangeMeta | {{name}} · submitted {{date}} | {{name}} · قُدّم في {{date}} |
| home.awaitingTaskRequest | {{type}} · {{title}} | {{type}} · {{title}} |
| committee.confirmRemoveMember (now the header) | Remove {{name}} from this committee? | إزالة {{name}} من هذه اللجنة؟ |
| committee.confirmRemoveMemberMessage | Their membership ends today and stays in the committee's history. | تنتهي العضوية اليوم وتبقى في سجل اللجنة. |
| task.confirmCompleteHeader | Complete “{{title}}”? | إنجاز «{{title}}»؟ |
| task.confirmComplete (now the message) | It's marked done for everyone on it, and any open request for more time or a hold is cancelled. | تُعلَّم منجزةً لكل من أُسندت إليه، ويُلغى أي طلب مفتوح لمزيد من الوقت أو للتعليق. |
| committee.form.listFailed | Couldn't load the list. | تعذّر تحميل القائمة. |

`home.awaitingTaskRequest`'s `{{type}}` is the existing task-request type words
("More time" / "On hold").

---

## 10. Changes from the drawing, each deliberate

1. **No approver name** in the banner, the requester's footer or the waiting
   line. Every `committees:approve` holder is told, and nobody is "the"
   reviewer (§1.2).
2. **The quorum impact sentence** says what was built (the snapshot), not the
   drawing's Q3 default (§9.5).
3. **Submit and Save as draft are never disabled** (step 238, Q18).
4. **No "Partial: task not created" state:** apply is one transaction (§1.2).
5. **No committee code** ("QMC-014") and no "9 members" chip in the header. A
   committee has no reference code (CLAUDE.md, Open items). The member count
   appears once, under Quorum.
6. **The summary banner has its title only.** The drawing's English second line
   ("2 of 9 fields · marked ✎ Changed …") has no Arabic and repeats what the
   marks show.
7. **The Arabic words follow the app, not the drawing,** where the two differ:
   "ترفع تقاريرها إلى" (Reports to, as the app says it) and "إنجاز" (Complete).
8. **The Arabic Request a change page has every field.** The drawing's Arabic
   frame leaves out Type, Purpose and Parent committee, which is a crop, not a
   rule.
9. **Impact lines name no individual approval** ("Hand-hygiene policy approval
   (3 of 5 …)"). `preview` returns a count, and naming a record the viewer may
   not see would need a visibility check per approval.

---

## 11. Decisions I made (each open to Ahmad's correction)

- **D1.** G1–G3 as additive response fields: `canRaise` on `open`, decider and
  withdrawer names, a `labels` map. No migration.
- **D2.** The request page reuses `preview` for its impact lines rather than a
  new read.
- **D3.** `ask()` gains an optional `details: string[]` for Approve's list.
- **D4.** Return and Reject are form dialogs (they carry a field); Approve and
  Withdraw are confirms.
- **D5.** "Current" is the LIVE value while a request is open, with a drift
  mark; `fromValues` once it is applied.
- **D6.** The terms task link is shown only to the requester and the decider.
- **D7.** The phone sticky bar switches at 760, the shared constant (ACC-242
  will move both).
- **D8.** Two PRs, 3a (reads + handover) and 3b (screens).
- **D9.** The Arabic vocabulary follows the app's existing keys (§10, 7).
- **D10.** The live proof uses the ACC-208 proof committee and ends in Withdraw
  (§8), pending Ahmad.

---

## 12. Open questions, each with my pick

- **Q-A. The stepper.**
  - `app-workflow-stage-indicator`'s `sequence` shows EVERY stage of the
    template in order: six for a request (Draft, Under review, Returned,
    Approved, Rejected, Withdrawn), with revisits annotated. The drawing shows
    three (Draft → Under review → Approved, or Rejected).
  - **Pick: reuse the indicator.** It is the one stepper in the app, it shows
    the tenant's stage names, and it never states a false progress count.
  - The alternative is a three-step stepper built from the stage keys: closer
    to the drawing, but a second stepper pattern.
- **Q-B. Home "Awaiting my action".**
  - **Pick: one card holding both change requests and task requests** (§3.5).
  - The alternative is change requests only.
- **Q-C. The live proof** (§8).
  - **Pick: create on the ACC-208 proof committee, return, resubmit, then
    withdraw; nothing applied.**
  - The alternatives are a read-only proof, or a proof that also approves.
- **Q-D. Notices still open the committee, not the request.**
  - **Pick: leave it.** The banner is one click from the request, and changing
    the notice's object is a backend change for no new information.

---

## 13. Not in this ticket

- The API lock on direct edits outside Formation: ACC-241.
- Added review stages: ACC-245.
- The 768 phone breakpoint: ACC-242.
- A committee reference code: CLAUDE.md, Open items.
