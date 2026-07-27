# Step 7 — Notification Service
# ACC-10 (suggested): event-driven notification service — in-app inbox, email
# delivery via Resend, and the badge-count bell every future module will trigger

---

## HEALTH CHECK — Run Before Starting

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AccreditMe Health Check — 2026-07-27
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CRITICAL ERRORS:  None ✅
ERRORS:           None ✅
WARNINGS:         None ✅

DETAILED RESULTS

Check 1  Git State              PASS — on dev, clean, no stashes
Check 2  Branch vs dev          INFO — 0 commits ahead/behind, ready for new ticket
Check 3  Backend TypeScript     PASS — npx tsc --noEmit → zero errors
Check 4  Frontend TypeScript    PASS — npx tsc --noEmit → zero errors
Check 5  Test Suite             PASS — 253/253 tests passing (14 suites)
Check 6  Tenant Isolation       PASS — 9/9 isolation tests passing
Check 7  Migration Status       PASS — 11 migrations, database up to date
Check 8  Schema Validation      PASS — schema.prisma is valid
Check 9  Environment Variables  Not re-verified this pass — no change since ACC-9's
                                 health check; RESEND_API_KEY presence confirmed
                                 required by existing health-check skill Check 9
Check 10 Critical Files         Not re-verified this pass — no file removals since ACC-9
Check 11 Security               PASS — .env and .mcp.json not in git history

OVERALL STATUS: 🟢 HEALTHY — ready to start ACC-10
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 1. OVERVIEW

### What This Step Builds

Step 7 implements the **Notification Service** — the cross-cutting service every
current and future module calls (never hardcoding its own notification logic) per
CLAUDE.md: *"Event-driven — modules emit events, NotificationService subscribes.
Never hardcode notification logic inside modules."* Two channels ship this step:

1. **In-app inbox** — `Notification` rows (model already scaffolded in Step 1),
   readable through a personal `GET /notifications` feed, an unread badge count,
   and mark-read/mark-all-read actions.
2. **Email delivery via Resend** — the **first activation** of the `resend` package
   (present in `package.json` since scaffold, never called), fired asynchronously
   through a new BullMQ queue (`email-delivery` — named exactly per CLAUDE.md's
   Background Jobs list), never blocking the request that triggered it.

