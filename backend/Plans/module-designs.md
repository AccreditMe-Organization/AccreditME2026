# AccreditMe Module Design Decisions
# Captured during business discussion sessions

---

## Document Module (Step 17)

### Two Separate Workflow Types
- DOCUMENT_REQUEST: lightweight request, if rejected no document created
- DOCUMENT: actual document lifecycle, can start with or without a request

### Document Request Workflow (6 stages)
1. Submitted (initial) - Assignee: SELF
2. Unit Manager Review - Assignee: ORG_UNIT_HEAD, SLA: 16h
3. Quality Review - Assignee: QUALITY_MANAGER, SLA: 16h
4. Approved (final) - triggers Document workflow creation
5. Rejected (final) - no document created

### Document Lifecycle Workflow (7 stages)
1. Drafting (initial) - Assignee: SELF or QUALITY_OFFICER
2. Owners Review - approvalMode: PARALLEL, threshold: ALL, SLA: 40h
3. Stakeholders Review - approvalMode: PARALLEL, threshold: ALL, SLA: 40h
4. Final Approval - approvalMode: PARALLEL, threshold: ALL, SLA: 24h
5. Publish Approval - configurable: SINGLE/COMMITTEE per doc type, SLA: 16h
6. Published (not final - can move to Obsolete or new revision)
7. Obsolete (final)

### Review Response Options (WorkflowApprovalDecision)
- APPROVED: accepted as is
- APPROVED_WITH_COMMENTS: accepted with tracked suggestions
- RETURNED: not acceptable, specific revision required (comment mandatory)
- ABSTAINED: cannot review (reason mandatory)
Note: PENDING is system-set only, never submitted by user

### Quality Officer Role in Approval Stages
- Sees consolidated view of all reviewer responses
- Decides whether to advance or return to drafting
- If ANY reviewer returns → must go back to drafting
- If all approve or approve with comments → can proceed
- Majority abstained → Quality Officer escalates

### Change Request Workflow (CHANGE_REQUEST object type)
- Triggered by: regulation change, standard update
- Requires: Unit Manager + Quality Manager approval
- If approved → opens new document revision cycle
- Separate workflow type from DOCUMENT

### Periodic Review
- BullMQ scheduled job fires when document.nextReviewDate arrives
- Review intervals stored in document_type lookup attributes
  (Policies: 24 months, Procedures: 12 months, etc.)
- Auto-creates new WorkflowInstance starting at Drafting stage
- Increments revision number automatically
- If no changes needed → "Confirm as Current" transition → Published
- If changes made → full review cycle applies

### Document Merge
- New document created with mergedFromIds[] list
- When merged document reaches Published stage
- Workflow action automatically moves source docs to Obsolete
- Source documents no longer accessible to staff portal

### Document Versioning
- Every version stored permanently in S3 — never overwritten
- Full revision history with diff available
- Each revision has revision number (1.0, 1.1, 2.0, etc.)
- Major revision: content changes
- Minor revision: formatting/minor corrections

### Document Access Control Levels
Three levels (tenant admin configures per document):
  ORG_WIDE: visible to all org members (default)
  DEPARTMENT: visible only to specified org units
  CONFIDENTIAL: visible only to specified roles

Access enforced at:
  Document listing API (filter by access level)
  Document view API (403 if no access)
  Staff portal (only distributed documents visible)

### Staff Acknowledgement (Step 17b)
Staff = portal-only users (OTP access, no system login)
Distribution list defined at publish time per org unit
AcknowledgementRecord per staff member per document version
Permanent access to all distributed documents
Re-acknowledgement required on new version publish

---

## CAPA Module (Step 18)

### Two Types Under Same Workflow
- CORRECTIVE: responds to existing nonconformity
- PREVENTIVE: responds to potential nonconformity (proactive)
- Same 10-stage workflow, same stages
- type field on CAPA record: CORRECTIVE | PREVENTIVE

### Seven Trigger Sources
1. Incident finding
2. Audit finding
3. Customer complaint
4. Internal observation
5. Risk assessment
6. Management review
7. Regulatory change
Note: Always linked to source when triggered, can be standalone

### Three Priority Levels (affect SLAs)
- CRITICAL: patient safety/regulatory risk
  Detection SLA: 4h, Investigation: 24h, Target closure: 30 days
- MAJOR: significant quality impact
  Detection SLA: 8h, Investigation: 40h, Target closure: 60 days
- MINOR: limited quality impact
  Detection SLA: 16h, Investigation: 40h, Target closure: 90 days

### CAPA Workflow (10 stages)
1. DETECTION (initial)
   - Problem statement documented
   - Linked to source
   - Risk classification set
   - Immediate correction documented
   - Assignee: QUALITY_OFFICER
   - SLA: 4-16h (by priority)

2. INVESTIGATION
   - Root cause analysis (5-Why, Fishbone, Fault Tree)
   - Evidence collection
   - Scope assessment (isolated vs systemic)
   - Assignee: QUALITY_OFFICER
   - SLA: 24-40h (by priority)

3. ROOT_CAUSE_APPROVED
   - Quality Manager reviews RCA
   - Can return if investigation insufficient
   - Assignee: QUALITY_MANAGER
   - SLA: 16h

4. ACTION_PLANNING
   - Corrective action plan with owners, deadlines, resources
   - Preventive measures identified
   - Risk assessment of proposed actions
   - Assignee: QUALITY_OFFICER
   - SLA: 24h

5. PLAN_APPROVED
   - Quality Manager approves plan
   - Critical CAPAs may require committee approval
   - Department head of affected area approves
   - Assignee: QUALITY_MANAGER
   - SLA: 16h

6. IMPLEMENTATION
   - Actions executed by responsible owners
   - Evidence documented
   - Training conducted if needed
   - Documents updated if relevant
   - Assignee: ROLE (owner of affected process)
   - SLA: 240h default (configurable per plan)

7. IMPLEMENTATION_VERIFIED
   - Quality Officer verifies actual implementation
   - Evidence reviewed (not just claimed done)
   - Returns to Implementation if incomplete
   - Assignee: QUALITY_OFFICER
   - SLA: 16h after implementation deadline

8. EFFECTIVENESS_CHECK
   - Monitoring period 30-90 days post-implementation
   - Evidence that root cause was eliminated
   - Recurrence monitoring results reviewed
   - Assignee: QUALITY_OFFICER
   - SLA: 240h (monitoring period — configurable)

