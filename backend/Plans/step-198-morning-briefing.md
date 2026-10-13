# Step 198 — AI morning briefing, on demand (al-nakheel only for now)

Linear: **ACC-198** (lane B for this build; High for the demo).
Branch: `feature/ACC-198-morning-briefing`, from `origin/dev` at `6505a15`.
Status: **APPROVED (`c1e29f0`), being built.** Ahmad decided D1–D12 as
recommended and added D13 (13 Oct, §11). On 13 Oct he also confirmed that
`ANTHROPIC_API_KEY` is set on Railway, so the live proof runs on the LIVE site
after the deploy (§8).

**Sources:**
- the ticket, as updated on 12 Oct;
- ACC-194's foundation (merged as `4aa860c`, live on dev: al-nakheel has 2,000
  credits, and `morning_briefing` costs 5 and is restricted to al-nakheel);
- **the drawing `frontend/design-reference/AccreditMe AI for Users.dc.html`
  (accepted 10 Oct)**, read in full: the am-ai-assist pattern (§1 of the
  drawing) and the Home briefing (§4). It wins on anything visual.

**Ahmad's later decision changes the TRIGGER.**
- The briefing is never made automatically.
- It is made only when a **tenant admin presses a button on Home**, only where
  `morning_briefing` is open, at **5 credits per run**.

Every place where the drawing assumes "made once per working day at first
open" is listed in §11 as a question.

---

## 0. What exists today

| Fact | Evidence |
|---|---|
| Home is the post-login landing page, open to every signed-in user, with no permission guard | `frontend/src/app/app.routes.ts:46`; `foundation/home/home.component.ts:15-38` |
| Home shows two self-scoped panels: **My tasks** (open tasks) and **Notifications** (newest 5). Both fail quietly, never with an error banner | `home.component.ts:53-120`, `:158-193` |
| The page header greets by name (`home.greeting`) | `home.component.ts:48-51` |
| Self-scoped data sources the briefing can use. None needs a permission; all are built from who the caller is | **My tasks:** `TaskService.getMyTasks()` (`backend/src/foundation/task/task.service.ts:381`, `GET /tasks/my-tasks`, `task.controller.ts:93`). **Pool tasks I could pick up:** `getAvailableToPick()` (`task.service.ts:443`, `task.controller.ts:111`). **Waiting for my decision:** `TaskRequestService.awaitingDecision()` (`task-request.service.ts:463`, `task.controller.ts:203`). **My notifications:** `GET /notifications?status=UNREAD` (`notification.controller.ts:7-22`) |
| "Today" is the tenant's day | `WorkingCalendarService.getEffectiveTimeZone()` (`working-calendar.service.ts:99-105`, ACC-94 D3) |
| The gateway, feature switch, refusals and log | `AiService.run('morning_briefing', …)` (`backend/src/foundation/ai/ai.service.ts`). Per-feature call settings: `ai.config.ts:45` (`morning_briefing`: effort `low`, `maxTokens` 3000) |
| The frontend refusal helper | `frontend/src/app/core/ai/ai-refusal.ts` (`aiRefusal(err, format)`) |
| `tenant:manage_config` | `common/constants/permissions.ts:4` |
| Who holds `tenant:manage_config` | **TENANT_ADMIN**, through `ALL` (`foundation/roles/role.seed.ts:65-70`), and PLATFORM_ADMIN. No other seeded role. It is the AI credits screen's own gate (`core/navigation/nav-items.ts:279`) |
| `GET /tenant` needs `tenant:view` | `tenant.controller.ts:35-39` |
| **No deep link to a task row on My tasks.** The bell does not link notifications to records either | `foundation/tasks/components/my-tasks/` has no `?task=`. `notification-bell.component.ts` only marks read (`:124`) |
| My tasks already shows "Waiting for your decision" (the request inbox) | `my-tasks.component.ts:128-140` |
| Notification object types in use | `Task` (most), `TaskRequest`, `COMMITTEE`, `Organization`, `User`, … (counted from `objectType: '…'` in `backend/src`) |
| The drawing's "accepted Home" panels are **My tasks** and **Awaiting my action**; the built Home has **My tasks** and **Notifications** | drawing `briefings` (`panels()`), against `home.component.ts:53-120` |

