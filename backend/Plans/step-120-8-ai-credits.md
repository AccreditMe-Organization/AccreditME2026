# ACC-120 slice 8 — the AI credits screen

Plan written 15 Oct 2026 (CC-109). Branch `feature/ACC-120-ai-credits`, from
dev at 227b01a.

Screen: `frontend/src/app/foundation/admin-settings/components/ai-settings/
ai-settings.component.ts`, which shows three plain numbers on cards today.
Design: the "AI credits" artboard (section 2) of
`frontend/design-reference/AccreditMe Settings Screens.dc.html`:
- markup at lines 155–203;
- states in the script at lines 339–366;
- the adoption note at line 436.

The artboard has three states: **normal**, **spent** (AI paused until the
reset date) and **none** (the plan has no AI allowance). Buy and overage are
absent by design and are not built.

## Every value the drawing shows, and where the API has it

All API fields below come from `GET /tenant` (`tenant.controller.ts:36-38`,
`@Permissions('tenant:view')`). It answers `ai: { ...aiBalanceOf(org),
features }` (`backend/src/foundation/tenant/tenant.service.ts:210`), and the
balance is built in `backend/src/foundation/ai/ai-balance.ts:67-76`.

| Drawn value | Drawing | API field | Where |
|---|---|---|---|
| Left (big number, and "Left N" under the meter) | `ai.left` | `ai.creditsRemaining` | `ai-balance.ts:71` |
| Total ("credits left of N") | `ai.total` | `ai.monthlyCredits` | `ai-balance.ts:69` |
| Used ("Used N" under the meter) | `ai.used` | `ai.creditsUsed` | `ai-balance.ts:70` |
| Reset date ("Resets 1 Oct 2026") | `Resets …` | `ai.resetDate` | `ai-balance.ts:72` |
| "in 1 day" | derived | computed on screen from `ai.resetDate` by `FormatService.relative()`, which handles future dates | `format.service.ts:138-146` |
| Heading "September allowance" | derived | `ai.periodStart` | `ai-balance.ts:75` — **see decision D1** |
| Chip "0 left · AI paused until 1 Oct" (spent only) | `ai.chip` | computed on screen: `creditsRemaining === 0` and `monthlyCredits > 0`, plus `resetDate` | `ai-balance.ts:69,71,72` |
| Meter aria-label "22 of 40 credits left" | `ai.aria` | computed on screen from left and total | — |
| Meter segments, one per feature, sized by credits used | `ai.segments` | **not returned** | `ai.features` (`ai-balance.ts:84-96`) gives `key` and `creditCost` only, not usage |
| Breakdown row: feature name | `b.name` | name: **not returned** (only `ai.features[].key`; a display name would be a translation of the key). Usage for that feature: **not returned** | `ai-balance.ts:95` |
| Breakdown row: credits used per feature | `b.n` | **not returned** | — |
| Breakdown row: percent of used | `b.pct` | **not returned** (depends on the row above) | — |
| "See each use" link (the usage log) | link | **not returned**: no usage-log endpoint or screen exists | — |
| None state: "The Starter plan has no AI allowance" | plan name | `plan` (`STARTER`) is returned (`tenant.service.ts:200`) but not typed on the frontend's `ITenant` (`frontend/…/tenant.service.ts:6-21`) | — |
| None state: "See plans with AI" button | button | **nothing to link to**: no tenant-facing plans screen exists | — |
| "Not active yet" banner (`notActive`) | banner | not applicable: credits have been metered and enforced since ACC-194, so nothing here is illustrative | — |

## Telling "none" apart from "spent"

- **none:** `ai.monthlyCredits === 0`. There is no allowance, so no meter and
  no zero, only the dashed "not included" shape.
- **spent:** `ai.monthlyCredits > 0 && ai.creditsRemaining === 0`. This shows
  the meter full, the "0 left · AI paused until …" chip, and the breakdown.
- **normal:** `ai.monthlyCredits > 0 && ai.creditsRemaining > 0`.
- **A fourth case, not drawn:** an allocation with AI switched off
  (`ai.enabled === false`). `settings.ai.enabled === false` makes it, but
  nothing writes that setting yet (CLAUDE.md, ACC-194). Proposed: it shows
  as normal or spent with a line saying AI is switched off for the
  organisation, and needs a design decision before it gets more than that.

`enabled` alone cannot separate the drawn states: it is false both for none
and for switched off. The allocation is what decides.

## Who can open the page

- **The page** answers to `tenant:manage_config`:
  - the nav item: `frontend/src/app/core/navigation/nav-items.ts:283-288`;
  - the route guard that reads it: `admin-settings.routes.ts:36`.
- **Anyone else** is sent to the landing page by `permissionGuard`
  (`core/guards/permission.guard.ts:73`). The item is not in their rail.
