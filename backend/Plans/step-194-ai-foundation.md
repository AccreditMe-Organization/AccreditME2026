# Step 194 — AI foundation (metering, credit periods, organisation and feature switches, platform key only)

Linear: **ACC-194** (High, lane B). **ACC-156** is its sub-issue and closes with it.
Branch: `feature/ACC-194-ai-foundation`, from `origin/dev` at `361b84c`.
**Status:** BUILT — merged as #163 (4aa860c), 12 Oct.

When written: **PLAN, revised with Ahmad's answers (12 Oct). No code yet.**

The brief is the ticket's scope (items 1–9) and its out-of-scope list:
- no provider choice;
- no Standard/Premium tiers in use;
- no credit-pack purchase;
- no platform AI admin screens;
- no tenant AI settings page.

All evidence is file:line at `361b84c`.

## Revision log

- **12 Oct, first draft (`284ffcc`):** questions Q1–Q11, decisions D1–D13.
- **12 Oct, revision 2: plan approved (`c53f868`), D14–D19 decided.** Every
  one as recommended (§14). D14 adds: when billing exists, the credit period
  follows the billing date. D18 adds: the plan endpoint writes an audit row with
  the old and new plan. D8's investigation (§16) is accepted as written, and
  nothing in it is built. ACC-198's Linear text now says the briefing runs on
  demand, by a tenant admin, for al-nakheel only, never on a schedule, at 5
  credits per run.
- **12 Oct, revision 1: Ahmad's answers.**
  - **Agreed as recommended:** D1, D5, D6, D7, D9, D10, D11, D12, D13.
  - **Changed:**
    - **D2:** the credit period is anchored to the organisation's activation
      date (§4).
    - **D3:** the allocation follows the plan, with upgrade and downgrade timing
      (§5).
    - **D4:** costs are set, and `morning_briefing` is limited to al-nakheel, on
      demand only (§8, §9).
  - **D8:** agreed, plus an investigation of customer-hosted models (§16).
  - **Also added:**
    - every reader and writer of the old counters, listed (§1.4);
    - effort and maximum output per feature, confirmed at build (§7);
    - ACC-215 opened for the remaining settings race (§1.5).
  - **New decisions D14–D19 are in §14.**

---

## 0. What exists today (measured, 12 Oct)

**Code**

| Fact | Evidence |
|---|---|
| The provider makes a real Anthropic call, and nothing calls it | `providers/ai/anthropic-ai.provider.ts:35-110`. The only reference outside the provider is a commented-out stub at `foundation/lookup/lookup.service.ts:550` |
| The model is hard-coded, and callers may override it | `anthropic-ai.provider.ts:29` (`claude-sonnet-4-6`), `:40`; `ai.provider.ts:9` |
| The tenant's own key wins | `anthropic-ai.provider.ts:112-127` |
| With no key at all, it still calls Anthropic | `:126` falls back to an **empty string** |
| The provider logs the first 200 characters of the prompt and response | `:24-25`, `:90-91`, `:103` |
| `AI_PROVIDER` is bound in TenantModule and exported | `foundation/tenant/tenant.module.ts:31,39` |
| `AiProvider` enum | `ANTHROPIC`, `AZURE_OPENAI`, `OPENAI`, `OLLAMA` (`prisma/schema.prisma:33-38`) |
| `AiInteractionLog` has no cost, provider, tier or tokens | `schema.prisma:1990-2009` |
| `AiFeatureCost` is platform-global | `schema.prisma:504-511`. The platform saves only cost and description (`platform/plan/plan.service.ts:221-226`, update at `:224`) |
| Nothing writes `aiConfig` | It is read only at `tenant/tenant.service.ts:234` |
| **Plan assignment happens ONLY at tenant creation** | `platform/tenant/platform-tenant.service.ts:130` (`planId: dto.planId ?? null`, optional in `create-tenant.dto.ts:40`). **No route changes a tenant's plan afterwards.** The platform tenant routes are create, suspend, reactivate, extend-trial, modules, ai-credits and impersonate (`platform-tenant.controller.ts:45-119`) |
| **There is no activation date** | `TenantStatus` is `TRIAL` / `ACTIVE` / `SUSPENDED` / `CANCELLED` / `OFFBOARDING` (`schema.prisma:46-52`). Creation defaults to `TRIAL`. The only write of `ACTIVE` is `reactivateTenant` (`platform-tenant.service.ts:188-190`), from `SUSPENDED`. Nothing moves `TRIAL` to `ACTIVE`, and no `activatedAt` exists. The nearest stored facts are `bootstrappedAt` (written once, `tenant.service.ts:457-458`, guarded by `isBootstrapped` at `:389`) and `createdAt` |

**Shared database** (a read-only script; it printed counts, dates and platform
tables, never a key or secret):

| Item | Value |
|---|---|
| Organisations | 3. All `TRIAL`, all with no plan, `trialEndsAt` null |
| Provisioning (`bootstrappedAt`) | platform 2026-09-21T04:37Z; al-nakheel 2026-09-21T04:39Z; al-manara 2026-09-21T04:43Z |
| Stored own key (`aiConfig`) | **0** organisations |
| `settings.ai` | **absent on all three** |
| `AiFeatureCost` rows | 0 |
| `AiCreditPack` rows | 0 |
| **`Plan` rows** | **0** |
| `AiInteractionLog` rows | 0 |

**al-nakheel's starting state, which the live proof restores:**
- no `settings.ai`;
- no plan;
- after the migration, every new AI column at its default.

---

## 1. Atomic credits (Q1, D1 agreed: dedicated columns)

### 1.1 Why not the JSON

Six writers read the whole `settings` JSON and write it back with no lock or
transaction:
- `tenant.service.ts:286-296`
- `tenant.service.ts:319-335`
- `tenant.service.ts:452-461`
- `platform-tenant.service.ts:214-222`
- `platform-tenant.service.ts:234-249`
- `platform-settings.service.ts:35-54`

A stale copy written back would erase a deduction. **Moving the counters into
their own columns takes them out of that race entirely.** The settings writers
never write those columns.

### 1.2 The columns (one additive migration, with §6's log fields and §8's switch)

**`Organization`:**

| Column | Type | Meaning |
|---|---|---|
| `aiMonthlyCredits` | `Int @default(0)` | **The allocation:** the plan's credits, or a manual value (§5). 0 means no allowance |
| `aiPendingMonthlyCredits` | `Int?` | A **lower** allocation waiting for the next renewal (a downgrade, §5). Null means none |
| `aiCreditsUsed` | `Int @default(0)` | Used in the current period |
| `aiCreditsPeriodStart` | `DateTime?` | When the current period began (§4). Null until the organisation first has an allocation |
| `aiCreditsRenewsAt` | `DateTime?` | When the current period ends and the next begins (§4) |
| `aiCreditsNoticeFor` | `DateTime?` | The `aiCreditsPeriodStart` whose "credits used up" notice was sent (§10) |