---

## 1. Where it sits (Q1)

**The card is a new card above the two panels, full content width**, exactly
where the drawing puts it ("Above the accepted Home panels, full content width",
and "the panels keep their size and order"). It goes inside
`home.component.ts`, between the page header (`:48-51`) and the panel grid
(`:53`).

**The card has three faces:**

| Face | When | What it shows |
|---|---|---|
| **Button only** | Allowed (§2) and nothing made today | A short line and the trigger `✦ Prepare my briefing`. It looks like the drawing's idle trigger: spark plus words, never an icon alone |
| **Working** | After the press | The drawing's working card: the tag "Your briefing · being prepared", the text "Preparing your briefing…" with pulsing lines, and the trigger reading "Working…". The panels below stay live, so nothing waits on AI |
| **The briefing** | Made today | The drawing's busy-day or quiet-day card: a greeting, the tag "Your briefing · made by AI at 07:40 from your tasks and notifications", the lead, the groups with linked items, and "Show the full list". **Plus** a secondary trigger, "Make a new briefing" (§4, D3) |

**Where AI is not available, Home is exactly as today:** no card, no button, no
error. That covers:
- a user without the permission;
- an organisation without the feature;
- AI not enabled, or no allocation.

This follows the drawing ("Never an error on Home"; Denied: "AI off: no card at
all").

---

## 2. Who may press it (Q2)

**`tenant:manage_config`.**
- No new permission.
- It is the AI credits screen's gate (`nav-items.ts:279`), and among seeded
  roles only TENANT_ADMIN holds it in a tenant (`role.seed.ts:65-70`).
- It is part of the root role's frozen set (ACC-120), so every tenant always
  has someone who can press it.
- A custom role granted `tenant:manage_config` can press it too. That is the
  existing permission model, not a special case.

**The button shows only when ALL of these are true** (§6, worked out on the
server, so the frontend never guesses):
1. the user holds `tenant:manage_config`;
2. `morning_briefing` is open to the organisation (ACC-194 D17: restricted to
   al-nakheel);
3. AI is on for the organisation: an allocation, and not switched off (D13).

**Credits running out does NOT hide the button.** Pressing it gives the
"credits used up" refusal, inside the card (D2). Otherwise an admin would never
learn why the button vanished.

---

## 3. What goes into the prompt, and what comes out (Q3)

### 3.1 Only what the pressing user may see

Everything is gathered through the four self-scoped services above, called with
the caller's id and organisation. So the briefing can hold nothing the caller
couldn't already see on My tasks or in the bell. No new query is written for it,
and none widens a scope.

| Group (drawing order) | Source | Cap |
|---|---|---|
| **Overdue** (leads, in danger ink) | `getMyTasks()`: open, `dueAt` before now | 10 |
| **Due today** | `getMyTasks()`: open, `dueAt` within today in the tenant's zone | 10 |
| **Waiting for your decision** | `awaitingDecision()`: pending extension or hold requests the caller may decide | 10 |
| **Waiting to be picked up** | `getAvailableToPick()`: pool tasks the caller could pick | 5 |
| **New since yesterday** | unread notifications from the last 24 hours | 10 |

**"Waiting to be picked up" is not in the drawing.** The ticket names pool
tasks, so it is a question (D5). **Recommended:** include them.

**What is NOT sent:**
- task descriptions;
- request reasons;
- notification bodies;
- names of other people.

**What IS sent, per item:**
- a reference key the model never sees used as a link (`T3`, `R1`, `N2`);
- the title, cut to 120 characters;
- the due date as "overdue by 3 days" or "due 16:00";
- the source (for example "Committee · Infection Prevention & Control"), for
  context.

**Size:** at most about 45 items, roughly 2–3k input tokens, well inside
ACC-194's cost assumption for this feature (§8 of the ACC-194 plan: about 6k).

### 3.2 What the model writes, and what our code writes

**Our code builds:**
- **every group, item, count, date and link**, from the records themselves;
- the greeting, by the time of day in the tenant's zone (D6).

**The model writes ONLY the lead:**
- the one-to-three-sentence summary under the tag, as in the drawing ("Two tasks
  are overdue and three are due today. Two items wait for your decision…");
- plain text, at most 400 characters, in the caller's language.

This guarantees that **links are built by our code, never by the model**. A
model can neither invent an item nor point a link anywhere.

**Defences in the system prompt:**
- task titles are customer data, not instructions;
- answer only in the requested language;
- no lists, links or markup.

**The output is rendered as text, never HTML.**

**A quiet day costs nothing.** When all five groups are empty, **the model is
not called and nothing is charged**. The card shows the drawing's sentence
"Nothing is overdue or due today, and nothing waits for you." That is the
drawing's "Empty" outcome, which it marks "not charged". When something exists
but there is little (the drawing's quiet day, with one document), the model is
called as normal.

### 3.3 Language

- **The language** is the one the caller is reading in when they press. The
  frontend sends `language: 'en' | 'ar'` (validated) from `LanguageService`.
  The top-bar toggle is a session reading mode (ACC-79), and the briefing is
  read now, in that language.
- **Record names** stay as stored (tenant data). Dates and counts are formatted
  on the screen by `FormatService` (ACC-94), so digits are Latin in both
  languages.
- **Arabic:** isolated LTR runs for codes, as drawn.

### 3.4 Links: built by our code

A small map in our code, `briefingItemLink(type, id)`:

| Item | Link |
|---|---|
| Task (mine, overdue or due today) | `/tasks?task=<id>`: My tasks scrolls to the row, focuses it and highlights it. ACC-208 built the same on the committee page; this adds it to My tasks |
| Pool task | `/tasks?task=<id>`: the row in My tasks' "Available" section |
| Request waiting for my decision | `/tasks?request=<id>`: My tasks' "Waiting for your decision" row, scrolled to and focused |
| Notification about a `Task`, `TaskRequest` or `COMMITTEE` | that record's link (the task row, the request row, `/committees/<id>`) |
| Notification about anything else | no link: the title as text |

A `?task=` for a task no longer on My tasks (completed, or reassigned) shows My
tasks as usual. It never errors, and the briefing item shows "done" (§4.2).

---

## 4. Saving, showing, pressing again (Q4)

### 4.1 Storage: one additive migration

```prisma
model AiBriefing {
  id              String    @id @default(cuid())
  organizationId  String
  userId          String
  language        String    // 'en' | 'ar' — the language it was written in
  lead            String    // the model's text, or the quiet-day sentence
  groups          Json      // the snapshot our code built: [{ kind, items: [{ type, id, title, meta }] }]
  creditCost      Int       // 5, or 0 for a quiet day
  generatedAt     DateTime? // when the current briefing was made
  generatingSince DateTime? // the in-flight claim (§5)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([organizationId, userId])
  @@index([organizationId])
}
```

**What is stored:**
- **One row per user**, holding the LATEST briefing. A new one replaces it.
  There is no history: a briefing is today's working aid, not a record, and the
  AI log already records each run.
- The lead is customer-derived text, so it lives in a **tenant-owned table**:
  deleted with the organisation (`onDelete: Cascade`), never the platform's AI
  log. The log keeps no text (ACC-194 D5).

**Safety:**
- **Expand only:** a new table, no change to any existing one.
- **Not applied to the shared database before the PR deploys.** It is generated
  against the local throwaway Postgres, as in ACC-194.

### 4.2 Showing it

**`GET /ai/briefing`:**
- self-scoped, no permission;
- returns `{ available, briefing }` for the caller only;
- **the briefing is returned only if `generatedAt` falls on today, in the
  tenant's zone** (D3). Yesterday's briefing about yesterday's work would
  mislead.

**The tag shows when it was made**, by `FormatService`: "made by AI at 07:40".

**Live "done" markers** (the drawing's Q6, answered: "Kept, with 'done' beside
it"). On each read, the stored item ids are re-checked in one query per type,
all scoped to the organisation:
- **task:** done once completed or cancelled;
- **request:** decided;
- **notification:** read.

The snapshot's wording never changes.

**Language mismatch:** a briefing made in Arabic and read in English is shown
as made, in Arabic, with the new trigger available (D4).

### 4.3 Pressing again

**"Make a new briefing"** sits on the briefing card and makes a new one at
**5 more credits**. Should it say so on the button? See D2.

**Recommended:** yes, a quiet "· 5 credits" after the label, for the admin
who presses it. The drawing's "credits appear once" rule was written for
ordinary users, and only a tenant admin can see this button.

---

## 5. One press never charges twice (Q5)

**The claim is ONE statement, on the user's row:**

```sql
INSERT INTO "AiBriefing" ("id", "organizationId", "userId", …, "generatingSince")
VALUES (…, now())
ON CONFLICT ("organizationId", "userId") DO UPDATE
  SET "generatingSince" = now()
  WHERE "AiBriefing"."generatingSince" IS NULL
     OR "AiBriefing"."generatingSince" < now() - interval '3 minutes'
RETURNING "id";
```

- **A row comes back:** this press owns the run.
- **No row comes back:** a run is already in flight, and the press is refused
  **`AI_BRIEFING_IN_PROGRESS` (409)**. The frontend never shows that state,
  because its own button is already "Working…".
- **When it is released:** at the end of every path (success, refusal, failure),
  through `generatingSince = NULL`.
- **If the process dies:** the claim goes stale after 3 minutes, comfortably
  above the provider's 120-second timeout (ACC-194), so a crashed run never
  locks the user out for long.

**The scope is per USER, not per organisation** (D7).
- The ticket said "one run in flight per organisation".
- Each briefing is the presser's own. Two admins in one organisation pressing at
  the same moment are two different briefings, each charged once, which is
  correct.
- What must never happen, one press charged twice, is a same-user event.

**Belt and braces on the frontend:** the button is disabled from the press
until the answer, so a double click sends one request.

**Proved against a real Postgres:** `test:db` gets a spec in which two
concurrent presses by one user make exactly one model call and one deduction.

---

## 6. The shared `am-ai-assist` component (Q6)

**`frontend/src/app/shared/components/ai-assist/ai-assist.component.ts`**,
built here so ACC-193 (Summarize) and ACC-197 (Draft with AI) reuse it. It is
the drawing's pattern §1, one component for every AI place.

### 6.1 Inputs and outputs

| Input | Meaning |
|---|---|
| `state` | `'idle' \| 'working' \| 'result' \| 'refusal'` |
| `triggerLabel` | The action's words ("Prepare my briefing", "Summarize", "Draft with AI"). Already translated |
| `againLabel` | The trigger's words once a result exists ("Make a new briefing", "Draft again") |
| `triggerNote` | Optional quiet text after the trigger (the "· 5 credits" of D2). Absent by default |
| `workingText` | "Preparing your briefing…" / "Reading 12 pages…" / "Drafting a description…" |
| `tag` | The result's tag line ("Your briefing · made by AI at 07:40…", "AI suggestion · check before using") |
| `refusal` | An `AiRefusal` from `aiRefusal(err, format)` (ACC-194), or null |
| `cancellable` | Shows Cancel while working (drawn for drafts; not used on Home) |
| `accept` | Shows Accept / Edit / Discard on a result (ACC-197). Not used on Home |
| `placement` | `'inline'` (beside a field's label, ACC-197), `'header'` (the viewer, ACC-193) or `'card'` (Home) |

| Output | When |
|---|---|
| `trigger` | Pressed (first time or again) |
| `cancel` | Cancel pressed while working |
| `retry` | "Try again" on a failure refusal |
| `accepted` / `edited` / `discarded` | The result's actions (ACC-197) |

**The result's content is projected** through `TemplateRef` +
`ngTemplateOutlet` (`resultTemplate`). It is never `ng-content`: the
EditDialogComponent finding (ACC-29) applies to anything that must re-render.

### 6.2 What it draws, from the drawing

- **Trigger:**
  - the spark `✦` (`aria-hidden`) plus words, never an icon alone;
  - a white button with a primary border;
  - while working, the mark becomes `◌` and pulses, and the text reads
    "Working…".
- **A result is marked four ways:**
  - the `✦` mark;
  - the tag words;
  - a **dashed rule on the inline-start edge**;
  - a light tint, never the only cue.
- **Refusals sit in the result area after a press.** They come from the
  helper's kind:
  - **credits used up:** "◔" with the renewal date;
  - **unavailable or failed:** "!" with **Try again** (the refusal box tinted
    red);
  - **not enabled / feature not available:** this cannot happen after a press
    on Home, because the button is hidden first (§2). The component still draws
    it, for the other places.
- **Announced:**
  - results and refusals arrive in a polite `aria-live` region ("Briefing
    ready");
  - focus moves to the result's region;
  - every action is reachable by Tab, in reading order.
- **Styling:** design tokens only (`design-tokens.scss`), with no literal colour
  (ACC-111), and RTL by logical properties.

### 6.3 What it does NOT do (stated for ACC-193 and ACC-197)

- **The drawing's "paused by AccreditMe" and "turned off by AccreditMe" lines
  are not built.** The platform has no pause switch and no "turned off by
  AccreditMe" state yet (ACC-194: only `settings.ai.enabled`, which nothing
  writes). The component has no input for them until one exists.
- **No API calls.** The host calls its own endpoint and sets `state`. That keeps
  the component free of feature logic, and keeps `check:ai-gateway`'s rule on
  the backend, where it belongs.

### 6.4 The refusal helper's words

ACC-194's helper says "…used all its AI credits for this period. They renew on
{{date}}." The drawing says "…for this month… Your administrator can add more."

**Recommended (D8): keep the helper's wording.**
- Periods are not calendar months (ACC-194 D2).
- No one can "add more": there is no purchase flow, and the platform allocates.
- The helper is shared, so all three AI places read the same.

---

## 7. The call (Q7)

`AiBriefingService.make(viewer, language)`:

1. Claim (§5).
2. Gather the five groups (§3.1).
3. **If they are empty:** save the quiet-day briefing at cost 0, release, and
   return.
4. Otherwise call `AiService.run('morning_briefing', { organizationId, actorId },
   { system, prompt, description })`. This uses `morning_briefing`'s effort
   (`low`) and output limit (3000) from `ai.config.ts:45`. Nothing in this
   ticket names a model, an effort or a limit.
5. **On an AI refusal:** pass it through unchanged
   (`AI_CREDITS_EXHAUSTED`, `AI_NOT_ENABLED`, `AI_PROVIDER_UNAVAILABLE`,
   `AI_PROVIDER_FAILED`), and keep the previous briefing.
6. **On success:**
   - trim the answer to 400 characters at a sentence boundary;
   - an empty answer falls back to a lead our code writes from the counts
     (still charged, because the provider was paid; see R4);
   - save, release, and return the briefing.

**The log `description`** (ACC-194 D5: no text) is counts only. For example:
`Home briefing · 2 overdue, 3 due today, 2 decisions, 0 pool, 1 notification`.

**Module:** `foundation/ai-briefing/`, with:
- `AiBriefingModule`, which imports `AiModule` (for `AiService`), `TaskModule`
  (for the three task services), and the global `NotificationModule`;
- `AiBriefingService`;
- `AiBriefingController`: `GET /ai/briefing` (self-scoped) and
  `POST /ai/briefing` (`@Permissions(tenant:manage_config)`), with body
  `{ language: 'en' | 'ar' }`.

**Availability** is computed on the server from:
- the permission;
- the open feature (`openAiFeatures()`, ACC-194);
- `aiBalanceOf().enabled`.

**`check:ai-gateway`** passes unchanged: the module uses `AiService`, never the
provider. **`check:worker-gate`** is unchanged: nothing is scheduled.

---

## 8. Tests and the live proof (Q8)

**Backend unit tests:**
- `AiBriefingService`:
  - **gathering** uses only the caller's id with the four self-scoped sources,
    and caps each group;
  - **the quiet day** makes no `AiService` call, at cost 0;
  - **the prompt** holds no description, reason or body (marker strings), and
    names the language;
  - **links and groups** are built by code: a model answer containing "links"
    changes nothing;
  - **refusals** pass through, and the previous briefing is kept;
  - **the claim** is taken and always released, including on a throw;
  - **the answer** is trimmed;
  - **"today"** is the tenant's zone;
  - **done markers** are re-checked live;
  - **isolation:** another organisation's or user's briefing is never
    returned, under the gate's exact test name.
- **Controller:**
  - `POST` carries `tenant:manage_config`, and `GET` none;
  - the DTO accepts `en` and `ar` only.

**`test:db`:**
- two concurrent `make()` calls for one user → one `AiService.run` (spied) and
  one row;
- a stale claim is taken over after 3 minutes;
- two users in one organisation → two runs.

**Frontend:**
- `ai-assist`:
  - every state;
  - the four marks;
  - the refusal kinds with Try again;
  - the live region;
  - RTL.
- **Home:**
  - **button visibility:** no permission / feature closed / AI off → no card,
    no error, no request beyond `GET /ai/briefing`, and not even that without
    the permission;
  - **the flow:** working → result; the quiet day; a refusal in the card;
  - "Make a new briefing" with its note;
  - "Show the full list" scrolls.
- **My tasks:** `?task=` and `?request=` scroll, focus and highlight.

**The live proof is a STOP 2 after the deploy**, because the table must not
reach the shared database first. **Changed 13 Oct (Ahmad): it runs on the LIVE
site** (the deployed frontend and API), because the platform key is now set on
Railway. It is still a separate prompt after the deploy:
1. **Press in English, as al-nakheel's tenant admin** (page-side sign-in):
   - the briefing appears, with linked items;
   - exactly **5 credits** are used;
   - **one AI log row**: cost 5, provider, tier, tokens, and a counts-only
     description with no text.
2. **Switch to Arabic and press again:** an Arabic lead, **5 more** credits, and
   a second log row.
3. **A non-admin persona at al-nakheel:** Home has no card and no button.
4. **al-manara's tenant admin:** Home has no card and no button (feature not
   open).
5. **Restore:**
   - al-nakheel's used credits back to 0, keeping its 2,000;
   - the two `AiBriefing` rows deleted, unless Ahmad wants one kept for the demo
     (the report will ask);
   - the log rows stay, as the record of real calls.

---

## 9. Railway (Q9)

For the live site's button to work, **Ahmad sets `ANTHROPIC_API_KEY` on the
Railway service himself.**
- I never ask for it, read it or print it.
- Until it is set, the deployed button refuses with `AI_PROVIDER_UNAVAILABLE`,
  and the card shows "AI isn't available right now. Try again later." That is
  correct, and harmless.

**Nothing else is needed.**
- `ANTHROPIC_MODEL_STANDARD` is optional; unset, it is `claude-sonnet-5-5`.
- `RUN_WORKERS` is unaffected, because nothing is scheduled.

**After he sets it:**
- one press on the live site confirms the key, read from Railway's own
  environment;
- al-nakheel's used credits are restored afterwards.

---

## 10. Build order (one commit each)

**Progress:**

- [x] 0. `docs(plans)`: this plan, and the drawing committed beside it (`c1e29f0`; decisions recorded in the next commit)
- [x] 1. `chore(prisma)`: migrate — the `AiBriefing` table (local throwaway Postgres; not the shared one) (`a01e75a`)
- [x] 2. `feat(ai-briefing)`: gathering, prompt, claim, save, read (live done markers), endpoints; unit specs and the `test:db` claim spec (`ca6d95a`)
- [x] 3. `feat(shared)`: the `am-ai-assist` component and its specs (`a493fe0`)
- [x] 4. `feat(tasks)`: `?task=` / `?request=` deep links on My tasks (scroll, focus, highlight) (`1aed5cc`)
- [x] 5. `feat(home)`: the briefing card (button, working, briefing, quiet day, refusals), EN and AR words (`f3f2250`)
- [x] 6. `docs`: SYSTEM-REFERENCE §17.8 (the briefing) and §10.19 (`am-ai-assist`), CLAUDE.md Key Architecture Decisions (ACC-198), §13 below (this commit)
- [ ] STOP 1: lint, typecheck, tests, `test:db`, scans; report
- [ ] After deploy, STOP 2: the live proof (§8), restore, report

---

## 11. Decisions for Ahmad: where the drawing assumed an automatic briefing

| # | The drawing says | Under on-demand | Recommendation |
|---|---|---|---|
| **D1** | "Never an error on Home": AI off, credits used up, paused or failed → no card, ordinary Home | Before a press that still holds (no button = no card). **After a press**, silence would leave the admin not knowing why nothing came | **After a press, show the refusal inside the card**, as the pattern does everywhere else ("after a click: credits used up and provider failure appear in the result area"). Before a press, Home is ordinary **(recommended)** |
| **D2** | Decision 4: "Credits appear once… No cost labels on buttons" | Only a tenant admin presses, and each press costs 5 | **Show "· 5 credits" quietly after the button's label**, for the first press and for "Make a new briefing" **(recommended)**. Alternative: only on "Make a new briefing" |
| **D3** | "Made once per working day… it stays until the next one" | It is made when pressed | **Keep the latest per user; show it only on the day it was made (tenant's zone)**. Afterwards the card is back to the button **(recommended)**. Alternative: show the latest whatever its date, with the date in its tag |
| **D4** | One briefing, in the reader's language | The reader may switch language after pressing | **Show it in the language it was made in; pressing again makes one in the current language** **(recommended)**. Alternative: a briefing per language, like summaries |
| **D5** | Groups: Overdue, Due today, Waiting for your decision, New since yesterday | The ticket also names pool tasks | **Add "Waiting to be picked up" after decisions**, in the drawing's group style **(recommended)**. Alternative: leave pool tasks out, as drawn |
| **D6** | "Good morning, Nora." | It can be pressed in the afternoon | **Greet by the time of day in the tenant's zone** (morning / afternoon / evening, EN and AR) **(recommended)**. Keep the feature's name, "morning briefing", only in the ticket and code |
| **D7** | — (the ticket said one run in flight per organisation) | Each briefing is the presser's own | **One run in flight per USER** **(recommended)**: two admins get their own briefings; one press never charges twice |
| **D8** | Credits wording: "for this month… Your administrator can add more" | Periods aren't months (ACC-194 D2); nobody can add more | **Keep ACC-194's helper wording** ("for this period. They renew on {date}.") **(recommended)** |
| **D9** | "Turn off my briefing" on the card, and back on in the profile | Nothing runs unless pressed, so there is nothing to turn off | **Drop it** **(recommended)** |
| **D10** | "No briefing is made on a weekend or holiday" | The admin chose to press | **Allow it any day**: "due today" still means the tenant's today **(recommended)** |
| **D11** | Working state: "If it takes over 8 seconds, the card quietly disappears" | The admin is waiting for the result they asked for | **Keep the working card until the answer** (the provider times out at 120 s, then the failure refusal with Try again) **(recommended)** |
| **D12** | Saved AI results stay visible when AI is later off (drawing Q1) | A saved briefing when the feature is later closed | **Shown on its day, marked as AI, with no button** **(recommended)**: the drawing's own rule for saved results |

**Decided (Ahmad, 13 Oct): D1–D12 as recommended above.**

**D13 (new, Ahmad, 13 Oct): "Focus on these first."**
- **What the model may add:** besides the lead, up to **3 items to show first**,
  each with a one-line reason in the user's language.
- **How it picks:** ONLY by the item ids we sent it, returned in a structured
  format (JSON).
- **What our code does with the picks:**
  - validates every id against the set it sent, and **drops any it doesn't
    recognise**, along with duplicates and anything past the third;
  - builds the item, its date and its link itself, exactly as for the groups;
  - with no valid picks left, **does not show the section at all**.
- **What the model never does:** write a title, a date or a link.
- **The section** sits between the lead and the groups. Its items still appear
  in their own groups below.
- **The output limit:** `morning_briefing` goes from 3,000 to **4,000**
  `max_tokens` in `ai.config.ts`. The visible answer is now JSON (the lead, plus
  up to three reasons, about 250 tokens); thinking is billed against the same
  limit (ACC-194 §7); and a truncated JSON answer would be unusable. The ceiling
  costs nothing unless used: the credit price is flat (5).

---

## 12. Risks

- **R1. The model only writes the lead.** If Ahmad expects the AI to choose or
  rewrite the items, this plan deliberately does not: links and items stay ours,
  as asked. The lead is where the AI's judgement shows ("Start with CAPA-0912; it
  blocks…").
- **R2. Prompt injection through task titles.** Titles are tenant-written. The
  system prompt marks them as data, the output is a short plain-text lead
  rendered as text, and it can't create links or actions. Worst case is an odd
  sentence on the presser's own Home.
- **R3. "Due today" needs the tenant's zone on the server** (ACC-94 D3). The
  frontend's browser zone is never used for it.
- **R4. An empty or useless answer is still charged** (the provider was paid;
  the drawing's Q2 says the same). The quiet day avoids the call entirely, and an
  empty answer falls back to a code-written lead, so the admin always gets a
  usable card.
- **R5. The Home the drawing calls "accepted" differs from the built one**
  (Notifications, not "Awaiting my action"). The briefing doesn't touch the
  panels, so this ticket doesn't resolve that; it is recorded, not changed.
- **R6. The live proof waits for the deploy** (a new table). Until Ahmad sets
  `ANTHROPIC_API_KEY` on Railway, the deployed button answers "AI isn't
  available right now".
- **R7. My tasks deep links are new behaviour on a screen ACC-198 doesn't own.**
  They follow ACC-208's committee-page pattern exactly, so the risk is small, but
  the change is real.

---

## 13. Where the build differs from the plan

- **D13 changed the answer's shape.** The model now answers in JSON (a lead
  plus up to three picks), not plain text. A plain-text answer with no `{` is
  still taken as the lead; broken JSON falls back to our lead, logged, and the
  run is still charged (R4). `maxTokens` is 4,000 (was 3,000).
- **`FormatService.timeOfDay()` was added** for the tag's "made by AI at 07:40".
  The formatting layer had dates and date-times, but no time on its own.
- **`am-ai-assist` keeps a result BELOW a refusal** when one exists. §6 did
  not say what a refusal does to an earlier result; D1 needs the earlier
  briefing to survive a failed second press, so the pattern does it for every
  feature.
- **Links:** the server stores a target and an id (§3.4); the frontend's
  `linkOf()` is the one map from target to route. The server never stores a
  URL.
- **`AI_BRIEFING_IN_PROGRESS` reads as "unavailable", with Try again.** It has
  no words of its own in `aiRefusal()`: it is reachable only from a second tab,
  and Try again is the right answer there.
- **The `test:db` spec's feature row is set open** (`restricted: false`)
  because a local database seeded by ACC-194's proof holds the row restricted.
  CI's database has no row until the spec creates it.