9. EFFECTIVENESS_APPROVED
   - Quality Manager confirms CAPA achieved objective
   - Lessons learned documented
   - Can reopen if recurrence detected
   - Assignee: QUALITY_MANAGER
   - SLA: 16h

10. CLOSED (final)
    - Complete documentation
    - Audit-ready records
    - Lessons learned shared
    - Assignee: QUALITY_MANAGER

### CAPA Cancellation
- Can be cancelled if: wrongly classified, addressed by another CAPA,
  risk accepted by management
- Requires Quality Manager approval + documented justification
- Record never deleted — marked CANCELLED with reason

### Cross-Module Links
- Source incident (if incident-triggered)
- Source audit finding (if audit-triggered)
- Affected documents (needing update)
- Training records (if retraining required)
- Follow-up audit (to verify systemic fix)

---

## Audit Module (Step 19)

### Two Levels of Audit Management
Level 1 — Audit Program (Annual):
  Annual schedule created at start of year
  Covers: which departments, which standards, frequency
  Risk-based prioritization
  Required by: ISO 9001 clause 9.2, JCI, CBAHI
  Model: AuditProgram + AuditProgramItem

Level 2 — Individual Audit (Execution):
  Triggered from audit program item
  OR standalone for special/unplanned audits
  Follows 10-stage workflow below

### AuditProgram Model (to be built in Step 19)
  id, organizationId, year, nameEn, nameAr
  status: DRAFT | ACTIVE | COMPLETED
  createdBy, approvedBy, approvedAt

### AuditProgramItem Model
  id, auditProgramId, orgUnitId
  auditType (from lookup: Internal/External/Surveillance/etc.)
  scheduledQuarter: Q1|Q2|Q3|Q4
  scheduledDate, assignedAuditorId
  status: PLANNED|IN_PROGRESS|COMPLETED|SKIPPED
  auditInstanceId (links to workflow instance when started)

### Individual Audit Workflow (10 stages)
Based on ISO 19011:2026 (latest edition, published May 2026)

1. PLANNING (initial)
   - Audit objectives, scope, criteria, team assigned
   - Schedule agreed
   - Assignee: AUDITOR role (use QUALITY_MANAGER if no AUDITOR role)
   - SLA: none (planning-dependent)

2. ANNOUNCED
   - Auditee formally notified
   - Opening meeting scheduled
   - Document review request sent
   - Required by ISO 19011
   - Assignee: AUDITOR
   - SLA: 40h

3. FIELDWORK
   - On-site/remote evidence collection
   - Interviews, observations, document review
   - Checklist execution
   - Assignee: AUDITOR
   - SLA: 40h

4. FINDINGS_DRAFT
   - Findings documented and classified:
     Major NC, Minor NC, Observation, Opportunity
   - Assignee: AUDITOR
   - SLA: 24h

5. AUDITEE_RESPONSE
   - Auditee reviews findings
   - May dispute or comment
   - Provides initial corrective action commitments
   - Required by JCI and ISO 19011 (fairness principle)
   - Assignee: QUALITY_MANAGER (auditee side)
   - SLA: 40h

6. REPORT_REVIEW
   - Lead auditor reviews auditee responses
   - Finalizes findings
   - Prepares formal report
   - Assignee: AUDITOR
   - SLA: 16h

7. REPORT_APPROVED
   - Report approved by Quality Manager
   - Assignee: QUALITY_MANAGER
   - SLA: 16h

8. CORRECTIVE_ACTION
   - CAP submitted and tracked
   - Links to CAPA module for each finding
   - Assignee: QUALITY_MANAGER
   - SLA: depends on finding severity

9. VERIFICATION
   - Auditor verifies corrective actions implemented and effective
   - Follow-up audit or evidence review
   - Required by ISO 19011 before closure
   - Assignee: AUDITOR
   - SLA: 240h (1 month)

10. CLOSED (final)
    - All findings resolved
    - Assignee: QUALITY_MANAGER

### Note on AUDITOR Role
If AUDITOR system role does not exist in seed data,
use QUALITY_MANAGER as fallback for auditor stages.
Consider adding AUDITOR as a system role in Step 4 data.

---

## Task Management Module (Step 8)

### Core Principle
Tasks are cross-module. Every task MUST have sourceType 
and sourceId — no standalone tasks allowed.
Tasks are always linked to a quality event.

### Task Source Types
MEETING, DOCUMENT, AUDIT, CAPA, INCIDENT,
CORRECTIVE_ACTION, STANDARD, KPI,
GAP, QUALITY_IMPROVEMENT_PLAN

### Multi-Assignee Design
Tasks support multiple assignees via TaskAssignee junction.
Completion rule: ANY one assignee completes → task marked 
COMPLETED and removed from all other assignees' task lists.
Record of who completed it kept in TaskAssignee.

### SLA Configuration
Task SLAs are TENANT-CONFIGURABLE — not hardcoded.
Stored in Organization.settings JSON:
{
  "taskSla": {
    "CRITICAL": 4,
    "HIGH": 16,
    "MEDIUM": 40,
    "LOW": 80
  }
}
Platform defaults shown above — tenant admin can override.
When task created without explicit due date:
  Read organization.settings.taskSla for priority
  Call WorkingCalendarService.calculateDeadline(now, hours)
  Set task.dueDate

NOTE: ALL SLAs in AccreditMe are tenant-configurable.
  Workflow stage SLAs: configurable per stage (slaWorkingHours) ✅
  Task priority SLAs: Organization.settings.taskSla ← this module
  CAPA closure targets: tenant settings ← Step 18
  Document review cycles: document_type lookup attributes ✅

### Escalation Rules (org structure aware)
Creator optionally sets escalationUserId and 
escalationAfterHours when creating a task.

Validation on escalation target:
  escalationUserId must be BOTH:
  1. In same org unit OR a parent org unit of assignee(s)
  2. Have role with higher or equal permission level 
     than the assignee(s)
     
This prevents escalating to peers or subordinates.

### Evidence of Completion
Tasks support multiple evidence items via TaskEvidence model.
Evidence types:
  TEXT               ← free text description
  ATTACHMENT         ← file uploaded to S3
  LINK               ← external URL with optional title
  INTERNAL_REFERENCE ← reference to AccreditMe business object

INTERNAL_REFERENCE refType values:
  DOCUMENT, AUDIT, INCIDENT, CAPA, MEETING,
  STANDARD, CORRECTIVE_ACTION, GAP

refDisplay field caches display name at creation time
for performance (e.g. "POL-ICU-2024 v2.0")

