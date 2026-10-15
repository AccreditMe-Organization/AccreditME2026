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

One request today (`GET /tenant`); a second one only if decision D2 adds a
usage read.

| Outcome | What it shows |
|---|---|
| Loading | A skeleton of the card at its normal height, with no numbers |
| Loaded | The normal, spent or none state above |
| Empty, with a reason | The none state: "AI features aren't part of your plan", with its reason sentence. This is an empty state with a reason, never "0 of 0" |
| Denied (403) | A sentence naming what is missing: "You can't see this organisation's AI credits. That needs permission to view the organisation's settings." No retry: retrying cannot change the answer |
| Error, with retry | A translated error and Retry. Never the server's text |
| Partial | Only if D2 adds a usage read. If the balance loads and the usage read fails, the meter shows used and left as one segment, and the breakdown shows its own error with Retry. The balance never waits on the breakdown |

## Gaps, and the decision needed (STOP: nothing is built)

**G1. Per-feature usage is not returned.** This affects the meter's segments,
the breakdown rows (name, count, percent) and "See each use". The data
exists in `AiInteractionLog` (`feature`, `creditCost`, `success`,
`createdAt`, `organizationId`, `schema.prisma:2021-2046`), but nothing reads
it for a tenant.

**Measured on dev, and it matters for the options:** al-nakheel's counter
says 0 used this period, but its log holds 166 credits of successful calls
in the same period (20 calls, 12–14 Oct). So a breakdown read from the log
would not add up to the drawn "Used" number today. Something reset the
counter without touching the log; the log is not wrong.

- **Option A (recommended): a small read on the backend.**
  - Add `usage: { key, credits, calls }[]` to the `GET /tenant` `ai` block:
    one `aiInteractionLog.groupBy` by `feature`, filtered by the tenant's
    `organizationId`, `success: true`, `creditCost > 0`, and `createdAt` at
    or after `periodStart`. A tenant-isolation test goes with it.
  - The meter segments are each feature's credits, clamped so that their sum
    never passes `creditsUsed`. If the log sums to less than `used`, the
    rest is one plain "Other" segment.
  - Percentages are of the breakdown's own total.
  - This keeps the drawing whole. The counter-versus-log disagreement above
    is then visible on al-nakheel; the clamp keeps the meter honest.
- **Option B: leave the breakdown out and record it.**
  - The meter shows used and left as one segment, with no "What used them"
    section.
  - It is smaller, and changes nothing on the backend. The screen loses its
    answer to "what did we spend it on".
- **Either way:** "See each use" is left out, because no usage-log screen
  exists, and "See plans with AI" is left out, because no tenant plans
  screen exists. Both are recorded here.

**D1. The heading "September allowance."** Periods are anchored to
activation (ACC-194): al-nakheel's runs from 21 Sep to 21 Oct, so a period
has no single month. Proposed: "This period's allowance", with the dates
"21 Sep – 20 Oct" from `periodStart` and `resetDate`.

**D2.** Follows from G1: if Option A, the partial outcome above applies.

## The browser check, and what seeded data can reach

| State | Reachable? |
|---|---|
| normal | yes: al-nakheel, 2,000 credits, 0 used |
| none | yes: al-manara, 0 credits |
| spent | **no**. No organisation has an allocation that is fully used. Reaching it would mean writing al-nakheel's counter on the shared database, which needs approval, so the state would be checked only in specs |
| denied | no seeded persona: only `TENANT_ADMIN` reaches the page. Checked by browser interception, as in slice 5b |
