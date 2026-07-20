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
- State machine: XState (workflow engine)
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
- UI components: PrimeNG (free MIT license)
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

### AI Providers (pluggable per tenant)
- Default: Anthropic Claude API
- Enterprise option: Azure OpenAI (customer's own Azure tenant)
- Direct option: OpenAI API
- Future on-premises: Ollama with local models

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
│   │   │   ├── workflow/             # Workflow engine (XState)
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

## Build Order — Non-Negotiable

Build in this exact sequence. Every layer depends on the one above it.
Never start a functional module before the foundation is complete and tested.

```
Phase 1 — Foundation
  Step 1:  Tenant provisioning + pluggable provider configuration
  Step 2:  Organization structure (units, sub-units, hierarchy)
  Step 3:  Working calendar (working days, hours, holidays, timezone)
  Step 4:  Lookup system (system defaults + tenant extensions)
  Step 5:  Roles + permissions + access control
  Step 6:  Workflow engine (templates, stages, transitions)
  Step 7:  Notification service (event-driven, multi-channel)
  Step 8:  Task management (workflow-generated, SLA-tracked)
  Step 9:  User management (invite, assign, delegate)
  Step 10: Committee management (composition, quorum, roles)
  Step 11: Meeting management (agenda, minutes, decisions, action items)
  Step 12: Super admin portal
  Step 13: Billing + subscription (Stripe)
  Step 14: Tenant onboarding wizard
  Step 15: Tenant offboarding + data export

Phase 2 — Functional Modules
  Step 16: Module 1 — Standards management
           (build hierarchy + measurable elements first —
            documents and audits depend on this)
  Step 17: Module 2 — Quality documentation management
           (documents now link as evidence to measurable elements)
  Step 17b: Document distribution + Staff portal + Acknowledgement records
            (staff members receive and acknowledge published documents —
             staff user type is separate from full users covered in Step 9;
             acknowledgement tracking and compliance reports included here)
  Step 18: Module 3 — Quality improvement
           (incidents and gaps reference standards and documents)
  Step 19: Module 4 — Audit management
           (checklists generated from standards, reference documents,
            findings may trigger quality improvement — depends on all above)
  Step 20: KPI and performance indicators module

Phase 3 — Enhancements
  Step 21: Public API + webhooks + developer portal
  Step 22: Custom report builder
  Step 23: Power BI embed for enterprise tenants
  Step 24: Organization structure change management workflow
  Step 25: draw.io enhancements
```

---

## Architecture Rules

### Multi-Tenancy — Non-Negotiable
- Every database table holding tenant data MUST have an organizationId field
- Prisma middleware intercepts EVERY query and injects organizationId automatically
- NestJS TenantGuard validates JWT tenant matches requested resource on every endpoint
- NEVER trust organizationId from the request body — always from JWT
- Automated cross-tenant isolation tests run in CI — deployment blocked if any fail
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

Tenant config drives which implementation is injected at runtime.
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
Option 2: Azure OpenAI (customer's own Azure tenant endpoint)
Option 3: OpenAI API direct
Option 4: Ollama with local models (future — on-premises)
```
Same interface pattern. AI model and API endpoint configurable per tenant.
AI keys encrypted at rest. AI always assistive — output always reviewed by human.
Every AI interaction logged: prompt, model used, response, actor, timestamp.

### Workflow Engine
- Single WorkflowService handles ALL state transitions across ALL modules
- No module manages its own state — always delegates to WorkflowService
- XState powers the state machine logic
- WorkflowTemplates are tenant-configurable (stages, assignees, SLAs)
- System ships default workflows for every object type
- Every transition recorded in audit trail
- WorkflowService emits events consumed by NotificationService and TaskService

### Task System
- Tasks are ALWAYS generated by workflow transitions — never created ad hoc
- Exception: meeting action items may be created manually (linked to meeting object)
- Single TaskService used by all modules
- SLA calculated by WorkingCalendarService — accounts for working days, hours, holidays
- Escalation triggered automatically when SLA is breached
- Task delegation supported for absence coverage

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
tasks:view                  tasks:manage              tasks:delegate
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
   e. AI provider selection + API key
3. System auto-provisions default lookups, workflows, roles, notifications
4. 14-day free trial — no credit card required
5. Welcome email sequence (day 1, 7, 13)
```

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

## Reporting and Analytics

```
Phase 1 — Built-in dashboards
  Pre-built KPI dashboards per module using PrimeNG Charts
  Compliance scores, document lifecycle, audit findings, incident patterns

Phase 1 — Export engine
  Every table exportable to formatted XLSX via SheetJS
  Scheduled exports: daily/weekly/monthly via email

Phase 2 — Custom report builder
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
Impersonation:      Log in as tenant admin — every action logged
Platform health:    Error rates, job queues, API latency, DB connections
Announcements:      Platform-wide banner messages
Billing overview:   Revenue, churn, trial conversions, plan distribution
```

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

## Step 1 Outcomes — Available After ACC-5 Merges

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
- `PermissionGuard` is **stubbed until Step 5** — all authenticated requests pass through; do not mistake this for real access control
- `bootstrap()` in `TenantService` has TODO stubs for Steps 4–7 — fill each in as the corresponding module is built

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
  Phase 2, Step 20 — after all four functional modules are complete
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