Back-references: referenced objects can show which tasks 
reference them — computed on demand via query, no extra schema.

### Task Permission Model
tasks:create — who can create tasks (tenant admin assigns to roles)
tasks:reassign — who can reassign tasks
tasks:complete — who can mark tasks complete
tasks:manage — full task management

### No Subtasks
Deferred to Phase 3. Multi-assignee covers most use cases.

### Data Models

Task:
  id, organizationId
  title, description
  sourceType (TaskSourceType enum)
  sourceId
  sourceStageId (optional — workflow stage that created it)
  meetingId (optional — cross-meeting tracking)
  priority: CRITICAL | HIGH | MEDIUM | LOW
  status: PENDING | IN_PROGRESS | COMPLETED | OVERDUE | CANCELLED
  dueDate (calculated from priority SLA or manually set)
  dueDateOverridden: Boolean (was it manually set?)
  createdById
  completedAt, completedById
  escalationUserId (optional)
  escalationAfterHours (optional)
  createdAt, updatedAt

TaskAssignee (junction — multi-assignee support):
  id, taskId, userId
  assignedAt, assignedById
  removedAt (when task completed by someone else)

TaskEvidence:
  id, organizationId, taskId
  type: TEXT | ATTACHMENT | LINK | INTERNAL_REFERENCE
  content (for TEXT)
  s3Key, fileName, fileSize, mimeType (for ATTACHMENT)
  url, linkTitle (for LINK)
  refType: TaskEvidenceRefType? (for INTERNAL_REFERENCE)
  refId: String? (ID of referenced record)
  refDisplay: String? (cached display name)
  uploadedById, uploadedAt

### Cross-Meeting Task Chain
Tasks created on meeting MINUTES_APPROVED:
  sourceType: MEETING, sourceId: meeting instance id
  meetingId: this meeting id

Next meeting AGENDA_READY auto-loads:
  All tasks WHERE sourceType = MEETING
  AND status != COMPLETED
  AND meetingId IN (previous meetings of same group)

Secretary records in MINUTES_DRAFT:
  COMPLETED (with evidence)
  IN_PROGRESS (% complete, new deadline)
  CARRIED_FORWARD (with reason)
  CANCELLED (with reason)

### AI Integration Points — Task Module

1. SMART_TASK_CREATION (when workflow fires CREATE_TASK)
   AI enriches auto-generated tasks with:
   - Better descriptive title from context
   - Realistic due date based on assignee workload
     and historical completion times
   - Priority suggestion based on source urgency
   Context: tenant-scoped tasks and source objects only
   Status: stub in Step 8, activate in Step 17+

2. WORKLOAD_BALANCING (during task assignment)
   AI warns if assignee is overloaded:
   "Ahmad has 12 open tasks with 3 overdue.
    Consider reassigning to Sara (4 open tasks)"
   Suggests alternatives based on current workload
   Context: tenant-scoped tasks and users only

3. EVIDENCE_SUGGESTION (when completing a task)
   AI suggests relevant internal references:
   Based on task source object, suggests documents,
   meetings, CAPAs, audits that could serve as evidence
   Context: tenant-scoped records only
   Status: stub in Step 8

4. OVERDUE_PATTERN_ANALYSIS (BullMQ weekly job)
   AI analyzes overdue task patterns:
   - Which assignees consistently miss deadlines
   - Which task types are always overdue
   - Which source modules generate most overdue tasks
   - Which org units are consistently behind
   Output: weekly pattern report to Quality Manager
   Status: defer to Phase 3 (needs data history)

5. TASK_DESCRIPTION_DRAFTING (manual task creation)
   User provides brief description
   AI expands to clear actionable task with context
   Status: defer to Phase 3

All AI context strictly tenant-scoped (organizationId filter)

---

## Notification Module (Step 7)

### Scope
Full design in: backend/Plans/step-07-notification-service.md

### Key Decisions
- Single Notification row per recipient per event
- channel field: IN_APP | EMAIL | BOTH | SMS (future)
- NotificationModule is @Global()
- Direct NotificationService.create() calls from other modules
  (no event emitter bus — deferred to Phase 3)
- Bell component polls every 30s for unread count
- Real-time WebSocket notifications deferred to Phase 3
- Resend for email delivery with BullMQ retry (3 attempts)
- Email errors throw so BullMQ retries correctly

### AI Integration
- Morning briefing: deferred (Step 20+ dependency)
- Personalized notification text: deferred to Phase 3

---

## Absence and Departure Management (Cross-Cutting)

### Three Patterns

Pattern 1 — Acting Assignment (planned absence):
  User sets out-of-office before going on leave
  Designates an acting user to cover assignments
  WorkflowService checks out-of-office when resolving assignee:
    IF user.outOfOfficeFrom <= now <= outOfOfficeTo
    AND user.actingUserId is set:
      → assign to actingUser instead
      → notify both absent user and acting user
      → audit log: "Assigned to [Acting] — [User] is on leave"
    ELSE:
      → assign normally but flag as user on leave
      → notify Tenant Admin to reassign

Pattern 2 — Manual Reassignment (admin action):
  Available to: Tenant Admin, Quality Manager, task creator
  Reassignable objects:
    Tasks: new assignee(s) selected
    Workflow stages: new assigneeUserId
    CAPAs: ownership transferred
    Committee seats: replacement member nominated
  Full audit trail on every reassignment:
    "Reassigned from [User A] to [User B]
     by [Admin] on [date] — Reason: [text]"

Pattern 3 — Role-Based Fallback (vacancy):
  SLA monitor detects: workflow stage with no eligible assignee
  (role-based assignment but role has no active members)
  Actions:
    1. Flag stage as UNASSIGNED (isUnassigned: true)
    2. Notify Tenant Admin immediately
    3. Pause stage SLA until reassigned
    4. Tenant Admin sees Unassigned Stages dashboard widget

### User Departure Flow (Critical)
When user.isActive set to false (left company):
  1. Increment tokenVersion (all JWTs immediately revoked)
  2. Find all open assignments:
     Tasks, Workflow stages, CAPAs, Committee memberships
  3. If actingUserId was set:
     → Transfer all assignments to acting user automatically
  4. If no acting user:
     → Flag all assignments as UNASSIGNED
     → Notify Tenant Admin with complete list
     → Tenant Admin must bulk-reassign before work continues
  5. Audit trail: "User deactivated — X assignments transferred/flagged"

### Data Model Additions

User model (Step 9):
  outOfOfficeFrom  DateTime?
  outOfOfficeTo    DateTime?
  actingUserId     String?   ← who covers during absence

