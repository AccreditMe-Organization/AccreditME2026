# Step 194 — AI foundation (metering, monthly reset, organisation switch, platform key only)

Linear: **ACC-194** (High, lane B). **ACC-156** is its sub-issue and closes with it.
Branch: `feature/ACC-194-ai-foundation`, from `origin/dev` at `361b84c`.
Status: **PLAN — no code yet.** Decisions for Ahmad are in §13. Each one has a
recommendation marked **(recommended)**.

The brief is the ticket's scope (items 1–9) and its out-of-scope list:
- no provider choice;
- no Standard/Premium tiers in use;
- no credit-pack purchase;
- no platform AI admin screens;
- no tenant AI settings page.

This plan answers the eleven questions Ahmad asked on 12 Oct, each with
file:line evidence from `361b84c`.

---

## 0. What exists today (measured, 12 Oct)

**Code**

| Fact | Evidence |
|---|---|
| The provider makes a real Anthropic call, and nothing calls it | `providers/ai/anthropic-ai.provider.ts:35-110`. The only reference outside the provider is a commented-out stub at `foundation/lookup/lookup.service.ts:550` |
| The model is hard-coded | `anthropic-ai.provider.ts:29` `defaultModel = 'claude-sonnet-4-6'`. Callers may override it: `:40`, and `ai.provider.ts:9` `model?: string` |
| The tenant's own key wins over the platform key | `anthropic-ai.provider.ts:112-127` |
| With no key at all, it still calls Anthropic | `:126` falls back to an **empty string**. "Not configured" shows up as an Anthropic 401 after a network round trip, logged as a generic failure |
| The provider writes the log itself | `:85-107`, through `logInteraction()` `:129-151` |
| The log keeps the first 200 characters of the prompt and response | `:24-25`, `:90-91`, `:103` |
| `AI_PROVIDER` is bound in TenantModule and exported to everyone | `foundation/tenant/tenant.module.ts:31,39` |
| `AiInteractionLog` has no cost, provider, tier or token fields | `prisma/schema.prisma:1990-2009` |
| `AiFeatureCost` is platform-global: `featureKey` unique and `creditCost`, with no organisation | `schema.prisma:504-511` |
| Organisation fields | `aiProvider AiProvider @default(ANTHROPIC)` `:360`; `aiConfig String?` (encrypted) `:391`; `settings Json?` `:401` |
| Nothing writes `aiConfig` | It is read only at `tenant/tenant.service.ts:234` (reported as `'set'`/null). There is no write path in `backend/src` |
| The balance reaches the screen from JSON | `tenant.service.ts:169-179` and `:206-213`. Missing values become 0 or false, and `enabled` defaults to **false** (`:207`). The screen is `admin-settings/components/ai-settings/ai-settings.component.ts:33-51` |

**Shared database**

Measured with a read-only count script. It printed counts and platform tables
only, never a key.

| Item | Count |
|---|---|
| Organisations | 3 (platform, al-manara, al-nakheel) |
| Organisations with a stored own key (`aiConfig`) | **0** |
| `settings.ai` | **absent on all three**. The tenants' `settings` hold only `taskSla`, and the platform org's holds nothing |
| `AiFeatureCost` rows | 0 |
| `AiCreditPack` rows | 0 |
| `Plan` rows | 0 |
| `AiInteractionLog` rows | 0 |

**al-nakheel's starting state, which the live proof restores:** no `settings.ai`.

---

## 1. Atomic credits (Q1)

### 1.1 Every other settings writer reads and rewrites the whole JSON

Each of these reads `settings`, spreads it, and writes the whole object back:
`findUnique`/`findFirst`, then `update({ data: { settings: { ...settings, x } } })`.
None takes a row lock, and none runs in a transaction.

| Writer | Who | Evidence |
|---|---|---|
| `updateAiOverageSetting` | tenant admin | `tenant/tenant.service.ts:286-296` |
| `updateTaskSla` | tenant admin | `tenant.service.ts:319-335` |
| `bootstrap` | tenant creation | `tenant.service.ts:452-461` |
| `updateTenantModules` | platform admin | `platform/tenant/platform-tenant.service.ts:214-222` |
| `allocateAiCredits` | platform admin | `platform-tenant.service.ts:234-249` (computes `creditsRemaining` itself, `:242`) |
| `updateSettings` | platform admin, platform org only | `platform/settings/platform-settings.service.ts:35-54` |

**What that means for a deduction kept in the JSON:**
- Even a perfectly atomic deduction (a single `jsonb_set` under a row lock) can
  be undone.
- A writer above that read `settings` before the deduction committed writes its
  stale copy back afterwards.
- The deduction is then **erased**. The tenant got the call for free, and the
  balance can drift in either direction.

So locking only the AI path is not enough. **Every one of the six writers**
would have to take the same lock, and so would any writer added later.
"Every writer must remember X" is the shape ACC-82 forbids.

### 1.2 Options