**`AiFeatureCost`** (§8):

| Column | Type | Meaning |
|---|---|---|
| `restricted` | `Boolean @default(false)` | When true, only the listed organisations may use the feature |
| `allowedOrganizationIds` | `String[] @default([])` | The organisations a restricted feature is open to |

**`AiInteractionLog`** (§6): `creditCost Int?`, `provider AiProvider?`,
`tier String?`, `inputTokens Int?`, `outputTokens Int?`.

**What the migration does not contain:**
- **no activation column:** D14 recommends `bootstrappedAt`, which every
  organisation already has;
- no `DROP`, no rename, no new enum and no new enum value.

**`creditsRemaining` is never stored.** It is `aiMonthlyCredits − aiCreditsUsed`,
and it is never negative because of the reservation's condition.

**`settings.ai` keeps only `enabled`** (the organisation switch, §3). The old
`monthlyCredits`, `creditsUsed`, `creditsRemaining`, `resetDate` and
`overageEnabled` keys are then **ignored everywhere**. None exist in the data
(§0).

### 1.3 The reservation: one statement on the hot path

```sql
UPDATE "Organization"
SET "aiCreditsUsed" = "aiCreditsUsed" + $cost
WHERE "id" = $organizationId
  AND "aiMonthlyCredits" > 0
  AND COALESCE(("settings" -> 'ai' ->> 'enabled')::boolean, true)
  AND "aiCreditsRenewsAt" > now()
  AND "aiCreditsUsed" + $cost <= "aiMonthlyCredits"
RETURNING "aiCreditsUsed", "aiMonthlyCredits", "aiCreditsPeriodStart";
```

- **Concurrent calls cannot overspend.** Postgres serialises concurrent
  updates of one row. Under READ COMMITTED the second re-checks the `WHERE`
  against the row the first committed, so two calls cannot both take the last
  credits, and the balance cannot go negative.
- **When zero rows come back:**
  - if `aiCreditsRenewsAt <= now()`, the period is due. The gateway runs
    `renewIfDue()` (§4.3, the same function the job uses) and **retries the
    reservation once**. So whether a call is allowed never depends on the job
    having run (ACC-82: anything read to make a decision resolves live);
  - otherwise, one read picks the refusal (§3).

### 1.4 Every reader and writer of the old `settings.ai` counters, moved

**Backend:**

| File:line | Today | After |
|---|---|---|
| `foundation/tenant/tenant.service.ts:169-179` | Type of `settings.ai` | Only `enabled` remains |
| `tenant.service.ts:206-213` | `mapToITenant` reads JSON counters, with `enabled ?? false` | Reads the columns. `enabled` is the **effective** value (D13). `resetDate` = `aiCreditsRenewsAt`. Adds `pendingMonthlyCredits` and `features` (§8.3) |
| `tenant.service.ts:282-306` | `updateAiOverageSetting` writes `settings.ai.overageEnabled` | The route stays but its value is **ignored** (D9). The comment at `:282-285` is corrected. Removing the route is a later contract step |
| `foundation/tenant/interfaces/tenant.interface.ts:34-38`, `dto/tenant-response.dto.ts:26-30` | Response shape | Same fields, plus `pendingMonthlyCredits` and `features`. `overageEnabled` is always `false` |
| `foundation/tenant/dto/update-ai-overage.dto.ts:3-8` | Comment | Corrected |
| `platform/tenant/platform-tenant.service.ts:32-35` | `OrgSettings.ai` type | Only `enabled` remains |
| `platform-tenant.service.ts:106-110` | Tenant detail reads JSON counters | Reads the columns, plus `pendingMonthlyCredits` and the period dates |
| `platform-tenant.service.ts:234-259` | `allocateAiCredits` writes `monthlyCredits` / `creditsRemaining` into JSON | Calls `AiAllocationService.setAllocation(org, value, 'manual')` (§5), which writes the columns. **No JSON write at all.** `overageEnabled` in the DTO is ignored (D9) |
| `platform/tenant/dto/allocate-ai-credits.dto.ts:3-12` | DTO | `monthlyCredits` unchanged. `overageEnabled` stays optional and is ignored (removed in a later contract step) |
| `platform/tenant/interfaces/platform-tenant.interface.ts:15-18` | Detail shape | Adds `pendingMonthlyCredits`, `periodStart`, `renewsAt` |
| `platform-tenant.service.ts:121-133` | `createTenant` sets `planId` only | Also applies the plan's allocation (§5) |

**Frontend:**

| File:line | Today | After |
|---|---|---|
| `foundation/tenant/services/tenant.service.ts:22-26` | Tenant `ai` type | Adds `pendingMonthlyCredits` and `features` |
| `tenant.service.ts:86-89` | `updateAiOverageSetting()` | Removed: there is no caller after D9 |
| `foundation/admin-settings/components/ai-settings/ai-settings.component.ts:32-41` | Shows allocation, remaining and used from `GET /tenant` | Unchanged: same fields, now from the columns |
| `ai-settings.component.ts:44-51`, `:75-78` | The overage toggle and its handler | **Removed (D9)** |
| `platform/components/tenant-detail/tenant-detail.component.ts:98-107`, `:159-174`, `:208` | The allocation form, with an overage checkbox | The allocation input stays. **The overage checkbox and its form control are removed (D19).** The used and remaining read-outs are unchanged |
| `platform/services/platform-tenant.service.ts:20-23`, `:70-71` | Detail type; `allocateAiCredits(id, monthlyCredits, overageEnabled?)` | Adds the new fields; `overageEnabled` is no longer sent |

### 1.5 What remains racy

The six writers still race **each other**. For example, a modules change and a
task SLA change saved together lose one of them. That predates this ticket and
no longer touches credits. It is **ACC-215** (Low, lane B, opened 12 Oct and
linked to ACC-194).

---

## 2. Reserve, then call (Q2)

The order inside the one gateway, `AiService.run()` (§11.1):

1. **Load the feature's cost.** No row means `AI_FEATURE_NOT_PRICED`. It fails
   closed: an unpriced feature is never free.
2. **The feature switch (§8).** A restricted feature that this organisation is
   not on the list for is refused `AI_NOT_ENABLED`, reason
   `FEATURE_NOT_AVAILABLE`.
3. **The provider is configured.** No platform key means
   `AI_PROVIDER_UNAVAILABLE`, **before anything is reserved**.
4. **Reserve** (§1.3), with an inline renewal if the period is due. Zero rows
   means `AI_NOT_ENABLED` or `AI_CREDITS_EXHAUSTED` (§3).
5. **Call the provider** with the feature's model, effort and maximum output
   (§7).
6. **On success:** log with `creditCost = cost` and return. If nothing can run
   any more, claim and send the notice (§10).