WorkflowInstanceStage additions (Step 6 enhancement):
  isUnassigned     Boolean @default(false)
  unassignedAt     DateTime?

Task model (Step 8):
  Reassignment via TaskAssignee junction:
    Add new assignee row, remove old assignee row
    Both changes logged in audit trail

### Build Sequence
Step 8 (Tasks — current):
  Task reassignment action (Pattern 2 for tasks)
  Out-of-office check when creating/assigning tasks
  UNASSIGNED task status when no eligible assignee

Step 9 (Users):
  outOfOfficeFrom/outOfOfficeTo/actingUserId fields
  Out-of-office settings UI
  Acting user assignment UI
  User departure bulk-reassignment flow

Step 6 enhancement (during Step 9):
  WorkflowService out-of-office routing
  Role vacancy detection in SLA monitor
  isUnassigned flag on WorkflowInstanceStage

Step 10 (Committees):
  Committee seat replacement when member departs

### AI Integration — Absence Management
Coverage gap detection (BullMQ daily job):
  AI identifies: users going on leave with no acting user set
  and open critical assignments
  Output: alert to Tenant Admin with coverage gaps
  "Ahmad goes on leave in 3 days with 5 critical
   assignments and no acting user designated"

---

## Org Position Module (Part of Step 8)

### Purpose
Defines organizational hierarchy of positions/grades.
Used for escalation validation, delegation authority,
and absence coverage rules across ALL modules.
This is NOT the same as OrgUnit.type which describes
the department structure — OrgPosition describes a
user's seniority within their unit.

### Design
Org-wide positions (orgUnitId = null):
  Apply across all departments
  e.g. Director, Deputy Director
  Seeded by default on bootstrap

Org-unit-specific positions (orgUnitId set):
  Apply within a specific department only
  e.g. "ICU Unit Manager"
  Created by tenant admin as needed

Grade system:
  grade: Int (1=lowest, 10=highest)
  Tenant admin defines grade for each position
  Default positions ship with pre-set grades

### Escalation Validation
Requires BOTH conditions to pass:
  1. target.position.grade >= max(assignee grades)
  2. target.primaryOrgUnitId in same or parent org unit

Edge cases:
  Assignee has no position: grade treated as 0 (any target valid)
  Target has no position: grade treated as 0 (fails if assignee has position)
  Target has no primaryOrgUnitId: fails org unit check

### Default Positions (seeded on bootstrap)
10 org-wide positions (orgUnitId = null):
Director(10), Deputy Director(9), Department Head(8),
Section Manager(7), Senior Specialist(6), Specialist(5),
Senior Technician(4), Technician(3), Coordinator(2), Staff(1)

### Cross-Module Usage
Step 8  Tasks:       validateEscalationTarget()
Step 9  Users:       User.positionId assignment in profile
Step 10 Committees:  chair authority validation
Step 11 Meetings:    meeting chair authority
Step 17 Documents:   approval authority chain
Step 18 CAPA:        ownership and escalation
Step 19 Audits:      audit team authority

### Permission Mapping
positions:view    — read org positions
positions:manage  — create/edit/deactivate positions

### AI Integration
POSITION_COVERAGE_GAP (BullMQ daily job):
  AI detects org units with no users assigned to
  senior positions (grade >= 7)
  Output: alert to Tenant Admin with specific gaps

---

## Meeting Module (Step 11)

### Scope Boundary
AccreditMe manages meeting GOVERNANCE RECORDS only.
Meeting logistics (Zoom/Teams/physical/room booking)
are outside scope. Integration with calendar/video
platforms is a Phase 3 webhook feature.

### Meeting Workflow (6 Stages)
1. PLANNED (initial)
   Meeting record created with title, date, type,
   committee/group, organizer, attendees list
   Can be rescheduled: field update NOT a stage transition
   Rescheduling recorded in rescheduleHistory[] with reason
   Assignee: SELF (organizer)

2. AGENDA_READY
   Agenda items added
   Previous meeting open tasks auto-loaded as first section
   Supporting documents attached
   Attendees notified via AccreditMe notification
   Assignee: SELF (organizer)
   SLA: configurable per committee (default 24h before meeting)

3. MINUTES_DRAFT
   Meeting held outside AccreditMe
   Secretary records:
     - Actual attendance (present/absent/excused)
     - Quorum status (met/not met — documented either way)
     - Status update on previous action items
     - Decisions made with vote records if applicable
     - New action items with owners and deadlines
   Assignee: SELF (secretary)
   SLA: 16h after meeting date

4. MINUTES_REVIEW
   Draft minutes distributed to all attendees
   Attendees can suggest FACTUAL corrections only
   Cannot change substance of decisions
   approvalMode: PARALLEL, threshold: ALL
   SLA: 16h

5. MINUTES_APPROVED (final — normal closure)
   Chair approves final minutes
   Minutes locked as permanent record
   New action items → Tasks created automatically
     sourceType: MEETING, sourceId: meeting instance id
   Open previous tasks carried forward to next meeting
   Assignee: committee chair or organizer
   SLA: 8h

6. CANCELLED (final — cancelled meetings)
   Mandatory cancellation reason required
   All attendees notified automatically
   Record kept permanently for audit trail
   Can transition from PLANNED or AGENDA_READY

### Rescheduling (NOT a stage transition)
   Meeting stays in PLANNED stage
   New date/time updated on meeting record
   Previous dates stored in rescheduleHistory[]
   rescheduleCount incremented
   All attendees notified of new date

### Cross-Meeting Task Chain
   Tasks created on MINUTES_APPROVED:
     sourceType: MEETING, sourceId: meeting instance id
     meetingId: this meeting id

   Next meeting AGENDA_READY auto-loads:
     All tasks WHERE sourceType = MEETING
     AND status != COMPLETED
     AND meetingId IN (previous meetings of same group)

   Secretary records in MINUTES_DRAFT:
     COMPLETED (with evidence)
     IN_PROGRESS (% complete, new deadline)
     CARRIED_FORWARD (with reason)
     CANCELLED (with reason)

### Vote Records
   Stored as structured data in meeting record (not free text)
   Fields: topic, voteType, votesFor, votesAgainst,
           abstentions, quorumMet, outcome
   Enables: committee decision history, governance reports

### AI Integration Points — Meeting Module

1. AGENDA_GENERATION (AGENDA_READY stage)
   AI analyzes previous minutes, open tasks,
   pending quality events to suggest agenda items
   Context: tenant-scoped meetings, tasks, CAPAs, KPIs
   Output: prioritized agenda suggestions with
           supporting data per item