- **A. Row lock plus one conditional `jsonb` update.**
  - The AI path does `SELECT … FOR UPDATE` and a `jsonb_set` guarded by
    `creditsUsed + cost <= monthlyCredits`.
  - **All six writers** above change to lock-then-write inside a transaction.
  - It needs no migration for the counters, but it touches tenant,
    platform-tenant and platform-settings, plus bootstrap.
  - It stays correct only while every future settings writer remembers the lock.
- **B. Dedicated columns on `Organization`, in the same additive migration as
  the log fields (recommended).**
  - The counters leave the JSON.
  - The settings writers never write these columns, so their read-modify-write
    **cannot reach the counters**, and nothing in them changes for this ticket.
  - The deduction is one conditional `UPDATE … RETURNING`. Postgres serialises
    concurrent updates of one row, and under READ COMMITTED the second updater
    re-checks the `WHERE` against the row the first one committed, so two calls
    cannot both take the last credits.

**Recommendation: B.** The measured data makes it cheap: no organisation has
`settings.ai`, so there is nothing to backfill. The read API stays the same,
because `mapToITenant` derives the same `ai` object from columns, so the
screen does not change.

### 1.3 The columns (option B)

| Column | Type | Meaning |
|---|---|---|
| `aiMonthlyCredits` | `Int @default(0)` | The allowance, set by the platform admin's allocate. 0 means no allowance |
| `aiCreditsUsed` | `Int @default(0)` | Used in `aiCreditsPeriod` |
| `aiCreditsPeriod` | `String?` | The month the used count belongs to, as `YYYY-MM` (D2). Null means never used |
| `aiCreditsNoticePeriod` | `String?` | The period whose "credits ran out" notice was sent (§9) |

**Three keys stay in `settings.ai`:**
- `enabled`, the organisation switch (§3);
- `overageEnabled`, which is unused because overage stays off (§2 and D9);
- `resetDate`, which no longer needs storing because it is derived (§4).

**`creditsRemaining` is never stored.** It is `aiMonthlyCredits` minus the used
count, where the used count is 0 when the period is not the current one. Two
fields holding one fact is ACC-82's stale-flag shape, and `allocateAiCredits`
already had to compute it by hand at `:242`.

### 1.4 The reservation, as one statement

```sql
UPDATE "Organization"
SET "aiCreditsUsed"   = (CASE WHEN "aiCreditsPeriod" = $period THEN "aiCreditsUsed" ELSE 0 END) + $cost,
    "aiCreditsPeriod" = $period
WHERE "id" = $organizationId
  AND "aiMonthlyCredits" > 0
  AND COALESCE(("settings" -> 'ai' ->> 'enabled')::boolean, true)
  AND (CASE WHEN "aiCreditsPeriod" = $period THEN "aiCreditsUsed" ELSE 0 END) + $cost <= "aiMonthlyCredits"
RETURNING "aiCreditsUsed", "aiMonthlyCredits";
```

- **A stale period counts as zero used, decided live.** The decision never
  depends on whether the reset job has run yet: anything read to make a decision
  resolves live (ACC-82). The job (§4) persists the reset for display and the
  record.
- **Zero rows returned means refused.** One follow-up read picks the code: no
  allowance or the switch off gives `AI_NOT_ENABLED`, otherwise
  `AI_CREDITS_EXHAUSTED`. The state may change between the two statements; that
  only affects which words are shown, never the balance.
- **Allocate becomes a single-column write** (`aiMonthlyCredits`). It no longer
  touches the counters, and it still merges `overageEnabled` into settings when
  sent, as it does today.

### 1.5 What remains racy, stated so it is not assumed fixed

The six settings writers still race **each other**. For example, a modules
change at the same moment as a task SLA change loses one of them. This predates
this ticket and no longer touches credits. The smallest fix is a per-key
`jsonb_set` in each writer.

**Recommended:** a separate Low ticket, not this one (Risk R1).

---

## 2. Reserve, then call (Q2)

The order inside the one gateway, `AiService.run()` (§10.1):

1. **Load the feature's cost.** No row means refuse `AI_FEATURE_NOT_PRICED`.
   This fails closed: an unpriced feature is never free.
2. **Check the provider is configured.** The platform key must be present.
   Without it, refuse `AI_PROVIDER_UNAVAILABLE` **before anything is
   reserved**, so a call that cannot happen costs nothing and leaves no
   reservation to undo.
3. **Reserve** with the §1.4 statement. Zero rows means `AI_NOT_ENABLED` or
   `AI_CREDITS_EXHAUSTED`. The balance can never go negative, because the
   statement only succeeds when `used + cost <= allowance`.
4. **Call the provider.**
5. **On success:** write the log with `creditCost = cost` and return.
6. **On failure** (any throw, a timeout or a non-2xx):
   - refund with
     `UPDATE … SET "aiCreditsUsed" = GREATEST("aiCreditsUsed" - $cost, 0) WHERE "id" = $org AND "aiCreditsPeriod" = $reservedPeriod`;
   - log with `success = false` and `creditCost = 0`;
   - refuse `AI_PROVIDER_FAILED`.