7. **On failure** (any throw, a timeout or a non-2xx):
   - refund with
     `UPDATE … SET "aiCreditsUsed" = GREATEST("aiCreditsUsed" - $cost, 0) WHERE "id" = $org AND "aiCreditsPeriodStart" = $reservedPeriodStart`;
   - log with `success = false` and `creditCost = 0`;
   - refuse `AI_PROVIDER_FAILED`.

   **The refund applies only within the same period:** if the period renewed
   during the call, the old period's usage is already gone, and refunding into
   the new period would give credits away.

**Overage stays off.** Nothing reads `overageEnabled`.

**Accepted gap (R10):** a process that dies between steps 4 and 6 keeps the
reservation.

---

## 3. Refusals (Q3) and the organisation switch

One class, `AiRefusalException` (`foundation/ai/ai-refusal.ts`), with the shape
of `StorageRefusalException` (`file-storage/storage-refusal.ts:119-140`): the
body is `{ statusCode, message, error, code, ...details }`. The statuses follow
the storage precedents (`storage-refusal.ts:46,50,53,54`).

| Code | HTTP | When | Details |
|---|---|---|---|
| `AI_NOT_ENABLED` | **409** | The organisation has no allocation, or `settings.ai.enabled === false`, or the feature is restricted and the organisation is not on its list | `reason`: `NO_ALLOWANCE`, `SWITCHED_OFF` or `FEATURE_NOT_AVAILABLE`; `feature` |
| `AI_CREDITS_EXHAUSTED` | **409** | `used + cost > allocation` this period | `creditCost`, `creditsRemaining`, `renewsAt` |
| `AI_PROVIDER_UNAVAILABLE` | **503** | No platform key (Railway today) | — |
| `AI_PROVIDER_FAILED` | **502** | The provider was called and failed. The reservation was refunded | — |
| `AI_FEATURE_NOT_PRICED` | **503** | No cost row for the feature. Logged at `error` | `feature` |

**Neither 409 is 403:** in this app a 403 means "you lack a permission"
(ACC-101).

**The switch (D13, agreed):** AI is on for an organisation when
`aiMonthlyCredits > 0` **and** `settings.ai.enabled` is not `false`. An absent
`enabled` counts as on. `GET /tenant` reports this effective value.

---

## 4. Credit periods and renewal (Q4, D2 changed)

### 4.1 The rule (Ahmad, 12 Oct)

Each organisation's credit period is **anchored to its activation date, in
UTC**. Let *A* be the activation instant and *d* its UTC day of the month.

- **When *d* is 1–28: monthly, on day *d*.**
  - Renewals fall at **00:00 UTC on day *d*** of each month after *A*'s month.
  - Every month has a day 1–28, so the day never drifts.
- **When *d* is 29, 30 or 31: every 30 days, whatever the month's length.**
  - Renewals fall at **00:00 UTC on *A*'s date plus 30·k days** (k = 1, 2, …).
  - These organisations need no anchor beyond the stored period itself: the
    next renewal is always the period's renewal plus 30 days.
  - The *mode* is still decided from *A*, never from the current period start.
    A 30-day period starting on 31 Jan renews on 2 Mar, and reading "day 2"
    from that start would wrongly switch the organisation to monthly.
- **The first period begins at *A*** and ends at the first renewal after it.
- **The period "containing now"** is from the latest renewal at or before now
  (or *A*) up to the next renewal after now. This is computed by one pure
  function, `creditPeriodAt(activation, now)` in
  `foundation/ai/ai-credit-period.ts`, which is the only place the rule lives.

**Worked examples:**

| Activation | Renewals |
|---|---|
| 21 Sep 2026, 04:39Z (al-nakheel, if D14 holds) | 21 Oct 00:00Z, 21 Nov, 21 Dec… The current period is 21 Sep 04:39 → **21 Oct 00:00Z** |
| 31 Jan 2027 | 2 Mar 2027, 1 Apr, 1 May, 31 May, 30 Jun… (every 30 days) |
| 28 Feb 2027 | 28 Mar, 28 Apr… (monthly) |

### 4.2 Where activation lives (D14, new)

**Today nothing records an "activation"** (§0). Every organisation is `TRIAL`,
nothing writes `TRIAL` → `ACTIVE`, and there is no `activatedAt`.

**What is stored is when each organisation became usable:**
- `bootstrappedAt`, written once by `bootstrap()` (`tenant.service.ts:457-458`,
  guarded by `isBootstrapped` at `:389`);
- `createdAt`.

**Recommended (D14): activation = `bootstrappedAt`, falling back to
`createdAt`.**
- **No new column, and existing organisations already have one** (§0, all on
  21 Sep).
- It is read when an organisation's period is first set up, and at every
  renewal, to decide monthly or 30-day mode.
- It is immutable once written.

**The alternative:**
- a new `activatedAt DateTime?`, written when a tenant first becomes `ACTIVE`;
- **no code makes that transition today** (it belongs with billing, Phase 2);
- so every organisation would have no activation, and therefore no period,
  until that flow exists;
- existing organisations would need a backfill to `bootstrappedAt` anyway.

### 4.3 Renewal: one function, run hourly and inline

`renewIfDue(organizationId)` runs in a short transaction:
1. `SELECT … FOR UPDATE` on the organisation row.
2. If `aiCreditsRenewsAt` is null or still in the future: **do nothing**. This
   is what makes a re-run, or a second worker, harmless: the second waits on the
   lock and then sees the new `aiCreditsRenewsAt`.
3. Otherwise, compute the period containing now (`creditPeriodAt`), so a missed
   renewal catches up straight to the current period with **one** refill, not
   one per missed period. Then set:
   - `aiCreditsUsed = 0`;
   - `aiMonthlyCredits = COALESCE(aiPendingMonthlyCredits, aiMonthlyCredits)`
     (a waiting downgrade takes effect here, §5);
   - `aiPendingMonthlyCredits = NULL`;
   - the new `aiCreditsPeriodStart` and `aiCreditsRenewsAt`.
4. Write one `AuditLog` row: `event: 'ai_credits_renewed'`, with the previous
   period, the used count and the allocation before and after. `actorId` is
   optional (`common/services/audit-log.service.ts:27`).

**The hourly job:**
- **Queue and processor:** queue `ai-credits`, processor
  `AiCreditsRenewalProcessor`. It is registered only behind `workersEnabled()`
  (`common/queue/workers.config.ts:60-62`), in the same form as
  `file-storage.module.ts:42`. It is added to `WORKER_QUEUES`
  (`workers.config.ts:53`) and to the startup log's list of skipped work
  (`:99-102`). `check:worker-gate` proves the registration.
- **Schedule:** a repeat every hour, with a fixed `jobId`
  (`storage-purge.processor.ts:41-43`).
- **Each tick** selects `WHERE "aiCreditsRenewsAt" <= now()` and calls
  `renewIfDue()` for each organisation. **It renews only organisations whose
  next renewal time has passed.**
- **The reservation calls the same function inline** when it meets a due period
  (§1.3). So where workers are off (local, `RUN_WORKERS` unset), no decision is
  wrong; the stored numbers simply wait for the next call or tick.