2. MINUTES_DRAFTING (MINUTES_DRAFT stage)
   Secretary provides rough notes or transcript
   AI drafts formal minutes in correct format
   Automatically extracts action items
   Highlights decisions clearly
   Output: draft minutes ready for review

3. ACTION_ITEM_EXTRACTION (MINUTES_DRAFT stage)
   Part of minutes drafting
   AI suggests: task title, assignee, due date, priority
   Secretary confirms before tasks are created

4. MEETING_SUMMARY (MINUTES_APPROVED stage)
   AI generates executive summary for absent members
   Plain language not formal minutes
   Highlights key decisions and implications

All AI context strictly tenant-scoped (organizationId filter)

---

## Committee Module (Step 10)

### Committee Lifecycle
Separate from individual meeting lifecycle:
FORMATION → TERMS_REVIEW → ACTIVE → DISSOLUTION_PENDING → DISSOLVED
Optional path: ACTIVE → SUSPENDED → ACTIVE (or DISSOLUTION_PENDING)

### Committee Workflow (6 Stages)
1. FORMATION (initial)
   Committee record created
   Name, type, purpose defined
   Terms of Reference drafted (as Document module document)
   Initial members nominated
   Assignee: QUALITY_MANAGER

2. TERMS_REVIEW
   Terms of Reference reviewed by establishing authority
   Quorum requirements set
   Meeting frequency configured
   approvalMode: SINGLE or COMMITTEE
   Assignee: QUALITY_MANAGER or senior authority
   SLA: 40h

3. ACTIVE
   Committee formally constituted and operational
   Members confirmed with roles
   First meeting can be scheduled
   Long-running operational state (not final)
   Membership changes recorded as MembershipEvents (not transitions)

4. SUSPENDED
   Temporarily inactive (reorganization, regulatory change)
   Reason documented, members notified
   Can reactivate to ACTIVE

5. DISSOLUTION_PENDING
   Being wound down
   Outstanding items resolved or transferred
   Final report prepared
   Assignee: QUALITY_MANAGER
   SLA: 40h

6. DISSOLVED (final)
   Formally closed, all records archived
   Outstanding items transferred to other committees

### Transitions
FORMATION → TERMS_REVIEW          "Submit for Approval"    committees:manage
TERMS_REVIEW → ACTIVE             "Approve Committee"      committees:approve
TERMS_REVIEW → FORMATION          "Revise Terms"           committees:approve
ACTIVE → SUSPENDED                "Suspend Committee"      committees:manage
SUSPENDED → ACTIVE                "Reactivate Committee"   committees:manage
ACTIVE → DISSOLUTION_PENDING      "Initiate Dissolution"   committees:manage
SUSPENDED → DISSOLUTION_PENDING   "Dissolve"               committees:manage
DISSOLUTION_PENDING → DISSOLVED   "Confirm Dissolution"    committees:approve

### Membership Changes (within ACTIVE stage)
NOT workflow stage transitions — recorded as events:
MembershipEvent:
  committeeId, userId, role
  action: JOINED | LEFT | ROLE_CHANGED
  effectiveDate, reason, approvedBy
Provides complete audit trail of membership at any point in time

### Terms of Reference
Formal document in the Document module (not a text field)
Document type: terms_of_reference (TOR prefix, annual review)
Created when committee enters FORMATION
Goes through document approval workflow
Linked to committee record
When revised → new version through document approval workflow

### Data Models (Step 10)
Committee:
  id, organizationId, nameEn, nameAr
  type (from lookup: committee_type)
  purpose, quorumCount
  meetingFrequency: WEEKLY|MONTHLY|QUARTERLY|BIANNUAL|ANNUAL|AS_NEEDED
  parentCommitteeId (optional — sub-committees)
  termsOfReferenceDocumentId
  reportingToId (committee or role it reports to)
  formedAt, dissolvedAt

CommitteeMember:
  id, committeeId, userId
  role (from lookup: committee_member_role)
  joinedAt, leftAt, isActive

CommitteeMembershipEvent:
  id, committeeId, userId, role
  action: JOINED|LEFT|ROLE_CHANGED
  effectiveDate, reason, approvedBy

### What Accreditation Surveyors Check
- Terms of Reference document (approved and current)
- Membership records (who, when, what role)
- Attendance records per meeting
- Quorum confirmation at each meeting
- Decisions recorded with vote counts
- Action items tracked to completion
- Reporting evidence (reports submitted to parent body)

### AI Integration Points — Committee Module

1. TOR_DRAFTING (FORMATION stage)
   Tenant provides: committee type, purpose,
   organization type, key stakeholders
   AI generates complete Terms of Reference document
   Based on international governance best practices
   and relevant accreditation standards
   Output goes into Document module for approval workflow

2. COMMITTEE_HEALTH_REPORT (dashboard widget)
   AI analyzes: meeting frequency compliance,
   quorum achievement rate, action item completion,
   open decisions pending follow-up
   Output: traffic light status + recommendations

3. DECISION_PATTERN_ANALYSIS (on demand)
   AI analyzes decisions across all committees
   Identifies: recurring topics, deferred decisions,
   contradictory decisions, decisions without evidence
   Output: insights report for management review

All AI context strictly tenant-scoped (organizationId filter)

### Additional Document Types Added
terms_of_reference added to lookup.seed.ts:
  key: terms_of_reference
  labelEn: Terms of Reference
  labelAr: النظام الداخلي
  numberingPrefix: TOR
  requiresCommitteeApproval: true
  defaultReviewCycleMonths: 12
  defaultRetentionYears: 10

---

## Standards Management Module (Step 16)

### Core Concepts

#### 1. Standard (template)
Standard:
  id, organizationId (null = system standard)
  body (from lookup: standard_body)
  nameEn, nameAr
  version (e.g. "8th Edition 2024")
  effectiveDate
  isSystem: true = shipped with AccreditMe
  isActive

#### 2. Flexible N-Level Hierarchy (StandardNode)
CRITICAL DESIGN DECISION:
Standard hierarchy depth varies between standards:
  JCI: Section → Chapter → Standard → Measurable Element (4 levels)
  CBAHI: Chapter → Standard → Sub-Standard (3 levels)
  ISO 9001: Clause → Sub-clause → Sub-sub-clause (3 levels)
  ISO 27001: Domain → Control (2 levels)

Solution: Self-referential StandardNode tree (not fixed levels)