**Why the refund is keyed by the reserved period:** if a month boundary passes
during the call, the old period's usage is gone, so there is nothing to refund.
Refunding into the new period would wrongly give credits back.

**Overage stays off.** `overageEnabled` is never read. The service refuses at
zero whatever the toggle says (decision D9 asks what to do with the toggle on
the screen).

**Known gap (R10):** a process that dies between step 3 and step 5 keeps the
reservation, so the tenant loses that one call's credits. It is accepted
deliberately: a reconciler for it would cost far more than the credits it
recovers.

---

## 3. Refusals (Q3) and the organisation switch

There is one exception class, `AiRefusalException`
(`foundation/ai/ai-refusal.ts`). It has the same shape as
`StorageRefusalException` (`file-storage/storage-refusal.ts:119-140`): the
body is `{ statusCode, message, error, code, ...details }`. The frontend maps
the CODE and never the English message. The statuses follow the closest
storage precedent so the two families agree.

| Code | HTTP | When | Precedent |
|---|---|---|---|
| `AI_NOT_ENABLED` | **409** | `aiMonthlyCredits = 0` (AccreditMe has allocated nothing), or `settings.ai.enabled === false` | `STORAGE_NOT_CONFIRMED` 409 (`storage-refusal.ts:46`): "not set up for you" |
| `AI_CREDITS_EXHAUSTED` | **409** | An allowance exists, but `used + cost > allowance` this period. Details: `creditCost`, `creditsRemaining`, `renewsOn` (first day of the next period) | `STORAGE_QUOTA_EXCEEDED` 409 (`:54`) |
| `AI_PROVIDER_UNAVAILABLE` | **503** | No platform key configured. **This is Railway today** | `STORAGE_NOT_CONFIGURED` 503 (`:50`) |
| `AI_PROVIDER_FAILED` | **502** | The provider was called and failed. The reservation is refunded | `STORAGE_UNAVAILABLE` 502 (`:53`) |
| `AI_FEATURE_NOT_PRICED` | **503** | No `AiFeatureCost` row for the feature. This is our configuration error, logged at `error` | — |

**Neither 409 is 403.** A 403 already means "you lack a permission" across the
app (ACC-101 asserts on 403 messages), and an administrator told they lack a
permission goes off to ask for one. These are states of the organisation, not
permissions of the person.