**The first run after deploy changes nothing.** Every organisation has
`aiCreditsRenewsAt = NULL` until it first gets an allocation, so the job matches
zero rows. That is logged as "0 organisations renewed".

**When a period is first set up:** the first time an organisation's allocation
becomes greater than 0, by a plan or by hand (§5), its period is set to the one
containing now: `aiCreditsPeriodStart`, `aiCreditsRenewsAt`, `aiCreditsUsed = 0`.
Its credits are available at once.

---

## 5. Allocation follows the plan (Q4 continued, D3 changed)

### 5.1 The rule (Ahmad, 12 Oct)

- **When an organisation's plan is set or changed, its allocation becomes that
  plan's `aiCreditsPerMonth`.** This replaces any earlier value, including a
  manual one. There is no "custom" flag.
- **A platform admin may still set a different allocation** for a special
  agreement, through the existing `PATCH /platform/tenants/:id/ai-credits`. The
  next plan set or change replaces it.
- **Timing:**
  - **Upgrade** (new ≥ current): `aiMonthlyCredits = new` at once, and any
    pending downgrade is cleared. Remaining is allocation minus used, so **the
    difference is added to the current period's balance immediately**.
  - **Downgrade** (new < current): `aiPendingMonthlyCredits = new`, and the
    current allocation stays until the **next renewal**, where `renewIfDue()`
    applies it.
  - **No period yet** (the allocation was 0): the allocation is set directly and
    the period is set up (§4.3).
- **Renewal restores the organisation's allocation:** `aiCreditsUsed = 0`
  against `aiMonthlyCredits` (§4.3).
- **One writer for all of this:** `AiAllocationService.setAllocation(org,
  credits, source: 'plan' | 'manual')`. It is a short transaction with
  `SELECT … FOR UPDATE`, the same lock as renewal, so a plan change and a renewal
  cannot interleave. It writes one audit row (`event: 'ai_allocation_changed'`,
  with the source, before, after and whether it is pending).

### 5.2 Where plan assignment happens, and the smallest change

**Today plan assignment exists only at creation**
(`platform-tenant.service.ts:130`).

**The smallest additive change:**
1. **`createTenant`** (`:121-133`): after `bootstrap()`, if `planId` is given,
   call `setAllocation(org, plan.aiCreditsPerMonth, 'plan')`.
2. **A new `PATCH /platform/tenants/:id/plan`** (`PlatformGuard`, as its
   siblings at `platform-tenant.controller.ts:45-96`):
   - body `{ planId: string | null }`;
   - sets `planId` and calls `setAllocation(…, 'plan')`;
   - a null plan means an allocation of 0, which as a decrease waits for the
     next renewal.

   **Changing the plan also changes the tenant's module entitlements**, because
   modules are read through `planId` (`tenant.service.ts:93-95`,
   `foundation/tenant/module-entitlements.ts`). That is the plan's existing
   meaning, not a side effect of this ticket.
3. **No UI in ACC-194** (D18). The platform tenant detail has no plan picker,
   and **no `Plan` rows exist yet** (§0), so the endpoint has nothing to
   assign until plans are created.

**Two rules that need Ahmad's word:**
- **D15:** a manual allocation follows the same timing (raise now, lower at
  renewal).
- **D16:** editing a plan's `aiCreditsPerMonth` does **not** reach the
  organisations already on it.

**Consequence until plans exist:** every organisation stays at an allocation of
0, which is `AI_NOT_ENABLED`, unless a platform admin allocates by hand. That is
how al-nakheel gets credits for the demo and for the live proof.

---

## 6. Logging (Q6, D5 and D7 agreed)

The migration adds these fields to `AiInteractionLog`, all nullable, so rows
written before the deploy stay valid:
- `creditCost Int?`: the cost on success, **0** when a call failed and was
  refunded;
- `provider AiProvider?`: the **existing** enum (`schema.prisma:33-38`);
- `tier String?`: always `'STANDARD'` in this ticket;
- `inputTokens Int?` and `outputTokens Int?`.

**No customer text is logged, for any feature:**
- `promptSummary` is a **description supplied by the caller**. For example:
  `document_summary · StoredFile cmv… · 18,240 characters in`.
- `responseSummary` is `"<n> characters out"`.
- Each row also carries the model, the tokens, the cost, the actor and the time.

The text a person accepted is recorded where they accepted it (suggest → review
→ approve).

A spec asserts that a marker string in the prompt never appears in the log row.

---

## 7. Model, effort and maximum output (Q7, D6 agreed)

**Confirmed against Anthropic's models overview on 12 Oct**
(`platform.claude.com/docs/en/models/overview`):

| Model | API ID | Price per million tokens (in / out) |
|---|---|---|
| Sonnet 5.5 | `claude-sonnet-5-5` | $2 / $10 |
| Opus 5.5 | `claude-opus-5-5` | $4 / $20 |
| Haiku 5.5 | `claude-haiku-5-5` | from $0.10 / $0.50 |

- **The hard-coded `claude-sonnet-4-6` is a legacy model.**
- **The IDs are confirmed again at build time** and named in the commit.

**Configuration: `foundation/ai/ai.config.ts`, the only place a model is
named.**
- Standard = `ANTHROPIC_MODEL_STANDARD`, else `claude-sonnet-5-5`.
- Premium = `ANTHROPIC_MODEL_PREMIUM`, else `claude-opus-5-5` (configured,
  unused).
- `AiCompletionOptions.model` (`ai.provider.ts:9`) is removed: a caller picks a
  feature, never a model.

**Every feature sets its effort and maximum output explicitly, in one table in
`ai.config.ts`.** No call inherits the API's defaults.
- Sonnet 5.5 thinks adaptively by default at `high` effort.
- Thinking is billed as output and counts against `max_tokens`.
- A missing effort would roughly double the cost, and a tight `max_tokens`
  would cut answers short.

| Feature | Effort (starting point) | `max_tokens` (starting point) |
|---|---|---|
| `task_description_drafting` | `low` | 2,000 |
| `document_summary` | `medium` | 4,000 |
| `morning_briefing` | `low` | 3,000 |

**At build time, before any feature value is final, confirm from Anthropic's
documentation:**
- the exact request shape for effort and thinking on the 5.x models;
- **whether `temperature` is still accepted** alongside adaptive thinking (the
  provider sends it when given, `anthropic-ai.provider.ts:56-58`; if it is
  refused or ignored, the provider stops sending it);
- that `anthropic-version: 2023-06-01` (`:64`) is still the version to send.

The values in the table above are adjusted then. The commit records what the
documentation said and on what date.

---

## 8. Feature costs and the per-organisation feature switch (Q8, D4 changed)

### 8.1 The costs (Ahmad, 12 Oct)

| Feature | Credits | Notes |
|---|---|---|
| `task_description_drafting` | **2** | — |
| `document_summary` | **15** | Summary input **capped at 30k tokens**. Whether a longer file is truncated or refused is ACC-193's call |
| `morning_briefing` | **5 per on-demand run** | **Restricted to al-nakheel**, for demos |

