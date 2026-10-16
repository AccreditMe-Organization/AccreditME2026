# ACC-120 slice 4 — the committees list and Add member

Plan written 16 Oct 2026 (CC-113). Branch `feature/ACC-120-committees-list`,
from dev at 8add3be.

**Scope** (CC-113):
- the `/committees` list;
- the Add committee member dialog.

**Out of scope:** Add and edit committee moved to the committee-change lane.
`committee-form.component.ts` and the edit flow are not touched. The list
keeps opening the existing Add committee dialog, gated as today.

**Design sources**:
- `frontend/design-reference/AccreditMe Templates.dc.html`: "Committees"
  (line 3169) and "Add committee member" (line 2954). Both are migration
  notes, not drawn artboards.
- The list follows Template 1, which `/users` and `/roles` already use.
- The "Add member" button and its panel follow `AccreditMe Committee
  Record.dc.html`.

**The other worktree:** checked 16 Oct, on `fix/ACC-231-task-files-follow-task-page`.
Its own changes (a three-dot diff from `origin/dev`) touch neither
`committee-detail.component.ts` nor `committee-member-form.component.ts`. Its
two-dot diff shows them only because its base predates ACC-232.

## The list: every column, and what feeds it

`GET /committees` (`committees.controller.ts:38-42`, `committees:view`)
returns `ICommitteeListItem[]`:
- the source is `committees.service.ts:43-64`;
- the type is `interfaces/committee.interface.ts:1-55`;
- the frontend type is `CommitteeListItemDto` (`committee.service.ts:43-55`).

The list is every committee in the organisation, unpaginated (al-nakheel has
5).

| Column | Field | Where |
|---|---|---|
| Name (EN/AR) | `nameEn`, `nameAr`, shown through `LanguageService.bilingual()` | `committee.interface.ts:4-5` |
| Type | `typeValueId`. Its label comes from the `committee_type` lookup, which the page already loads | `committee.interface.ts:6`; `committee-list.component.ts:88` |
| Parent (relation) | `parentCommitteeId`. The parent's name comes from the same list, which holds every committee in the organisation | `committee.interface.ts:10` |
| Stage | `currentStageNameEn`, `currentStageNameAr` (tenant data, never `| translate`) | `committee.interface.ts:48-49`; `committees.service.ts:58-59` |
| Status | `isActive`, plus `isDissolving` (ACC-233) for a committee being dissolved | `committee.interface.ts:24, 54`; `committees.service.ts:61` |
| Members | `memberCount` (active members) | `committee.interface.ts:41`; `committees.service.ts:57` |
| **Next meeting** | **not returned** | — |

**Next meeting has nothing behind it:**
- A `Meeting` table exists (`schema.prisma`, with `committeeId` and
  `scheduledAt`), and it has **0 rows** on dev.
- No endpoint or screen creates or reads a meeting. Meeting Management is
  not built (CLAUDE.md, Build Sequence), and its schema is a dormant scaffold
  that module-designs.md already calls incomplete.

## Sorting, search, filters, and empty

The list is `DataListComponent` with `clientSideSource`, as `/roles` does:
the whole list is one small read.
- **Search:** the name, in both languages.
- **Sort:**
  - by name (default A–Z), with an unnamed Arabic name sorted last
    (`nullsLast`, ACC-160);
  - by type label, by stage name and by member count.
  - A row's own link opens the record.
- **Filters:**
  - Status (Active / Inactive / Being dissolved);
  - Type, from the `committee_type` lookup.
  - No parent filter: a hierarchy filter is its own design.
- **Empty, with nothing at all:** "No committees yet". If the viewer holds
  `committees:create`, it adds a line pointing to Add committee.
- **Empty after a search or filter:** "No committees match …", with Clear.
  This is the filtered empty of ACC-111's artboard 8.

## The user picker, and "already a member"

**Nothing in the app can be reused as it is:**
- **The task assignee picker** (`task-assignee-picker`) chooses unit →
  position → person, never "anyone in the tenant". It answers to
  `tasks:create`.
- **The acting-head and cover pickers** are `OverlaySelectComponent`
  lists, which have no search box (ACC-42 §2.5).