On the Angular side: a `NotificationBellComponent` with a badge count, polling
`GET /notifications/unread-count` every 30 seconds (CLAUDE.md's real-time channel
is WebSocket, but no WebSocket gateway exists anywhere in this codebase yet —
polling is this step's explicit, scoped simplification, not an oversight).

### Why This Step Is Different From Every Prior Foundation Step

- It is the **first step where the model already fully exists** — `Notification`,
  `NotificationChannel`, `NotificationStatus` were scaffolded in Step 1 and have
  sat unused. This step is almost entirely *service + job + controller + UI*, with
  the smallest schema footprint of any foundation step so far (one added index).
- It is the **first real caller of two already-scaffolded stub sites**:
  `WorkflowService.executeSendNotification()` / `.resolveAndNotifyInitialAssignee()`
  and `SlaMonitorProcessor.fireEscalation()` all currently call
  `this.prisma.notification.create()` directly, with an explicit code comment in
  each ("`NotificationService doesn't exist yet (Step 7)`") marking them as
  temporary. This step's job is to delete that stub behavior, not add to it.
- It is the **first activation of Resend**, mirroring how Step 6 was the first
  activation of BullMQ — same "dependency has sat in `package.json` since scaffold,
  now it does something real" shape.
- It re-triggers the **exact transitive circular-dependency risk discovered in
  Step 6** (see Section 8) — `WorkflowModule` and `SlaMonitorProcessor`'s module
  will need to inject `NotificationService`, and `NotificationModule` will need
  `AuditLogService` from `TenantModule`, which already `forwardRef()`s into
  `WorkflowModule`. This must be verified with a real `start:dev` boot, not just
  `tsc`, exactly as Step 6's postmortem requires.

### Scaffold Already in Place (from Step 1 — do not recreate)

```
Notification model        — EXISTS, fully fielded (see Section 2) — MODIFY (compound index only)
NotificationChannel enum   — EXISTS (IN_APP, EMAIL, SMS) — MODIFY, add BOTH value (see Section 2)
NotificationStatus enum    — EXISTS (UNREAD, READ, DISMISSED) — no changes needed
User.language              — EXISTS — drives which body (bodyEn/bodyAr) an email uses
PrismaService.notification — EXISTS getter — no new getter needed
NOTIFICATIONS_PERMISSIONS  — EXISTS in common/constants/permissions.ts (VIEW, MANAGE) —
                              reserved for a future notification-rules admin screen,
                              NOT used by this step's personal-inbox endpoints (see
                              Business Rules — Permission Model)
resend package              — EXISTS in package.json — never called until this step
bullmq / @nestjs/bullmq     — EXISTS, already registered (QueueModule, Step 6) —
                              this step adds a third queue to the same module
QueueModule                 — EXISTS (common/queue/queue.module.ts) — MODIFY, add queue
WorkflowService              — EXISTS — 2 call sites MODIFY (stub → real service)
SlaMonitorProcessor           — EXISTS — 1 call site MODIFY (stub → real service)
```

### Explicit Non-Goals for This Step

Per the 8 scope items given for this step, the following CLAUDE.md-mentioned
Notification Service capabilities are **deliberately deferred**, not silently
dropped — flagged here and again in Section 12 (Pending Discussions):

- **Tenant-configurable notification rules** ("which events notify which roles via
  which channel, per tenant") — this step ships a fixed, code-level rule (see
  Business Rules), not an admin-configurable rules engine.
- **Digest mode** (CLAUDE.md: "Digest mode available per notification type, user
  preference") and the `notification-digest` BullMQ job from CLAUDE.md's
  Background Jobs list — no user preference model exists yet to store the setting.
- **Real-time WebSocket push** — CLAUDE.md's Tech Stack lists a NestJS WebSocket
  gateway (Socket.io), but none has been built in this codebase yet, for any
  module. Polling is this step's explicit, scoped stand-in.
- **SMS / Teams / WhatsApp channels** — `NotificationChannel.SMS` exists on the
  enum (Step 1 scaffold) but is not wired to any provider this step.
- **AI-generated personalized notification text / morning briefing** (CLAUDE.md
  Cross-Module AI Integration Points) — stubbed identically to how Step 6 stubbed
  `suggestWorkflowConfig()` (see Section 9).

---

## 2. PRISMA SCHEMA CHANGES

### What `NotificationChannel` Currently Has

```prisma
enum NotificationChannel {
  IN_APP
  EMAIL
  SMS
}
```

### What `NotificationChannel` Must Have After Migration

```prisma
enum NotificationChannel {
  IN_APP
  EMAIL
  BOTH                                                          // ADD
  SMS
}
```

**Why `BOTH`:** resolved in Section 12 (Pending Discussion #3) — a `Notification`
row is still a single row regardless of channel (no multi-row fan-out), but
`channel: 'BOTH'` means the row is both visible in the in-app inbox AND enqueued
for email delivery, versus `channel: 'EMAIL'` which — after this resolution —
still enqueues email too (the in-app row always exists regardless of channel per
Section 8's "Single Row, Optional Email Fan-Out" rule). In practice `EMAIL` and
`BOTH` now enqueue the same email job; `BOTH` exists as the semantically explicit
value for call sites that want to be unambiguous that both surfaces matter (a
future notification-rules screen, Section 7, is the main anticipated consumer of
that distinction). `IN_APP` alone never enqueues email.

### What `Notification` Currently Has (unchanged fields shown for reference)

```prisma
model Notification {
  id             String              @id @default(cuid())
  organizationId String
  userId         String
  titleEn        String
  titleAr        String?
  bodyEn         String
  bodyAr         String?
  channel        NotificationChannel @default(IN_APP)
  status         NotificationStatus  @default(UNREAD)
  objectType     String?
  objectId       String?
  sentAt         DateTime?
  readAt         DateTime?
  createdAt      DateTime            @default(now())

  organization   Organization        @relation(fields: [organizationId], references: [id])
  user           User                @relation(fields: [userId], references: [id])

  @@index([organizationId])
  @@index([userId])
  @@index([status])
  @@index([createdAt])
}
```

**Why no new columns are needed:** every field this step's 8 scope bullets require
already exists — `sentAt` (currently unset by both stub call sites) is exactly the
"email actually dispatched" timestamp this step's email processor will finally
stamp; `channel` is exactly the per-notification dispatch selector (now with
`BOTH` added, see above); `status` already distinguishes `UNREAD`/`READ` for the
bell badge and inbox filtering. The only two schema changes this step makes are
additive: one new enum value (`BOTH`) and one new compound index — no column
added, removed, or retyped on `Notification` itself.

### What `Notification` Must Have After Migration

```prisma
model Notification {
  id             String              @id @default(cuid())
  organizationId String
  userId         String
  titleEn        String
  titleAr        String?
  bodyEn         String
  bodyAr         String?
  channel        NotificationChannel @default(IN_APP)
  status         NotificationStatus  @default(UNREAD)
  objectType     String?
  objectId       String?
  sentAt         DateTime?
  readAt         DateTime?
  createdAt      DateTime            @default(now())

  organization   Organization        @relation(fields: [organizationId], references: [id])
  user           User                @relation(fields: [userId], references: [id])

  @@index([organizationId])
  @@index([userId])
  @@index([status])
  @@index([createdAt])
  @@index([userId, status])                                    // ADD
}
```

**Why `@@index([userId, status])`:** the bell's unread-count query
(`WHERE userId = ? AND status = 'UNREAD'`) is, by design, the single most
frequently executed query this module introduces — every logged-in user's browser
tab re-runs it every 30 seconds via polling (Section 4). The existing separate
`userId` and `status` indexes work but force Postgres to intersect two index scans;
a compound index serves the exact predicate directly. This is the only schema
change in this step.

### Migration Name

```
add_notification_channel_both_and_user_status_index
```

```bash
cd backend && npx prisma migrate dev --name add_notification_channel_both_and_user_status_index
```

One migration, two additive changes:
1. `ALTER TYPE "NotificationChannel" ADD VALUE 'BOTH'`
2. `CREATE INDEX` for `@@index([userId, status])`

**Data migration note:** both changes are additive — new enum value, new index,
no column changes, no backfill — safe to apply directly regardless of existing
`Notification` row count.

---

## 3. FILES TO CREATE / MODIFY (BACKEND)

All new paths relative to `backend/src/foundation/notification/` unless noted.

### Commit 1 — Schema (standalone commit before any code)
```
backend/prisma/schema.prisma                                            MODIFY
backend/prisma/migrations/YYYYMMDDHHMMSS_.../                          GENERATED
```

Two changes in this one migration (see Section 2):
- Add `BOTH` to the `NotificationChannel` enum
- Add `@@index([userId, status])` compound index on `Notification`

---

### Commit 2 — Interfaces and DTOs
```
interfaces/notification.interface.ts                                   CREATE
dto/create-notification.dto.ts                                         CREATE
```

**`notification.interface.ts`**:
```typescript
export interface INotification {
  id: string;
  organizationId: string;
  userId: string;
  titleEn: string;
  titleAr: string | null;
  bodyEn: string;
  bodyAr: string | null;
  channel: string;      // NotificationChannel
  status: string;       // NotificationStatus
  objectType: string | null;
  objectId: string | null;
  sentAt: Date | null;
  readAt: Date | null;
  createdAt: Date;
}
```

**`create-notification.dto.ts`** — this is an **internal DTO, never exposed on any
HTTP route**. Per CLAUDE.md's event-driven principle, notifications are always
system/workflow-generated, not user-authored via a public "create notification"
endpoint — there is deliberately no `POST /notifications` route (see Business
Rules). class-validator decorators are still applied since other services call
`NotificationService.create()` with values that may originate from their own
request bodies indirectly (e.g. a comment string):

```typescript
export class CreateNotificationDto {
  @IsString() @IsNotEmpty()
  userId: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  titleEn: string;

  @IsString() @IsOptional() @MaxLength(200)
  titleAr?: string;

  @IsString() @IsNotEmpty() @MaxLength(2000)
  bodyEn: string;

  @IsString() @IsOptional() @MaxLength(2000)
  bodyAr?: string;

  @IsEnum(['IN_APP', 'EMAIL', 'BOTH', 'SMS']) @IsOptional()
  channel?: 'IN_APP' | 'EMAIL' | 'BOTH' | 'SMS';   // default IN_APP

  @IsString() @IsOptional()
  objectType?: string;

  @IsString() @IsOptional()
  objectId?: string;
}
```

---

### Commit 3 — NotificationService + spec
```
notification.service.ts                                                CREATE
notification.service.spec.ts                                           CREATE
```

**`notification.service.ts`** methods:

```typescript
// Creates the Notification row. If channel === 'EMAIL' or 'BOTH', enqueues an
// 'email-delivery' BullMQ job immediately after the row is committed — the row
// itself is created regardless of channel, so every notification is always
// visible in the recipient's in-app inbox even when it is ALSO emailed (this
// is the one design choice this step makes on CLAUDE.md's behalf — see
// Business Rules, "Single Row, Optional Email Fan-Out").
create(dto: CreateNotificationDto, organizationId: string): Promise<INotification>

// Personal inbox — always scoped to the CALLING user, never another user's,
// regardless of any permission the caller holds (see Business Rules —
// Permission Model). organizationId still enforced for defense in depth.
getForUser(
  userId: string,
  organizationId: string,
  options: { status?: 'UNREAD' | 'READ' | 'DISMISSED'; limit?: number; offset?: number },
): Promise<INotification[]>

getUnreadCount(userId: string, organizationId: string): Promise<number>

// Throws NotFoundException if the notification does not belong to this
// userId + organizationId — ownership is checked, not just tenant membership
markRead(id: string, userId: string, organizationId: string): Promise<INotification>

markAllRead(userId: string, organizationId: string): Promise<{ count: number }>
```

**Spec must cover:**
- `create()` with `channel: 'IN_APP'` (default) never enqueues an email job
- `create()` with `channel: 'EMAIL'` both creates the row AND enqueues exactly one
  `email-delivery` job carrying `{ notificationId, organizationId }`
- `create()` with `channel: 'BOTH'` also both creates the row AND enqueues exactly
  one `email-delivery` job — asserted as its own test case, not inferred from the
  `EMAIL` case, since the two are separate enum values even though they currently
  share identical enqueue behavior
- `getUnreadCount()` only counts `status: 'UNREAD'` rows for that exact user
- `markRead()` throws `NotFoundException` when the notification belongs to a
  different user in the SAME organization (ownership check, not just tenant scope
  — this is a stricter isolation test than most prior modules needed, since a
  regular tenant-isolation test alone would not catch a same-org cross-user leak)
- `markAllRead()` only touches the calling user's own `UNREAD` rows and returns
  the correct count
- Tenant isolation test: org B's `getForUser()`/`getUnreadCount()` never returns
  org A's notifications

---

### Commit 4 — BullMQ email queue + Resend delivery processor
```
common/queue/queue.module.ts                                           MODIFY
notification-email.processor.ts                                        CREATE
```

**`queue.module.ts`** — add a third queue, named exactly per CLAUDE.md's
Background Jobs list (`email-delivery`):
```typescript
BullModule.registerQueue({
  name: 'email-delivery',
  defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
}),
```

**`notification-email.processor.ts`** — `@Processor('email-delivery')` extending
`WorkerHost`, same shape as `WorkflowActionProcessor` (Step 6):
- Job payload: `{ notificationId: string; organizationId: string }`
- Loads the `Notification` row + its `User` (`email`, `language`)
- Picks body/title by language: `user.language === 'ar' && titleAr/bodyAr present
  ? titleAr/bodyAr : titleEn/bodyEn` — mirrors the existing `User.language` /
  bilingual-content pattern used everywhere else in the codebase, no new field
- Calls `resend.emails.send({ from, to: user.email, subject, html })` — **first
  real call to the `resend` package in the codebase**
- On success: `prisma.notification.update({ sentAt: new Date() })`
- On failure: BullMQ's own retry (3 attempts, exponential backoff, same policy as
  Step 6's webhook queue) handles retry; no dedicated execution-log table is
  introduced for email delivery (unlike `WorkflowActionLog` for webhooks) — see
  Business Rules for why this asymmetry is intentional, not an oversight

**Env note:** `RESEND_API_KEY` has been a required env var since scaffold (health
check Check 9) but this is the first step to actually read and use it at runtime.

---

### Commit 5 — NotificationController + spec
```
notification.controller.ts                                             CREATE
notification.controller.spec.ts                                        CREATE
```

```
GET   /notifications                 — list current user's own notifications
GET   /notifications/unread-count    — badge count for current user
PATCH /notifications/:id/read        — mark one of current user's own as read
POST  /notifications/mark-all-read   — mark all of current user's own as read
```

**No `@Permissions()` decorator on any of these four endpoints** — see Business
Rules, "Permission Model for the Personal Inbox." `@UseGuards(TenantGuard)` only
(no `PermissionGuard` needed since there is no permission gate to check — but
`TenantGuard` still runs to populate `@CurrentTenant()`/`@CurrentUser()` and
enforce authentication). Zero business logic — full delegation to
`NotificationService`.

**No `POST /notifications` endpoint** — deliberate, see Commit 2 note.

---

### Commit 6 — NotificationModule + AppModule
```
notification.module.ts                                                 CREATE
app.module.ts                                                          MODIFY
```

**`notification.module.ts`**:
```typescript
@Global()
@Module({
  imports: [PrismaModule, QueueModule, forwardRef(() => TenantModule)],
  controllers: [NotificationController],
  providers: [NotificationService, NotificationEmailProcessor],
  exports: [NotificationService],
})
export class NotificationModule {}
```

**Why `@Global()` — unlike `WorkflowModule`, like `RolesModule`:** CLAUDE.md's own
integration requirement for this step is "all future modules that generate
notifications" — every functional module in Phase 2 (Documents, Incidents, Audits,
CAPA, Meetings, Committees, Standards, KPI) will need to inject
`NotificationService` directly. Making every one of those modules explicitly
import `NotificationModule` is pure repetition with no isolation benefit (compare:
`WorkflowModule` is NOT global because only modules that own a lifecycle object
need it — a much narrower set). This mirrors exactly why `RolesModule` is
`@Global()` for `PERMISSION_RESOLVER`.

Add `NotificationModule` to `AppModule` imports.

**Circular-dependency risk — same shape as Step 6's `working-calendar.module.ts`
bug, pre-empted here instead of discovered after a broken boot:**
`TenantModule` already `forwardRef()`s into `WorkflowModule` (Step 6).
`NotificationModule` now needs `TenantModule` (for `AuditLogService`), and
`WorkflowModule` (Commit 7 below) will need `NotificationModule`. Traced:
`TenantModule → (forwardRef) WorkflowModule → NotificationModule → (forwardRef)
TenantModule`. Both new edges (`NotificationModule → TenantModule` and
`WorkflowModule → NotificationModule`) must be created with this cycle in mind
from the start — `NotificationModule`'s `TenantModule` import above is already
written as `forwardRef()`, and `WorkflowModule`'s import of `NotificationModule`
(Commit 7) does not need `forwardRef()` on its own edge since `NotificationModule`
is `@Global()` (Nest resolves global module providers without a normal import
edge). **Verify with a real `npm run start:dev` boot, not just `tsc`** — Step 6's
lesson was that this exact class of bug is invisible to both TypeScript and Jest.

---

### Commit 7 — Migrate WorkflowService and SlaMonitorProcessor off the stubs
```
foundation/workflow/workflow.service.ts                                MODIFY
foundation/workflow/workflow.service.spec.ts                            MODIFY
foundation/workflow/sla-monitor.processor.ts                            MODIFY
foundation/workflow/workflow.module.ts                                  MODIFY
```

This is the commit that actually retires the two `// NotificationService doesn't
exist yet (Step 7)`-style comments left in place since ACC-9.

**`workflow.service.ts`** — inject `NotificationService`; replace the body of:
- `executeSendNotification()` (currently loops `assigneeIds` and calls
  `this.prisma.notification.create(...)` per user) → call
  `this.notificationService.create({ userId, titleEn: transition.labelEn, bodyEn:
  ..., objectType: instance.objectType, objectId: instance.objectId },
  organizationId)` per user instead.
- `resolveAndNotifyInitialAssignee()` — same substitution for the "New workflow
  assignment" notification.

**`sla-monitor.processor.ts`** — inject `NotificationService`; replace
`fireEscalation()`'s direct `this.prisma.notification.create(...)` loop with
`this.notificationService.create({ userId, titleEn: 'SLA breach escalation',
bodyEn: ... }, organizationId)` per user. The existing `AuditLogService.log()`
call in this method is unchanged — audit logging of the escalation event and
notifying the escalation target are two separate concerns, both still required.

**`workflow.module.ts`** — no import change strictly required (`NotificationModule`
is `@Global()`), but add it to `imports` anyway for explicitness/testability,
matching how `PrismaModule` is imported everywhere despite being available
globally in some NestJS setups — explicit imports make `TestingModule` setup in
spec files easier to reason about.

**Spec updates:** `workflow.service.spec.ts` and any `sla-monitor.processor.spec.ts`
must mock `NotificationService` (a simple `{ create: jest.fn() }` provider) instead
of asserting on `mockPrisma.notification.create` directly — update the existing
assertions in `workflow.service.spec.ts` (currently `expect(mockPrisma.notification
.create).toHaveBeenCalledWith(...)`, per the ACC-9 spec) to assert on
`mockNotificationService.create` instead.

---

## 4. FILES TO CREATE (FRONTEND)

All paths relative to `frontend/src/app/foundation/notification/` unless noted.
No shared app-shell/topbar module exists yet anywhere in this codebase (checked —
`app.component.ts` is a bare `<router-outlet>`; CLAUDE.md's `frontend/src/app/
layout/` directory has not been created by any step so far) — see Section 12 for
the flagged placement decision this forces.

### Commit 8 — Angular notification service + bell component
```
services/notification.service.ts                                      CREATE
components/notification-bell/notification-bell.component.ts            CREATE
frontend/src/app/app.component.ts                                      MODIFY
frontend/src/app/app.component.html                                    MODIFY
```

**`notification.service.ts`**:
```typescript
export interface NotificationDto {
  id: string;
  titleEn: string;
  titleAr: string | null;
  bodyEn: string;
  bodyAr: string | null;
  status: string;
  objectType: string | null;
  objectId: string | null;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  list(status?: string): Observable<NotificationDto[]>
  getUnreadCount(): Observable<{ count: number }>
  markRead(id: string): Observable<NotificationDto>
  markAllRead(): Observable<{ count: number }>
}
```

**`notification-bell.component.ts`** — standalone, PrimeNG `p-popover` (or
`p-overlayPanel`, whichever this Angular/PrimeNG version ships — confirm against
the version already used elsewhere in this codebase before writing):
- `signal<number>` unread count, refreshed via
  `interval(30000).pipe(startWith(0), switchMap(() => service.getUnreadCount()))`
- Badge only renders when count > 0 (PrimeNG `p-badge`)
- Click opens a panel listing the most recent notifications (`list()`, default
  limit e.g. 10), each row shows `titleEn`/`titleAr` per current UI language,
  relative-time `createdAt`, and unread rows are visually distinct (bold or dot)
- Clicking a row calls `markRead(id)` and updates local state optimistically — no
  navigation to `objectType`/`objectId` is attempted this step (no functional
  module exists yet to navigate to — flagged, not a bug)
- "Mark all read" button calls `markAllRead()` and resets the badge to 0

**`app.component.ts`/`.html`** — mount `<app-notification-bell />` directly in the
root shell template. This is a **temporary placement**, explicitly flagged: once a
real topbar/sidebar layout module exists (CLAUDE.md's `frontend/src/app/layout/`),
the bell moves there. No numbered build-order step currently owns "build the app
shell" — see Section 12.

---

### Commit 9 — Translation keys
```
frontend/src/assets/i18n/en.json     MODIFY
frontend/src/assets/i18n/ar.json     MODIFY
```

Keys to add under a new `"notification"` namespace in `en.json` (real Arabic
translations in `ar.json`, same rule as every prior step):
```json
{
  "notification": {
    "title": "Notifications",
    "markAllRead": "Mark All as Read",
    "noNotifications": "No notifications yet.",
    "unreadCount": "{{count}} unread",
    "justNow": "Just now",
    "errorLoad": "Failed to load notifications."
  }
}
```

---

## 5. COMMIT SEQUENCE

All commits on branch `feature/ACC-10-notification-service`.
Format: `{type}({scope}): {description} [ACC-10]`

```
Commit 1: chore(prisma): add compound index for notification unread-count query [ACC-10]
Commit 2: feat(notification): add notification interface and internal create DTO [ACC-10]
Commit 3: feat(notification): add NotificationService [ACC-10]
Commit 4: feat(notification): register email-delivery queue and Resend processor [ACC-10]
Commit 5: feat(notification): add NotificationController [ACC-10]
Commit 6: chore(notification): register NotificationModule in AppModule [ACC-10]
Commit 7: fix(workflow): replace direct Notification stubs with NotificationService [ACC-10]
Commit 8: feat(notification): add Angular notification bell with badge count [ACC-10]
Commit 9: feat(i18n): add notification translation keys [ACC-10]
```

Run `npx tsc --noEmit` before commits 1, 3, 4, 5, 6, 7, 8.
Run `npx jest --passWithNoTests` before commits 3, 4, 6, 7.

**Commit 6 carries the same circular-dependency risk class as Step 6's
mid-build fix** — do not consider it done from `tsc`/`jest` passing alone;
confirm with an actual clean `npm run start:dev` log showing `NotificationModule
dependencies initialized` and `Nest application successfully started` before
moving to Commit 7.

**Commit 7 is the actual point of this step from CLAUDE.md's perspective** — it
retires the two "doesn't exist yet (Step 7)" stub comments left in the codebase
since ACC-9. Do not merge this step without it, even though the module works
without it (functionally, Commit 7 is the caller-side migration, not new
capability — but leaving it undone means Step 7 shipped a service nothing calls).

---

## 6. ACCEPTANCE CRITERIA

- [ ] `Notification` model unchanged except for the new compound index;
      `NotificationChannel` enum gains `BOTH` (IN_APP, EMAIL, BOTH, SMS)
- [ ] Migration applied — database schema up to date
- [ ] `NotificationService.create()` always writes the row; enqueues
      `email-delivery` when `channel === 'EMAIL'` or `channel === 'BOTH'`
- [ ] `BOTH` channel correctly delivers in-app notification AND sends email via
      Resend — verified as its own test case, not assumed identical to `EMAIL`
- [ ] `getForUser()` / `getUnreadCount()` / `markRead()` / `markAllRead()` all
      double-scoped: tenant (`organizationId`) AND owning user (`userId`) —
      not tenant-only like most prior modules
- [ ] `markRead()` throws `NotFoundException` for a notification belonging to a
      different user in the same organization (not just a different tenant)
- [ ] `email-delivery` queue registered with 3-attempt exponential backoff,
      matching the existing `workflow-actions` queue's retry policy
- [ ] `NotificationEmailProcessor` picks `titleAr`/`bodyAr` when the recipient's
      `User.language === 'ar'` and Arabic content exists, else falls back to
      `titleEn`/`bodyEn`
- [ ] `NotificationEmailProcessor` stamps `sentAt` only on confirmed Resend success
- [ ] `NotificationController` has exactly 4 endpoints, no `POST /notifications`
- [ ] None of the 4 endpoints carry a class-level `@Permissions()` — confirmed
      deliberate (see Business Rules), not a missing-decorator bug
- [ ] `WorkflowService.executeSendNotification()` and
      `.resolveAndNotifyInitialAssignee()` call `NotificationService.create()`,
      no remaining direct `this.prisma.notification.create()` in workflow code
- [ ] `SlaMonitorProcessor.fireEscalation()` calls `NotificationService.create()`,
      no remaining direct `this.prisma.notification.create()` in that file
- [ ] `workflow.service.spec.ts` assertions updated to check
      `NotificationService.create` calls, not raw Prisma mock calls
- [ ] `NotificationModule` is `@Global()`, exports `NotificationService`
- [ ] Server boots cleanly with `NotificationModule` initialized — confirmed via
      actual `start:dev` log, not inferred from `tsc`/`jest` alone
- [ ] Angular `NotificationBellComponent` polls unread count every 30s, shows
      badge only when count > 0, supports mark-read and mark-all-read
- [ ] Bell mounted in `app.component`, flagged as temporary pending a real layout
      module
- [ ] Backend TypeScript: zero errors
- [ ] Frontend TypeScript: zero errors
- [ ] All tests passing (253+ existing + new notification tests)
- [ ] Tenant isolation test present for `NotificationService`
- [ ] Translation keys in both `en.json` and `ar.json`
- [ ] PR to dev with green CI

---

## 7. DEPENDENCIES

### What This Step Requires from Steps 1–6

| Requirement | Where It Comes From |
|---|---|
| `Notification` model + `NotificationChannel`/`NotificationStatus` enums | Scaffolded in Step 1 |
| `User.language` | Scaffolded in Step 1 — drives email body language selection |
| `PrismaService.notification` getter | Already present |
| `AuditLogService` | From `TenantModule` — same `forwardRef()` pattern as every prior module |
| `TenantGuard` | Active since Step 4 — used alone (no `PermissionGuard`) on `NotificationController` |
| `QueueModule` / BullMQ infrastructure | Built in Step 6 — this step adds a queue, doesn't rebuild the mechanism |
| `resend` package | In `package.json` since scaffold — never called until this step |
| `WorkflowService` / `SlaMonitorProcessor` stub call sites | Built in Step 6, explicitly marked for this step to replace |
| Circular-dependency pattern (`forwardRef` + `@Global()`) | Proven in Step 4 (`RolesModule`) and Step 6 (`working-calendar.module.ts` fix) |

### What Future Steps Will Require from Step 7

| Future Step | What It Needs |
|---|---|
| Step 8 — Task management | Overdue-task escalation will call `NotificationService.create()` the same way SLA escalation does |
| Step 9 — Users | User invitation / role-change notifications will call `NotificationService.create()` |
| Every Phase 2 functional module | "All future modules that generate notifications" (CLAUDE.md) — this is why `NotificationModule` is `@Global()` |
| A future "app shell" pass | Moves `NotificationBellComponent` out of `app.component` into a real topbar, once `frontend/src/app/layout/` exists |
| A future notification-rules step | Would activate the currently-unused `NOTIFICATIONS_PERMISSIONS.MANAGE` for a tenant-admin rules screen, and add the digest-mode preference model CLAUDE.md describes |

---

## 8. BUSINESS RULES

### Event-Driven Principle — What This Step Actually Implements

CLAUDE.md: *"Event-driven — modules emit events, NotificationService subscribes.
Never hardcode notification logic inside modules."* This step implements the
**second half literally** (no module writes its own `Notification` row logic —
everything routes through `NotificationService.create()`) but implements the
**first half pragmatically**: modules call `NotificationService.create()` as a
normal injected-service method call, not via a `@nestjs/event-emitter` publish/
subscribe bus. A true event bus is a larger architectural addition not requested
in this step's 8 scope items, and retrofitting it now would mean re-touching
already-merged `WorkflowService`/`SlaMonitorProcessor` code a second time beyond
the simple call-site swap this step already requires. Flagged in Section 12 as an
open question for whether a real event bus should be introduced before more
functional modules start depending on the current direct-call shape.

### Single Row, Optional Email Fan-Out

A `Notification` row is created on every `create()` call regardless of `channel`
— the in-app inbox is always populated, even for a notification whose primary
intent is an email. `channel: 'EMAIL'` or `channel: 'BOTH'` additionally enqueues
async delivery (see Section 2 for why both values trigger the same enqueue path).
There is no multi-row fan-out (one row per channel) — CLAUDE.md's phrasing
("channels: in-app, email...") could be read as simultaneous multi-channel
delivery per event, but the existing Step-1-scaffolded schema models `channel` as
a single value per row, and none of this step's 8 scope items ask for true
multi-row multi-channel fan-out. Adding `BOTH` (Section 12, Resolution #3) keeps
this single-row model while making the "both surfaces matter" intent explicit at
the enum level — the smallest change consistent with the existing schema.

### Permission Model for the Personal Inbox

Unlike every other controller in the codebase, `NotificationController` carries
**no `@Permissions()` decorator at all** — not even a data-driven exception like
`WorkflowController`'s two runtime endpoints. A user's own notification inbox is
not permission-gated content; it is intrinsically self-scoped (every query filters
`userId = currentUser.id`), the same way no permission string gates "view my own
profile." `TenantGuard` still runs alone (authentication + `@CurrentTenant()`/
`@CurrentUser()` population) — `PermissionGuard` is intentionally not applied to
this controller. The existing `NOTIFICATIONS_PERMISSIONS.VIEW`/`.MANAGE` constants
remain reserved, unused until a future tenant-admin "notification rules" screen
needs them (see Section 7) — documented here so their absence from this
controller is never mistaken for a missing decorator.

### Why Email Delivery Has No Execution-Log Table (Unlike Webhooks)

CLAUDE.md makes `WorkflowActionLog` non-negotiable specifically for webhooks:
*"Every webhook call logged in WorkflowActionLog."* No equivalent requirement
exists for notification email delivery. This step relies on BullMQ's own job
history plus the `Notification.sentAt` timestamp (set on success, left `null` on
failure) as sufficient signal — a `null sentAt` on an `EMAIL`-channel row after
its job should have completed is the failure indicator. Introducing a dedicated
`NotificationDeliveryLog` table was considered and rejected as unrequested scope
for this step's 8 items.

### Digest Mode and Tenant-Configurable Rules — Explicitly Out of Scope

CLAUDE.md mentions both; neither appears in this step's 8 scope bullets. No schema
or service work for either ships in Step 7. See Section 1, "Explicit Non-Goals."

### Audit Log

`AuditLogService.log()` on every mutation:
- `create()` — one entry per notification created (`action: 'CREATE'`,
  `objectType: 'Notification'`)
- `markRead()` / `markAllRead()` — logged as `action: 'UPDATE'`; `markAllRead()`
  logs ONE summary entry with the affected count in `metadata`, not one entry per
  row, to avoid audit log bloat from a single bulk user action (a deliberate
  batching decision — no precedent for this exact shape existed before this step,
  since no prior module had a "mark many as done in one click" action)

---

## 9. AI INTEGRATION POINTS

Per CLAUDE.md's Cross-Module AI Integration Points: *"Notifications: Personalized
context-aware notification text per user"* and *"Morning briefing: AI-generated
daily summary replacing raw notification list."*

### Personalized Notification Text

**This step ships a stub only**, matching the exact pattern Step 6 established for
`suggestWorkflowConfig()`: `NotificationService` does not call `AI_PROVIDER` at
all in this step — every notification's `titleEn`/`bodyEn` is composed directly
by the calling module (e.g. `WorkflowService` already builds
`"${instance.objectType} moved to ${toStage.nameEn}"` itself). Activating
AI-personalized phrasing requires the tenant-scoped `AI_PROVIDER` call plus a
prompt design decision (what context is safe/useful to include per notification
type) that is out of scope for this step's 8 items.

### Morning Briefing

Not built this step — requires a scheduled BullMQ job that aggregates a user's
pending notifications/tasks and calls `AI_PROVIDER` once per user per day. No
Task module exists yet (Step 8) to aggregate against, so this is structurally
blocked until at least Step 8 ships. Flagged for a future step, not this one.

**Pattern: AI suggests → human reviews → human approves → system records** (once
either of the above is actually activated in a later step).

---

## 10. QUEUE SUMMARY (Cross-Reference with Step 6)

```
workflow-actions   — registered Step 6 — webhook firing on transitions
sla-monitor        — registered Step 6 — 15-min repeatable SLA breach sweep
email-delivery     — registered THIS STEP — async Resend send per EMAIL-channel Notification
```

All three share `QueueModule`'s single `BullModule.forRootAsync()` Redis
connection block — no new connection config needed, only a new
`registerQueue()` call.

---

## 11. FRONTEND — WHY NOT A SHARED LAYOUT MODULE YET

CLAUDE.md's Project Structure lists `frontend/src/app/layout/` (app shell,
sidebar, topbar) as an intended location, but no step in the numbered Build Order
explicitly creates it — every foundation module built so far (Organization,
Lookup, Working Calendar, Roles, Workflow) ships as a standalone routed feature
with no shared chrome. This step's `NotificationBellComponent` is built as a
fully standalone, reusable component specifically so it can be relocated without
rework once a real app shell exists — its only integration point with
`app.component` is a single tag mount, not a structural dependency.

---

## 12. PENDING DISCUSSIONS — RESOLVED

All four items below were open questions at plan-creation time. Resolved before
any code was written:

1. **Direct service call vs. real event bus** — **RESOLVED: direct call, no event
   emitter.** `NotificationService.create()` ships as a plain injected method call
   (Section 8), not a `@nestjs/event-emitter` publish/subscribe bus. Every call
   site introduced or modified in this step (Commits 3 and 7 — `WorkflowService
   .executeSendNotification()`/`.resolveAndNotifyInitialAssignee()` and
   `SlaMonitorProcessor.fireEscalation()`) must carry a `// TODO(event-bus):
   migrate to event emitter if/when NotificationService moves to a pub/sub model`
   comment, so the deferred architectural question stays visible in the code, not
   just in this plan.
2. **`NotificationModule` as `@Global()`** — **RESOLVED: yes.** Ships exactly as
   specified in Commit 6, same rationale as `RolesModule`.
3. **Email fan-out model** — **RESOLVED: single row, `channel` decides delivery —
   with a `BOTH` option.** `NotificationChannel` now carries `IN_APP`, `EMAIL`,
   `BOTH`, `SMS` (the pre-existing `SMS` value is untouched, still unwired to any
   provider this step — see Section 1, Explicit Non-Goals). `channel: 'BOTH'`
   means the single `Notification` row is created AND an `email-delivery` job is
   enqueued — i.e. `NotificationService.create()`'s email-enqueue condition is
   `channel === 'EMAIL' || channel === 'BOTH'`, not `channel === 'EMAIL'` alone.
   Applied directly to Section 2 (enum + migration), Section 3 (Commit 1's
   migration, Commit 2's DTO, Commit 3's method doc), and Section 6 (a dedicated
   acceptance criterion) — this plan no longer just cross-references the change,
   it reflects it
   (Step 1 scaffold: `IN_APP`, `EMAIL`, `SMS`) — a migration adding
   `BOTH` to the enum is now required before Commit 3 can be implemented as
   specified. See the updated Section 2 note below.
4. **`NotificationBellComponent` mount point** — **RESOLVED: yes, temporary
   placement in `app.component`.** Additionally: add a
   `// TODO(ACC-XX): move to shared layout shell in Step 9` comment at the mount
   point in `app.component.html`/`.ts` (ticket number to be filled in once the
   Step 9 — Users ticket exists; Step 9 is the next foundation step after this one
   and is the natural place to build the shared topbar/sidebar shell, since it is
   also where a real per-user identity surface first becomes necessary).

### Schema Follow-Up From Resolution #3 — Applied

Sections 2, 3, and 6 have been updated directly to reflect this resolution (no
longer just cross-referenced here): the `NotificationChannel` enum now includes
`BOTH` (Section 2), Commit 1's migration adds both the enum value and the
compound index in one pass (Section 3), `CreateNotificationDto`'s `@IsEnum`
includes `'BOTH'` (Section 3, Commit 2), and Section 6 has a dedicated acceptance
criterion for `BOTH` delivering both surfaces. Angular's `NotificationChannel`
representation (if surfaced in any DTO) must match this same four-value set when
Commit 8 is written.

---

*Plan created: 2026-07-27*
*Branch to create: feature/ACC-10-notification-service*
*Depends on: ACC-9 (merged to dev ✅)*
