# AccreditMe — Claude Code Master Instructions

## What Is AccreditMe

AccreditMe is a multi-tenant SaaS Digital Quality Management Platform for organizations
managing accreditation and quality assurance processes. Target market: Any organization
pursuing formal accreditation or quality management — healthcare, education, government,
manufacturing, financial services, energy, technology, and others.
GCC and MENA region is the primary geographic focus but the platform is designed for
global use.
Healthcare examples are used throughout this document for illustration only. No
industry-specific logic is hardcoded anywhere in the platform.

The platform is AI-first — every workflow has an AI assistance layer designed into it,
not retrofitted. AI is assistive, never autonomous. Pattern is always:
AI suggests → human reviews → human approves → system records with audit trail.

---

## Deployment Tiers

```
Tier 1 — Cloud SaaS (default)
  Shared infrastructure managed by AccreditMe.
  Target: small to mid-size organizations.
  Pricing: monthly subscription via Stripe.

Tier 2 — Dedicated cloud instance
  Isolated AccreditMe instance on AWS Bahrain or UAE
  in AccreditMe's account. Higher price point.
  Target: large hospitals and enterprise customers.

Tier 3 — On-premises / private cloud (future)
  Full containerized deployment on customer infrastructure.
  Enabled by Docker-first architecture from day one.
  Annual license model.
```

---

## Tech Stack

### Backend
- Runtime: Node.js with TypeScript — strict mode always
- Framework: NestJS
- ORM: Prisma
- Database: PostgreSQL (Supabase — Bahrain region)
- Auth: Better Auth (self-hostable, runs inside NestJS app)
- Job queues: BullMQ with Redis
- Real-time: NestJS WebSocket gateway (Socket.io)
- Workflow engine: Custom WorkflowService, database-driven (not XState — see Architecture Rules → Workflow Engine)
- Email: Resend
- Payments: Stripe
- Error tracking: Sentry
- Logging: Winston (structured JSON logs)
- Security: Helmet.js, @nestjs/throttler, class-validator, class-transformer
- PDF generation: LibreOffice headless (Docker sidecar)
- Virus scanning: ClamAV (Docker sidecar)
- Date handling: Luxon (all timezone operations)
- Hijri calendar: moment-hijri