They arrive through an **idempotent seed run after the deploy** (D12, agreed):
`npm run seed:ai-feature-costs`.
- **Dry run by default**, with `--execute`.
- It **creates a row only if it is absent and never overwrites one.** An edited
  cost, or an edited restriction, stays as someone set it.
- `morning_briefing` is created with `restricted: true` and al-nakheel's id,
  **resolved by its slug at run time**.
- **If al-nakheel is not found,** the seed creates the row restricted with an
  empty list, open to nobody, and says so. It never creates it unrestricted.

### 8.2 The switch: platform-controlled, on the feature's own row

**Shape (D17):** two additive columns on `AiFeatureCost` (§1.2):
`restricted Boolean @default(false)` and `allowedOrganizationIds String[]`.

**Why two columns, not one list where empty means everyone:**
- `AiCreditPack.availableTo` uses that one-list shape (`schema.prisma:496`).
- **Here an empty list would mean "open to every organisation"**, and emptying
  a demo feature's list by mistake would switch it on for every tenant.
- With the flag, a restricted feature with an empty list is open to **nobody**.
  It fails closed.

**Who controls it:**
- `AiFeatureCost` is platform data, written only by platform admins
  (`plan.service.ts:221-226`, behind `PlatformGuard`).
- That upsert updates only `creditCost` and `description` (`:224`), so **a cost
  saved on the platform screen cannot clear a restriction.**
- Until a platform screen shows it, the restriction is set by the seed, or by a
  platform admin through a script. **ACC-194 builds no screen.**

**The check:** step 2 of §2. If `restricted` and the organisation's id is not in
`allowedOrganizationIds`, the call is refused `AI_NOT_ENABLED` with reason
`FEATURE_NOT_AVAILABLE`, before any other check and without reserving anything.

**Tenant isolation:**
- the organisation id compared is always the one from the JWT;
- the list holds ids only;
- no tenant can read another tenant's membership in it, because a tenant sees
  only its own `features` (§8.3);
- a deleted organisation leaves a harmless stale id.

### 8.3 What ACC-194 provides, and what ACC-198 must add

**ACC-194 provides:**
- the switch and its check in the gateway;
- the seeded `morning_briefing` row (5 credits, al-nakheel only);
- **`features` on `GET /tenant`'s `ai` object:**
  - the priced features open to the caller's organisation, as
    `{ key, creditCost }[]`;
  - restricted features appear **only** for an organisation on their list;
  - a screen can then show or hide a button without a refusal round trip;
- the shared frontend refusal helper (§12), with the `FEATURE_NOT_AVAILABLE`
  wording.

**ACC-198 must add:**
- **The on-demand endpoint**, for example `POST /ai/morning-briefing`:
  - gated by a **tenant-admin permission**;
  - the AI credits screen's own `tenant:manage_config`
    (`core/navigation/nav-items.ts:279`) is the obvious candidate. That is
    ACC-198's decision;
  - it calls `AiService.run('morning_briefing', …)`.
- **The button**, shown only when `features` includes `morning_briefing`.
  Every other organisation would only ever be refused `AI_NOT_ENABLED`.
- **A guard against a double press** (one run in flight per organisation), so
  one click is never charged twice.
- **No schedule:** no processor and no repeat. The briefing runs only from the
  button. `check:worker-gate` stays as it is, and ACC-198's plan should say so.
- **The prompt, and what the briefing covers.**
- **ACC-198's Linear text** still says "for each user"; it needs rewording to
  "on demand, by a tenant admin".

---

## 9. (Merged into §8.)

---

## 10. The "credits used up" notice (Q9, D10 agreed)

**When:** once per credit period, at whichever comes first:
- a reservation that leaves less than the **cheapest feature open to this
  organisation**, so nothing can run any more;
- the first `AI_CREDITS_EXHAUSTED` refusal.

**How it is sent only once, by claim:**
`updateMany({ where: { id, OR: [{ aiCreditsNoticeFor: null }, { aiCreditsNoticeFor: { not: periodStart } }] }, data: { aiCreditsNoticeFor: periodStart } })`.
**Only the call that moves the value sends**, the same shape as
`storageWarnedAt` (`file-storage/stored-file.service.ts:190-205`, send at
`:200`). A new period makes it sendable again on its own.

**The path:**
- `AiNoticesService.creditsUsedUp()`, modelled on
  `StorageNoticesService.storageAlmostFull()` (`storage-notices.service.ts:40-64`);
- in-app, in English and Arabic, to the organisation's ACTIVE holders of an
  active `TENANT_ADMIN` role, through `NotificationService`;
- sent **after** the reservation commits. A failure to send is logged and never
  refunds or blocks anything.

**The words:**
- **Title:** "AI credits used up" / «نفدت أرصدة الذكاء الاصطناعي».
- **Body:** "Your organization has used all its AI credits for this period.
  They renew on {date}." /
  «استخدمت مؤسستك جميع أرصدة الذكاء الاصطناعي لهذه الفترة، وتتجدد في {date}.»
- This is server-built text: the known ACC-95 limitation.

It is a bell event. There is no Setup health condition (ACC-82).

---

## 11. The shape of the code

### 11.1 One gateway, enforced

- **New `foundation/ai/`:**
  - `AiModule`;
  - `AiService` (the gateway);
  - `AiCreditService` (reserve, refund, notice claim; raw SQL);
  - `AiAllocationService` (`setAllocation`, `renewIfDue`);
  - `ai-credit-period.ts` (the pure period rule);
  - `AiNoticesService`;
  - `ai-refusal.ts`;
  - `ai.config.ts`;
  - `AiCreditsRenewalProcessor`, gated.
- **The `AI_PROVIDER` binding moves** from `tenant.module.ts:31,39` into
  `AiModule`, and is **not exported**. `PlatformTenantModule` imports `AiModule`
  for `AiAllocationService`.
- **`AnthropicAiProvider` only makes the call.** It takes
  `{ model, system, prompt, maxTokens, effort }` and returns content, usage and
  the model name. It loses:
  - the tenant key;
  - Prisma;
  - logging;
  - model choice.
- **`check:ai-gateway`:** a new backend scan that fails on any reference to
  `AI_PROVIDER` or `AnthropicAiProvider` outside `foundation/ai/` and
  `providers/ai/`. It keys off the symbol, not a file list, and CI discovers it.
- **The stub comment** at `lookup.service.ts:550` is updated to name
  `AiService`.

### 11.2 Migration (additive only)

One migration, `add-ai-metering-columns`:
- the six `Organization` columns;
- the two `AiFeatureCost` columns;
- the five `AiInteractionLog` fields.

All are defaulted or nullable. There is no drop, no rename, no new enum and no
new value.

**It is safe for the old container that is still serving during the
pre-deploy migration (ACC-127).**