- **The data** answers to `tenant:view` (`tenant.controller.ts:37`).
- **Measured on dev:** in both tenants, only Organization Administrator
  (`TENANT_ADMIN`) holds `tenant:manage_config`, and it holds `tenant:view`
  too. Read-Only Administrator holds `tenant:view` only, so it cannot open
  the page.
- **A custom role with `tenant:manage_config` but not `tenant:view`** would
  open the page and get 403 on its data. So would anyone during the moment
  the guard lets through before permissions load
  (`permission.guard.ts:63`). That is the denied state below.

## The six request outcomes

One request (`GET /tenant`). The usage read is part of its response.

| Outcome | What it shows |
|---|---|
| Loading | A skeleton of the card at its normal height, with no numbers |
| Loaded | The normal, spent or none state above |
| Empty, with a reason | The none state: "AI features aren't part of your plan", with its reason sentence. This is an empty state with a reason, never "0 of 0" |
| Denied (403) | A sentence naming what is missing: "You can't see this organisation's AI credits. That needs permission to view the organisation's settings." No retry: retrying cannot change the answer |
| Error, with retry | A translated error and Retry. Never the server's text |
| Partial | No separate request can fail on its own: one response carries the balance and the usage. The partial case here is the log adding up to less than `used`. The rest is then one plain "Other" segment and row, and the breakdown says why |

## Decisions (Ahmad, 15 Oct, CC-109a)

- **G1: Option A.** `GET /tenant`'s `ai` block gains
  `usage: { key, credits, calls }[]`.
  - It is one grouped query on `AiInteractionLog`, filtered by the tenant's
    `organizationId`, `success: true`, `creditCost > 0`, and `createdAt` at
    or after `periodStart`. It has a tenant-isolation test.
  - **The meter:** feature segments are capped so their sum never passes
    `creditsUsed`. If the log adds up to less than `used`, the rest is one
    plain "Other" segment.
  - **The breakdown:** percentages are of its own total.
  - **Partial outcome:** the read is part of the same response, so this
    one cannot be partial.
- **D1: the heading** is "This period's allowance" ("رصيد هذه الفترة"), with
  the dates from `periodStart` to `resetDate`, both through `FormatService`.
- **Left out, each recorded here:**
  - "See each use": no usage-log screen exists.
  - "See plans with AI": no tenant plans screen exists.
  - The "Not active yet" banner: credits have been metered since ACC-194.
  - The undrawn "AI switched off" state: nothing writes the switch yet.

## Why al-nakheel's counter read 0 with 166 credits logged (15 Oct, read only)

Every query was a SELECT. Nothing was written, and nothing is changed in this
branch.

- **The audit trail has ONE AI row for al-nakheel, ever:**
  - `ai_allocation_changed` at 12 Oct 15:57:32Z, manual, 0 → 2000;
  - no `ai_credits_renewed` row at all.
  - The allocation set up the first period, and with it `aiCreditsUsed = 0`,
    22 seconds before the first call.
- **Twenty successful calls followed**, 12 Oct 15:57:54Z to 14 Oct 08:16:24Z:
  - 166 credits in all, every one inside the current period;
  - each one adds its cost through `ai-credit.service.ts:51`;
  - so the counter should read 166.
- **`Organization.updatedAt` is 14 Oct 08:18:05Z.**
  - That is 1 min 41 s after the last call (a `workload_balancing` proof
    call, ACC-199).
  - The calls' raw `UPDATE` does not touch `updatedAt`, so this was a later
    write through the Prisma client.
  - No audit row exists at that time, and no application path writes
    `aiCreditsUsed = 0` without one: renewal and allocation both audit.
- **Cause:** a direct, unaudited write by a live-proof cleanup.
  - The ACC-197 live proof ends with "8. Clean up, and reset al-nakheel's
    used credits." (`step-197-task-drafting.md:369`).
  - The same reset after ACC-199's proof calls fits the timestamp.
  - It went around `AiAllocationService`, so the customer's own record has
    no trace of it: the blind spot in CLAUDE.md's ACC-101 note on backfills.
  - Which session ran it is not recorded anywhere this query can see.

**A second finding, not fixed here: the stored renewal time does not match
the rule.**
- `aiCreditsRenewsAt` is 20 Oct 21:00Z. The rule (`ai-credit-period.ts`)
  gives 21 Oct 00:00Z for an activation on 21 Sep.
- The allocation ran at 15:57Z on 12 Oct, before ACC-194 merged (18:47Z), so
  it probably ran from a branch with an earlier rule.
- **Consequence:** the hourly job will renew al-nakheel at 20 Oct 21:00Z,
  into a period that still starts on 21 Sep. Its counter goes to 0 three
  hours early, and the audit row shows the same period start before and
  after.

## The browser check, and what seeded data can reach

| State | Reachable? |
|---|---|
| normal | yes: al-nakheel, 2,000 credits, 0 used |
| none | yes: al-manara, 0 credits |
| spent | not with seeded data: faked in the browser (CC-109a), never written to the shared database |
| denied | no seeded persona can reach it: faked in the browser, as in slice 5b |