### Frontend
- Framework: Angular 18+ (standalone components)
- UI components: PrimeNG (free MIT license) — one deliberate,
  evidence-based exception, now the REQUIRED pattern rather than a
  narrow one-off: `OverlaySelectComponent`
  (`frontend/src/app/shared/components/overlay-select/`, ACC-41,
  substantially extended by ACC-42) replaces `p-select`/
  `p-cascadeSelect` on any field where PrimeNG's own
  `ConnectedOverlayScrollHandler` scroll-chaining bug is reachable —
  in practice, every dropdown with 5+ options anywhere in the app,
  across all three DOM contexts (raw `p-dialog`, `EditDialogComponent`,
  routed pages under `AppShellComponent`'s `<main>`). Confirmed root
  cause (verified against PrimeNG's own source, `primeng-dom.mjs`): it
  closes the overlay on ANY scroll of ANY ancestor found via
  `DomHandler.getScrollableParents()`, with no supported way to
  disable or override that behavior — not a defect fixable within
  PrimeNG, a structural property of how it's built.
  `OverlaySelectComponent` is built on Angular CDK's `Overlay` +
  `RepositionScrollStrategy` instead, which repositions on ancestor
  scroll rather than closing (verified against
  `@angular/cdk/overlay`'s own source) — structurally immune to this
  bug class, not a workaround for it. This is a scoped exception for
  this specific failure mode, not a general PrimeNG replacement —
  `p-select` remains correct and preferred only for fields genuinely
  below the 5-option threshold, where scroll-chaining can't be
  reached regardless of DOM context. Also supports hierarchy mode
  (`optionGroupLabel`/`optionGroupChildren`, mirroring
  `p-cascadeSelect`'s own naming — required for any OrgUnit-style
  tree picker), custom item-template projection (`itemTemplate`, for
  option rows needing more than a plain label), and binds via either
  `formControlName`/`[formControl]` or plain `[(ngModel)]`. Known,
  deliberate gap: no filter-search box (typeahead only) — see
  SYSTEM-REFERENCE.md Section 10.7 for why that one is a real,
  confirmed-harder capability, not an oversight. Full mechanism
  detail, capability list, and complete consumer inventory (28 total):
  SYSTEM-REFERENCE.md Section 10.7.
- Styling: PrimeNG design tokens + Tailwind CSS
- Global styles: One SCSS file for app shell only
- State management: NgRx Signals
- Forms: Angular Reactive Forms
- i18n: ngx-translate (English + Arabic)
- Charts: PrimeNG Charts
- Diagrams: draw.io embedded (iframe embed)
- Excel export: SheetJS
- Typography: Inter (Google Fonts)
- Icons: PrimeIcons + Tabler Icons

### Infrastructure
- Backend hosting: Railway (auto-deploy from GitHub)
- Database: Supabase — Bahrain region (me-south-1)
- File storage: AWS S3 — Bahrain region (me-south-1)
- On-premises storage alternative: MinIO (S3-compatible)
- CDN: Cloudflare (free tier)
- Containers: Docker (every service containerized from day one)
- CI/CD: GitHub Actions

### AI Providers (tenant selects, AccreditMe's own key serves the request — see AI Providers Per Tenant)
- Default: Anthropic Claude API
- Enterprise option: Azure OpenAI
- Direct option: OpenAI API
- Tier 3 (on-premises) only: Ollama with local models

---

## Project Structure

```
accreditme/
├── backend/
│   ├── src/
│   │   ├── foundation/               # All foundation modules
│   │   │   ├── tenant/               # Tenant provisioning + config
│   │   │   ├── organization/         # Org units + hierarchy
│   │   │   ├── lookup/               # Lookup system
│   │   │   ├── roles/                # Roles + permissions
│   │   │   ├── workflow/             # Workflow engine (custom, database-driven)
│   │   │   ├── notifications/        # Notification service
│   │   │   ├── tasks/                # Task management
│   │   │   ├── users/                # User management
│   │   │   ├── committees/           # Committee management
│   │   │   └── meetings/             # Meeting management
│   │   ├── modules/                  # Functional modules
│   │   │   ├── standards/            # Module 1 — Standards management (build first)
│   │   │   ├── documents/            # Module 2 — Quality documentation
│   │   │   ├── quality-improvement/  # Module 3 — Quality improvement
│   │   │   └── audit/                # Module 4 — Audit management (build last)
│   │   ├── platform/                 # Super admin portal
│   │   ├── providers/                # Pluggable provider implementations
│   │   │   ├── auth/                 # Better Auth + Azure AD
│   │   │   ├── storage/              # S3 + MinIO + Local filesystem
│   │   │   └── ai/                   # Anthropic + Azure OpenAI + OpenAI
│   │   ├── common/                   # Shared guards, decorators, filters, pipes
│   │   │   ├── guards/               # TenantGuard, PermissionGuard, ThrottleGuard
│   │   │   ├── interceptors/         # AuditLogInterceptor, ResponseTransformer
│   │   │   ├── decorators/           # @Permissions(), @CurrentTenant(), @CurrentUser()
│   │   │   └── filters/              # GlobalExceptionFilter
│   │   ├── prisma/                   # PrismaService
│   │   └── main.ts
│   ├── prisma/
│   │   ├── schema.prisma             # Single source of truth for DB schema
│   │   └── migrations/               # Never edit manually
│   ├── Dockerfile
│   └── docker-compose.yml
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── core/                 # App-wide services, guards, interceptors
│   │   │   ├── shared/               # Shared components, directives, pipes
│   │   │   ├── layout/               # App shell, sidebar, topbar
│   │   │   ├── foundation/           # Foundation module UIs
│   │   │   └── modules/              # Functional module UIs
│   │   ├── assets/
│   │   │   └── i18n/
│   │   │       ├── en.json
│   │   │       └── ar.json
│   │   ├── styles/
│   │   │   ├── styles.scss           # Global — app shell only
│   │   │   └── tokens.scss           # AccreditMe design tokens
│   │   └── environments/
│   └── Dockerfile
├── .mcp.json                         # MCP server config (gitignored if contains secrets)
├── .env                              # Local env vars — NEVER commit
├── .env.example                      # Committed template — no real values
├── .gitignore
└── CLAUDE.md                         # This file
```

---

## Build Sequence (Revised)

Ticket numbers below are only shown for steps that already have a real
Linear ticket. Everything after Design Foundation is name-and-order
only — do not hardcode future ACC-# numbers here. Numbers get assigned
at /new-ticket time, not planned in advance: ACC-14 was originally
expected to be Committee Management but was consumed mid-project by an
unplanned fix ticket, and ACC-15 ended up as Design Foundation instead
of Meeting Management — hardcoding future numbers doesn't hold up.

### Foundation (Complete)
ACC-5  Step 5:  Tenant provisioning ✅
ACC-6  Step 6:  Organization structure + Working calendar ✅
ACC-7  Step 7:  Lookup system ✅
ACC-8  Step 8:  Roles + Permissions ✅
ACC-9  Step 9:  Workflow engine ✅
ACC-10 Step 7b: Notification service ✅
ACC-11 Step 8b: Task management + OrgPosition ✅
ACC-12 Step 9b: User management + Better Auth ✅

### Admin + Navigation (Complete)
ACC-13/14 Step 12: Navigation shell + Super Admin Portal + Tenant Admin
                Settings ✅ (merged to dev via PR #11, commit ff75e00)
                ACC-14 covers fixes found while browser-testing ACC-13
                (PrimeNG theme provider, demo-seed platform admin,
                login redirect, breadcrumb, sidebar nav separation) —
                folded into ACC-13's own PR/branch rather than merged
                separately; both tickets closed Done.
                (Stripe/billing deferred to Phase 2)

### Design Foundation (Complete)
ACC-15: Spacing/typography/component design foundation ✅ (merged to dev)
                Spacing/sizing scale, typography scale, consistent
                table/card/badge patterns using the existing --am-*
                CSS variables (status/severity colors defined in
                tokens.scss but currently unused), applied across the
                navigation shell, Super Admin Portal, and Tenant Admin
                Settings screens that already exist.
                Explicitly NOT full visual/brand polish (illustrations,
                distinctive layout personality) — that stays a separate
                future ticket, still positioned right before the demo
                milestone, after Document Management.

### Post-Design-Foundation Fixes (Complete)
ACC-16: Post-ACC-15 fixes ✅ (merged to dev)
                Translation key dedup, NG04002 navigation crash fix,
                Org Positions permission-seed gap (+ existing-tenant
                backfill), settings-hub permission filtering,
                last-admin lockout protection.
ACC-17: Tenant isolation fixes ✅ (merged to dev)
                PlatformGuard-only SYSTEM lookup category mutation,
                NotificationService.create() userId/organizationId
                validation, 3 corrected mislabeled tests.
ACC-18: Post-ACC-15 UI gaps ✅ (merged to dev)
                Navbar/notification-bell overlap, Add Unit modal
                conversion, Lookups page discoverability chevron,
                topbar profile-menu (My Profile/Logout).

### i18n / RTL Foundation (Complete)
ACC-19: Language switching and RTL layout support ✅ (merged to dev)
                language field on GET /auth/me, app-bootstrap language
                resolution, live profile-page language switch, central
                LanguageService (owns all translate.use()/dir/lang
                writes), 3 orphaned TODOs closed, empirical automated
                + manual RTL verification.
                Full RTL visual audit (auditing all ~15+ existing
                screens for RTL correctness — icon mirroring,
                breadcrumb arrow direction, table column order, form
                alignment) remains explicitly deferred, positioned at
                the same point as the full visual/brand polish ticket
                — right before the demo milestone, after Document
                Management. ACC-19 only built and verified the
                underlying mechanism on a representative sample (nav
                shell, one form, one table), not a full audit.

### Infrastructure Fixes (Complete)
ACC-20: Enabled real CI ✅ (merged to dev)
                backend/frontend/tenant-isolation jobs had been
                commented out since scaffold, 19 days post-
                initialization, never re-enabled. Also fixed lockfile
                drift (missing Linux-platform optional dependencies)
                and a missing prisma generate step in CI.
ACC-21: Fixed platformAdminGuard hard-reload race condition ✅
                (merged to dev)
                NavigationAccessService.loadAccess() added to the app
                initializer, chained after restoreSession().

### Auth Flow and Demo Seed Fixes (Complete)
ACC-23: demo-seed.ts refactored to genesis-only ✅ (merged to dev)
                Platform org + admin only — demo tenant now provisioned
                exclusively via the real Super Admin Portal "Create
                Tenant" flow, closing the drift bug where the
                hand-rolled script silently fell behind
                TenantService.bootstrap().
ACC-24: Fixed authInterceptor's blanket 401-redirect hijacking
                navigation ✅ (merged to dev)
                Was hijacking navigation on any pre-auth route
                (accept-invitation, forgot-password) — breaking
                invitation acceptance entirely for every real invited
                user.
ACC-25: acceptInvitation() surfaces real backend error messages ✅
                (merged to dev)
                Instead of a generic "invalid or expired" message for
                any failure (e.g. Better Auth's password-compromised
                check).

### Governance Modules (In Progress)
ACC-22: Committee Management ✅ (merged to dev)
                Full CRUD, membership management
                (CommitteeMembershipEvent audit trail, not workflow
                transitions), ACC-17's dormant committeeId gap closed
                across all 3 workflow.service.ts call sites,
                committees:approve permission fix + demo-tenant
                backfill, two-distinct-validation-paths pattern for
                reportingToCommitteeId/reportingToRoleId, and the
                generic WorkflowTransitionActionsComponent.
Meeting Management
               (depends on: committees)
               NOTE: Build a Dashboard/Home page BEFORE Meeting
               Management, not after — see Open/Deferred Items below.
               Meeting Management will introduce even more non-admin
               interaction (attendance, votes) and should inherit a
               working landing experience from day one rather than
               repeating the gap Committee Management just exposed.

### Error Handling Consistency (Complete)
ACC-26: Fixed user-role-assignment 400 error and object rendering ✅
                (merged to dev)
                p-select missing optionValue binding caused the 400;
                array-safe HTTP error-message extraction (new shared
                http-error.util.ts) swept across 25 files/30 call
                sites.
ACC-27: Global HttpExceptionFilter ✅ (merged to dev)
                CLAUDE.md had documented this filter's existence
                prematurely; confirmed during ACC-26 it was never
                actually built. Now real: consistent {statusCode,
                message, error} shape across the API, explicit
                allowlist for safe third-party errors (Better Auth's
                isAPIError(), reused from AuthService which now
                delegates to this filter instead of its own local
                check), Sentry wiring deliberately deferred (TODO
                placeholder only).

### Onboarding
Tenant Onboarding wizard
               (depends on: navigation + admin portal)

### Quality Modules (order enforced by dependencies)
Document Management
               (depends on: committees for approval mode)
Standards Management
               (benefits from: documents for evidence linking)
Incident Management
               (standalone — no hard dependencies)
CAPA Management
               (triggered by: incidents, audits)
Gap Management
               (triggered by: standards, audits, KPIs)
Audit Management
               (depends on: CAPA for findings follow-up)
KPI Management
               (benefits from: gap for below-target triggers)

### Offboarding
Tenant Offboarding
               (tenant deactivation without Stripe)

### Phase 2 — Monetization (after demo and validation)
Stripe + Billing
               - Stripe products and webhooks
               - Plan management with payment processing
               - Self-service tenant registration
               - Invoice generation
               - Module licensing enforcement

Platform Health Monitoring
               - Error rates, job queues, API latency, DB connections
               - The one item remaining from what was originally a
                 broader Super Admin "Platform Operations" scope;
                 tenant suspend/reactivate/extend-trial and the
                 platform-wide announcement banner shipped in ACC-13
                 instead of waiting for this phase (see Super Admin
                 Portal section)
               - Same phase/priority tier as Stripe + Billing above,
                 not a far-future item — always meant to ship right
                 after Stripe, not alongside Phase 3's wishlist items

### Phase 3 — Advanced Features
  Visual workflow canvas (draw.io)
  Enterprise auth: Azure AD, LDAP, SAML
  Power BI embed
  Public API + webhooks
  Multi-language AI (Arabic NLP)
  Mobile app

### Key Dependency Rules (do not violate)
  Meeting needs Committee
  Document needs Committee
  CAPA needs Incident OR Audit source
  Gap needs Standards OR Audit OR KPI
  Audit needs CAPA for findings
  KPI benefits from Gap
  All functional modules benefit from navigation (ACC-13/14, shipped first)

### Demo Strategy
  Target demo point: After Document Management
  At that point AccreditMe has:
    - Proper navigation shell
    - Controlled document management with approval workflows
    - Committee governance
    - Meeting management with minutes
    - Incident reporting
    - Corrective actions
    - User management with MFA
    - Role-based access control
  This is a compelling demo for GCC healthcare and government

---

## Module Design Specifications
Detailed business rules, workflows, and data models
for each functional module are documented in:
backend/Plans/module-designs.md

Read this file before implementing any functional module
(Document, Standards, Incident, CAPA, Gap, Audit, KPI — see Build
Sequence above for order; ticket numbers are assigned at /new-ticket
time, not hardcoded here). It contains:
- Workflow stages and transitions per module
- Business rules validated against international standards
  (ISO 9001, ISO 19011, JCI, CBAHI, FDA 21 CFR)
- AI integration points per module
- Cross-module relationships and data flow
- Data model requirements per module

## System Reference

A living, maintained technical inventory of every foundational
mechanism actually implemented in this codebase is documented in:
SYSTEM-REFERENCE.md (repo root)

Distinct from this file (decisions and the build log) and from
module-designs.md (business rules): SYSTEM-REFERENCE.md documents the
actual implemented shape of foundational, cross-cutting mechanisms —
model/schema shape, exactly what each service method does and does not
do, and which other modules currently consume it — verified against
the code, not the design intent.

**Read this file before planning any new foundational or
cross-cutting mechanism** — not just functional modules. It exists
directly because of an incident (ACC-28) where a new authorization
system was drafted without checking whether existing machinery already
solved most of the problem. Checking SYSTEM-REFERENCE.md first is how
that mistake is not repeated.

## Cross-Module Rules (from module-designs.md)

### Tasks
Every task MUST have sourceType and sourceId.
No standalone tasks. See TaskSourceType enum (ACC-11 — Task Management).
Task source types: MEETING, DOCUMENT, AUDIT, CAPA,
INCIDENT, CORRECTIVE_ACTION, STANDARD, KPI,
GAP, QUALITY_IMPROVEMENT_PLAN, COMMITTEE

### WorkflowObjectType Additions Schedule
Already in schema (ACC-9 — Workflow Engine):
  DOCUMENT_REQUEST, DOCUMENT, CHANGE_REQUEST,
  INCIDENT, AUDIT, CORRECTIVE_ACTION, MEETING, COMMITTEE

Add before Step 16 (Standards Management):
  ACCREDITATION_ROUND

Add before Step 18c (Gap Management):
  GAP

### Document Types Added
terms_of_reference added to lookup seed (ACC-6 — Organization structure + Working calendar)
(already committed to dev)

### Gap vs CAPA Distinction
Gap: strategic shortfall — what is wrong
CAPA: specific action — what to do about it
Never merge these concepts in the data model.
One Gap generates one or more CAPAs.
Gap is not closed until all its CAPAs are verified.

---

## Architecture Rules

### Multi-Tenancy — Non-Negotiable
- Every database table holding tenant data MUST have an organizationId field
- No Prisma middleware auto-injects organizationId — there is no such mechanism in
  `prisma.service.ts`. Every tenant-scoping guarantee is manual, per-service-method
  developer discipline: every query scopes by `id` AND `organizationId` together in
  the same `where` clause (`findFirst({ where: { id, organizationId } })`), never a
  bare `findUnique({ id })` followed by a separate check. Corrected here per
  SYSTEM-REFERENCE.md Section 8.1 (ACC-33 item 5) — this was previously documented
  as an automatic mechanism that does not exist; the real, weaker guarantee below
  is what actually protects tenant isolation today.
- NestJS TenantGuard validates JWT tenant matches requested resource on every endpoint
- NEVER trust organizationId from the request body — always from JWT
- Automated cross-tenant isolation tests run in CI — deployment blocked if any fail
  (this CI gate, not a Prisma-level guarantee, is the actual backstop — see
  SYSTEM-REFERENCE.md Section 8.4 for its own confirmed blind spots)
- A cross-tenant data leak is a business-ending event — treat it with maximum seriousness

### NestJS Conventions
- Controllers handle routing and input validation ONLY — zero business logic
- Services contain ALL business logic
- Every module is self-contained — owns its own controller, service, DTOs, and Prisma calls
- All incoming request bodies validated with DTOs using class-validator
- Use Guards for auth, tenant scoping, and permissions
- Use Interceptors for audit logging and response transformation
- Use Decorators for current user, current tenant, and permission requirements

### Provider Abstraction — Required for All Three Provider Types
All three pluggable providers (auth, storage, AI) MUST be implemented as interfaces
with multiple concrete implementations. Application code NEVER calls a provider directly.

```typescript
// Storage example — same pattern for Auth and AI
interface StorageProvider {
  upload(file: Buffer, path: string, mimeType: string): Promise<string>
  download(path: string): Promise<Buffer>
  delete(path: string): Promise<void>
  getSignedUrl(path: string, expiresInSeconds: number): Promise<string>
}

// Implementations
class S3StorageProvider implements StorageProvider { ... }
class MinioStorageProvider implements StorageProvider { ... }
class LocalFilesystemProvider implements StorageProvider { ... }
```

Tenant config drives which implementation is injected at runtime — true for
Auth and Storage. **AI is a deliberate exception**, resolved after
investigation (full resolution under AI Providers Per Tenant below): tenant
config selects WHICH provider serves a request, never whose credentials pay
for it — for Tier 1/2, AccreditMe's own platform-level key is used
regardless of tenant selection, not a tenant-supplied key.
Tenant secrets (API keys, connection strings) are ALWAYS encrypted before DB storage.
Decrypted only at runtime when making provider calls.

### Auth Providers Per Tenant
```
Option 1: Better Auth local accounts (default for all tenants)
Option 2: Azure Active Directory / Entra ID via OIDC
Option 3: Google Workspace via OIDC (future)
```
authProvider field on tenant record drives login routing.
SSO tenants are redirected to their IdP. Local tenants use Better Auth directly.

### Storage Providers Per Tenant
```
Option 1: AWS S3 — Bahrain region (default)
Option 2: MinIO on customer infrastructure (on-premises S3-compatible)
Option 3: Local filesystem / NAS mount (legacy on-premises)
```
All built against the StorageProvider interface. Zero application code changes
when switching providers — only tenant configuration changes.
Local filesystem provider streams files through NestJS API (no signed URLs).

### AI Providers Per Tenant
```
Option 1: Anthropic Claude API (default)
Option 2: Azure OpenAI
Option 3: OpenAI API direct
Option 4: Ollama with local models (Tier 3 on-premises only)
```
Same interface pattern, with one deliberate exception to the general
Provider Abstraction rule above. For Tier 1 (Cloud SaaS) and Tier 2
(Dedicated Cloud Instance): a tenant admin SELECTS their preferred provider
from the list above, but AccreditMe maintains its OWN platform-level key
per provider — traffic is always routed through AccreditMe's key,
regardless of tenant selection. Tenant-facing "bring your own API key" was
considered and explicitly REJECTED, specifically to keep the AI credit
system (`Organization.settings.ai`, `AiCreditPack`, `AiFeatureCost` — see
AI — Universal Credit-Based Add-on below) fully intact and in AccreditMe's
control: provider selection affects WHICH backend serves a request, never
who pays for it or how usage is metered.

Model/quality selection works the same way, one level more specific: a
tenant admin selects a QUALITY TIER (e.g. Standard / Premium), never a
specific model by name. AccreditMe's own engineering decides which real
model backs each tier, per provider — this preserves the credit system's
margin calibration, since a tenant cannot silently inflate AccreditMe's
real cost by having a cheap-model-calibrated credit price actually execute
against an expensive model.

Pricing rule: each (feature, tier) combination gets ONE flat credit price,
calibrated CONSERVATIVELY — set against the most expensive real per-call
cost among whichever providers are actually offered at that tier. A tenant
sees a predictable, flat credit cost regardless of which provider they
picked; AccreditMe's margin is protected against the worst case, not an
average.

STANDING ENGINEERING RULE for whenever a new provider is added to the
platform: whoever wires it up MUST select a cost-comparable model for each
existing tier — never just that vendor's flagship model regardless of
relative cost. When actually built, this changes `AiFeatureCost`'s data
shape from `(feature → credit cost)` to `(feature, tier → credit cost)`.

Tier 3 (On-Premises / Private Cloud) sits on a completely separate
annual-license commercial model, outside the credit system entirely — a
Tier 3 customer's own platform admin configuring their deployment against a
self-hosted model (e.g. Ollama) is consistent with this design, not an
exception to it, since Tier 3 was never intended to be credit-metered.
AI keys (AccreditMe's own, one per provider) encrypted at rest. AI always
assistive — output always reviewed by human. Every AI interaction logged:
prompt, model used, response, actor, timestamp.

### Email Provider (IEmailProvider)
Current implementation: Resend (hardcoded in NotificationEmailProcessor)
Planned abstraction: IEmailProvider interface (same pattern as AIProvider)

```typescript
interface IEmailProvider {
  send(options: {
    to: string | string[]
    subject: string
    html: string
    from?: string
    fromName?: string
  }): Promise<void>
}
```

Planned implementations:
```
ResendEmailProvider     (current, cloud default)
SmtpEmailProvider       (on-premises/Exchange via SMTP relay)
Office365EmailProvider  (Microsoft 365 via Graph API + OAuth2)
SendGridEmailProvider   (alternative cloud)
SesEmailProvider        (AWS SES)
```

Per-tenant config in Organization.emailConfig (encrypted JSON):
```json
{
  "emailProvider": "smtp"|"office365"|"resend"|"sendgrid"|"ses",
  "emailConfig": { "...encrypted provider config...": true }
}
```

Platform default: ResendEmailProvider with AccreditMe platform key.
From: noreply@accreditme.com

Build sequence:
```
ACC-10 (Step 7b, done): Resend hardcoded in NotificationEmailProcessor
Step 12 (Super Admin): email provider settings UI per tenant
Between Step 12-14:    refactor NotificationEmailProcessor to resolve
                       IEmailProvider per tenant from Organization.emailConfig
```

Microsoft Exchange note:
```
On-premises Exchange: SmtpEmailProvider via SMTP relay (port 587)
Exchange Online (Office 365): Office365EmailProvider
  (requires Azure AD app registration by customer IT team)
```

### Workflow Engine

#### Architecture Decision
Custom WorkflowService reading from database dynamically.
XState is NOT used — tenant-configurable templates cannot
be defined at compile time, eliminating XState's main benefits.
All audit trail, tracking, and monitoring comes from the
database design, not from a state machine library.

#### Core Concepts
- WorkflowTemplate: tenant-configurable stage/transition definitions
- WorkflowStage: a named state in the lifecycle with SLA and assignee rules
- WorkflowTransition: named action moving object between stages (button label)
- WorkflowInstance: a running instance tied to a specific object (document/incident/audit)
- WorkflowInstanceStage: record of every stage entry with timing and outcome
- WorkflowApproval: individual approval decisions within a stage
- WorkflowTransitionAction: actions that fire on transition (internal + webhook)
- WorkflowActionLog: execution record for every action fired

#### Object Types with Workflows
DOCUMENT_REQUEST, DOCUMENT, CHANGE_REQUEST, INCIDENT,
AUDIT, CORRECTIVE_ACTION, MEETING, COMMITTEE

#### Stage Approval Modes
SINGLE: one approver
SEQUENTIAL: multiple approvers one after another — one rejection stops chain
PARALLEL: multiple approvers simultaneously — configurable threshold (ALL/MAJORITY/ANY)
COMMITTEE: formal vote with quorum requirement

#### Assignee Resolution Strategies
SPECIFIC_USER, ROLE, ORG_UNIT_HEAD, SELF, COMMITTEE, ROUND_ROBIN

#### Transition Conditions (who can trigger)
SPECIFIC_USER, ROLE_BASED, ANY_AUTHENTICATED, SYSTEM_AUTOMATIC

#### Internal Actions (fire on every transition)
- CREATE_TASK: assign task to stage assignee with SLA due date
- SEND_NOTIFICATION: notify relevant parties
- GENERATE_PDF: snapshot of object at this stage
- LOCK_DOCUMENT: prevent editing during review
- LOG_AUDIT: always fires, cannot be disabled

#### External Actions (webhook-based)
- Tenant admin configures webhook URL per transition
- AccreditMe POSTs structured JSON payload to external system
- Retry logic via BullMQ (3 retries, configurable timeout)
- Every webhook call logged in WorkflowActionLog
- Supports custom headers for authentication

#### Validator Conditions (must be true before transition)
- Required fields filled
- Minimum attachments present
- All previous stage tasks completed
- Minimum approvals reached

#### SLA Rules
- SLA defined per stage in working days
- Uses WorkingCalendarService for calculation
- GCC weekends, public holidays excluded
- BullMQ job checks for SLA breaches every 15 minutes
- Escalation chain configurable per stage

#### Default System Workflows
Default workflows are defined in:
  backend/src/foundation/workflow/workflow.seed.ts
  backend/Plans/module-designs.md

Do not maintain workflow stage details in CLAUDE.md —
module-designs.md is the authoritative source.
Current defaults: DOCUMENT_REQUEST (5 stages),
DOCUMENT (7 stages), CHANGE_REQUEST (5 stages),
INCIDENT (5 stages, 2 paths), AUDIT (10 stages ISO-19011),
CORRECTIVE_ACTION (10 stages CAPA), MEETING (6 stages),
COMMITTEE (6 stages)

#### Tenant Configuration UI (ACC-9 — Workflow Engine)
Structured form-based workflow builder (not visual canvas).
Tenant admin can: add/edit stages, define transitions, set assignees,
configure SLAs, set approval modes, add webhook actions.
Visual canvas (draw.io) deferred to Phase 3.

#### Visual Canvas — Phase 3
draw.io embed as premium workflow builder feature.
Runs as stateless Docker container — no extra infrastructure.
Canvas reads from and writes to WorkflowTemplate database records.
Built in Phase 3 when paying customers justify the engineering investment.

#### Webhook Integration
Tenant admin configures webhook URLs per transition in the workflow builder.
AccreditMe fires webhooks via BullMQ background jobs.
Use cases: notify HIS on document publish, update SharePoint on approval,
trigger training system on new procedure, send audit results to ministry portal.
Full visual integration builder (n8n-style) deferred to Phase 3.

### Task System
- Tasks are created two ways:
  1. Automatically by workflow engine (CREATE_TASK action)
  2. Manually by users with tasks:create permission
  Every task MUST have sourceType and sourceId regardless
  of how it was created — no standalone tasks
- Single TaskService used by all modules
- SLA calculated by WorkingCalendarService — accounts for working days, hours, holidays
- Escalation triggered automatically when SLA is breached
- Task reassignment and absence coverage — see Absence and
  Departure Management section below

### Absence and Departure Management
Full design in module-designs.md.
Three patterns:
  Pattern 1: Acting assignment (planned absence)
  Pattern 2: Manual reassignment (admin action)
  Pattern 3: Role-based fallback (vacancy)

User model additions (ACC-12 — User Management):
  outOfOfficeFrom, outOfOfficeTo, actingUserId

WorkflowService checks out-of-office when resolving
assignee — routes to actingUser if set.

User departure triggers bulk-reassignment flow:
  tokenVersion incremented (all JWTs revoked)
  All open assignments flagged or transferred
  Tenant Admin notified with full list

### Notification Service
- Event-driven — modules emit events, NotificationService subscribes
- Never hardcode notification logic inside modules
- Channels: in-app (WebSocket), email (Resend), future: SMS, Teams, WhatsApp
- Notification rules configurable per tenant
- Digest mode available per notification type (user preference)
- AI generates personalized morning briefing from pending notifications

### Working Calendar and SLA
- ALL due date and SLA calculations go through WorkingCalendarService
- No module calculates its own dates
- All timestamps stored as UTC in PostgreSQL — no exceptions
- Luxon handles all timezone conversions
- Tenant configures: working days, working hours, timezone, holidays
- GCC default: Sunday-Thursday, 08:00-16:00, UTC+3
- Task assigned outside working hours: SLA starts next working day
- Escalation triggers only fire during working hours

### Prisma Rules
- schema.prisma is the SINGLE source of truth for the entire database
- After ANY schema change: npx prisma migrate dev --name "describe_change_here"
- NEVER modify migration files manually
- Always run npx prisma generate after schema changes
- AuditLog table is append-only — no UPDATE or DELETE ever permitted
- Use npx prisma studio to inspect data during development

### TypeScript Rules
- Always strict mode — zero any types without explicit documented justification
- Interfaces for data shapes, classes for NestJS services and controllers
- DTOs in a dto/ subfolder inside each module
- Enums for all fixed value sets (status, provider type, permission strings, etc.)

---

## Lookup System

Two-layer model for all dropdown values across the application.

```
Layer 1 — System lookups (shipped with AccreditMe)
  Visible to all tenants. Cannot be deleted. Can be hidden or label-overridden.

Layer 2 — Tenant lookups (customer-defined)
  Tenant admins add values, define attributes, reorder, activate/deactivate.
```

### System Lookup Categories (shipped defaults)
```
committee_type            Quality Committee, Safety Committee, Board, etc.
committee_member_role     Chairman, Secretary, Member, Observer, etc.
document_type             Policy, Procedure, Form, Platform, Manual, etc.
document_section_type     Purpose, Scope, Definitions, Responsibilities, etc.
incident_type             Clinical, Operational, Safety, Environmental, etc.
incident_severity         Critical, High, Medium, Low
audit_type                Internal, External, Surveillance, Follow-up, etc.
corrective_action_type    Immediate, Corrective, Preventive
standard_body             JCI, CBAHI, ISO 9001, ISO 14001, local MOH, etc.
gap_category              Process, People, Technology, Environment, etc.
meeting_type              Regular, Extraordinary, Emergency, etc.
```

### Attribute Schema
Each lookup category defines a JSON schema for additional attributes per value.
UI renders attribute form dynamically from schema.
Example — document_type attributes:
  requiresFlowchart: boolean
  defaultReviewCycleMonths: number
  numberingPrefix: string
  requiresCommitteeApproval: boolean
  defaultRetentionYears: number

---

## Permission System

Permission strings follow {module}:{action} pattern.

```
documents:view              documents:create          documents:submit
documents:review            documents:approve         documents:publish
documents:manage_templates  documents:manage_numbering
standards:view              standards:manage          standards:link_evidence
audits:view                 audits:create             audits:execute
audits:report               audits:close
incidents:view              incidents:report          incidents:investigate
incidents:approve_plan      incidents:close
meetings:view               meetings:manage           meetings:record_minutes
meetings:approve_minutes
committees:view              committees:manage          committees:approve
committees:create            committees:edit_details    committees:add_member
committees:remove_member     committees:change_member_role
tasks:view                  tasks:create              tasks:reassign
tasks:complete              tasks:manage
org:view                    org:manage
users:view                  users:manage              users:invite
roles:view                  roles:manage
lookups:view                lookups:manage
workflows:view              workflows:manage
billing:view                billing:manage
reports:view                reports:export
platform:admin              platform:impersonate
```

Every API endpoint decorated with @Permissions('module:action').
PermissionGuard checks JWT permissions on every request after TenantGuard.

Task delegation via out-of-office acting assignment — see Absence Management
section in module-designs.md

---

## Security Configuration

### Rate Limiting (@nestjs/throttler)
```
Global:           100 requests / 60 seconds per IP
Auth endpoints:   5 attempts / 15 minutes per IP
File upload:      10 uploads / 60 seconds per tenant
AI endpoints:     20 requests / 60 seconds per tenant
```

### File Upload Security
- Validate actual MIME type via mime-types — not just file extension
- ClamAV virus scan every upload before storing to S3
- Max file size: 50MB default, configurable per tenant plan
- Signed URLs only for file access — direct S3 paths never exposed to clients
- Signed URL expiry: 15 minutes for downloads, 5 minutes for uploads

### Security Headers (Helmet.js in main.ts)
- Content-Security-Policy
- HTTP Strict Transport Security
- X-Frame-Options: DENY
- X-Content-Type-Options: nosniff
- Referrer-Policy: strict-origin-when-cross-origin

### Token Management
- JWT expiry: 15 minutes
- Refresh token expiry: 7 days with rotation
- tokenVersion integer per user — incremented on role change, validated every request
- Max concurrent sessions: 5 per user (configurable per tenant)
- Forced logout on role change or account suspension

### Audit Trail
- AuditLog table: actor, timestamp, action, objectType, objectId, before, after, tenantId, ip
- Append-only — Prisma middleware blocks any UPDATE or DELETE on this table
- Retained for 3 years minimum
- Included in tenant data export

---

## Data Retention Policy

Configured per tenant with system minimums that cannot be reduced.

```
Documents (published)           10 years after obsolescence
Audit records                   7 years after closure
Incident records                5 years after closure
Corrective action records       5 years after closure
Meeting minutes                 10 years
User activity / audit logs      3 years
Background job logs             90 days
```

Nightly background job (BullMQ) checks for records approaching expiry.
Approaching expiry: archived state (read-only, S3 Glacier, flagged in UI).
Post-expiry deletion requires explicit tenant admin confirmation.
Deletion certificate (signed PDF) issued after confirmed deletion.

---

## GDPR and Data Privacy

```
1. Data export
   Tenant admin: full organization data export as JSON + CSV
   User: personal data export covering their own records

2. Right to erasure
   Deleted user PII anonymized: name to "Deleted User", email to null
   Audit trail entries de-identified but never deleted
   Organizational records preserved — only PII removed

3. Consent tracking
   TOS and privacy policy version accepted stored per user
   Timestamp of acceptance recorded
   Re-consent triggered on policy version change

4. Data processing register
   Maintained as an internal AccreditMe document (not a system feature)
```

---

## Localization

### Language
- English and Arabic supported from day one
- ngx-translate for all UI text
- Language preference stored per user, defaulted from tenant config
- Arabic activates RTL layout globally via Angular dir binding
- PrimeNG RTL mode enabled when Arabic active
- AI prompts include language instruction: respond in user's preferred language
- All system notification templates maintained in both languages

### Timezone and Calendar
- All DB timestamps: UTC only — no exceptions
- Luxon for all timezone conversion in NestJS
- Tenant timezone configured in settings
- Hijri calendar display toggle per user — moment-hijri for conversion
- Source of truth always Gregorian UTC — Hijri is display only

### Working Calendar
- Tenant configures: working days, working hours start/end, timezone
- GCC default: Sunday-Thursday, 08:00-16:00, UTC+3
- Public holidays configured per tenant per year (bilingual name, recurring flag)
- Organization-specific holidays also configurable
- ALL due date and SLA calculations use WorkingCalendarService
- Escalation triggers only fire during working hours

---

## Document Management Rules

### Document Numbering
- Auto-generated per document type and org unit
- Format: {TYPE_PREFIX}-{ORG_UNIT_CODE}-{YEAR}-{SEQUENCE}
- Example: POL-ICU-2024-001
- Format configurable per tenant via lookup attributes
- Codes never reused — even after document obsolescence

### Document Authoring Flow
```
1. Author creates document record in AccreditMe
2. System generates pre-filled DOCX template via docxtemplater
3. Author downloads, edits in MS Word (Track Changes enabled)
4. Flowchart sections: draw.io embedded editor
   (saves XML source + PNG to S3, PNG injected into DOCX at placeholder)
5. Author uploads edited DOCX back to AccreditMe
6. System converts DOCX to PDF via LibreOffice headless
7. Document enters workflow (review, approve, publish)
```

### Document Review Flow
```
1. AccreditMe distributes reviewer copy to each reviewer
2. Reviewer downloads, annotates with Word Track Changes + Comments
3. Reviewer uploads annotated copy back to AccreditMe
4. AccreditMe collects all reviewer copies — one card per reviewer
5. Author downloads all reviewer copies from one screen
6. Author uses Word Compare and Combine to consolidate
7. Author uploads clean new draft — cycle repeats or advances
```

### Document Access Control
- Published documents: visible org-wide by default
- Department-restricted: visible only to assigned org unit
- Confidential: restricted to specific roles (configurable per document type)
- Read acknowledgement: staff confirm reading published documents
  Tracked per user. Reports show acknowledgement status.

---

## AI Integration Points

AI present at every significant user action.
Pattern: AI suggests → human reviews → human approves → recorded in audit trail.
All AI interactions logged: actor, model, prompt summary, response summary, timestamp.

### Foundation Layer
```
Working calendar:   Suggest public holidays for tenant's country/year
Lookup management:  Suggest missing lookup values based on industry standards
Workflow config:    Suggest appropriate workflow template for object type
```

### Module 2 — Documents
```
Drafting:           Generate full document draft from prompt
Template fill:      Pre-fill all sections from document title + type + standard
Review assist:      Flag sections conflicting with linked standards
Consolidation:      Compare all reviewer copies, summarize differences
Similarity:         Detect overlap/conflict with existing published documents
Readability:        Score and flag overly complex language
```

### Module 1 — Standards
```
Interpretation:     Plain-language explanation of each measurable element
Gap analysis:       Identify missing evidence for a standard node
Evidence suggest:   Auto-suggest which unmapped standards a document satisfies
```

### Module 3 — Quality Improvement
```
Root cause:         Suggest probable root cause category from incident description
Action plan:        Generate corrective action plan template
Pattern detect:     Surface recurring incident patterns across time and departments
Effectiveness:      Predict corrective action plan effectiveness
```

### Module 4 — Audit
```
Checklist gen:      Generate checklist from standards + department + scope
Finding class:      Classify finding severity from description
Report draft:       Draft audit report narrative from structured findings
Risk predict:       Suggest high-risk audit focus areas from historical data
```

### Meeting Management
```
Agenda gen:         Generate from open action items, pending approvals, overdue tasks
Minutes draft:      Draft full minutes from structured inputs
Action extract:     Extract and create tasks from meeting minutes text
```

### Cross-Module
```
Global assistant:   Natural language query interface on every page
Morning briefing:   AI-generated daily summary replacing raw notification list
Notifications:      Personalized context-aware notification text per user
Language:           All AI outputs in user's preferred language (Arabic/English)
```

---

## Background Jobs (BullMQ + Redis)

Never block API requests with long-running tasks.
Always run as background jobs:

```
pdf-generation      DOCX to PDF via LibreOffice headless
ai-processing       All AI API calls for document generation
email-delivery      All outbound emails via Resend
file-processing     Virus scan + MIME validation after upload
data-retention      Nightly check for records approaching retention expiry
sla-monitor         Every 15 minutes — check SLA breaches, trigger escalations
notification-digest Daily digest emails for digest-mode users
data-export         Tenant data export packages (async, notified when ready)
report-scheduler    Scheduled automated report generation and email delivery
```

---

## Tenant Lifecycle

### Onboarding
```
1. Self-service signup with email verification
2. Onboarding wizard:
   a. Organization name, country, subdomain
   b. Timezone, preferred language, working calendar
   c. Auth provider selection
   d. Storage provider selection
   e. AI provider selection (no API key entry — AccreditMe's own
      platform key serves the request regardless of selection,
      see AI Providers Per Tenant)
3. System auto-provisions default lookups, workflows, roles, notifications
4. 14-day free trial — no credit card required
5. Welcome email sequence (day 1, 7, 13)
```
Org unit / position / head-role setup (per
backend/Plans/step-40-org-position-unit-head.md) has no home in this
wizard yet — flagged, not designed here. The original note for this
(step-02-organization-structure.md's Section 11, "Users: one primary
unit + optional acting-as unit with expiry date — note for Step 9")
was silently dropped when Step 9 was built; this line exists so the
ACC-40 concepts don't suffer the same fate.

### Subdomain Routing
- Each tenant gets {slug}.accreditme.com
- Subdomain chosen during onboarding — validated unique
- Cannot be changed after first non-admin user logs in
- Wildcard SSL via Let's Encrypt (automatic on Railway)

### User Types — Key Distinction
```
Full users     — Active system users: quality staff, managers, auditors,
                 coordinators. Full platform access based on assigned roles.
                 Counted against the plan's full-user seat limit.

Staff members  — Document portal only: receive and acknowledge published
                 documents. No system access, no role assignment, no workflow
                 participation. Separate seat pool from full users.
```

### Subscription Plans (Stripe)
```
Starter:
  10 full users, 100 staff members
  10 GB storage
  Modules: Standards, Documents, Quality Improvement
  Basic AI features (Anthropic Claude, shared quota)
  14-day free trial — no credit card required

Professional:
  50 full users, 500 staff members
  100 GB storage
  All modules: Standards, Documents, Quality Improvement, Audit, KPI
  Full AI features (Anthropic Claude, higher quota)
  Full Arabic RTL support
  14-day free trial — no credit card required

Enterprise:
  Unlimited full users, unlimited staff members
  1 TB storage
  All modules
  Full AI features + custom AI provider (Azure OpenAI or own OpenAI key)
  Dedicated cloud instance (Tier 2) or on-premises (Tier 3) option
  Custom annual contract — no Stripe self-service
```

### Add-ons (available on all plans, billed via Stripe)
```
Extra full users:     per additional seat
Extra staff members:  per 100-member block
Extra storage:        per 10 GB block
```

- Overage warnings at 80% and 95% of limits
- Hard limits at 100% — uploads blocked, no data corruption
- Stripe generates and emails invoice PDF automatically
- Enterprise custom contracts invoiced outside Stripe

### Offboarding
```
1. 30-day cancellation notice period
2. Data accessible for 30 days post-cancellation
3. Day 30: automatic full data export emailed to tenant admin
4. Day 45: all data deleted from production systems
5. Deletion certificate issued (signed PDF with date and scope)
```

### Backup and Recovery
```
Tier 1/2 (cloud):
  Database: Supabase automated daily backup, 30-day point-in-time recovery
  Files: AWS S3 versioning + cross-region replication
  RTO: 4 hours (Tier 1), 2 hours (Tier 2)
  RPO: 24 hours (Tier 1), 4 hours (Tier 2)

Tier 3 (on-premises):
  Customer's responsibility — documented in contract
```

---

## Pricing and Module Strategy

### Module Clusters
Three types of modules:

```
ANCHORS (strong standalone value):
  Document Management, KPI Management,
  Committee Management, Meeting Management

PAIRS (always sold together):
  Audit + CAPA (inseparable)
  Incident + CAPA (inseparable)
  Gap + at least one source module

CONNECTORS (never standalone):
  CAPA — requires Audit or Incident or Gap
  Gap Management — requires Standards or Audit or KPI
  Standards Management — requires at least one evidence module
```

Module dependency rules enforced by platform:
```
RULE 1: CAPA requires Audit OR Incident OR Gap
RULE 2: Gap requires Standards OR Audit OR KPI
RULE 3: Standards requires Documents OR Audit OR Incident
RULE 4: System warns if Audit enabled without CAPA
RULE 5: System warns if Incident enabled without CAPA
```

### Plans (managed in DB by Platform Admin — not hardcoded)
Three base plans:
```
STARTER: entry level, Document Control focus
PROFESSIONAL: quality operations, module selection
ENTERPRISE: full platform, unlimited, custom contract
```

Standards Management is READ_ONLY in Starter,
FULL in Professional and Enterprise.

### AI — Universal Credit-Based Add-on
AI is available on ALL plans as a credit-based add-on.
Not tied to any specific plan tier.
Platform Admin configures:
- Credits included per plan per month
- Credit pack options and prices
- Credit cost per AI feature (AiFeatureCost table)

AI credit costs per feature (platform admin adjustable):
```
LIGHT (1-5 credits):
  task_title_suggestion: 1
  task_description_drafting: 2
  meeting_agenda_generation: 3
  standard_interpretation: 3
  severity_suggestion: 2
  similar_incident_detection: 3

MEDIUM (5-20 credits):
  rca_assistance: 5
  capa_suggestion: 5
  morning_briefing: 5
  minutes_drafting: 8
  committee_health_report: 10
  evidence_suggestion_per_element: 2
  tor_drafting: 10

HEAVY (20+ credits):
  gap_analysis_report: 20
  readiness_score: 30
  overdue_pattern_analysis: 15
  decision_pattern_analysis: 15
  standard_comparison: 20
  mock_survey_per_standard: 50
```

Note: LIGHT/MEDIUM/HEAVY above classifies FEATURES by complexity (how
many credits a call costs) — unrelated to the Standard/Premium QUALITY
TIER concept in "AI Providers Per Tenant" above, which classifies which
MODEL serves a request. A feature's LIGHT/MEDIUM/HEAVY bucket and its
Standard/Premium tier are independent axes — e.g. a HEAVY feature run at
Standard quality and a LIGHT feature run at Premium quality are both
valid, separately-priced combinations once (feature, tier) pricing is
actually built.

### Plan Configuration Data Model
Plans are stored in DB — never hardcoded:
```
Plan: id, name, nameEn, nameAr, monthlyPrice,
      annualPrice, maxFullUsers, maxStaff,
      maxStorageGb, aiCreditsPerMonth,
      isActive, isPublic, sortOrder

PlanModule: planId, moduleKey, accessLevel
            (FULL/READ_ONLY/NONE)

AiCreditPack: name, credits, price, isActive,
              availableTo[], sortOrder

AiFeatureCost: featureKey (unique), creditCost,
               description
```

### Organization AI Settings (in Organization.settings JSON)
```json
{
  "modules": { "documents": true, "audits": true, ... },
  "ai": {
    "enabled": true,
    "monthlyCredits": 500,
    "creditsUsed": 127,
    "creditsRemaining": 373,
    "resetDate": "2026-08-01",
    "overageEnabled": true
  }
}
```

### Platform Admin Controls (ACC-13 — Super Admin Portal)
Platform admin manages without code deployment:
- Plan configuration (price, limits, modules, AI credits)
- AI credit packs (name, credits, price)
- AI feature costs (creditCost per featureKey)
- Per-tenant overrides (custom plan, trial access, credit boost)
- Tenant usage monitoring

### AI Runtime Flow
Every AI call:
```
1. Load AiFeatureCost for featureKey from DB
2. Check organization.settings.ai.creditsRemaining >= cost
3. If insufficient → return FeatureQuotaExceededException
4. Execute AI call via AIProvider
5. Deduct credits from organization settings
6. Log to AiInteractionLog with creditCost field
7. If creditsRemaining = 0 → notify tenant admin
```

Monthly BullMQ job:
```
Reset creditsUsed to 0 for all organizations
Set creditsRemaining = Plan.aiCreditsPerMonth
Set resetDate = first day of next month
```

---

## Reporting and Analytics

```
Reporting Tier 1 — Built-in dashboards
  Pre-built KPI dashboards per module using PrimeNG Charts
  Compliance scores, document lifecycle, audit findings, incident patterns

Reporting Tier 1 — Export engine
  Every table exportable to formatted XLSX via SheetJS
  Scheduled exports: daily/weekly/monthly via email

Reporting Tier 2 — Custom report builder
  Drag-and-drop report builder
  Save, schedule, and share custom reports
  Power BI embed for enterprise tenants
```

---

## Super Admin Portal

Separate NestJS module and Angular route.
Accessible only to AccreditMe platform administrators.

```
Tenant management:  List all tenants, usage, plan, last activity
                    Suspend / reactivate / extend trial
                    ✅ shipped in ACC-13 — moved in from the original
                    "defer to billing phase" plan since none of it
                    depends on Stripe (just Organization status/date
                    fields), so it was kept rather than stripped back
                    out once already built
Impersonation:      Log in as tenant admin — every action logged
                    ✅ shipped in ACC-13
Announcements:      Platform-wide banner messages
                    ✅ shipped in ACC-13 — same reasoning as tenant
                    management above, moved in from deferral
Platform health:    Error rates, job queues, API latency, DB connections
                    Still deferred — see Phase 2 — Monetization
                    ("Platform Health Monitoring", ships alongside
                    Stripe + Billing). The only item left from what
                    was originally a broader Super Admin "Platform
                    Operations" scope; the other two items above
                    shipped instead of waiting for this phase.
Billing overview:   Revenue, churn, trial conversions, plan distribution
                    Deferred to Phase 2 — Monetization (Stripe-dependent)
```

### Demo Seed (Development Only)
`npm run seed:demo` (backend) creates a platform Organization
(`isPlatformOrg: true`) and a `PLATFORM_ADMIN` user, properly
role-assigned via the same seeding pattern used for the demo tenant
admin, alongside the existing demo tenant — credentials printed to
console next to the existing demo admin credentials. Lets the Super
Admin Portal be exercised through the real `/login` page instead of
hand-editing `Organization.isPlatformOrg` and role assignments in
Prisma Studio.

## Key Architecture Decisions (ACC-13/14)

- **Platform admin access is never role/permission alone.**
  `PLATFORM_ADMIN` is still seeded into every tenant's own Role table
  (harmless, inert — `SYSTEM_ROLE_SEED` runs identically for every
  organization). Real gating is `PlatformGuard`: requires BOTH
  `Organization.isPlatformOrg = true` (settable only via direct DB
  access — no API path exists to set it) AND the `platform:admin`
  permission. Neither alone is sufficient. This closes a real
  cross-tenant privilege-escalation gap found during ACC-13 planning: a
  tenant admin who self-assigns `PLATFORM_ADMIN` in their own org would
  otherwise pass a naive permission-only check, since that role's
  permission set is identical regardless of which org it's assigned in.
- `PLATFORM_ADMIN` is filtered out of the assignable-roles list shown
  to non-platform-org tenants — defense in depth alongside
  `PlatformGuard`, not a replacement for it.
- Platform admin navigation is fully separated from tenant navigation
  in the sidebar — tenant-scoped nav items (Organization Structure,
  Working Calendar, Lookups, Roles, Workflows, Tasks, Users, Admin
  Settings) are hidden entirely when `isPlatformAdmin()` is true,
  showing only Super Admin. Platform admins are operators of the
  product, not users of it — nothing in this product has them managing
  their own org's HR/roles/workflows day to day.
- **PrimeNG v21 theming is provider-based** (`providePrimeNG()` + a
  theme preset registered in `app.config.ts`'s providers array), NOT a
  CSS import in `angular.json` — the old
  `primeng/resources/themes/*.css` import pattern from pre-v18 PrimeNG
  no longer applies. This was a gap since the original Angular scaffold
  (confirmed byte-identical on `dev` before ACC-13 touched anything),
  fixed as part of this work. Brand colors (`--am-blue-primary` etc.)
  layer on top via the preset's own token config
  (`AccreditMePreset` in `frontend/src/app/core/theme/accreditme-preset.ts`),
  not via loose `:root` CSS variables alone — PrimeNG components never
  read plain CSS custom properties directly, only PrimeNG's own
  generated `--p-*` tokens.
- `BreadcrumbComponent` must build from
  `router.routerState.snapshot.root` (the fully-resolved
  `ActivatedRouteSnapshot` tree, computed before any component
  activates) and read each route's own `routeConfig.data` — never the
  resolved/inherited `snapshot.data`. A naive implementation walking
  the live `ActivatedRoute.children` tree will crash on nested
  lazy-loaded routes (that tree is populated incrementally, outlet by
  outlet, DURING component activation — not guaranteed complete the
  instant a template child like the breadcrumb constructs), and
  reading the inherited `snapshot.data` will duplicate every route's
  last segment (Angular merges an ancestor's `data` into a descendant
  that doesn't declare its own). Also: the breadcrumb's `router.events`
  subscription must use per-navigation error handling (`switchMap` +
  a `catchError` scoped to just that one build), not a single
  long-lived `.subscribe(nextFn)` — a thrown exception there
  unsubscribes permanently, killing the breadcrumb for the rest of the
  session after the first failure.
- **Future note**: when a Home/dashboard landing page is eventually
  built, the breadcrumb will NOT automatically show "Home > X" —
  routes are flat, not nested under a Home parent route, and
  `buildBreadcrumb` only walks actual route nesting. Don't restructure
  routing to make Home a real parent just to get this; instead
  hardcode a first "Home" entry in `BreadcrumbComponent` pointing at
  `/`.

## Key Architecture Decisions (ACC-16 through ACC-21)

- **Tenant Admin remains a Role** (not a separate entity type),
  consistent with Platform Admin's own pattern — but a Tenant Admin
  DOES count against the tenant's licensed seat limit
  (`Plan.maxFullUsers`), same as any other user. Explicit business
  decision, not a technical default.
- **Last-admin lockout protection** (ACC-16): `RoleService` already
  guarded both `removeRoleFromUser()` and `deactivateRole()` against
  removing a tenant's last `TENANT_ADMIN`; `UserService`'s departure
  flow (`deactivate()`) did NOT have the equivalent guard until
  ACC-16 — now fixed, using the same pattern, with the
  `notifyTenantAdminsOfDeparture()` query reordered to run BEFORE the
  status flip (previously would have silently notified no one in the
  exact last-admin scenario it was fixing).
- **`LookupCategory` (SYSTEM/shared rows, `organizationId: null`)
  mutation requires `PlatformGuard`**, not tenant-level
  `lookups:manage` — closes a cross-tenant integrity gap (ACC-17).
  `LookupValue`'s existing tenant-scoped override pattern is
  unaffected and remains the correct, safe mechanism for tenant-level
  customization.
- **`NotificationService.create()` validates `dto.userId` belongs to
  the `organizationId` passed in**, before writing — closes an
  unscoped-write gap most directly reachable via workflow
  `SEND_NOTIFICATION` actions (ACC-17). Defense-in-depth also added
  in `workflow-template.service.ts` for `assigneeUserId` at write-time.
  `committeeId` validation intentionally deferred (no
  Committee/CommitteeMember table exists yet) — MUST be revisited
  when Committee Management ships, since that's what makes this path
  live rather than dormant.
- **`LanguageService`** (`frontend/src/app/core/services/language.service.ts`,
  ACC-19) is the single owning mechanism for `translate.use()` calls
  and `document.documentElement` `dir`/`lang` writes — no other
  component should touch these directly. Language resolution order:
  `user.language` → `organization.language` → `'en'`. Applied at
  app-bootstrap (blocking initializer, same pattern as session
  restore) and live-switches on profile save (`TranslatePipe`-bound
  template text updates automatically; imperative consumers must
  read `LanguageService`'s `isArabic()`/`isRtl()` signals instead of
  deriving their own).
- **App initializer pattern** (`app.config.ts`) now chains THREE
  sequential concerns before initial navigation: session restore →
  language resolution → platform/tenant permission loading
  (`NavigationAccessService.loadAccess()`, ACC-21). Any future
  concern that must be resolved before a route guard can evaluate
  correctly belongs in this same chain, not a per-guard workaround.
- **`NavigationAccessService.loadAccess()` is deliberately called
  from BOTH the app initializer (fixes hard-reload guard timing,
  ACC-21) AND `AppShellComponent.ngOnInit()`** (required for
  same-tab logout→login without a full page reload — the initializer
  only runs once per page load). The resulting double-call on hard
  reload is an accepted, harmless tradeoff, not an oversight — do not
  "simplify" this to one call site without re-introducing one of the
  two bugs this dual pattern fixes.
- **CI** (`.github/workflows/ci.yml`) had backend/frontend/tenant-isolation
  jobs commented out since scaffold (19+ days, forgotten not
  deliberate) — now real and enabled (ACC-20). Backend job includes
  `prisma generate` (required — `generated/` is gitignored) and
  `prisma migrate deploy` against an ephemeral CI Postgres container
  (not `migrate status` against an assumed pre-existing DB). Lockfiles
  must be regenerated on Linux (WSL or equivalent) going forward if
  new dependencies are added, to avoid Windows-only lockfiles missing
  Linux-platform optional dependency entries.

## Key Architecture Decisions (ACC-22 through ACC-27)

- **`WorkflowStage` has no persisted, stable key/slug** (only
  `nameEn`/`nameAr`/`order`), and stages are tenant-editable — this
  blocks any semantic (not just positional) UI treatment keyed to a
  specific stage, across EVERY `WorkflowObjectType`-driven module.
  Committee Management (ACC-22) resolved this by displaying the
  current stage as plain text (no colored status badge) rather than
  guessing at a fix. Revisit when a SECOND workflow-driven module
  needs stage-aware UI — do not pre-build a fix against only one
  data point.
- **`WorkflowTransitionActionsComponent`**
  (`frontend/src/app/foundation/workflow/components/workflow-transition-actions/`,
  ACC-22) is the standard, reusable pattern for triggering workflow
  transitions from any module's detail view — reads available
  transitions for the current stage, client-side filters by the
  caller's permissions (UX only — the backend's
  `WorkflowService.triggerTransition()` re-validates
  `requiredPermission` server-side regardless), renders each
  transition's own `labelEn`/`labelAr` (never `| translate` —
  transition labels are tenant-editable data). Every future
  workflow-driven module should reuse this component, not rebuild
  it. **Known limitation**: does not filter on `triggerCondition`
  (e.g. hiding `SYSTEM_AUTOMATIC` transitions a human shouldn't
  manually fire) — irrelevant today since every seeded transition is
  `ROLE_BASED`, but must be addressed before any module seeds a
  non-role-based transition.
- **`TenantService.bootstrap()`'s seeding steps run entirely
  sequentially**, awaited one at a time (positions, lookups ~87
  entries, roles + permissions, workflows: 54 stages + 68 transitions
  + 68 transition-actions) — several hundred sequential DB
  round-trips in a single HTTP request. Confirmed NOT the cause of
  any correctness issue, but a real, unaddressed
  performance/scaling risk for real-world tenant creation. Candidate
  fix (not yet designed): parallelize independent seed steps via
  `Promise.all()` where no real ordering dependency exists, and/or
  batch each service's own per-row upserts. Needs its own
  investigation before implementing — do not parallelize blindly
  given potential ordering dependencies between steps.
- **Post-merge CI verification requires a specific workaround**: the
  `github` MCP server's `pull_request_read`/`get_check_runs` tool is
  scoped to a PR's head SHA and does NOT pick up the new commit a
  squash-merge creates (a separate push-triggered workflow run).
  Confirmed via reading `ci.yml` directly — both `push` and
  `pull_request` triggers exist, so a genuine second run always
  fires on merge. Verify post-merge CI via a direct `WebFetch` to
  `api.github.com/repos/.../commits/{sha}/check-runs` — the
  PR-scoped tool will not surface it.
- **Better Auth's `better-auth/api` import (and `better-auth/config`)
  is ESM-only** and breaks Jest for any spec file that transitively
  loads a module importing it — not just the file importing it
  directly. Established mitigation:
  `jest.mock('better-auth/api', () => ({ isAPIError: () => false }))`
  (or a real discriminating mock where the test needs true/false
  branching, e.g. `http-exception.filter.spec.ts`'s `MockAPIError`
  pattern). This has now recurred 3 times (ACC-25, ACC-27, plus the
  original `better-auth.config` precedent) — expect it again on any
  future file that imports from `better-auth/api` or
  `better-auth/config`.

## Key Architecture Decisions (ACC-28 through ACC-33)

- **`WorkflowStage.assigneeCommitteeRoleValueId`** (ACC-28) narrows
  the `COMMITTEE` assignee strategy to a specific
  `committee_member_role`, when set. The new `WorkflowTriggerCondition`
  value `ASSIGNEE_POOL` checks `actorId` against
  `resolveAssigneeRaw()`'s resolved pool before allowing a transition
  to fire — the first real enforcement connecting workflow
  assignee-resolution to trigger-gating (previously two fully
  disconnected mechanisms, per the ACC-17-era finding).
- **Committee's non-workflow CRUD actions** (create / edit details /
  add member / remove member / change member role) are gated by 8
  specific permission strings (`committees:view`/`manage`/`approve`/
  `create`/`edit_details`/`add_member`/`remove_member`/
  `change_member_role`), not a dynamic per-instance authority check.
  A Chairman-specific "is this your committee" check was designed,
  built, then **deliberately rejected** — a Chairman is often a
  figurehead who delegates actual system use to a Secretary or
  similar; checking literal Chairman identity would lock out the
  person doing the real work. Roles holding `committees:manage` are
  granted all 8 permission strings directly at seed time (existing
  tenants backfilled) — there is no runtime "does manage imply this"
  logic anywhere. **This is now the REQUIRED pattern for every future
  module's own CRUD permission model** (ACC-44 — previously only
  described as what Committee itself does, an undocumented gap):
  richer, action-specific permission strings per module rather than a
  single flat `{module}:manage`, with an umbrella `{module}:manage`
  seeded to also hold every one of that module's specific strings
  directly (never computed/implied at runtime) — matching
  `OverlaySelectComponent`'s and `EditDialogComponent`'s own "now the
  REQUIRED pattern" status elsewhere in this file. A per-instance
  dynamic authority check (e.g. "are you literally this record's
  owner/chairman") is NOT part of this required pattern — Committee's
  own attempt at one was designed, built, then deliberately rejected
  for the reason above, and that reasoning applies to any future
  module considering the same shortcut.
- **`WorkflowInstanceStage.isUnassigned`/`.unassignedAt`** (ACC-28,
  extended ACC-33) detects when a stage's next required transition
  has NO eligible actor — checked at stage-entry time and re-swept
  every 15 minutes by the existing `SlaMonitorProcessor` job.
  Originally scoped to `ASSIGNEE_POOL` only (ACC-28); ACC-33 extended
  it to `ROLE_BASED`/`SPECIFIC_USER` trigger conditions via a
  structurally separate resolver (not a generalization of the first
  one, since assignee-resolution and trigger-gating remain genuinely
  distinct concepts) — results are unioned, both reasons preserved if
  a stage is blocked for more than one cause simultaneously.
- **`EditDialogComponent`**
  (`frontend/src/app/shared/components/edit-dialog/`, ACC-29) is now
  the required pattern for every create/edit dialog in the app,
  replacing the old per-screen `p-dialog` + manual `@if` convention.
  Confirmed via real Angular TestBed experiments (not
  documentation-read) that content projection (`<ng-content>` + a
  wrapper's own `@if`) does NOT recreate a projected child component
  on reopen — only `TemplateRef` + `ngTemplateOutlet` does. All 8
  screens that existed at ACC-29's own point in time were migrated
  then (4 were confirmed-broken by the content-projection bug, 4 were
  "accidentally correct" by luck of parent wiring, not by using a safe
  pattern). **That "8" is a point-in-time count, not a permanent
  invariant** — it went stale as new screens were added afterward
  without following the pattern (a gap ACC-39 later found and closed).
  Current total, re-verified directly against the code, not assumed:
  17 consumers (the original 8 + 1 from ACC-36 + 8 from ACC-39, the
  latter migrated for architectural consistency, not a live bug —
  every one of those 8 was independently confirmed already immune).
  Full current list: SYSTEM-REFERENCE.md Section 10.5. Includes a built-in
  scroll-discoverability affordance (a bottom-edge cue when dialog
  content exceeds visible height) and a fix for a known upstream
  PrimeNG overlay bug (primefaces/primeng#14519) where scroll-chaining
  from an internal dropdown list to the dialog's own scroll container
  incorrectly hides the open dropdown — fixed via
  `overscroll-behavior: contain` on the dropdown's own listbox.
  **Update (ACC-36)**: that CSS rule alone was found insufficient
  (live-measured a ~2px scroll leak reaching the dialog's ancestor on
  some wheel ticks, closing the dropdown even nowhere near its own
  boundary) — closed with a targeted `(wheel)` handler that only ever
  calls `preventDefault()` once a listbox has genuinely exhausted its
  own scroll room, leaving every other tick untouched. The CSS rule
  itself was also widened to cover `p-multiselect`, not just
  `p-select` (they render their listbox under different class names).
  **`p-listbox` (not `p-multiselect`) is now the required pattern for
  any new inline multi-select-inside-a-dialog need** — confirmed via
  source that `p-listbox` renders inline with no connected-overlay
  mechanism at all, so it's structurally immune to this entire bug
  category rather than merely protected against it. Full detail:
  SYSTEM-REFERENCE.md Section 10.5.
- **`CommitteeMember` reactivation** (ACC-32): rejoining a departed
  committee member reuses the SAME row (reactivate-in-place, matching
  `RoleService.reactivateRole()`'s established shape) rather than
  creating a new row — `CommitteeMember`'s unique constraint on
  `(committeeId, userId)` has no partial/conditional exemption, and
  `CommitteeMembershipEvent` (a fully independent, append-only ledger
  keyed by `committeeId`+`userId`, not `CommitteeMember.id`) already
  correctly preserves full multi-period history regardless of row
  reuse. Confirmed: dropping the unique constraint to allow multiple
  historical rows would be strictly worse, not just unnecessary.
- **CI's tenant-isolation gate** (the `--testNamePattern` check) had
  several passing-but-mislabeled tests found across this session
  (lookup, user, working-calendar, task, org-position) — a test whose
  logic is genuinely correct but whose NAME doesn't match the gate's
  exact literal string is invisible to CI even though it passes
  locally. This is now a known, recurring failure class, not fully
  eliminated — worth checking for on any future PR touching
  tenant-scoped queries. **Recurred again, ACC-44**: a deliberate
  audit of every tenant-scoped query added ACC-40 through ACC-43
  found 4 more instances — `OrgPositionService.reactivatePosition()`,
  `OrganizationService.refreshOrgUnitHeadVacancy()`, and
  `SlaMonitorProcessor.sweepDueHandovers()` each had a real, correct
  cross-tenant test under the wrong name (renamed, logic unchanged);
  `SlaMonitorProcessor.sweepExpiredActingOrgUnitAssignments()` had no
  cross-tenant test at all (added a genuine new one). Confirms this
  is a standing risk on every PR touching tenant-scoped queries, not
  a one-time cleanup — no further systemic fix attempted, still
  worth checking by hand each time.

## Key Architecture Decisions (ACC-44)

- **`WorkflowStage.requiredPermission` removed from the schema —
  confirmed genuinely dead, not merely unused.** Existed alongside
  `WorkflowTransition.requiredPermission` (the real, actively-enforced
  field — checked in `triggerTransition()`, `checkAndFlagUnassignedStage()`,
  `resolveApproverPool()`) but was never set by any of the 8 seeded
  workflow templates, never exposed by any stage-editing frontend UI
  (only the transition editor ever had a `requiredPermission` input),
  and never read anywhere in the runtime engine. Removed rather than
  wired up: several seeded stages have multiple outgoing transitions
  that legitimately require *different* permissions (Committee's
  `terms_review` stage alone needs both `committees:approve` and
  `committees:manage` on its two different outgoing transitions), so
  a single stage-level permission value could never have expressed
  what the real per-transition values already do correctly — not
  just an oversight nobody got to, but a field that didn't fit this
  engine's own authorization model. Same shape as `tasks:manage`
  pre-ACC-33: a real-looking permission string, settable via the raw
  API, silently doing nothing — closed via a real migration
  (`prisma migrate dev`), not left as dead schema. Full audit trail:
  SYSTEM-REFERENCE.md Section 2.1.

## Key Architecture Decisions (ACC-55)

- **A save that returns a WARNING must keep its surface alive and visible
  until the user dismisses it — including not triggering a parent refresh
  that destroys that surface.** This is now a required contract for every
  non-blocking config-time warning, not advice. Both halves are load-bearing;
  the second half is the one nobody knew to check, and it is what broke
  ACC-55 in live testing.
  Three occurrences, and they do NOT share one mechanism — worth knowing
  before anyone tries to extract a single helper for them:
  - **ACC-43 (`position-form`)** and **ACC-54 (`workflow-stage-form`)** share
    the FIRST mechanism: the dialog closed itself immediately on save, so the
    warning rendered for a fraction of a second. Both fixed the same way —
    keep the dialog open, and (for a create) switch create→edit so
    re-submitting cannot make a second record.
  - **ACC-55 (`workflow-transition-editor`)** is a DIFFERENT mechanism, and
    is why this note exists. The dialog logic was already correct — verified
    in isolation, it stayed open and rendered the warning. The component
    holding it was destroyed underneath: it emitted `changed`, the parent
    (`workflow-stage-list`) ran `loadTemplate()`, the `stages()` array was
    replaced, `p-table` rebuilt the expanded row's embedded view, and the
    editor was recreated with every dialog signal back at its default.
    Fixed by deferring `changed.emit()` until the dialog actually closes
    (`refreshPending` + a `notifyParent()` flush on every exit route). The
    list is briefly stale while the dialog is open — the correct trade, since
    the user is looking at the dialog, not the row behind it.
  An "always keep the dialog open on warning" helper would have prevented the
  first two and NOT the third. So: treat this as a contract to check against,
  not a component to reuse. When adding any new warning-returning save, verify
  BOTH that the surface stays open AND that nothing it triggers destroys the
  surface — the second needs a parent+child test, not a component test
  (`workflow-stage-list.integration.spec.ts` is the worked example).
- **`OverlaySelectComponent.groupsSelectable`** (default `true`) — opt-in
  control over whether group/branch nodes in hierarchy mode are themselves
  valid choices. Default preserves ACC-42's deliberate, separately-tested
  behavior ("every node is individually selectable regardless of depth or
  branch/leaf status"), which `org-unit-form` genuinely needs: a parent unit
  IS a valid parent. But that is a property of THAT data, not of hierarchies
  in general. A grouped list whose groups are pure categories needs the
  opposite, and getting it wrong is not cosmetic: in ACC-55 the permission
  picker's module headings were selectable, and selecting one saved
  `requiredPermission: null` — silently CLEARING the transition's permission
  gate and widening who could fire it. Implemented via CdkOption's own
  `cdkOptionDisabled` rather than a hand-rolled click guard, so pointer and
  keyboard agree for free (`CdkListbox` applies
  `skipPredicate(option => option.disabled)` to its `ActiveDescendantKeyManager`
  — verified in `@angular/cdk/listbox` source, not assumed). Set
  `[groupsSelectable]="false"` on any picker whose groups are categories.
- **A label resolved with `TranslateService.instant()` inside a `computed()`
  needs an explicit dependency on `translate.currentLang()`**, or it will
  never re-evaluate on a language switch and will stay stuck in the previous
  language for the rest of the session. `instant()` is a plain function call,
  not a signal read. `currentLang` IS a real signal (`LanguageService` relies
  on the same fact), so reading it inside the computed is the whole fix.
  Prefer `TranslatePipe` in the template; `instant()` is only for labels built
  outside it (option lists, `ConfirmationService` messages).

---

## Open / Deferred Items

- **Resend email domain (`accreditme.com`) is not verified** in the
  Resend dashboard — invitation/notification emails will not actually
  deliver until this is configured. Infrastructure task, not a code
  fix, needs doing before any real customer relies on email-based
  flows.
- **`angular-component` skill's templates are stale against current
  project conventions** — `@if` not `*ngIf`, standalone `TranslatePipe`
  imports, `EditDialogComponent`/`OverlaySelectComponent` not
  referenced as required patterns despite this file marking both
  required. Found during ACC-46's skill audit. Worth updating whenever
  next touched, not urgent.
- **Full RTL visual audit** — deferred, see the i18n / RTL Foundation
  note in Build Sequence above. Positioned right before the demo
  milestone, after Document Management, alongside the full
  visual/brand polish ticket. Distinct from the smaller, near-term
  Committee-specific RTL pass in the sequence below.
- **RESOLVED (ACC-42)** — **`p-cascadeSelect` adopted in exactly one
  place, not consistently** — was: `org-unit-form.component.ts`'s
  `parentId` got the hierarchy-aware `p-cascadeSelect` widget while
  every other org-unit picker (`invite-user.primaryOrgUnitId`,
  `user-profile.primaryOrgUnitId`/`actingOrgUnitId`) used a flat
  `p-select`. Now: all 4 use `OverlaySelectComponent`'s hierarchy mode
  uniformly — `p-cascadeSelect` removed from the codebase entirely,
  and the 3 previously-flat pickers gained real tree display for the
  first time via a shared `buildOrgUnitCascadeOptions()` helper
  (`org-unit.service.ts`). No longer an inconsistency to track. Full
  detail: SYSTEM-REFERENCE.md Section 10.7.
- **Task creation has no real, business-appropriate home today.**
  `TaskListComponent` was deliberately designed, from its own original
  build, as an embeddable list meant to live inside a future business
  object's detail page (its own header comment says so explicitly) —
  not a standalone destination. It currently ships as a temporary,
  nav-unlinked standalone route (`/tasks/all`) as a stopgap. Confirmed
  during ACC-41 testing: this stopgap has a real, currently-dormant
  defect — its list silently shows "No tasks" regardless of actual
  data, since the route supplies no `sourceType`/`sourceId` and the
  component's own guard clause returns early without ever querying.
  Task CREATION itself (the "New Task" button/form) works correctly
  and is fully decoupled from this — creating a task always succeeds,
  it just never appears in this specific broken list afterward.
  Do NOT add a nav link to `/tasks/all` as a quick fix — this would
  make the misleading empty-list defect easier to find, not fix it.
  The real fix is a deliberate design pass: decide where task creation
  and task lists genuinely belong from a business standpoint (most
  likely embedded in Committee's detail page today, the only fully-
  built business module, following `TaskListComponent`'s own original
  intended pattern) once that's properly scoped — not a navigation
  patch.
- **Platform Admin has no real navigation structure** — confirmed
  while testing ACC-39: `ai-feature-costs` and `ai-credit-packs` are
  only reachable by typing their URLs directly after a platform-admin
  login; `sidebar.component.ts` shows platform admins exactly one link
  ("Super Admin" to `/platform`), with no sub-navigation, tab bar, or
  layout component to hold links to either screen. Same class of gap
  as ACC-35 (Working Calendar) and the task-creation navigation note
  above, but likely broader — worth a real investigation into whether
  Platform Admin has OTHER unreachable screens beyond these two before
  scoping a fix, rather than patching just these two in isolation.
- **`OverlaySelectComponent` has no filter-search capability**
  (ACC-42) — `committee-member-form.userId` lost `p-select`'s
  `[filter]="true" filterBy="name,email"` (a visible search box, not
  the same thing as CDK's own prefix-only typeahead) when migrated,
  deliberately, not as an oversight. Confirmed one-field scope via a
  full grep of the entire frontend (the only other `filter`-using
  picker, `unassigned-tasks`' Reassign field, is a `p-listbox`, never
  in scope). Confirmed genuinely harder than every other
  `OverlaySelectComponent` capability, not just more work: PrimeNG's
  own filter keeps real DOM focus in the filter input and
  re-implements keyboard nav independently, because CDK's
  `ActiveDescendantKeyManager` assumes focus stays on the listbox
  itself — replicating PrimeNG's actual UX means fighting that
  machinery, not composing it, unlike scroll-chaining, hierarchy mode,
  and item-template support, which all reuse it directly. Full
  investigation and decision: `backend/Plans/step-42-overlay-select-migration.md`
  Section 2.5. Revisit only if a future field genuinely needs real
  filter-search (not just a longer option list) — typeahead alone was
  judged sufficient for `committee-member-form.userId`'s own bounded
  list, not necessarily for every future case.
- **`OverlaySelectComponent` positioning — single unreproduced
  sighting, not a confirmed bug, not a confirmed non-issue.** A
  single, real sighting of `OverlaySelectComponent`'s positioning
  panel appearing clipped/off-screen was observed once, on the
  genuinely migrated component (confirmed via DOM inspection), at
  Ahmad's real environment (100% zoom, no OS display scaling,
  devicePixelRatio 1, 1589x945 viewport, maximized Chrome). Extensive
  follow-up testing — at Ahmad's exact reported dimensions, at
  multiple other sizes, forcing both above- and below-trigger
  placement, across two different fields, using both scripted and
  real mouse-driven clicks — could not reproduce it again, ever,
  under any controlled condition. Ahmad's own fresh manual retest,
  performed after the original sighting, also could not reproduce
  it. The underlying CDK positioning mechanism
  (`FlexibleConnectedPositionStrategy`) is confirmed correct in every
  deterministic test run — computed and rendered position match to
  the pixel in every case tested. Most likely explanation: a stale
  cached asset (JS bundle or CSS) briefly served immediately after
  this session's rapid sequence of deployments, producing a one-off
  visual glitch that a hard refresh resolved — confirmed consistent
  with Ahmad's own account (he performed a hard refresh between the
  original sighting and his successful retest, and has not seen it
  recur since). Not a defect in CDK's positioning logic itself, which
  remains confirmed correct in every deterministic, cache-clean test
  performed. Not treated
  as a known open bug requiring a fix — no reproducible failure
  exists to fix. Flagged here for visibility only, in case it recurs
  with a genuinely reproducible trigger in the future, at which point
  this note should be revisited with real, fresh investigation rather
  than assumed already understood.
  (Earlier draft history, superseded by the status above: this note
  originally claimed a confirmed PrimeNG-vs-CDK zoom-positioning bug,
  then was corrected to flag that the reproduction method —
  `document.body.style.zoom` via `page.evaluate()` — does not
  represent genuine browser zoom. The **standing rule** from that
  correction still holds regardless of this note's own final status:
  any future zoom-related reproduction MUST use genuine browser zoom
  — Ctrl+scroll, real OS display scaling, or Playwright's actual
  device-scale-factor emulation — never `document.body.style.zoom`
  injection.)

### Sequence to Meeting Management

Supersedes prior standalone entries covering this same ground
(Dashboard/Home page, backend-vs-frontend coverage audit, permanent
E2E suite — all folded into the ordered sequence below instead).
SYSTEM-REFERENCE.md's Tier 1 findings (10 items) are CLOSED via
ACC-33 — tracked in SYSTEM-REFERENCE.md itself, not repeated here.

**Items 1–4 below are structural work — a hard prerequisite.** No
functional module work (Committee's own remaining items, the coverage
audit, Meeting Management) begins until all four are actually
complete, not just the currently-in-review ones.

1. **DONE — Invitation-activation shortcut.** Confirmed working
   (dev-only — no email infrastructure needed for it to function).
2. **DONE — Manager vs. Unit-Head / escalation redesign (ACC-46).**
   Merged to `dev` via PR #53 (squash `2061305`) — the full
   `OrgPosition` redesign (org-wide catalog, `isUnitHeadPosition`/
   `isSingleAssignee`, position-to-role mapping, the `ORG_UNIT_HEAD`
   workflow assignee strategy's first real implementation, the
   Manager-then-Head task escalation rework, the User Transfer
   Wizard). Full detail: SYSTEM-REFERENCE.md Section 5 and Section
   12.9.
   This is also what settled the long-open "does `managerId` do
   anything?" question: it now has a real functional consumer
   (`OrgPositionService.resolveManagerEscalationTargets()` reads it,
   and `SlaMonitorProcessor` calls that for the Manager escalation
   tier), where before ACC-46 it was display-only and read by nothing.
3. **PARTIALLY COMPLETE — replace `Role`-based workflow assignment with
   `OrgPosition`-based assignment.**
   **Done (ACC-54, merged `57e621d`)**: the `POSITION_FIXED` assignee
   strategy — a stage resolves to whoever holds a specific position in a
   specific, config-time-chosen org unit. New enum value, two nullable
   `WorkflowStage` columns, a `resolveAssigneeRaw()` case, the matching
   `resolveApproverPool()` branch, write-time tenant validation for both
   ids, and config UI with a non-blocking no-holder warning. Full detail:
   SYSTEM-REFERENCE.md Section 2.5.
   **Four things remain, stated explicitly so none is assumed done:**
   - **`ROLE` is deliberately RETAINED, not being removed.** Genuine
     broadcast-to-everyone patterns still need it — verified against
     `workflow.seed.ts:231`, `MEETING.minutes_review` is
     `assigneeStrategy: ROLE` / `assigneeRoleKey: BASE_USER` /
     `approvalMode: PARALLEL` / `parallelThreshold: ALL`, i.e. every
     user in the tenant must approve. No position-based strategy
     expresses that, and it is the seed's only `BASE_USER` use.
     This item's original wording ("remove `Role`") was
     always too strong; the real goal is that `ROLE` stops being the
     DEFAULT for cases that want a real organizational target, not that
     it disappears.
   - **`ROLE_BASED` on the trigger side is completely untouched.**
     ACC-54 changed assignment (who receives work), never trigger-gating
     (who may fire a transition) — two structurally separate mechanisms
     (SYSTEM-REFERENCE.md Section 2.8). Every seeded transition is still
     `ROLE_BASED`, and note this is also what ACC-56's open finding
     depends on.
   - **RELATIVE mode is not built and is deliberately blocked.** The
     position would resolve against the *triggering object's own*
     `orgUnitId`, walking up the parent chain if vacant. It has no live
     consumer: `Committee` has no `orgUnitId` field, and it is the only
     fully-built workflow-driven module. Building it now would ship a
     second strategy resolving to an empty pool for every object that
     exists — repeating exactly the wired-but-unreachable state
     `ORG_UNIT_HEAD` sat in from ACC-40. Revisit when
     `Committee.orgUnitId` (or another workflow-driven object with a
     unit) exists to prove it against.
   - **None of the 8 seeded templates were migrated off `ROLE`.** They
     still resolve to flat tenant-wide `QUALITY_MANAGER`/
     `QUALITY_OFFICER` lookups. That migration is a separate decision
     with real seed-data implications, and belongs with item 4 below
     rather than being smuggled into a strategy-implementation ticket.
4. **NOT STARTED — new seed data reflecting the final structural
   shape**, once items 1–3 above are actually settled.

5. **THEN, once all four structural items above are done — Committee
   Management's remaining production-readiness work**:
   - A live Quality Manager persona test — every test so far used
     Tenant Admin, which holds every permission and never proves
     permission-gating actually works for a realistic non-admin user.
   - A minimal Dashboard/Home slice — so a Quality Manager can
     discover "my committees / pending my action" without hunting.
     Must be built as a set of independently permission-gated widgets
     (checking permission strings held by the current user), never
     hardcoded against specific named roles — matching the same
     principle already established for Committee's own CRUD
     permissions; any tenant-created custom role must get a
     correctly-adapted dashboard automatically, with no special-
     casing required. The Unassigned Tasks view (ACC-34) is a likely
     future widget candidate here, not necessarily a permanently
     separate screen.
   - An Arabic/RTL pass on Committee's own ~5 screens specifically —
     NOT the full app-wide RTL audit above, which stays deferred to
     the pre-demo milestone.
6. **THEN, once all of the above are done — the backend-vs-frontend
   coverage audit**, re-scoped smaller than originally planned:
   SYSTEM-REFERENCE.md's static Frontend Consumption checks across
   all 12 sections already answered most of "does a UI path exist";
   remaining value is the LIVE, persona-driven half using Playwright
   MCP. Followed by the permanent, CI-integrated Playwright E2E
   suite, informed by the audit's findings.
7. **ONLY THEN — Meeting Management planning begins.** Its own plan
   MUST, as a mandatory step:
   - Check SYSTEM-REFERENCE.md's remaining Tier 2/3 items for real
     dependencies — not decided blind now (e.g. Task's missing
     detail/reassignment/evidence-upload UI, `ROUND_ROBIN`'s missing
     rotation logic, `SEQUENTIAL` approval mode's missing ordering —
     some may be load-bearing for Meeting, most are not; check
     per-item against Meeting's actual design).
     **ACC-40 cross-reference**: when a Task detail view (or any
     approval-history surface) finally gets built, `TaskAssignee` and
     `WorkflowApproval` already carry real, fully-populated
     `delegationReason`/`delegationContextId` fields (`ACTING_HEAD` |
     `OUT_OF_OFFICE_COVERAGE` | `null`) — stamped end-to-end on the
     backend since ACC-40 Phase 9, just never surfaced. Wire it in
     directly rather than re-deriving anything: resolve the qualifier
     from those two fields and render it next to the actor's name,
     e.g. "Approved by Sarah — Acting Head of Cardiology" or
     "Completed by Sarah — covering for Ahmad" (exact format specified
     in `backend/Plans/step-40-org-position-unit-head.md` Section
     2.6.3). This note exists so this doesn't get silently dropped the
     way the original org-unit/position note was lost for seven months
     before this same ticket had to recover it.
   - Design Meeting's Vote Record fields from scratch — the current
     `Meeting`/`AgendaItem` schema is a dormant scaffold only, and
     even that scaffold is incomplete relative to Meeting's own
     module-designs.md spec (structured vote tracking — topic/
     voteType/votesFor/votesAgainst/abstentions/quorumMet/outcome —
     doesn't exist; `minutesText` is currently just a free-text
     blob).

- **AI provider selection is a confirmed 3-layer gap — no UI, no
  `aiConfig` write path, hardcoded single-provider DI binding** (full
  detail: SYSTEM-REFERENCE.md Section 11, Tier 2). `AIProvider` itself
  is fully built and working (real Anthropic integration, per-tenant
  key resolution, complete audit logging) but has zero real consumers
  app-wide (one stub caller, `LookupService.suggestValues()`, doesn't
  count) — genuinely idle, production-ready infrastructure, not
  blocking anything on its own. A real pricing-model question this
  surfaced has now been resolved: tenant-facing "bring your own API
  key" was considered and explicitly REJECTED in favor of a different
  design — AccreditMe maintains its OWN platform-level keys for
  multiple AI providers (Anthropic, Azure OpenAI, OpenAI); a tenant
  admin SELECTS their preferred provider, but traffic is routed
  through AccreditMe's own key regardless of selection. This keeps
  the existing AI credit system (`Organization.settings.ai`,
  `AiCreditPack`, the full usage-metered revenue model already
  designed) fully intact and in AccreditMe's control — selection
  affects WHICH backend serves a request, never who pays for it or
  how it's metered. This applies to Tier 1 (Cloud SaaS) and Tier 2
  (Dedicated Cloud Instance) only. Tier 3 (On-Premises/Private Cloud)
  sits on a completely separate annual-license commercial model,
  outside the credit system entirely — a Tier 3 customer's own
  platform admin configuring the deployment against a self-hosted
  model (e.g. Ollama) is consistent with, not in conflict with, this
  design, since Tier 3 was never intended to be credit-metered in the
  first place. STILL correctly deferred: build only when a real AI
  feature or the Tenant Onboarding wizard actually needs it — but the
  DESIGN QUESTION itself is now resolved, so whenever this does get
  built, it should NOT default back to a generic bring-your-own-key
  implementation. `AiInteractionLog` should capture provider and tier
  as explicit fields (not inferred from a model-name string) for
  accurate cost reconciliation, once this is actually built.
  (Committee's `TOR_DRAFTING`/Health Report/Decision Pattern Analysis
  AI features remain separately blocked on Document Management's and
  Meeting Management's own data existing — unrelated to this
  provider-selection gap, unaffected by this resolution.)
- **Two small, unrelated findings needing their own tiny tickets
  eventually**: the frontend's `suggestHolidays()` calls a backend
  route that doesn't exist (a live 404, not a stub);
  `AiFeatureCost`/`AiCreditPack` billing machinery is fully built but
  structurally unreachable since no feature triggers the
  credit-deduction flow.
- **List-page filtering is inconsistent/missing across the app** —
  flagged by Ahmad after ACC-40 removed OrgPosition's org-unit filter
  (a necessary removal, since positions became org-wide with nothing
  left to filter by). Worth a proper, dedicated investigation once
  picked up: inventory every list screen in the app, confirm which
  already have real filtering (status, date range, etc.) and which
  have none, and design what's actually useful per screen rather than
  a single generic filter pattern applied uniformly everywhere. Not
  scoped or sized yet — this note exists so the idea isn't lost, not
  as a commitment to a specific approach.
- **Field alignment/spacing inconsistency, `committee-form`'s Quorum
  and Meeting Frequency fields** — Ahmad flagged a visual
  misalignment between the two during ACC-42 testing. Not fixed as
  part of ACC-42 — unrelated to that ticket's own scroll-chaining
  migration. Worth folding into a broader responsiveness/alignment
  audit across the app once one is picked up, not a one-off fix in
  isolation. Not scoped or sized yet — recorded here so it isn't
  lost before that audit exists. Grouped here with the list-page-
  filtering note above — both are the same category (a future,
  broader UI-consistency audit), not two unrelated findings.
  **Second, independent sighting (ACC-39 testing pass)**: the same
  Quorum/Meeting Frequency misalignment on the Edit Committee page
  was observed again, separately, during this later testing session
  — not a one-off rendering glitch from the original ACC-42 sighting,
  but a reproducible pattern seen twice independently. Strengthens
  the case that this is a real, systemic issue worth the planned
  broader audit rather than something that could have been transient.
  Still not scoped or fixed here — no code change attempted, still
  deferred to that same future audit.
- **Full frontend design-consistency audit needed** — flagged by
  Ahmad after finding Task SLA settings was the only screen in the
  entire app using a raw `<table>` + manual `overflow-x-auto` instead
  of the established patterns (found during ACC-46). This is broader
  than the existing field-alignment and list-filtering notes above:
  revisit whether this project has a complete, written set of
  frontend design rules, verify every real screen actually follows
  them (not just spot-checked), and specifically check code
  comments/documentation for any deliberate, DOCUMENTED exceptions to
  those rules versus undocumented one-off deviations like this one
  turned out to be. Not scoped or sized yet — this is a full audit,
  not a single fix, grouped here with the other future UI-consistency
  items but distinctly larger in scope than either.
- **Local development points at SHARED infrastructure that a live
  Railway deployment also depends on — both the dev database and the
  dev Redis queue.** Confirmed twice, in two structurally different
  ways, which is why this is recorded as one problem rather than two
  incidents:
  - **ACC-48 — shared DATABASE.** Root cause of a 14.5-hour production
    sweep outage (`SlaMonitorProcessor` silently disabled on the
    deployed dev instance, tenant-wide, including the real Demo
    Organization). ACC-46's Commit 1 migration was run directly
    against the shared dev Supabase database before any corresponding
    code was merged to `dev` — the deployed instance kept running old
    code that still queried the now-dropped columns, and
    `SlaMonitorProcessor.process()` having no per-step error isolation
    turned one crashing query into a total outage of all six sweep
    mechanisms at once. That blast-radius half is now fixed (ACC-49 —
    every step is independently fault-isolated, and the job still
    reports failed so a broken step stays visible); the
    shared-infrastructure question below is what remains undecided.
  - **ACC-51 — shared REDIS.** `REDIS_URL` points at a shared Railway
    Redis (`sakura.proxy.rlwy.net`), so the deployed instance and any
    local dev server are **competing workers on the same
    `sla-monitor` queue**. During ACC-51's live verification, a sweep
    job enqueued locally to exercise newly-written recovery code was
    consumed by the deployed worker running `dev`'s recovery-less
    code instead. It cleared the stage's `isUnassigned` flag and
    stopped there — silently invalidating the verification, and
    (because that recovery path is one-shot: the
    `wasUnassigned === isNowUnassigned → continue` guard means only
    the transition itself triggers it) permanently consuming the only
    chance to recover that task. The queue still holds ACC-48's own
    old failures from `/app/dist/...`, which is how the shared-worker
    situation was identified at all.

  The decision needed is the **same for both**, which is the point:
  either genuinely separate dev/staging infrastructure per
  environment (database AND queue), or a documented rule about
  exactly what may safely point at a shared instance — e.g. that a
  migration only gets applied once its corresponding code is merged,
  never before, and that local workers must not share a queue with a
  deployed one. Not decided or scoped here — this note exists so the
  question isn't lost before that decision gets made.

  **Practical implication until it is decided:** verifying
  queue-driven behavior locally is unreliable by default, because
  there is no guarantee the local worker processes its own job.
  ACC-51's verification worked around this by invoking
  `SlaMonitorProcessor.process()` directly in-process against the
  real database rather than enqueueing — a usable workaround, not a
  fix, and worth knowing about before someone else loses time to the
  same silent failure.

  **Refinement (ACC-54) — "never migrate before merge" is too blunt a
  rule; the real dividing line is ADDITIVE vs DESTRUCTIVE.** What
  actually broke in ACC-48 was not the timing on its own, it was
  applying a *destructive* change (dropped columns) that the running
  deployment's older code still queried. An additive change does not
  have that failure mode:
  - **Adding a nullable column is safe** for a running old
    deployment — Prisma generates its client from the schema it was
    built with and selects only the columns it knows about, so a
    column it has never heard of is simply never referenced.
  - **Adding an enum value is safe** for the same class of reason —
    no existing row can hold the new value, and nothing writes it
    until the new code deploys.
  - **Dropping or renaming a column, or narrowing a type, is NOT
    safe** — that is exactly ACC-48, where old code kept selecting
    columns that no longer existed and crashed on every query.

  So the safe formulation is: *a destructive migration must not be
  applied to shared infrastructure ahead of its code merging; an
  additive one may be.* ACC-54's own migration (two nullable columns
  plus one enum value) was applied to the shared dev database ahead
  of its code under exactly this reasoning, deliberately and with
  the distinction stated at the time rather than discovered
  afterward. This does not replace the decision still needed above —
  genuinely separate environments would make the whole question moot
  — but it is the more precise interim rule, and it is worth knowing
  that treating every migration as equally dangerous would block
  ordinary additive work for no real safety gain.
- **No form in this app has a per-field inline error-message pattern**
  (confirmed via full grep, zero matches) — every form relies solely
  on a disabled submit button as its only invalid-state feedback.
  Worth a deliberate future decision on whether specific, per-field
  error text should become a real, established pattern (matching the
  same rigor `EditDialogComponent`/`OverlaySelectComponent` got
  before being made required) — found while fixing `invite-user`'s
  missing feedback during ACC-46 review, not scoped or decided here.
- **Bulk user import (CSV/Excel)** — flagged by Ahmad as a real,
  separate feature: for organizations with 100+ users, inviting one
  by one is impractical. Imported users should be created ACTIVE
  directly (no invitation/confirmation step). Real scope, not a small
  addition: needs a defined file format/template, validation against
  existing positions/org units/managers/roles (all must already exist
  and be correctly referenced), and a decision on partial-failure
  handling (reject the whole batch vs. skip-and-report malformed
  rows). Needs its own investigation and plan before building.
  Placement: NOT Phase 2 (Monetization) or Phase 3 (Advanced
  Features) — this is operational tooling, not a monetization or
  advanced feature. Belongs in the unlabeled build sequence that
  precedes both named phases, sequenced late: after "Sequence to
  Meeting Management" items 5 (Committee production-readiness) and 6
  (the coverage audit) — real testing with a handful of users has to
  come first — and before item 7 (Meeting Management). Becomes
  genuinely valuable once the product is close to real-customer-scale
  testing/demo, not before.
- **Vacancy notification could distinguish "genuinely nobody
  assigned" from "assigned but not yet activated"** — confirmed
  during ACC-43 that vacancy detection correctly requires ACTIVE
  status (an invited head-conferring holder does NOT count as
  covering a unit, matching the same principle already established
  for out-of-office coverage: holding a position isn't the same as
  being able to act). Still true in the current code —
  `resolveActingHeadForOrgUnit()` filters on `status: 'ACTIVE'`.
  Worth a future UX refinement: the first notification could be
  softer/different when the cause is "holder hasn't activated yet"
  vs. a genuine empty assignment — not built now, this is a polish
  idea, not a defect.
- **Workflow stage configuration changes are effectively unaudited** —
  `updateStage`'s audit `before`/`after` records only `nameEn`/
  `nameAr`, not `assigneeStrategy` or any assignee field, and
  `WorkflowStage` has no `updatedAt` column. You can see THAT a stage
  changed and WHO changed it, never WHAT changed. Found during ACC-54
  while investigating unexpected stage config. Compounding:
  maintenance/restore scripts that write via direct Prisma bypass
  `AuditLogService` entirely, so those changes leave no trail at all.
  Worth addressing for a compliance product — config-change history
  that can't say what was configured is close to useless.

---

## Branching Strategy

```
main          → production-ready only — branch protection enabled
dev           → active integration — all features merge here first
feature/xxx   → one branch per feature
fix/xxx       → one branch per bug
```

Rules:
- NEVER commit directly to main or dev
- Always branch from dev
- Merge to dev via Pull Request only
- main updated from dev only at release time
- Commit convention: feat: / fix: / refactor: / docs: / test: / chore:

---

## Testing Strategy

```
Unit tests:         Jest — all NestJS services
Integration tests:  Supertest — all API endpoints
Tenant isolation:   Automated cross-tenant tests — CI blocks deployment on failure
E2E tests:          Playwright — critical user workflows
Test database:      Separate PostgreSQL — never production data
Seed scripts:       Prisma seed with realistic anonymized data per module
```

---

## API Versioning

- Version prefix from day one: /api/v1/
- Breaking changes require new version: /api/v2/
- Old versions deprecated with 90-day notice
- Swagger/OpenAPI auto-generated by NestJS
- Public API (Phase 3): API key management in tenant admin panel + webhooks

---

## Environment Variables

Never hardcode secrets. All in .env (gitignored).
.env.example committed with placeholder values only.

```env
DATABASE_URL=postgresql://user:password@host:5432/accreditme
BETTER_AUTH_SECRET=
JWT_SECRET=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=me-south-1
AWS_S3_BUCKET=
ANTHROPIC_API_KEY=
RESEND_API_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
REDIS_URL=
SENTRY_DSN=
ENCRYPTION_KEY=
PLATFORM_ADMIN_EMAIL=
APP_BASE_DOMAIN=accreditme.com
```

---

## Brand Design Tokens

```css
:root {
  --am-blue-primary:    #2E6FA3;
  --am-blue-light:      #64B5D9;
  --am-green-accent:    #8DC63F;
  --am-green-dark:      #6FA028;
  --am-charcoal:        #3D3D3D;
  --am-sidebar-bg:      #1E2A38;
  --am-sidebar-hover:   #28394D;
  --am-sidebar-active:  #2E6FA3;
  --am-surface:         #F4F7FA;
  --am-card:            #FFFFFF;
  --am-border:          #E2E8F0;
  --am-text-primary:    #2D3748;
  --am-text-secondary:  #718096;
}
```

Layout: Top bar 64px + Sidebar 260px collapsible + Main content fills remaining space.
Tables use PrimeNG scrollable with scrollHeight="flex" — no page scroll on data tables.
Active sidebar item shows 3px green left stripe as visual anchor.
Status pills use semantic colors distinct from brand colors.

---

## Foundation Outcomes — Available After ACC-12 Merges

These are wired and ready for all subsequent steps to import:

- `TenantModule` — import this in every foundation and functional module
  to get `TenantService`, `AuditLogService`, and all three provider tokens
- `AuditLogService` — call `log()` on every create/update/delete mutation
- `STORAGE_PROVIDER` (Symbol) — inject for file operations (S3 default)
- `AI_PROVIDER` (Symbol) — inject for AI completions (Anthropic default)
- `AUTH_PROVIDER` (Symbol) — inject for token validation (BetterAuth default)
- `TenantGuard` + `PermissionGuard` — apply `@UseGuards(TenantGuard, PermissionGuard)` at class level on every controller
- `@CurrentTenant()` — use this decorator (never `request.body.organizationId`) to get the tenant ID in controllers
- `@CurrentUser()` — use this decorator to get the actor ID for audit logs
- `@Permissions()` + permission constants in `common/constants/permissions.ts` — use on every endpoint
- `PermissionGuard` is **stubbed until ACC-8 (Roles + Permissions)** — all authenticated requests pass through; do not mistake this for real access control
- All foundation stubs resolved — ACC-5 through ACC-12 complete ✅

---

## KPI Module — Business Requirements

### Industry Scope
AccreditMe is industry-agnostic. Healthcare examples are used
for illustration only. All standard bodies, KPI names, and
measurement frameworks are tenant-configurable via the lookup
system. No industry-specific logic is hardcoded anywhere.

### Two KPI Types

INTERNATIONAL — from accreditation bodies (JCI, CBAHI, ISO, ABET, etc.)
  Predefined names, formulas, and targets from the standard body
  Loaded as system definitions per selected standard
  Cannot be deleted — only deactivated
  Standard bodies are lookup values — not hardcoded
  Any accreditation body can be added by tenant admin

ORGANIZATIONAL — defined by quality dept or department managers
  Custom to the organization's own improvement goals
  Created and managed by authorized users
  Can be organization-wide or department-level

### KPI Scope
  Organization-wide:   orgUnitId = null
  Department-level:    orgUnitId = specific org unit

### Permission Model
  kpi:view_own          — KPIs where user is owner or data entry person
  kpi:view_department   — all KPIs for user's org unit
  kpi:view_all          — all KPIs organization-wide
  kpi:enter_data        — enter measurement values for assigned KPIs
  kpi:verify            — verify and approve entered measurements
  kpi:manage            — create and manage KPI definitions
  kpi:manage_system     — load internationally defined KPI sets

### Data Model
  KpiCategory       — groups KPIs by source and topic
  KpiDefinition     — the KPI definition with target and threshold
  KpiMeasurement    — actual measured values per period

### Direction
  HIGHER_IS_BETTER  — e.g. compliance rate, completion rate
  LOWER_IS_BETTER   — e.g. error rate, incident rate, waiting time

### Traffic Light Thresholds
  Green:  at or better than target
  Amber:  between threshold and target
  Red:    below threshold

### AI Integration Points
  1. Measurement narrative — generated after each data entry
     "The error rate for March exceeded target for the second
      consecutive month. ICU accounts for 67% of cases."
  2. Trend analysis — generated on KPI dashboard view
     "Compliance has improved steadily over 6 months.
      Current trajectory suggests target reached by Q3."
  3. Standard KPI setup assistant — when tenant selects
     their accreditation standard, AI suggests all required
     mandatory KPIs with standard targets and frequencies

### Module Dependencies
  Linked to: Standards module (KPIs as evidence for measurable elements)
  Linked to: Quality improvement (incidents trigger KPI review)
  Linked to: Audit module (findings linked to relevant KPIs)
  Linked to: Org structure (department-level KPI ownership)
  Linked to: Lookup system (standard bodies, units of measure,
             measurement frequencies as configurable values)

### Build Position
  After all quality modules complete (before Phase 2 Monetization)
  Reason: depends on data from documents, incidents, audits,
  and standards modules for auto-calculated measurements

---

## What Claude Must Always Do

- Scope EVERY database query by organizationId — no exceptions ever
- Route ALL state transitions through WorkflowService
- Route ALL due date and SLA calculations through WorkingCalendarService
- Put business logic in services, never in controllers
- Generate a Prisma migration after every schema change
- Use TypeScript strict types — flag any use of any explicitly
- Follow the branching strategy — remind if working directly on main or dev
- Keep each module self-contained
- Validate all request bodies with DTOs and class-validator
- Run long tasks as BullMQ background jobs — never block API requests
- Encrypt all tenant secrets before database storage
- Log all AI interactions with actor, model, prompt summary, and timestamp
- Check that file uploads pass MIME validation and ClamAV scan before storing
- Use signed URLs for all file access — never direct S3 paths

## What Claude Must Never Do

- Write business logic in controllers
- Skip Prisma migrations after schema changes
- Use any type without flagging and explaining why
- Query the database without tenant scoping
- Expose direct S3 URLs — always use signed URLs
- Commit or suggest committing secrets, PATs, or API keys
- Mix concerns across modules
- Call AI, storage, or auth providers directly — always through provider interfaces
- Block an API request with a long-running synchronous operation
- Store tenant API keys or secrets in plain text
- Calculate SLA or due dates without WorkingCalendarService
- Allow UPDATE or DELETE operations on the AuditLog table
- Trust organizationId from the request body