**It is NOT applied to the shared database before the PR deploys.** It is
generated locally with `--create-only`, and CI applies it to its own ephemeral
Postgres (`.github/workflows/ci.yml:136-141`).

---

## 12. Frontend: the shared refusal helper (Q10)

**`frontend/src/app/core/ai/ai-refusal.ts`**, built on `refusalCode()` /
`refusalBody()` (`core/http/refusal.ts:16-26`).
- **Input:** an error.
- **Output:** `{ kind, messageKey, params }` or null.
- `renewsAt` is formatted through `FormatService` (ACC-94).

| Key | When | English | Arabic |
|---|---|---|---|
| `ai.refusal.notEnabled` | `AI_NOT_ENABLED`, `NO_ALLOWANCE` or `SWITCHED_OFF` | AI isn't turned on for your organization. Ask your administrator. | الذكاء الاصطناعي غير مفعّل لمؤسستك. تواصل مع مسؤول النظام. |
| `ai.refusal.featureNotAvailable` | `AI_NOT_ENABLED`, `FEATURE_NOT_AVAILABLE` | This AI feature isn't available for your organization. | ميزة الذكاء الاصطناعي هذه غير متاحة لمؤسستك. |
| `ai.refusal.creditsUsedUp` | `AI_CREDITS_EXHAUSTED` | Your organization has used all its AI credits for this period. They renew on {{date}}. | استخدمت مؤسستك جميع أرصدة الذكاء الاصطناعي لهذه الفترة. تتجدد في {{date}}. |
| `ai.refusal.unavailable` | `AI_PROVIDER_UNAVAILABLE`, `AI_PROVIDER_FAILED`, `AI_FEATURE_NOT_PRICED` | AI isn't available right now. Try again later. | الذكاء الاصطناعي غير متاح حاليًا. حاول مرة أخرى لاحقًا. |

The helper has a spec and no consumer yet; ACC-193, ACC-197 and ACC-198 are its
callers. The parameter is `date`, so the translation-keys plural check does not
flag it.

---

## 13. Tests and the live proof (Q11, D11 agreed)

**Unit tests, with the provider mocked:**
- `AiService`:
  - the order in §2;
  - every refusal, with its status, reason and details;
  - a restricted feature refused before anything is reserved;
  - provider unavailable refused before reserving;
  - the refund on failure, keyed by period;
  - the log fields, and no customer text;
  - an unpriced feature refused.
- `creditPeriodAt()`, as a table:
  - activations on the 1st, the 28th, the 29th, the 30th and the 31st;
  - February in leap and non-leap years;
  - catch-up across several missed periods;
  - "30-day mode never turns monthly".
- `setAllocation`: upgrade adds at once and clears pending; downgrade is
  pending; first allocation sets up the period; plan replaces manual.
- `renewIfDue`: applies pending, a no-op when not due.
- The renewal processor and its gate; the notice claim; the mapper's effective
  `enabled` and `features`; `createTenant` and the plan endpoint applying the
  allocation.

**`npm run test:db`, a new CI step after `prisma migrate deploy`.**
- It runs against the ephemeral Postgres (`ci.yml:136-141`).
- It **fails, rather than skips, without `DATABASE_URL`**.
- **What it proves:**
  1. **Concurrent calls cannot overspend:** an allocation of 100, 50 concurrent
     reservations of 3 → exactly 33 succeed, and used = 99.
  2. **A settings write cannot erase a deduction:** concurrent whole-JSON
     `settings` writes leave `aiCreditsUsed` exactly as the reservations made
     it.
  3. **Renewal cannot double-run:** two concurrent `renewIfDue()` calls for a
     due organisation → one renewal, one no-op.
  4. **A refund is keyed by period:** a refund after the period moved changes
     nothing.
  5. **A plan change and a renewal do not interleave:** they serialise on the
     row lock.

**Tenant isolation**, named with the gate's exact string (ACC-44):
- a reservation, refund, renewal or allocation for org A never touches org B;
- the log row carries A's id;
- the notice reaches only A's admins;
- `features` for A never lists a feature restricted to B.

**Limits:**
- Docker is not installed here, so the database spec runs in CI only.
- **The live proof is a STOP 2 after the deploy.** The migration must not reach
  the shared database first.

**The live proof:**
1. `npm run seed:ai-feature-costs`: a dry run, then `--execute`.
2. As the platform admin, allocate al-nakheel **20** credits by hand. Its period
   is set up: 21 Sep → 21 Oct, if D14 holds.
3. From a local backend at the merged commit, with `RUN_WORKERS` unset and the
   key read from the local `.env` and never printed, a scratchpad script calls
   `AiService.run('task_description_drafting', …)` for al-nakheel in-process.
   **What it checks:**
   - one real answer;
   - `aiCreditsUsed = 2`;
   - one log row with cost 2, provider `ANTHROPIC`, tier `STANDARD`, tokens and
     no prompt text;
   - `morning_briefing` is refused `FEATURE_NOT_AVAILABLE` for al-manara, and
     allowed for al-nakheel (one call, 5 credits);
   - lowering the allocation to the amount used gives `AI_CREDITS_EXHAUSTED`,
     and the notice is sent once.
4. **Restore al-nakheel exactly:**
   - `aiMonthlyCredits 0`, `aiPendingMonthlyCredits null`, `aiCreditsUsed 0`;
   - `aiCreditsPeriodStart`, `aiCreditsRenewsAt` and `aiCreditsNoticeFor` null;
   - `settings.ai` absent, and no plan;
   - the notices deleted.
5. **The log rows stay**, as the record of real calls. The report names them.

---

## 14. Decisions

**Agreed (Ahmad, 12 Oct):**
- D1 dedicated columns;
- D5 no customer text in the log;
- D6 `claude-sonnet-5-5`, overridable;
- D7 token counts;
- D8 leave the own-key column untouched;
- D9 hide the overage toggle;
- D10 the notice when nothing can run or at the first refusal, once per period;
- D11 `test:db`;
- D12 an idempotent seed;
- D13 the effective "AI enabled".

**Changed (Ahmad, 12 Oct):**
- **D2:** periods are anchored to activation, monthly on days 1–28, every 30
  days on the 29th–31st (§4).
- **D3:** the allocation follows the plan; upgrade at once, downgrade at renewal
  (§5).
- **D4:** costs 2 / 15 / 5, with `morning_briefing` al-nakheel only and on
  demand (§8).

**Decided (Ahmad, 12 Oct, revision 2): D14–D19, each as recommended below.**
- **D14:** activation = `bootstrappedAt`, falling back to `createdAt`, with no
  new column. **When billing exists, the credit period follows the billing
  date.**
- **D15:** a manual allocation follows the plan-change timing.
- **D16:** a plan edit does not reach organisations already on it until their
  plan is next set.
- **D17:** a `restricted` flag plus an allowed list; an empty list means
  nobody.
- **D18:** `PATCH /platform/tenants/:id/plan`, backend only, with an audit row
  recording the old and new plan.