**The switch:** AI is on for an organisation when `aiMonthlyCredits > 0` **and**
`settings.ai.enabled` is not `false`.
- An absent `enabled` counts as on, so an allocation alone turns AI on, as the
  ticket requires ("an organisation has AI only when AccreditMe has allocated it
  credits").
- `enabled: false` is honoured when present. Nothing writes it until the tenant
  AI settings page exists.
- The mapper's `ai.enabled` (`tenant.service.ts:207`, today `?? false`) reports
  this **effective** value (D13).

---

## 4. Monthly reset job (Q4)

- **Queue `ai-credits`, processor `AiCreditsResetProcessor`.** It is registered
  only behind `workersEnabled()` (`common/queue/workers.config.ts:60-62`), in
  the same `...(workersEnabled() ? [X] : [])` form as
  `file-storage.module.ts:42`. It is added to `WORKER_QUEUES`
  (`workers.config.ts:53`), and `check:worker-gate` proves the registration.
- **Schedule:** a repeat every **hour**, added in `onModuleInit` with a fixed
  `jobId`, the same pattern as `storage-purge.processor.ts:41-43`.
  - It runs hourly rather than as a cron on the 1st, so a deploy, a worker
    restart or Redis being away at midnight on the 1st delays the reset by at
    most an hour instead of a month.
  - Each tick is one `UPDATE`.
- **What a tick does:**
  - The update:
    `UPDATE "Organization" SET "aiCreditsUsed" = 0, "aiCreditsPeriod" = $current WHERE "aiCreditsPeriod" IS NOT NULL AND "aiCreditsPeriod" <> $current RETURNING "id", "aiCreditsPeriod" AS previous`.
  - Then one `AuditLog` row per organisation reset (`event: 'ai_credits_reset'`,
    with the previous period and the used count). `actorId` is optional
    (`common/services/audit-log.service.ts:27`), so a system row is allowed.
- **Which organisations:** only those whose stored period is an earlier month.
  - An organisation that has never used AI has a null period and zero used, so
    there is nothing to reset and it is left alone.
  - The allowance (`aiMonthlyCredits`) is never touched: the allocation persists
    month to month (D3).
- **Idempotent, and two workers cannot double-reset:**
  - The `WHERE` matches only stale periods. The first update moves the period
    to the current month, so a re-run, or a second worker in the same second,
    matches zero rows.
  - **It cannot reset mid-month:** `$current` is computed from the clock at run
    time, so a row already in the current period never matches.
- **What it does to existing balances on the first run after deploy:
  nothing.**
  - Every organisation has `aiCreditsPeriod = NULL` (a new column), and
    `settings.ai` is absent on all three, so no balance exists to carry over or
    lose.
  - The first run matches zero rows. That is the expected first-run result, and
    it is logged as "0 organisations reset".
- **Not where workers are off** (local, `RUN_WORKERS` unset): no job runs, and
  nothing is wrong. The reservation (§1.4) and the mapper (§1.3) already treat a
  stale period as zero used. The job only makes the stored numbers match.
- **The period clock: a UTC calendar month (D2, recommended).** "Renews on" is
  the 1st, 00:00 UTC, which is 03:00 in Riyadh. Using each tenant's own zone
  would make a platform-wide reset a per-tenant schedule, for a difference of
  three hours.

---

## 5. Removing the tenant's own key (Q5)

- **Count: 0** organisations have a stored `aiConfig` (§0).
- **No write path exists:** `aiConfig` is read only at `tenant.service.ts:234`.
  Nothing in `backend/src` writes it.
- **The change:**
  - delete `resolveApiKey()`'s tenant branch (`anthropic-ai.provider.ts:112-125`)
    and the decrypt imports with it;
  - the key comes only from the platform's `ANTHROPIC_API_KEY`;
  - an empty or absent key is `AI_PROVIDER_UNAVAILABLE` (§3) and is never sent.
- **The stored value: leave it untouched (D8, recommended).** There is nothing
  to clear, because the count is zero, so no write to the shared database is
  needed. Dropping the column is a later contract step (ACC-127), once nothing
  reads it. `GET /tenant/config` keeps reporting `aiConfig: 'set' | null` until
  then.
- **If the count were ever non-zero:** clearing it waits for Ahmad's yes, as
  this brief requires. The code would already ignore it, so leaving it in place
  is safe.

---

## 6. Logging (Q6)

**The migration adds these fields to `AiInteractionLog`, all nullable, so rows
written before the deploy stay valid:**

| Field | Type | Written |
|---|---|---|
| `creditCost` | `Int?` | Credits charged: the feature's cost on success, **0** on a failed or refunded call |
| `provider` | `AiProvider?` | The **existing** enum (`schema.prisma:360`), so no new enum and no new value |
| `tier` | `String?` | `'STANDARD'` for every call in this ticket. A string, not an enum, because the ticket allows no new enum and tiers are out of scope in use |
| `inputTokens` / `outputTokens` | `Int?` | From the provider's `usage` (D7) |

**Logging the prompt text: the recommendation is to stop logging customer text
(D5).**
- Today `promptSummary` is the first 200 characters of the prompt (`:90`) and
  `responseSummary` the first 200 of the answer (`:91`).
- For `document_summary` that is the customer's document text, and its summary,
  copied into a platform log:
  - the customer cannot delete it;
  - it is outside the file's own recycle-bin and purge rules (ACC-177);
  - it outlives the file.
- For the morning briefing it is a list of the user's work.

**What gets logged instead, for every feature:**
- `promptSummary` is a **description supplied by the caller**, never a slice of
  the prompt. For example:
  `document_summary · StoredFile cmv… · 18,240 characters in`.
- `responseSummary` is `"<n> characters out"`.
- The tokens, the model, the cost, the actor and the time.

This still satisfies "every AI interaction logged: prompt, model used,
response, actor, timestamp" as an audit of **what was done**. What was said is
recorded where the person accepted it: the AI pattern is suggest → review →
approve, and the approved text lives on the record it was approved for.

---

## 7. The model (Q7)

**Confirmed against Anthropic's models overview on 12 Oct 2026**
(`platform.claude.com/docs/en/models/overview`):

| Model | API ID | Price per million tokens (in / out) |
|---|---|---|
| Opus 5.5 | `claude-opus-5-5` | $4 / $20 |
| Sonnet 5.5 | `claude-sonnet-5-5` | $2 / $10 |
| Haiku 5.5 | `claude-haiku-5-5` | from $0.10 / $0.50 |
| Fable 5.1 | `claude-fable-5-1` | $10 / $50 |

- **The hard-coded `claude-sonnet-4-6` is now a LEGACY model.**
- **This is confirmed again at build time**, as the ticket says, and the
  commit message records the date.

**The config: `foundation/ai/ai.config.ts`, the one place a model is named.**

```ts
resolveModel('ANTHROPIC', 'STANDARD') // env ANTHROPIC_MODEL_STANDARD, else 'claude-sonnet-5-5'
resolveModel('ANTHROPIC', 'PREMIUM')  // env ANTHROPIC_MODEL_PREMIUM,  else 'claude-opus-5-5' (configured, unused)
```

- `AiCompletionOptions.model` (`ai.provider.ts:9`) is **removed**. A caller
  picks a feature, and the feature has a tier. A caller can never choose a model
  (CLAUDE.md: "a tenant admin selects a QUALITY TIER … never a specific model").

**Default proposed: `claude-sonnet-5-5` for Standard (D6).**
- Arabic summaries and drafting are quality-sensitive, and Sonnet is half Opus's
  price.
- Haiku 5.5 is the candidate to make drafting cheaper later. That is a config
  change, not code.

**Two build-time checks, because the 5.x models changed the request:**
1. **Thinking is adaptive and on by default** (Sonnet 5.5's default effort is
   `high`). Thinking tokens are billed as output and count against
   `max_tokens`.
   - Each feature sets its effort explicitly. Drafting and briefing use `low`
     and summary uses `medium`, unless testing says otherwise.
   - Each feature sets a `max_tokens` that leaves room for thinking.
2. **Whether `temperature` is still accepted** with adaptive thinking. The
   provider sends it when given (`:56-58`). If it is not accepted, the provider
   stops sending it.

---

## 8. Feature costs (Q8). Ahmad decides

The arithmetic uses Sonnet 5.5 at $2 / $10 per million tokens, with thinking at
the efforts in §7.

| Feature | Input tokens | Output tokens (incl. thinking) | Our cost per call |
|---|---|---|---|
| `task_description_drafting` | ~1.5k (instructions + the note + record context) | ~1k | ≈ $0.013 |
| `morning_briefing` | ~6k (the user's open work) | ~2k | ≈ $0.032 |
| `document_summary` | **capped at 30k** (about 20 pages) | ~2.5k | ≈ $0.085 worst case |

The ratio is about **1 : 2.5 : 6.5**. CLAUDE.md's credit table already lists
`task_description_drafting: 2` and `morning_briefing: 5`, and those numbers
match the ratio.

**Proposed (D4):**
- `task_description_drafting` **2**: keep CLAUDE.md's number.
- `morning_briefing` **5**: keep CLAUDE.md's number.
- `document_summary` **15**:
  - 6.5 × the drafting cost is 13;
  - rounded **up**, because CLAUDE.md's pricing rule calibrates against the
    worst case, and the worst case is a document at the 30k cap;
  - 15 sits inside CLAUDE.md's MEDIUM band (5–20).

**The 30k input cap belongs to ACC-193.** Whether it truncates the input or
refuses is that ticket's call, but the cost assumes it.

**Seeding the rows (D12, recommended):** an idempotent
`npm run seed:ai-feature-costs`.
- It creates each row only if it is absent and **never overwrites** a cost
  someone has changed.
- It runs after the deploy.
- The platform admin's AI feature costs screen can then adjust them. That
  screen already exists (ACC-79's rail).

**Sizing note for whoever sets allowances (R4):** the briefing is per user per
working day. 50 users × 22 days × 5 credits is **5,500 credits a month** from
the briefing alone, which dwarfs every other feature. Allowances, or the
briefing's cost, should be set with that in view.

---

## 9. The zero-balance notice (Q9)

**Trigger: once per period, at the first of these:**
- a reservation that leaves `creditsRemaining` below the **cheapest active
  feature cost**, so nothing can run any more;
- or a refusal with `AI_CREDITS_EXHAUSTED`.

This catches "1 credit left" too, not only exactly 0. CLAUDE.md's step 7 says
`= 0`, but with costs of 2, 5 and 15, a balance of 1 is just as spent (D10).

**Once per period, by claim:**
```sql
UPDATE "Organization" SET "aiCreditsNoticePeriod" = $period
WHERE "id" = $org AND "aiCreditsNoticePeriod" IS DISTINCT FROM $period
```
This is `updateMany` returning a count. **Only the call that moves the value
sends**, the same shape as `storageWarnedAt` (`file-storage/stored-file.service.ts:190-205`,
send at `:200`). A new period makes the notice sendable again, with no reset
needed.

**The existing notification path:**
- An `AiNoticesService.creditsUsedUp()` modelled on
  `StorageNoticesService.storageAlmostFull()`
  (`file-storage/storage-notices.service.ts:40-64`).
- It goes to the organisation's ACTIVE holders of an active `TENANT_ADMIN`
  role, in-app, in English and Arabic, through `NotificationService`, with
  `objectType: 'Organization'`.
- It is sent **after** the reservation commits. A failure to send is logged and
  never refunds or blocks anything.

**The words:**
- **Title:** "AI credits used up" / «نفدت أرصدة الذكاء الاصطناعي».
- **Body:** "Your organization has used all its AI credits for {month}. They
  renew on {date}." /
  «استخدمت مؤسستك جميع أرصدة الذكاء الاصطناعي لشهر {month}، وتتجدد في {date}.»
- The dates are server-built text: the known ACC-95 limitation.

It is an **event**, so it goes to the bell (ACC-82). There is no Setup health
condition, because running out is the expected end of a month, not a
configuration gap.

---

## 10. The shape of the code

### 10.1 One gateway, enforced

- **New `foundation/ai/`:**
  - `AiModule`;
  - `AiService` (the gateway, `run(featureKey, organizationId, actorId, request)`);
  - `AiCreditService` (the reserve, refund, reset and notice claim, as raw SQL);
  - `AiNoticesService`;
  - `ai-refusal.ts`;
  - `ai.config.ts`;
  - `AiCreditsResetProcessor`, gated.
- **The `AI_PROVIDER` binding moves** from TenantModule (`tenant.module.ts:31,39`)
  into `AiModule` and is **not exported**. Only `AiService` is exported.
- **`AnthropicAiProvider` is reduced to one thing: make the call.** It loses:
  - the tenant key;
  - the database access (no `PrismaService`);
  - the logging;
  - model choice.

  It takes `{ model, maxTokens, effort, systemPrompt, prompt }` and returns the
  content and usage. The gateway logs, because the gateway knows the cost.
- **A new backend scan, `check:ai-gateway`.**
  - It fails if `AI_PROVIDER` or `AnthropicAiProvider` is referenced outside
    `foundation/ai/` and `providers/ai/`, so a future feature cannot bypass
    metering by injecting the provider.
  - It keys off the symbol, not a list of files (ACC-120's "predicate, not
    allowlist").
  - CI discovers it automatically (`ci.yml` discovers `check:*`).
- **The commented stub** at `lookup.service.ts:550` is updated to name
  `AiService`, so it does not teach the bypass.

### 10.2 Reads and writes moved to columns

- `tenant.service.ts:169-213`: `mapToITenant` derives the same `ai` object
  from columns plus `settings.ai.enabled`/`overageEnabled`:
  - `monthlyCredits`;
  - `creditsUsed`, which is 0 when the period is stale;
  - `creditsRemaining`;
  - `resetDate`, the next 1st;
  - `enabled`, the effective value.

  The frontend contract is unchanged.
- `platform-tenant.service.ts:94-110`: the same derivation for the platform
  tenant detail.
- `platform-tenant.service.ts:234-249`: `allocateAiCredits` writes
  `aiMonthlyCredits` and still merges `overageEnabled` into settings when sent.
  It stops writing `monthlyCredits`, `creditsUsed` and `creditsRemaining` into
  the JSON.

### 10.3 Migration (additive only)

One migration, `add-ai-metering-columns`:
- the four `Organization` columns (§1.3), defaulted or nullable;
- the five `AiInteractionLog` fields (§6), all nullable.

It has no `DROP`, no rename, no new enum and no new enum value.

**It is safe for the old container that is still serving during the
pre-deploy migration (ACC-127).** That container's Prisma client never selects
columns it does not know, and the shared database has no data in the old
`settings.ai` keys to strand.

**It is NOT applied to the shared database before the PR deploys** (this
brief's rule). Locally it is generated with `--create-only`, and CI applies it
to its own ephemeral Postgres (`ci.yml:136-141`).

---

## 11. Tests and the live proof (Q11)

**Unit tests, with the provider mocked:**
- `AiService`:
  - the order of §2;
  - every refusal code with its status and details;
  - unavailable is refused before reserving;
  - a failed call is refunded and logged with `creditCost: 0`;
  - the log carries cost, provider, tier and tokens;
  - **no customer text in the log** (asserted against a prompt containing a
    marker string);
  - an unpriced feature is refused.
- `AiCreditService`: the SQL text and its parameters. This is weak on its own,
  and the database spec below is the real proof.
- The reset processor and its gate (`check:worker-gate` plus a spec), the notice
  claim (once per period), the mapper derivation (stale period reads as zero
  used) and allocate writing the column.

**A concurrency spec against a real database: new `npm run test:db`.**
- Jest with `testRegex` `\.db-spec\.ts$`, against the CI job's ephemeral
  Postgres.
- It runs as a **new CI step after `prisma migrate deploy`** (`ci.yml:136-141`).
  Today `npx jest` runs *before* migrations (`ci.yml:134`) and has no database.
- **It fails rather than skips without `DATABASE_URL`**, because a spec that
  silently skips is ACC-120's vacuous pass.
- **What it proves:**
  1. **Concurrent calls cannot overspend:** an allowance of 100, 50 concurrent
     reservations of 3 → **exactly 33** succeed, and `aiCreditsUsed = 99`.
  2. **A settings write cannot erase a deduction:** while the reservations run,
     concurrent `updateTenantModules`-style read-modify-writes of `settings`
     leave `aiCreditsUsed` exactly as the successful reservations made it.
  3. **The reset cannot double-run:** two concurrent reset ticks → one update,
     one no-op.
  4. **A refund is keyed by period:** a refund after the period moved changes
     nothing.

**Tenant isolation:** every reservation, refund and claim is keyed by the
organisation's own id. Specs named with the gate's exact string
`should NOT return records belonging to a different tenant` (the ACC-44 lesson)
assert:
- org B is untouched by org A's reservation and refund;
- the log row carries org A's id;
- the notice goes only to org A's admins.

**Local verification limit:** Docker is not installed here, so the database
spec runs in CI only. That is stated in the report rather than implied green
locally.

**The live proof: AFTER the PR deploys (R2),** because the new columns must not
reach the shared database before the deploy, and there is no local Postgres. It
is a **STOP 2**, like ACC-185's post-deploy run.
1. `npm run seed:ai-feature-costs` (dry run first).
2. As the platform admin, allocate al-nakheel **20** credits on its tenant
   record (the existing screen or API).
3. A scratchpad script, run from a local backend at the merged commit with
   `RUN_WORKERS` unset, calls `AiService.run('task_description_drafting', …)`
   in-process for al-nakheel. The key is read from the local `.env` and never
   printed.

   **What it checks:**
   - one real answer;
   - `aiCreditsUsed = 2`;
   - one `AiInteractionLog` row with `creditCost 2`, `provider ANTHROPIC`,
     `tier STANDARD`, tokens, and no prompt text;
   - a refusal with `AI_CREDITS_EXHAUSTED` once the allowance is spent by
     setting the allowance to 2;
   - the notice sent once.
4. **Restore al-nakheel to its starting values:**
   - `aiMonthlyCredits = 0`, `aiCreditsUsed = 0`;
   - `aiCreditsPeriod = NULL`, `aiCreditsNoticePeriod = NULL`;
   - `settings.ai` absent, as measured in §0;
   - the notice deleted from the admins' bells.
5. **The `AiInteractionLog` row stays.** It is the record of a real call. The
   report names it.

---

## 12. Frontend: the shared refusal helper (Q10)

**`frontend/src/app/core/ai/ai-refusal.ts`**, beside
`core/http/refusal.ts` and built on its `refusalCode()` / `refusalBody()`
(`core/http/refusal.ts:16-26`).

```ts
export type AiRefusalKind = 'notEnabled' | 'creditsUsedUp' | 'unavailable';
export interface AiRefusal { kind: AiRefusalKind; messageKey: string; params: Record<string, string> }
export function aiRefusal(err: unknown, format: FormatService): AiRefusal | null;
```

- `AI_NOT_ENABLED` maps to `notEnabled`.
- `AI_CREDITS_EXHAUSTED` maps to `creditsUsedUp`, with `renewsOn` formatted by
  `FormatService` (ACC-94 rules: Latin digits, the user's calendar).
- `AI_PROVIDER_UNAVAILABLE`, `AI_PROVIDER_FAILED` and `AI_FEATURE_NOT_PRICED`
  map to `unavailable`.
- Anything else returns `null`, and the caller shows its usual error.

| Key | English | Arabic |
|---|---|---|
| `ai.refusal.notEnabled` | AI isn't turned on for your organization. Ask your administrator. | الذكاء الاصطناعي غير مفعّل لمؤسستك. تواصل مع مسؤول النظام. |
| `ai.refusal.creditsUsedUp` | Your organization has used all its AI credits for this month. They renew on {{date}}. | استخدمت مؤسستك جميع أرصدة الذكاء الاصطناعي لهذا الشهر. تتجدد في {{date}}. |
| `ai.refusal.unavailable` | AI isn't available right now. Try again later. | الذكاء الاصطناعي غير متاح حاليًا. حاول مرة أخرى لاحقًا. |

The helper has a spec and no consumer yet. ACC-193, ACC-197 and ACC-198 are its
first callers. The parameter is named `date`, not `count`, so the
translation-keys spec's plural check does not flag it.

---

## 13. Decisions for Ahmad

| # | Decision | Recommendation |
|---|---|---|
| **D1** | Where the counters live | **Dedicated `Organization` columns, in the one additive migration (recommended)**, over a row lock plus `jsonb` update, which would need all six settings writers changed (§1) |
| **D2** | The period clock | **UTC calendar month (recommended)**, renewing on the 1st at 00:00 UTC. Alternative: each tenant's working-calendar zone |
| **D3** | What the reset restores | **The tenant's own allocation (`aiMonthlyCredits`), which persists month to month (recommended)**. Not `Plan.aiCreditsPerMonth`: no plans exist, and the ticket makes the platform tenant record the source. CLAUDE.md's "Monthly BullMQ job" lines get corrected |
| **D4** | Credit costs | **`task_description_drafting` 2, `morning_briefing` 5, `document_summary` 15 with a 30k-token input cap (recommended)** (§8) |
| **D5** | Prompt and response text in `AiInteractionLog` | **Stop logging customer text for every feature, and log a caller-supplied description, sizes and tokens instead (recommended)**. Alternative: keep the 200-character slices |
| **D6** | Default model | **`claude-sonnet-5-5` for Standard (recommended)**, configurable through `ANTHROPIC_MODEL_STANDARD`. Premium is mapped to `claude-opus-5-5` but unused |
| **D7** | Token counts on the log | **Add `inputTokens` and `outputTokens` (recommended)**: they are what reconciles our cost, and CLAUDE.md asks for "accurate cost reconciliation" |
| **D8** | The stored own-key column | **Leave untouched (recommended).** The count is 0, so there is nothing to clear. Drop the column in a later contract step |
| **D9** | The overage toggle on the tenant's AI credits screen | **Hide it (recommended)**: it promises a behaviour that does not exist, and the service ignores it. A one-line template change. Alternative: leave it and document it |
| **D10** | When the "credits used up" notice fires | **When nothing can run any more, or at the first refusal, once per period (recommended)**, rather than only at exactly 0 |
| **D11** | A database-backed concurrency spec in CI | **Yes: a `test:db` step after migrations, failing without a database (recommended)** |
| **D12** | How the three `AiFeatureCost` rows arrive | **An idempotent seed script run after deploy, never overwriting (recommended)**. Alternative: entered by hand on the platform screen |
| **D13** | What `ai.enabled` reports on `GET /tenant` | **The effective value: allocated and not switched off (recommended)**. Today it reports `?? false` |

---

## 14. Risks

- **R1.** The settings writers still race each other (§1.5). The counters are
  out of that race, but modules, task SLA, overage and bootstrap can still lose
  each other's writes. **Recommended:** a separate Low ticket (per-key
  `jsonb_set`).
- **R2. The live proof cannot run before the deploy.** The migration must not
  reach the shared database first, and there is no local Postgres (Docker is not
  installed). The proof is a post-deploy STOP 2. **Until then the concurrency
  proof is the CI database spec only.**
- **R3. Production refuses every call until ACC-193 adds a key.**
  `ANTHROPIC_API_KEY` stays off Railway, as instructed. After deploy, every
  production call refuses `AI_PROVIDER_UNAVAILABLE`, which is correct and is
  what the frontend helper is for. It is also why the live proof runs from a
  local backend.
- **R4. The morning briefing's volume** dominates any allowance (§8).
- **R5. 5.x request semantics** (adaptive thinking billed as output, and
  `temperature`): verified at build. A wrong `max_tokens` would truncate
  answers, and a missing effort would roughly double the cost.
- **R6. CLAUDE.md is wrong in three places this ticket touches.** It is fixed in
  the docs step:
  - the "AI Runtime Flow" (deduct after the call; `creditsRemaining` stored;
    notice at exactly 0);
  - "Organization AI Settings" (the counters in JSON);
  - "Monthly BullMQ job" (reset to the Plan value).
- **R7. The provider's error message includes Anthropic's response body**
  (`anthropic-ai.provider.ts:71-72`). That body does not contain our key, but
  the new gateway logs only the status and Anthropic's error type, never the
  body, so nothing customer-derived reaches stdout either.
- **R8. Expand-then-contract.** The old `settings.ai` credit keys become dead
  keys. None exist in data (§0), so the contract step is code-only:
  - nothing writes them after this ticket;
  - the `OrgSettings` / mapper types drop them;
  - nothing on the database needs contracting except `aiConfig` (D8).
- **R9. The worker gate's startup log** (`workers.config.ts:99-102`) lists what
  a disabled process does not run. The AI reset is added to that sentence, so a
  deployment with workers off says so.
- **R10. A crash mid-call keeps the reservation** (§2). This is accepted
  deliberately.

---

## 15. Build order (one commit each)

**Progress:**

- [ ] 0a. `docs(plans)`: this plan
- [ ] 0b. `docs`: CLAUDE.md file storage corrected (separate commit, requested on 12 Oct)
- [ ] 1. `chore(prisma)`: migrate — add AI metering columns (`--create-only` locally; CI applies it)
- [ ] 2. `feat(ai)`: config (models by tier), refusal codes, with specs
- [ ] 3. `feat(ai)`: credit service (reserve, refund, reset, notice claim) with unit specs and the CI `test:db` concurrency spec
- [ ] 4. `feat(ai)`: the gateway and the slimmed provider (platform key only, no customer text logged), `AiModule`, the `check:ai-gateway` scan
- [ ] 5. `feat(tenant)`: the AI balance read from the columns, and allocate writes the allowance column
- [ ] 6. `feat(ai)`: monthly reset processor behind the worker gate
- [ ] 7. `feat(ai)`: the "credits used up" notice, once per period
- [ ] 8. `chore(ai)`: idempotent seed for the three feature costs
- [ ] 9. `feat(ai)`: the shared frontend refusal helper and its words, plus D9 if yes
- [ ] 10. `docs`: SYSTEM-REFERENCE AI section, CLAUDE.md AI Runtime Flow / Org AI settings / reset, Key Architecture Decisions (ACC-194)
- [ ] STOP 1: lint, typecheck, tests, scans; report
- [ ] After deploy, STOP 2: seed, live call on al-nakheel, restore, report