StandardNode:
  id, standardId, parentId (null = root)
  code (e.g. "ACC.1", "QM.1.1", "7.5.1")
  nameEn, nameAr
  nodeType: SECTION|CHAPTER|STANDARD|SUB_STANDARD|
            MEASURABLE_ELEMENT|REQUIREMENT|CONTROL
  intentEn, intentAr (explanatory text)
  isLeaf: true = evidence mapped here
  order

isLeaf marks where evidence gets mapped regardless of depth.
This allows AccreditMe to handle any standard structure.

#### 3. Accreditation Round (tenant-specific lifecycle)
AccreditationRound:
  id, organizationId
  standardId
  nameEn, nameAr (e.g. "JCI Survey 2026")
  surveyDate (target or actual)
  status: PREPARATION|SURVEY_SCHEDULED|SURVEY_COMPLETE|
          ACCREDITED|CONDITIONALLY_ACCREDITED|NOT_ACCREDITED
  cycleYears (2 or 3 per accreditation body)
  nextSurveyDate (auto-calculated: surveyDate + cycleYears)
  overallScore, surveyors, notes

#### 4. Chapter Assignment (responsibility mapping per your insight)
ChapterAssignment:
  id, organizationId, accreditationRoundId
  standardNodeId (chapter/section being assigned)
  responsibleOrgUnitId (department that owns this chapter)
  coordinatorUserId (manages evidence collection)
  targetCompletionDate
  status: NOT_STARTED|IN_PROGRESS|READY|SUBMITTED
  complianceScore (calculated from evidence mappings)

#### 5. Evidence Mapping (core activity)
EvidenceMapping:
  id, organizationId, accreditationRoundId
  standardNodeId (must be isLeaf = true)

  Linked evidence from other modules:
  documentIds[], auditIds[], incidentIds[]
  capaIds[], meetingIds[], kpiIds[]
  attachments[] (uploaded files, certificates)

  responsibleOrgUnitIds[] (one or more org units)

  complianceStatus: COMPLIANT|PARTIALLY_COMPLIANT|
                    NON_COMPLIANT|NOT_ASSESSED
  complianceScore: 0-100
  assessedBy, assessedAt, notes

  Survey findings (after actual survey):
  surveyorScore: MET|PARTIALLY_MET|NOT_MET
  surveyorFindings, surveyorRecommendations

### Accreditation Round Workflow (10 stages)
Requires: ACCREDITATION_ROUND added to WorkflowObjectType enum

1. PREPARATION (initial)
   Round created, survey date set
   Chapter assignments created per department
   Compliance and audit responsibilities assigned per chapter
   Due dates set for evidence submission per chapter
   Assignee: QUALITY_MANAGER

2. GAP_ASSESSMENT
   Each chapter assessed for compliance
   Evidence mapped to measurable elements
   Gaps identified → GAP records created automatically
   Assignee: QUALITY_OFFICER per chapter
   SLA: configurable based on survey date

3. EVIDENCE_COLLECTION
   All gaps addressed via Quality Improvement Plans
   Evidence mapped and verified per element
   Pre-survey readiness check
   Assignee: QUALITY_OFFICER

4. MOCK_SURVEY (optional)
   Internal mock survey conducted
   Using actual survey methodology
   Findings documented
   Additional gaps/CAPAs triggered if needed
   Assignee: AUDITOR role

5. SURVEY_READY
   All evidence submitted
   Organization confirmed ready for external survey
   Assignee: QUALITY_MANAGER

6. SURVEY_IN_PROGRESS
   External surveyors on site or remote
   Evidence presented
   Real-time findings recorded
   Assignee: QUALITY_MANAGER

7. FINDINGS_RESPONSE
   Surveyor findings received
   Organization prepares response and clarifications
   CAPAs created for non-compliant elements
   Assignee: QUALITY_MANAGER
   SLA: per accreditation body requirements

8. ACCREDITED (final — success)
   Certificate issued
   Next round auto-scheduled (surveyDate + cycleYears)

9. CONDITIONALLY_ACCREDITED (final — conditional)
   Granted with conditions tracked as CAPAs
   Follow-up survey scheduled

10. NOT_ACCREDITED (final — failed)
    Major findings documented
    Improvement plan required
    New round can be initiated

### AI Integration Points — Standards Module

1. EVIDENCE_SUGGESTION (Evidence Collection stage)
   AI suggests which existing records satisfy each element
   Context: tenant-scoped documents, audits, CAPAs, meetings
   Output: suggested evidence links per measurable element

2. GAP_ANALYSIS_REPORT (on demand)
   AI identifies elements with no or insufficient evidence
   Priority ranking: critical gaps flagged first
   Estimated readiness score per chapter and overall

3. READINESS_SCORE (dashboard widget)
   Real-time compliance % per chapter and overall
   Trend: improving/declining/stable
   Days until survey countdown

4. CONTRADICTION_DETECTION (Evidence Collection)
   AI identifies conflicts between mapped documents
   and standard requirements
   Output: specific contradiction with citation

5. MOCK_SURVEY_ASSISTANT (Mock Survey stage)
   AI plays surveyor role per measurable element
   Asks probing questions, flags weak evidence
   Suggests stronger evidence alternatives

6. STANDARD_COMPARISON (on demand)
   Compares requirements between two standards
   Useful for dual-accreditation organizations

7. STANDARD_INTERPRETATION (on demand)
   Plain-language explanation of each measurable element
   Translates technical standard language to practical guidance
   Example: "What does JCI ACC.1.3 ME2 actually require
            us to do in plain terms?"
   Output: plain language explanation + practical checklist
   Context: standard text only (no tenant data needed)

All AI context strictly tenant-scoped (organizationId filter)

### Permission Mapping
standards:view         — read standards, view evidence mappings
standards:manage       — create/edit accreditation rounds,
                         manage chapter assignments
standards:link_evidence — link AccreditMe records as evidence
                          to measurable elements

### Schema Notes
Add to WorkflowObjectType enum:
  ACCREDITATION_ROUND
(additional migration needed before Step 16 begins)

---

## Gap Management Module (part of Step 18)

### What is a Gap vs a CAPA
Gap: A documented shortfall between current state
     and required standard/target
     Strategic level — "we are not meeting this requirement"

CAPA: A specific corrective or preventive action
      Operational level — "do this specific thing to fix it"

Relationship:
  One Gap → generates ONE OR MORE CAPAs
  Multiple related Gaps → can share same QIP
  Gap NOT closed until ALL its CAPAs verified effective