- **D19:** the platform checkbox is removed too, and allocate no longer sends
  the overage value.

The table as proposed:

| # | Decision | Recommendation |
|---|---|---|
| **D14** | What "activation date" means, since nothing records one today | **Provisioning: `bootstrappedAt`, falling back to `createdAt` (recommended).** No new column, and every organisation already has one. Alternative: a new `activatedAt` for `TRIAL` → `ACTIVE`, which no code writes until billing exists |
| **D15** | Timing of a manual allocation by a platform admin | **The same as a plan change: a raise applies now, a cut at the next renewal (recommended)** |
| **D16** | Editing a plan's `aiCreditsPerMonth` | **Does not reach organisations already on the plan; it applies when their plan is next set or changed (recommended).** Propagating would silently overwrite special agreements. Alternative: apply to every organisation on the plan, with the same raise and cut timing |
| **D17** | Shape of the per-organisation feature switch | **`restricted` flag plus `allowedOrganizationIds`, where a restricted feature with an empty list is open to nobody (recommended)**, over one list where empty means everyone (the `AiCreditPack.availableTo` shape) |
| **D18** | Changing a tenant's plan | **A backend endpoint only in ACC-194, with no picker on the platform tenant detail (recommended).** No `Plan` rows exist yet, so a picker would have nothing to show |
| **D19** | The **platform** tenant detail's overage checkbox (`tenant-detail.component.ts:102-103`), which D9 did not name | **Remove it too, and stop sending `overageEnabled` from allocate (recommended).** It sets a value nothing reads |

---

## 15. Risks

- **R1. The settings writers still race each other** (§1.5). → **ACC-215.**
- **R2. The live proof cannot run before the deploy**, and there is no local
  Postgres. Until then the concurrency proof is the CI database spec.
- **R3. Production refuses every call until a key is added.**
  `ANTHROPIC_API_KEY` stays off Railway, so every production call refuses
  `AI_PROVIDER_UNAVAILABLE` until ACC-193 adds a key.
- **R4. With no `Plan` rows, plan-driven allocation does nothing yet.** Every
  organisation is at 0 until plans exist, or until a platform admin allocates
  by hand.
- **R5. 5.x request semantics** (thinking billed as output, effort,
  `temperature`): confirmed at build (§7).
- **R6. CLAUDE.md is wrong in four AI sections**, corrected in the docs step:
  - the AI Runtime Flow (deduct after the call; `creditsRemaining` stored;
    notice at exactly 0);
  - Organization AI Settings (the counters in JSON);
  - the monthly job (it resets to the Plan value on the 1st);
  - the AI credit-cost table (`document_summary` is missing; `morning_briefing`
    is described as a daily per-user feature).
- **R7. The provider's error message includes Anthropic's response body**
  (`anthropic-ai.provider.ts:71-72`). The gateway logs only the status and the
  error type.
- **R8. Expand-then-contract:**
  - the old `settings.ai` counter keys become dead (none exist in the data);
  - the overage routes and the DTO field are ignored now and removed in a later
    contract step;
  - `aiConfig` stays (D8).
- **R9. Renewal day.** If D14 holds, al-nakheel and al-manara both renew on the
  21st (the next is 21 Oct, 00:00Z). A live proof done after the deploy but
  before the 21st, and then restored, leaves no period behind.
- **R10. A crash mid-call keeps the reservation** (accepted).
- **R11. `allowedOrganizationIds` holds ids with no foreign key.** It is safe
  because it is only ever compared with the JWT's organisation. A deleted
  organisation leaves a stale id that matches nobody.
- **R12. A plan change also changes module entitlements.** That is the existing
  meaning of `planId`, but the plan endpoint is the first way to change it after
  creation. Its audit row records the old and new plan.

---

## 16. Investigation: customer-hosted models in closed environments (no implementation)

**The question:** a customer in a closed environment runs its own model server
on premises (Ollama, vLLM, LM Studio or similar) and wants AccreditMe's AI
features to use it.

**Can the provider interface take it? Yes, after ACC-194.**
- The reduced provider contract (§11.1) is provider-neutral: model, system
  prompt, prompt and maximum output in; content, token usage and the model name
  out.
- Every server named above exposes an **OpenAI-compatible
  `/v1/chat/completions`**: `messages`, `max_tokens`, and
  `usage.prompt_tokens` / `completion_tokens` in the response. That maps onto
  the contract one to one.
- `effort` has no equivalent and is ignored.
- So an `OpenAiCompatibleAiProvider` is a second class behind the same
  interface. The gateway, metering, logging and refusals are untouched.
- The `AiProvider` enum already has `OLLAMA` and `OPENAI` (`schema.prisma:33-38`).
  A generic "customer-hosted" value would be a new enum value, which is decided
  when this is built.

**Per deployment or per organisation?**

| | Per deployment (Tier 3 on-premises; Tier 2 dedicated) | Per organisation on the shared cloud (Tier 1) |
|---|---|---|
| Who configures | AccreditMe or the customer's IT, at install, in the deployment's environment (endpoint, model, optional auth header) | A tenant admin enters an endpoint and credential |
| "Tenants never bring a key" | Holds: it is deployment configuration, like the database URL, not a tenant setting | **Broken:** a tenant-supplied endpoint and credential is exactly what that rule rejects |
| Network | Same network as the model server. Private addresses are allowed, as `STORAGE_ALLOW_PRIVATE_ENDPOINTS` does for storage (ACC-177) | Our cloud must reach into their network: the model server exposed to the internet, or a VPN or private link, plus TLS and an allowlist of our egress addresses (not fixed on Railway). A per-tenant URL is also an SSRF path that would need ACC-177's connect-time guard |
| Data residency | **The real benefit:** prompts and documents never leave the customer's network | **None gained:** their data is already in our EU cloud, and sending it to their server adds a hop rather than removing one |

**Metering:**
- Credits exist to cover **AccreditMe's** model cost. When the customer runs
  the compute, charging credits charges for nothing.
- CLAUDE.md already puts Tier 3 outside the credit system (annual licence).
- **Recommended:** keep the gateway on every call, so the feature switch, the
  organisation switch, the refusals and the log all still apply. Add a
  **deployment-level** mode, `AI_CREDITS_MODE=metered|unmetered` (default
  `metered`):
  - an unmetered deployment reserves and deducts nothing and logs
    `creditCost: null`;
  - the rule "every call is metered" becomes "every call goes through the
    gateway and is logged; credits apply where AccreditMe pays for the model".

**Risks:**
- **Quality:** Arabic and instruction-following vary widely across local models;
  prompts tuned for Claude may need per-model work; "AI is bad" support tickets
  will be about the customer's model.
- **Capacity:**
  - a 30k-token summary needs a model with at least a 32k context;
  - on modest hardware it can take minutes, which needs long timeouts and
    probably asynchronous delivery;
  - token counts differ by tokenizer, so input caps need per-model checks.