- **`am-simple-list` inside `am-list-dialog size="compact"`** (ACC-230) has
  the search, sort and Load more the note asks for, but its rows can't be
  chosen or disabled.

**Proposed:** the picker is `am-list-dialog size="compact"` stacked as its
own layer above the Add member dialog (dialog rule 4, as ACC-111 does for
panels). Inside it, `am-simple-list` gains two opt-in inputs, default off,
so ACC-230's lists are unchanged:
- `selectable`: a row is a button that picks it;
- `rowDisabled(row)`: a function that returns a reason, or null.

**What feeds it:**
- **The people:** `GET /users?status=ACTIVE` (`UserService.listAllUsers`),
  as the current form already does (`committee-member-form.component.ts:148`).
  It needs `users:view`. Measured on dev: every role holding
  `committees:add_member` also holds `users:view` (Organization
  Administrator, Quality Manager).
- **"Already a member":** `GET /committees/:id/members`
  (`committees.controller.ts:71-80`, `committees:view`), read for its
  ACTIVE rows (`leftAt` null).
  - Today's form FILTERS those people out
    (`committee-member-form.component.ts:117`).
  - The drawing keeps them, as disabled rows reading "Already a member",
    so a searcher is never left wondering where someone went.

**Role on committee** is an `OverlaySelectComponent` over the
`committee_member_role` lookup, as today.

**Joined date** uses the shared inline calendar (`am-inline-calendar`).
- The API takes it as `effectiveDate`, which is optional
  (`dto/add-committee-member.dto.ts`), and stores it as `joinedAt`
  (`committees.service.ts:248, 257`).
- It is Gregorian, picked in the tenant's zone, defaulting to today.
  Leaving it today matches what the server does when it is omitted.

## Where Add member opens, and the smallest change there

- **Where:** `committee-detail.component.ts:414-426` hosts
  `<app-committee-member-form>` in the page's `EditDialogComponent`
  (`memberFormVisible`, `onAddMember()` at 649).
- **The same form** also handles Change role (`editingMember()`, line 425).
  Change role is not part of this slice and keeps its behaviour.
- **The change:** the form's add mode gains the picker and the joined date;
  change-role mode is untouched. The page changes by one line at most, to
  pass the `[dirty]` signal the shell needs.

## The six request outcomes

| Outcome | List | Add member dialog |
|---|---|---|
| Loading | the list's skeleton rows | the picker's skeleton rows |
| Loaded | the rows | the picker's people |
| Empty, with a reason | the two empties above | "No one to add" when every active user is already a member |
| Denied (403) | a sentence naming `committees:view` (the route guard already sends anyone without it to the landing page) | the dialog is not offered without `committees:add_member` |
| Error, with retry | the list's own error and Retry | the picker's error and Retry; a save error under the field, from its code, never the server's text |
| Partial | the lookups failing while the list loads: a raw type shows as "—", never an id | members failing while people load: the picker says it can't tell who is already a member, and the save's refusal still protects |

**Permissions:**
- **Viewing the list** needs `committees:view` (the controller and the nav
  item).
- **Add committee is shown only with `committees:create`.** It is hidden,
  not disabled (ACC-118, `committee-list.component.ts:80`), and it opens the
  existing form, unchanged.
- **Add member needs `committees:add_member`** (`committees.controller.ts:113`;
  `canAddMember` at `committee-detail.component.ts:530`).

## Decisions (Ahmad, 16 Oct, CC-113a)

- **Next meeting: Option A.** The column is left out. It is added together
  with the read that feeds it, once Meeting Management exists. The table has
  six columns: name, type, parent, stage, status and members.
- **The user picker: approved as planned.** It reuses the ACC-230 searchable
  list (`am-simple-list` in `am-list-dialog size="compact"`), opened as its
  own layer above the Add member dialog. The list gains two opt-in options,
  both off by default: rows you can pick, and rows disabled with a reason
  ("Already a member"). Every existing test of that list passes unedited.
- **Rules for the picker:**
  - Escape closes only the top layer.
  - Focus returns to the field that opened the picker.
  - Change role keeps working as it does today.
  - `committee-detail.component.ts` gets at most a one-line change.