### Gap Sources (7 types)
1. Standards non-compliance (from EvidenceMapping)
2. Audit finding
3. KPI below target
4. Incident pattern (recurring incidents)
5. Management review decision
6. Customer complaint trend
7. Internal observation / proactive identification

### Three-Level Structure
Level 1 — Gap (the identified shortfall)
Level 2 — Quality Improvement Plan / QIP
          (structured plan addressing one or more related gaps)
Level 3 — CAPA (specific actions from the QIP)

QIP Model:
  id, organizationId
  nameEn, nameAr
  description
  gapIds[] (one or more gaps being addressed)
  objectives, successCriteria
  timeline, resources
  responsibleUserId
  status: DRAFT|APPROVED|IN_PROGRESS|COMPLETED

### Gap Lifecycle Workflow (9 stages)
Requires: GAP added to WorkflowObjectType enum

1. IDENTIFIED (initial)
   Gap documented with:
   - Description of shortfall
   - Source (audit/standard/KPI/incident/etc.)
   - Linked source record ID
   - Initial severity: CRITICAL|MAJOR|MINOR
   - Responsible org unit
   Assignee: QUALITY_OFFICER
   SLA: 4-8h (gap must be formally recorded quickly)

2. ANALYSIS
   Root cause analysis performed:
   - Tool: 5 Whys, Fishbone, Pareto, Fault Tree
   - Root cause category: People|Process|Technology|
     Environment|Materials|Measurement
   - Scope: isolated or systemic
   - Contributing factors documented
   Assignee: QUALITY_OFFICER
   SLA: 24-40h by severity

3. PLAN_DEVELOPMENT
   Quality Improvement Plan created:
   - Objectives and success criteria defined
   - Timeline with milestones
   - Resources required
   - CAPAs generated (one per specific action)
   - Risk assessment of the plan
   Assignee: QUALITY_OFFICER
   SLA: 24h

4. PLAN_APPROVED
   Quality Manager reviews and approves QIP
   Critical gaps may require committee approval
   Assignee: QUALITY_MANAGER
   SLA: 16h

5. IN_PROGRESS
   CAPAs being executed
   Progress tracked through CAPA module
   Gap stays here until ALL linked CAPAs verified
   Assignee: QUALITY_OFFICER (monitoring)
   SLA: per QIP timeline

6. EFFECTIVENESS_REVIEW
   All CAPAs completed and verified
   Quality Officer reviews whether gap truly closed:
   - Evidence that shortfall is resolved
   - Performance data showing improvement
   - Re-assessment against original requirement
   Assignee: QUALITY_OFFICER
   SLA: 16h

7. CLOSED (final — normal closure)
   Gap formally closed
   Evidence of closure documented
   Lessons learned recorded
   If standards gap → EvidenceMapping updated to COMPLIANT
   Assignee: QUALITY_MANAGER

8. STICKY (special non-final status)
   Gap recurred after closure OR
   IN_PROGRESS for more than 2x planned timeline
   Elevated to management/committee attention
   Requires strategic intervention not just operational CAPA
   Can move back to ANALYSIS for deeper investigation
   Assignee: QUALITY_MANAGER

9. ACCEPTED_RISK (final — risk accepted)
   Organization formally accepts gap cannot be closed
   Risk acceptance documented with justification
   Management sign-off required
   Accreditation body notified if standards-related
   Record kept permanently
   Assignee: QUALITY_MANAGER

### Key Transitions
Forward:
IDENTIFIED → ANALYSIS              "Start Analysis"        gaps:investigate
ANALYSIS → PLAN_DEVELOPMENT        "Submit Root Cause"     gaps:investigate
PLAN_DEVELOPMENT → PLAN_APPROVED   "Submit Plan"           gaps:investigate
PLAN_APPROVED → IN_PROGRESS        "Approve Plan"          gaps:approve
IN_PROGRESS → EFFECTIVENESS_REVIEW "All CAPAs Complete"   gaps:investigate
EFFECTIVENESS_REVIEW → CLOSED      "Confirm Gap Closed"    gaps:approve
EFFECTIVENESS_REVIEW → STICKY      "Mark as Sticky"        gaps:approve
STICKY → ANALYSIS                  "Re-investigate"        gaps:approve
IN_PROGRESS → ACCEPTED_RISK        "Accept Risk"           gaps:approve

Rejection paths:
PLAN_APPROVED → PLAN_DEVELOPMENT   "Revise Plan"           gaps:approve
ANALYSIS → IDENTIFIED              "Insufficient Analysis" gaps:approve

### STICKY Gap Definition
Triggered automatically when:
  Gap recurs within 6 months of closure
OR manually by Quality Manager when:
  Gap IN_PROGRESS > 2x planned timeline

STICKY requires:
  Escalation to committee level
  Strategic intervention plan (not just more CAPAs)
  Root cause re-investigation at systemic level

### AI Integration Points — Gap Module

1. ROOT_CAUSE_SUGGESTION (ANALYSIS stage)
   AI suggests probable root causes based on:
   - Gap description and source
   - Similar historical gaps in the organization
   - Industry patterns for this type of gap
   Output: ranked root cause hypotheses with
           supporting evidence questions

2. QIP_DRAFTING (PLAN_DEVELOPMENT stage)
   AI drafts a Quality Improvement Plan:
   - Suggested objectives based on root cause
   - Recommended actions from best practices
   - Realistic timeline based on gap severity
   - Similar successful plans from system knowledge
   Output: draft QIP for Quality Officer to refine

3. SIMILAR_GAPS_DETECTION (IDENTIFIED stage)
   AI checks if similar gaps exist or existed:
   - Currently open gaps with same root cause
   - Previously closed gaps that recurred (STICKY candidates)
   - Related gaps that could share a QIP
   Output: list of related gaps with suggestion to
           consolidate into one QIP

4. EFFECTIVENESS_PREDICTION (IN_PROGRESS stage)
   AI monitors CAPA completion and predicts:
   - Likelihood gap will be closed on time
   - Risk of becoming STICKY based on patterns
   - Early warning if CAPAs are insufficient
   Output: traffic light status + specific risk flags

5. STICKY_PATTERN_ANALYSIS (STICKY stage)
   AI performs deeper systemic analysis:
   - Why did previous CAPAs not work?
   - What systemic factors are contributing?
   - What strategic interventions have worked
     in similar situations?
   Output: systemic analysis report for committee

All AI context strictly tenant-scoped (organizationId filter)