- **Feature parity:** a feature that later needs tool use or images may not work
  on the customer's model.
- **Security:** the endpoint's credential is a deployment secret (environment,
  not database). The model server's TLS and authentication are the customer's
  responsibility, and must be stated in the install guide, as the SharePoint
  guide does (ACC-185).
- **Version drift:** the log records the model name the server reports, so
  answers can be traced to a model.

**Recommendation:**
- Support customer-hosted models **per deployment only** (Tier 3, and Tier 2 on
  request), through an OpenAI-compatible provider chosen by environment, with
  credits unmetered on that deployment.
- **Do not offer per-organisation customer-hosted endpoints on the shared
  cloud.** It breaks "no tenant keys", adds an SSRF surface and network
  plumbing, and buys no residency.
- **Build it when a Tier 3 customer exists.** ACC-194's only obligation is the
  one it already meets: keep the provider contract neutral, so the new provider
  slots in without touching the gateway.

---

## 17. Build order (one commit each)

**Progress:**

- [x] 0a. `docs(plans)`: plan (`284ffcc`), revised with Ahmad's answers (this commit)
- [x] 0b. `docs`: CLAUDE.md file storage corrected (`ada5fda`)
- [x] 1. `chore(prisma)`: migrate — add AI metering, period, allocation, feature-switch and log columns (`--create-only` locally; CI applies it) (`3f7f823`)
- [x] 2. `feat(ai)`: config (models, effort and max output per feature), refusal codes, the period rule; specs (`c590843`)
- [x] 3. `feat(ai)`: credit and allocation services (reserve, refund, renew, setAllocation, notice claim); unit specs and the CI `test:db` step (`016dfb6`)
- [x] 4. `feat(ai)`: gateway, slimmed provider (platform key only, no customer text logged), feature switch, `AiModule`, `check:ai-gateway` (`80e4cb6`)
- [x] 5. `feat(tenant)`: AI balance from the columns everywhere (§1.4), allocate through `setAllocation`, plan applied at creation, `PATCH /platform/tenants/:id/plan` (`29bf79d`)
- [x] 6. `feat(ai)`: renewal processor behind the worker gate (`ee464f5`)
- [x] 7. `feat(ai)`: the "credits used up" notice, once per period (`d307524`)
- [x] 8. `chore(ai)`: idempotent seed for the three feature costs (`morning_briefing` restricted to al-nakheel) (`b63e3a2`)
- [x] 9. `feat(ai)`: shared frontend refusal helper and words; overage controls removed (D9, D19); types updated (`5eeac1a`)
- [x] 10. `docs`: SYSTEM-REFERENCE AI section; CLAUDE.md AI Runtime Flow, Org AI settings, renewal and cost table; Key Architecture Decisions (ACC-194) (this commit)
- [x] STOP 1: lint, typecheck, tests, scans; report (12 Oct, see §19)
- [ ] After deploy, STOP 2: seed, live calls on al-nakheel (and the al-manara refusal), restore, report

---

## 18. Where the build differs from the plan (12 Oct)

**What Anthropic's documentation said at build time** (read 12 Oct: models
overview, effort, thinking, the Sonnet 5.5 migration guide):
- **`temperature`:** a non-default `temperature`, `top_p` or `top_k` is a
  **400** on Sonnet 5.5. The provider never sends any of them.
- **Effort:** `output_config.effort`, generally available, no beta header.
  Sonnet 5.5's default is `high`.
- **Thinking:** on by default on the 5.x models; Sonnet 5.5 refuses
  `thinking: disabled`. No `thinking` field is sent, and thinking blocks come
  back with empty text, so the answer is the text blocks joined.
- **Header:** `anthropic-version: 2023-06-01` is still current.
- **Per-feature settings:** the effort and output limits in §7 were kept as
  written.

**Added during the build:**
- **A model refusal is a failed call.** A response with
  `stop_reason: refusal` is treated as `AI_PROVIDER_FAILED` and refunded, so a
  person pays nothing for no answer. An answer cut off at the output limit
  (`max_tokens`) is returned with `truncated: true`, and the log says so.
- **`PrismaService` gained `$queryRaw` and `$executeRaw`** (tagged templates
  only), because the reservation is a single statement outside a transaction.
- **`ai.features` on `GET /tenant` lists only callable features:** keys in
  `AI_FEATURE_KEYS` with a cost row. A cost row for an unbuilt feature (say,
  `rca_assistance`) is not listed.
- **The frontend helper takes the caller's `FormatService`** (`aiRefusal(err,
  format)`) rather than injecting it. A first version took a `formatDate`
  function, and `check:formatting` (ACC-94) rightly refused the name.
- **The frontend helper has four kinds, not three:** a feature not open to
  the organisation (`featureNotAvailable`) gets its own sentence, not "AI
  isn't turned on".
- **The seed's audit rows** are written in the platform organisation's trail,
  because `AiFeatureCost` is platform data.
- **`test:db` runs with `--forceExit`:** `PrismaService.$disconnect()` does not
  end its `pg` pool, so Jest would otherwise wait on it.
- **Proving `test:db` locally:** Docker is not installed here, so it ran on a
  throwaway Postgres 17 from the `embedded-postgres` npm package, installed in
  the session scratchpad (not the repo), on `localhost:55432`. The migration
  was generated and applied there too, and the seed proved there (dry run,
  apply, rerun).

**Left as it was:**
- **`PATCH /tenant/ai-settings` still exists** and answers 200, but nothing
  reads what it writes. It is removed in a later contract step; the frontend
  method that called it is removed now.
- **The platform tenant detail's allocation field** shows the current
  allocation, not a pending cut. The API returns `pendingMonthlyCredits`, so a
  screen can show it later. No new UI was in scope.
- **`aiCreditsRenewsAt` has no index.** The hourly query runs over a handful
  of organisations.

**Not done here, by instruction:**
- running the seed on the shared database;
- al-nakheel's demo allocation;
- the live AI call.

All three wait for the deploy and a separate prompt (STOP 2).

---

## 19. STOP 1 verification (12 Oct, on `aaabd9b`)

**Backend:**
- `tsc` 0;
- Jest: 138 suites / 3,032 tests, all passing;
- tenant isolation: 179 tests;
- `test:db`: 7 tests against a local throwaway Postgres 17;
- scans `check:ai-gateway` and `check:worker-gate` (6 processors, all gated) exit 0;
- the whole application context boots with every AI service resolved (local database, workers off).

**Frontend:**
- `tsc` (app and spec) 0;
- `ng build` 0;
- Karma: 1,475 tests, all passing;
- all 12 `check:*` scans exit 0.

**Lint:** ESLint on the lines this branch added in the backend finds **0 in production code**. It finds 50 in specs, all the mock-typing patterns existing specs already use (`no-unsafe-*` and `unbound-method`); 33 of them come from the platform spec's existing `mockPrisma: any` declaration. The frontend has no ESLint setup; its gate is the strict typecheck plus `ng build`. CI does not lint.
