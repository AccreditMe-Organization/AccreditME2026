# ACC-286 — what lane A builds

Written for lane A by lane B (Coder 2), 14 Nov. The rules, the refusal codes and
every reader ship in ACC-286 PR 1 (lane B). Three screens are yours. Each
section below says what the server does, what the screen must do, and the
wording, in English and Arabic. The full plan and Ahmad's answers (14 Nov) are
in `step-286-committee-structure-rules.md`, §9.

---

## 1. Lookups: the "Required seat" toggle

**What the server does (PR 1):**

- `committee_member_role` now has an attribute schema with one property:
  `required`, a boolean, labelled "Required seat".
- On the shared (SYSTEM) seats, Chairman and Secretary carry
  `attributes: { required: true }`. The seed writes this on every deploy, so
  every organisation has the default.
- `GET /lookups/categories/committee_member_role/values` returns each seat's
  `attributes`, with the organisation's own values merged over the shared ones
  **key by key**. A renamed seat (a label-only override) keeps
  `required: true`.
- **New endpoint, for a SHARED seat:**
  `PATCH /lookups/values/:id/attributes`, body `{ attributes: { required: boolean | null } }`,
  `lookups:manage`, answers 204.
  - `true` or `false` sets the organisation's own value.
  - `null` removes it, so the shared default applies again.
  - It is stored on the same override row that holds hide and the label
    override. It never touches the label.
  - A key the category does not declare, or a value of the wrong type, gets
    **400 `LOOKUP_ATTRIBUTE_INVALID`** with `key`, and nothing is written.
  - An id that is not a shared value gets 404.
  - Every save is audited (UPDATE on LookupValue, before and after).
- **An organisation's own seat** (layer TENANT) keeps using the existing value
  form. `attributes.required` is a field there like any other attribute; the
  form already renders it from the schema.

**What the screen must do:**

- On the Lookups values page for `committee_member_role`, show "Required seat"
  for each shared seat as a toggle. Its value is `attributes.required === true`
  from the values read.
- Toggling it calls the new endpoint, then reads the list again.
- Offer "Use the default" (send `null`) only if you want it. Sending `false` is
  enough to untick.
- Say `LOOKUP_ATTRIBUTE_INVALID` from its code. It is not reachable from this
  toggle; it guards the API.

**Wording:**

| Key (suggested) | EN | AR |
|---|---|---|
| `lookup.attribute.required` | Required seat | مقعد مطلوب |
| hint under the toggle | A committee can't go live, and its last holder can't leave while it is in force, unless this seat is filled. | لا يمكن أن تصبح اللجنة سارية، ولا يمكن لآخر من يشغل هذا المقعد مغادرته وهي سارية، ما لم يكن المقعد مشغولًا. |

The hint is a suggestion; shorten it if the row has no room. It describes the
seat, not a person, so «آخر من يشغل» is fine here: the rule against «آخر»
applies to the refusal sentence about appointing someone (§3).

---

## 2. Setup health: "Committee missing a required seat" (PR 2)

**Nothing is written in PR 1.** The enum value
`COMMITTEE_MISSING_REQUIRED_SEAT` and its migration ship in PR 1, and the
backend leaves it in `DEFERRED_SETUP_CONDITION_TYPES`, so no row exists and
the page never receives one. PR 2 adds the detector and reports it.

**What PR 1 already gives the page (lane B wrote it, so the frontend can read
a row the moment PR 2 writes one):**

- The type in `SetupConditionType`, and its place in `TYPE_ORDER` (after
  "Task with no actionable owner").
- `subject.seats`: the empty required seats, `{ id, labelEn, labelAr }[]`, in
  seat order. `subject.nameEn` / `nameAr` is the committee.
- Severity: **AT_RISK** (Ahmad, Q7).
- The Fix goes to `/committees/:id`. It needs `committees:view` and
  `committees:add_member`.
- The row: the committee's name as the title; the consequence names the seats,
  joined by `، ` in Arabic and `, ` in English.

**Wording, already in en.json and ar.json, for your review:**

| Key | EN | AR |
|---|---|---|
| `setupHealth.types.COMMITTEE_MISSING_REQUIRED_SEAT` | Committee missing a required seat | لجنة ينقصها مقعد مطلوب |
| `setupHealth.consequence.committeeMissingSeat` | Required seats with no one in them: {{seats}}. | مقاعد مطلوبة لا يشغلها أحد: {{seats}}. |
| `setupHealth.fix.COMMITTEE_MISSING_REQUIRED_SEAT` | Appoint members | تعيين أعضاء |
| `setupHealth.fixNeeds.COMMITTEE_MISSING_REQUIRED_SEAT` | Fixing this needs permission to add committee members. | إصلاح هذا يتطلب صلاحية إضافة أعضاء إلى اللجان. |

**What to check when PR 2 lands:** the row on the page and on Home's Needs
fixing, in both languages, at phone width. If you change a sentence, change
the key's value; the code reads only the keys above.

---

## 3. The transfer wizard: `COMMITTEE_REQUIRED_SEAT_LAST_HOLDER`

**What the server does (PR 1, Ahmad Q5: the rule applies in the wizard too):**

- `removeSeats()` (`transfer-user-wizard.component.ts`) removes each chosen
  seat through `DELETE /committees/:id/members/:memberId`, one after another.
- While the committee is **in force** (its stage flagged `IN_FORCE`), removing
  the **last ACTIVE holder of a required seat** is refused:
  409 `COMMITTEE_REQUIRED_SEAT_LAST_HOLDER`, body
  `{ seat: { id, labelEn, labelAr } }`. Nothing is written: the person stays in
  the seat.
- The other seats in the run are unaffected: `removeSeats()` already catches
  each failure on its own and carries on.

**What the wizard must do:**

1. **Say it from the code, for that seat.** Today `failureText()` falls
   through to `extractErrorMessage()`, which shows the server's English
   sentence in an Arabic session. Read it like the committee dialogs do:
   - `committeeSeatRefusal(error)` (exported from
     `foundation/committees/committee-stage-refusal.ts`) returns
     `{ seatEn, seatAr }`, or null for any other error.
   - The sentence is `committee.refusal.requiredSeatLastHolder` with
     `{ seat: language.bilingual(seatEn, seatAr) }`.
   - Check it BEFORE the 404 branch. It is a 409, so the order only matters
     against the generic fallback.
2. **Keep the person in the seat, and say so.** The row stays in the
   "failed" list with the sentence. Nothing about the transfer itself is
   undone; the transfer has already succeeded.
3. **Let the admin carry on.** The other removals have run. Try again on this
   row keeps failing until someone else holds the seat. That is correct: after
   appointing another holder on the committee's page, Try again removes it.
   You may want a link to the committee from the row (`/committees/:id`); the
   row already has `committeeId`.
4. **Nothing before Submit.** The wizard's committee list
   (`TransferCommitteeSeatDto`) does not say whether a seat is required or the
   last holder. Do not guess it on the client. If you want the wizard to warn
   before Submit, ask lane B for the fields; it is not in PR 1.

**Wording, already in en.json and ar.json:**

| Key | EN | AR |
|---|---|---|
| `committee.refusal.requiredSeatLastHolder` | Appoint another {{seat}} first. | يلزم تعيين عضو في مقعد «{{seat}}» أولاً. |

The Arabic avoids «آخر» and any gendered adjective (Ahmad, Q8): an imperative
noun phrase.

**Specs to add on your side:** a refused row is said in both languages, from
the code, naming the seat; the other rows still complete; Try again sends only
the failed row.