### Schema Notes
Add to WorkflowObjectType enum:
  GAP
(additional migration needed before Step 18 begins)

Add to TaskSourceType enum (Step 8):
  GAP
  QUALITY_IMPROVEMENT_PLAN

---

## Incident Module (Step 18)

### Core Principle
Not all incidents require full RCA and CAPA.
Some incidents can be closed immediately after
investigation if immediate action was sufficient.
The log must always show the decision and reasoning.

### Two Closure Paths
Path A — Simple closure (immediate action sufficient):
  REPORTED → INVESTIGATING → CLOSED
  Minor incidents where recurrence risk is low
  Immediate action documented and deemed sufficient
  Quality Manager approves skipping RCA
  Reason for skipping RCA mandatory

Path B — Full investigation with CAPA handoff:
  REPORTED → INVESTIGATING → ROOT_CAUSE_IDENTIFIED → CLOSED
  Root cause documented
  CAPA created and linked (owns the fix lifecycle)
  Incident closed after RCA — CAPA tracks the rest

### Incident Workflow (5 Stages)
Requires: INCIDENT already in WorkflowObjectType enum

1. REPORTED (initial)
   Incident documented:
   - What happened, when, where, who involved
   - Incident type and severity (from lookup)
   - Immediate action taken (mandatory field — even if none)
   - Reported by
   Assignee: QUALITY_OFFICER
   SLA: 4h CRITICAL, 8h MAJOR, 16h MINOR

2. INVESTIGATING
   Investigation underway:
   - Evidence collected, witnesses interviewed
   - Timeline reconstructed
   - Contributing factors identified
   Assignee: QUALITY_OFFICER
   SLA: 24h CRITICAL, 40h MAJOR, 40h MINOR

3. ROOT_CAUSE_IDENTIFIED
   RCA completed:
   - RCA tool documented (5 Whys, Fishbone, etc.)
   - Root cause confirmed
   - Decision: CAPA needed YES/NO (both valid, must be documented)
   Assignee: QUALITY_OFFICER
   SLA: 16h

4. CLOSED (final — normal closure)
   - Closure reason documented
   - If CAPA created: CAPA ID linked
   - If no CAPA: reason documented (immediate action sufficient)
   - Lessons learned recorded
   Assignee: QUALITY_MANAGER

5. CANCELLED (final — invalid incident)
   - Incorrectly reported or duplicate
   - Mandatory cancellation reason required
   Assignee: QUALITY_MANAGER

### Transitions
Path A (simple closure):
REPORTED → INVESTIGATING           "Start Investigation"    incidents:investigate
INVESTIGATING → CLOSED             "Close — No RCA Needed"  incidents:close
  (requires: immediate action documented, reason for skipping RCA)

Path B (full investigation):
REPORTED → INVESTIGATING           "Start Investigation"    incidents:investigate
INVESTIGATING → ROOT_CAUSE_IDENTIFIED "Submit Root Cause"   incidents:investigate
ROOT_CAUSE_IDENTIFIED → CLOSED     "Close Incident"         incidents:close
  (CAPA link optional but reason required if no CAPA)

Special:
REPORTED → CANCELLED               "Cancel Incident"        incidents:manage
INVESTIGATING → CANCELLED          "Cancel Incident"        incidents:manage

### Business Rules
1. Immediate action ALWAYS required before leaving REPORTED
   Even if action is "no action needed — already resolved"
   Must be explicitly documented

2. Skipping RCA requires Quality Manager approval
   Reason documented: why RCA not performed
   Confidence statement: why recurrence unlikely

3. CAPA link is optional but decision always tracked
   If no CAPA → reason documented
   If CAPA created → linked by ID
   Both outcomes valid — choice is in the audit trail

4. Severity drives SLA:
   CRITICAL: 4h to investigate, 24h to RCA
   MAJOR:    8h to investigate, 40h to RCA
   MINOR:    16h to investigate, 40h to RCA

5. Near-miss incidents follow same workflow
   Same process as actual incidents
   Incident type lookup distinguishes them
   Near-misses encouraged — same audit trail

### Relationship to CAPA Module
Incident captures: what happened and why
CAPA captures: what was done to fix it
Incident → CAPA is one-to-many (one incident can
generate multiple CAPAs for different root causes)

### Relationship to Gap Module
3+ similar incidents in 90 days → AI pattern alert
Quality Officer decides whether to open a GAP record
Gap captures the systemic issue
CAPA addresses the systemic fix

### AI Integration Points — Incident Module

1. SEVERITY_SUGGESTION (REPORTED stage)
   AI suggests severity based on incident description
   Context: incident type, affected parties, potential impact
   Output: suggested severity with reasoning

2. SIMILAR_INCIDENTS_DETECTION (INVESTIGATING stage)
   AI identifies similar past incidents:
   - Same type in same org unit
   - Same root cause category
   - Pattern detection (3+ similar = potential gap)
   Context: tenant-scoped incidents only
   Output: similar incidents list, pattern alert if threshold met

3. RCA_ASSISTANCE (ROOT_CAUSE_IDENTIFIED stage)
   AI assists root cause analysis:
   - Suggests likely root causes based on incident type
   - Recommends appropriate RCA tool
   - Checks root cause consistency with evidence
   Output: RCA guidance and consistency check

4. CAPA_SUGGESTION (ROOT_CAUSE_IDENTIFIED stage)
   AI suggests whether CAPA is needed:
   - Based on severity, root cause, recurrence history
   - Suggests CAPA priority level
   - Drafts initial CAPA description if needed
   Output: recommendation with draft CAPA content

5. PATTERN_ALERT (automated — BullMQ weekly job)
   Analyzes incident trends across all incidents:
   - 3+ similar incidents in 90 days → alert Quality Manager
   - Suggests opening GAP record for systemic issue
   Context: tenant-scoped incidents only
   Output: pattern report with gap recommendation

All AI context strictly tenant-scoped (organizationId filter)

---

## Pending WorkflowObjectType Additions
The following must be added to WorkflowObjectType enum
via migrations before their respective steps begin:

Already in schema (from Step 6 migration):
  DOCUMENT_REQUEST, DOCUMENT, CHANGE_REQUEST,
  INCIDENT, AUDIT, CORRECTIVE_ACTION, MEETING, COMMITTEE

To add before Step 16 (Standards):
  ACCREDITATION_ROUND

To add before Step 18 (Quality Improvement):
  GAP

## Pending Discussions
- Incident workflow (confirm or revise) — next discussion

---
