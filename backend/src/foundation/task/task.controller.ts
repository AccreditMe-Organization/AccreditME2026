import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUserPermissions } from '../../common/decorators/current-user-permissions.decorator';
import { TaskService } from './task.service';
import { AssignmentViewer, TaskAssignmentService } from './task-assignment.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { ReassignTaskDto } from './dto/reassign-task.dto';
import { RejectTaskDto } from './dto/reject-task.dto';
import { AddTaskEvidenceDto } from './dto/add-task-evidence.dto';
import { GetMyTasksQueryDto } from './dto/get-my-tasks-query.dto';
import { ReleaseTaskDto } from './dto/release-task.dto';
import { EvidenceSummaryQueryDto, MakeEvidenceSummaryDto } from './dto/evidence-summary.dto';
import { IFileSummaryView } from '../ai-file-summary/interfaces/ai-file-summary.interface';
import { CancelTaskDto, ReopenTaskDto, UpdateTaskDto } from './dto/update-task.dto';
import { ApproveTaskRequestDto, CreateTaskRequestDto, DeclineTaskRequestDto } from './dto/task-request.dto';
import { TaskRequestService } from './task-request.service';
import { ITaskRequest, ITaskRequestForDecision } from './interfaces/task-request.interface';
import {
  AssignmentCommitteeMembersQueryDto,
  AssignmentCommitteeRolesQueryDto,
  AssignmentHoldersQueryDto,
  AssignmentPositionsQueryDto,
  AssignmentQueryDto,
} from './dto/assignment-query.dto';
import {
  IAssignableCommitteeRole,
  IAssignableHolder,
  IAssignablePosition,
  IAssignableUnit,
  IWorkloadHint,
  IWorkloadHintAvailability,
} from './interfaces/task-assignment.interface';
import { WorkloadHintDto } from './dto/workload-hint.dto';
import { TaskWorkloadService } from './workload/task-workload.service';
import { WorkloadHintService } from './workload/workload-hint.service';
import { IRecordRef } from './workload/task-workload';
import { ITask } from './interfaces/task.interface';
import { IMyTaskListItem, ITaskListItem } from './interfaces/task-list-item.interface';
import { ITaskWithAssignees } from './interfaces/task-with-assignees.interface';
import { ITaskEvidence, ITaskEvidenceList, ITaskEvidenceView } from './interfaces/task-evidence.interface';
import { TaskEvidenceService } from './task-evidence.service';
import { TaskPageService } from './task-page.service';
import { TaskRecordListService } from './task-record-list.service';
import { RecordListQueryDto, RecordPanelQueryDto } from './dto/record-list-query.dto';
import { ITaskRecordList, ITaskRecordPanel, ITaskViews } from './interfaces/task-record-row.interface';
import { ITaskHistoryEvent, ITaskPageView } from './interfaces/task-page.interface';
import { SingleFileUploadInterceptor } from '../file-storage/single-file-upload.interceptor';
import { IFileDownload, IUploadedFile } from '../file-storage/interfaces/stored-file.interface';
import { DraftTaskDto } from './dto/draft-task.dto';
import { TaskDraftService } from '../ai-task-draft/task-draft.service';
import { ITaskDraft, ITaskDraftAvailability } from '../ai-task-draft/interfaces/task-draft.interface';
import { RATE_LIMITS } from '../../common/throttle/rate-limits';
import { perUser } from '../../common/throttle/throttle.config';

@Controller('tasks')
@UseGuards(TenantGuard, PermissionGuard)
export class TaskController {
  constructor(
    private readonly taskService: TaskService,
    private readonly assignment: TaskAssignmentService,
    private readonly requests: TaskRequestService,
    private readonly evidence: TaskEvidenceService,
    private readonly drafts: TaskDraftService,
    private readonly workload: TaskWorkloadService,
    private readonly workloadHint: WorkloadHintService,
    private readonly page: TaskPageService,
    private readonly recordList: TaskRecordListService,
  ) {}

  // ACC-70 — deliberately NOT @Permissions (it was tasks:view, retired in ACC-244).
  //
  // A user's own task list is intrinsically self-scoped, exactly like the
  // notification inbox: getMyTasks() filters on
  // `assignees: { some: { userId: <caller>, removedAt: null } }` plus
  // organizationId, so it can only ever return work assigned to the calling
  // user. It cannot leak another user's tasks regardless of permissions.
  //
  // This follows the principle NotificationController already states for the
  // same shape of data: "a user's own notification inbox is not
  // permission-gated content, it is intrinsically self-scoped (every query
  // filters userId = the calling user)". Gating my-tasks behind tasks:view
  // was inconsistent with that, and had a concrete consequence — the landing
  // page every user is sent to after login could not show a permission-less
  // user their own assigned work, which is most of the reason that page
  // exists.
  //
  // Note the contrast with the record list and Unassigned, which can return
  // tasks the viewer is not on: they answer from the task visibility rule
  // (ACC-244). Only this one is self-scoped.
  //
  // PermissionGuard still runs (class-level @UseGuards) and returns true when
  // no @Permissions metadata is present; TenantGuard still authenticates and
  // populates @CurrentUser()/@CurrentTenant().
  //
  // ACC-174 — the caller's permissions are read for each row's canManage only;
  // they never widen which rows come back.
  @Get('my-tasks')
  getMyTasks(
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @Query() query: GetMyTasksQueryDto,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IMyTaskListItem[]> {
    return this.taskService.getMyTasks(userId, tenantId, query, permissions);
  }

  // ── ACC-167 — STATIC GET ROUTES, ALL DECLARED BEFORE ':id' ─────────────────
  // Nest matches in declaration order, and ':id' would swallow 'available',
  // 'assignees' and any other single segment declared after it. A spec calls
  // each route through the real router to pin this.

  // Open pool tasks the caller could pick up (decision 7). Self-scoped like
  // my-tasks — built from the caller's own position, unit and committee roles
  // — so it carries no permission.
  @Get('available')
  getAvailable(
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<ITaskListItem[]> {
    return this.taskService.getAvailableToPick(userId, tenantId, permissions);
  }

  // ACC-174 — what New task's date picker stops at: the default due date and
  // the SLA limit for every priority, counted from now. It names no task, so it
  // is gated like creating one (ACC-101 clause a — a 403 naming the permission).
  // ACC-244 — Create tasks on at least one record type, decided in the service.
  @Get('sla-preview')
  getSlaPreview(
    @CurrentTenant() tenantId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<Record<string, { dueAt: Date; limitAt: Date }>> {
    return this.taskService.slaPreview(tenantId, permissions);
  }

  // ACC-197 — "Draft with AI" on New task. Both are gated like creating a
  // task, and both are static paths declared before ':id'.
  //
  // Whether to show the trigger at all: AI is on for the organisation and the
  // feature is open to it. Nothing about the balance.
  // ACC-244 — Create tasks on at least one record type, decided in the service.
  @Get('draft/availability')
  getDraftAvailability(
    @CurrentTenant() tenantId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<ITaskDraftAvailability> {
    return this.drafts.availability(tenantId, permissions);
  }

  // A draft is returned and NOT stored: a task exists only when the person
  // presses Create task (POST /tasks below). 2 credits through the AI gateway;
  // ten a minute per user (Q3).
  // ACC-244 — Create tasks on the named record's type (any type with none),
  // decided in the service.
  @Post('draft')
  @HttpCode(HttpStatus.OK)
  @perUser(RATE_LIMITS.taskDraft)
  draft(
    @Body() dto: DraftTaskDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<ITaskDraft> {
    return this.drafts.draft({ id: userId, permissions }, tenantId, dto);
  }

  // The assignment picker (decision 8). No @Permissions on any of these, by
  // design: who may use it is "Create tasks on a record type, OR whoever may
  // reassign the task named by ?taskId" (its creator or someone acting for
  // them, or Manage tasks on its type — ACC-244), and the second half is only
  // knowable from the row. TaskAssignmentService.assertMayAssign() decides.
  @Get('assignment/units')
  getAssignableUnits(
    @Query() query: AssignmentQueryDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IAssignableUnit[]> {
    return this.assignment.listUnits(viewer(userId, permissions), tenantId, query.taskId);
  }

  @Get('assignment/positions')
  getAssignablePositions(
    @Query() query: AssignmentPositionsQueryDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IAssignablePosition[]> {
    return this.assignment.listPositions(viewer(userId, permissions), tenantId, query.orgUnitId, query.taskId);
  }

  @Get('assignment/committee-roles')
  getAssignableCommitteeRoles(
    @Query() query: AssignmentCommitteeRolesQueryDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IAssignableCommitteeRole[]> {
    // ACC-208 (B5) — the DTO lets committeeId be absent only with catalogue.
    if (query.catalogue) {
      return this.assignment.listCommitteeRoleCatalogue(viewer(userId, permissions), tenantId, query.committeeId, query.taskId);
    }
    return this.assignment.listCommitteeRoles(viewer(userId, permissions), tenantId, query.committeeId!, query.taskId);
  }

  @Get('assignees/committee')
  getCommitteeAssignees(
    @Query() query: AssignmentCommitteeMembersQueryDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IAssignableHolder[]> {
    // ACC-199 — with the record named, each member carries their counts on it.
    return this.workload.listCommitteeMembers(viewer(userId, permissions), tenantId, {
      committeeId: query.committeeId,
      roleValueId: query.roleValueId,
      taskId: query.taskId,
      record: recordOf(query),
    });
  }

  @Get('assignees')
  getAssignees(
    @Query() query: AssignmentHoldersQueryDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IAssignableHolder[]> {
    // ACC-199 — with the record named, each holder carries their counts on it.
    return this.workload.listHolders(viewer(userId, permissions), tenantId, {
      orgUnitId: query.orgUnitId,
      positionId: query.positionId,
      taskId: query.taskId,
      record: recordOf(query),
    });
  }

  // ACC-199 — "✦ Suggest someone" in the assignee picker. No @Permissions, like
  // every picker route: the service applies the record task list's rule
  // (tasks:view and the record) and the picker's own (tasks:create, or
  // reassigning this task). Static paths, before ':id'.
  //
  // Whether to show the button at all: AI is on and the feature is open to the
  // organisation. Nothing about the balance.
  @Get('assignment/workload-hint/availability')
  getWorkloadHintAvailability(@CurrentTenant() tenantId: string): Promise<IWorkloadHintAvailability> {
    return this.workloadHint.availability(tenantId);
  }

  // Nothing is stored; 1 credit through the AI gateway, refunded when nobody
  // is suggested; twenty a minute per user (Q11).
  @Post('assignment/workload-hint')
  @HttpCode(HttpStatus.OK)
  @perUser(RATE_LIMITS.workloadHint)
  suggestWorkload(
    @Body() dto: WorkloadHintDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IWorkloadHint> {
    return this.workloadHint.suggest(viewer(userId, permissions), tenantId, dto);
  }

  // ACC-173 — "Waiting for your decision": pending extension and hold
  // requests the caller may decide. No @Permissions: self-scoped — the
  // service builds the query from who the caller is and whom they cover.
  // Declared before ':id', which would otherwise swallow 'requests'.
  @Get('requests/awaiting-decision')
  getAwaitingDecision(
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<ITaskRequestForDecision[]> {
    return this.requests.awaitingDecision({ id: userId, permissions }, tenantId);
  }

  // ── ACC-229 — a record's Tasks panel, and the All tasks list ────────────
  // No @Permissions, deliberately, like the task page: who sees which tasks is
  // decided by TaskRecordListService — the record's own visibility first
  // (403 naming the permission, or 404), then tasks:view for every task on it
  // or the viewer's own tasks without it; organisation-wide needs tasks:view.
  // Declared before ':id', which would otherwise swallow both segments.
  @Get('record-panel')
  getRecordPanel(
    @Query() query: RecordPanelQueryDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() actorPermissions: string[],
  ): Promise<ITaskRecordPanel> {
    return this.recordList.panel(query, tenantId, viewer(userId, actorPermissions));
  }

  // ACC-244 — which saved views of the one /tasks list the caller gets (My
  // tasks, All tasks, Unassigned, Unit tasks) and New task's record types.
  // Self-scoped, so no @Permissions; static, so declared before ':id'.
  @Get('views')
  getViews(
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<ITaskViews> {
    return this.recordList.views(tenantId, viewer(userId, permissions));
  }

  @Get('record-list')
  getRecordList(
    @Query() query: RecordListQueryDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() actorPermissions: string[],
  ): Promise<ITaskRecordList> {
    return this.recordList.list(query, tenantId, viewer(userId, actorPermissions));
  }

  // Must be declared before ':id' — Nest matches routes in declaration order
  // and :id would otherwise swallow the literal 'unassigned' segment.
  //
  // ACC-244 — Manage tasks holders only, limited to the record types they
  // manage; decided in the service (403 naming the keys).
  @Get('unassigned')
  getUnassigned(
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<ITask[]> {
    return this.taskService.listUnassigned(tenantId, viewer(userId, permissions));
  }

  // ACC-244 (Q10) — GET /tasks?sourceType=&sourceId= and GET /tasks/:id are
  // removed. Neither had a frontend caller, and each answered from its own copy
  // of who may see a task; a record's tasks are GET /tasks/record-panel and
  // /record-list, and one task is GET /tasks/:id/view.

  // ── ACC-228 — the task page (/tasks/:id) ───────────────────────────────
  // No @Permissions, deliberately: an assignee without tasks:view must open
  // their own task. Who may open it is Q4's union, decided by TaskPageService
  // from the row; everyone else gets the identical 404.
  @Get(':id/view')
  getPage(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() actorPermissions: string[],
  ): Promise<ITaskPageView> {
    return this.page.view(id, tenantId, viewer(userId, actorPermissions));
  }

  @Get(':id/history')
  getHistory(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() actorPermissions: string[],
  ): Promise<ITaskHistoryEvent[]> {
    return this.page.history(id, tenantId, viewer(userId, actorPermissions));
  }

  // ── ACC-174 — the creator's own actions ─────────────────────────────────
  // No @Permissions on any of these, by design: who may act is the creator,
  // anyone acting for them, or (while the creator is no longer ACTIVE) a
  // tasks:reassign holder — only knowable from the row. TaskService decides,
  // and everyone else gets the identical 404 (ACC-101 clause b).

  // Edit's date picker: the due date and limit each priority would give THIS
  // task, from its own SLA start — or, with ?restart=true, from now, for
  // Reopen's picker (a reopened task's SLA restarts).
  @Get(':id/sla-preview')
  getTaskSlaPreview(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
    @Query('restart') restart?: string,
  ): Promise<Record<string, { dueAt: Date; limitAt: Date }>> {
    return this.taskService.slaPreviewForTask(id, { id: userId, permissions }, tenantId, restart === 'true');
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<ITask> {
    return this.taskService.update(id, dto, { id: userId, permissions }, tenantId);
  }

  @Post(':id/cancel')
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelTaskDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<ITask> {
    return this.taskService.cancel(id, dto, { id: userId, permissions }, tenantId);
  }

  @Post(':id/reopen')
  reopen(
    @Param('id') id: string,
    @Body() dto: ReopenTaskDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<ITask> {
    return this.taskService.reopen(id, dto, { id: userId, permissions }, tenantId);
  }

  // ACC-244 — Create tasks on the record's type, AND the record: it must exist
  // in this organisation and be one the caller may see (ACC-101 clause a).
  // Decided in the service, because the type is in the body.
  @Post()
  create(
    @Body() dto: CreateTaskDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<ITask> {
    return this.taskService.createForViewer(dto, tenantId, { id: userId, permissions });
  }

  // ACC-76 — deliberately NOT @Permissions(tasks:complete), for
  // the same reason my-tasks above carries no permission: completing a task is
  // intrinsically SELF-SCOPED. TaskService.complete() rejects (404) anyone who
  // is not a currently-active assignee, so the decorator gated nothing the
  // service does not already enforce — while breaking the engine's own
  // assignment behaviour.
  //
  // WHAT IT BROKE, concretely. tasks:complete was seeded to PLATFORM_ADMIN,
  // TENANT_ADMIN and QUALITY_MANAGER only. BASE_USER — the default role for
  // ordinary staff — did not hold it. And the workflow engine assigns to
  // BASE_USER by design: MEETING.minutes_review is seeded assigneeStrategy
  // ROLE / assigneeRoleKey BASE_USER / PARALLEL / threshold ALL, i.e. every
  // user in the tenant. So the engine handed work to people the permission
  // model forbade from finishing it, and my-tasks' Complete button 403'd for
  // most of the people it was shown to.
  //
  // The alternative — granting tasks:complete to everyone including BASE_USER
  // — reaches the same enforcement while keeping a permission that means
  // nothing. That is worse: it still LOOKS like a control.
  //
  // ACC-162 then ungated addEvidence() on the same grounds, which left
  // tasks:complete gating nothing anywhere, so it was RETIRED: removed from
  // the flat tasks:* group and the seed, and from existing tenants by
  // backfill-retire-tasks-complete.ts. Do not reintroduce it.
  @Post(':id/complete')
  complete(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<ITask> {
    return this.taskService.complete(id, userId, tenantId);
  }

  // ACC-163 — start and reject are SELF-SCOPED, exactly as complete() above:
  // TaskService refuses (404) anyone who is not a currently-active assignee,
  // and no permission is involved. Do not add @Permissions here for
  // consistency with the neighbours — the engine assigns work to people who
  // hold no task permission at all.
  @Post(':id/start')
  start(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<ITask> {
    return this.taskService.start(id, userId, tenantId);
  }

  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectTaskDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<ITask> {
    return this.taskService.reject(id, dto, userId, tenantId);
  }

  // ACC-163 — deliberately NO @Permissions. tasks:reassign is still checked,
  // but in the service, because it is now one of two ways in: the task's own
  // creator may reassign it too (a rejected task comes back to its creator,
  // Q4), and whether the caller IS the creator is only knowable from the row.
  // A decorator here would refuse the creator before the row was read.
  // ACC-167 (decisions 4 and 5) — pick a task up from its pool, and hand it
  // back. No @Permissions: both are scoped to the pool and the picker by the
  // service, which answers anyone else with the identical 404.
  @Post(':id/pick')
  pick(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<ITask> {
    return this.taskService.pick(id, userId, tenantId);
  }

  @Post(':id/release')
  release(
    @Param('id') id: string,
    @Body() dto: ReleaseTaskDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<ITask> {
    return this.taskService.release(id, dto, userId, tenantId);
  }

  // ACC-173 — extension and hold requests. None carries @Permissions: asking
  // is an active assignee's, withdrawing the asker's, deciding the creator's
  // (or their cover's, or a tasks:reassign holder's) — all only knowable from
  // the row, so the service decides, with the identical 404 for anyone else.
  @Post(':id/requests')
  createRequest(
    @Param('id') id: string,
    @Body() dto: CreateTaskRequestDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<ITaskRequest> {
    return this.requests.create(id, dto, userId, tenantId);
  }

  @Post(':id/requests/:requestId/withdraw')
  withdrawRequest(
    @Param('id') id: string,
    @Param('requestId') requestId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<ITaskRequest> {
    return this.requests.withdraw(id, requestId, userId, tenantId);
  }

  @Post(':id/requests/:requestId/approve')
  approveRequest(
    @Param('id') id: string,
    @Param('requestId') requestId: string,
    @Body() dto: ApproveTaskRequestDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<ITaskRequest> {
    return this.requests.approve(id, requestId, dto, { id: userId, permissions }, tenantId);
  }

  @Post(':id/requests/:requestId/decline')
  declineRequest(
    @Param('id') id: string,
    @Param('requestId') requestId: string,
    @Body() dto: DeclineTaskRequestDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<ITaskRequest> {
    return this.requests.decline(id, requestId, dto, { id: userId, permissions }, tenantId);
  }

  // "Resume now" — an active assignee, or anyone who may decide.
  @Post(':id/resume')
  resume(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<ITask> {
    return this.requests.resume(id, { id: userId, permissions }, tenantId);
  }

  @Post(':id/reassign')
  reassign(
    @Param('id') id: string,
    @Body() dto: ReassignTaskDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() actorPermissions: string[],
  ): Promise<ITask> {
    return this.taskService.reassign(id, dto, tenantId, userId, actorPermissions);
  }

  // ACC-162 — deliberately NOT permission-gated, for the reason complete()
  // above states: evidence is self-scoped. TaskService.addEvidence() 404s
  // anyone who is not a currently-active assignee and refuses a closed task.
  @Post(':id/evidence')
  addEvidence(
    @Param('id') id: string,
    @Body() dto: AddTaskEvidenceDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<ITaskEvidence> {
    return this.taskService.addEvidence(id, dto, tenantId, userId);
  }

  // ── ACC-177 — file evidence, the evidence list, downloads and deletes ────
  //
  // None is permission-gated, for the reason addEvidence() above states: each
  // is decided from the task row in TaskEvidenceService — an active assignee
  // adds, and deletes their own; anyone on the task, managing it, or able to
  // see its record lists and downloads. Everyone else gets the identical 404.

  @Post(':id/evidence/file')
  @UseInterceptors(SingleFileUploadInterceptor)
  addFileEvidence(
    @Param('id') id: string,
    @UploadedFile() file: IUploadedFile | undefined,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<ITaskEvidenceView> {
    return this.evidence.addFile(id, file, tenantId, userId);
  }

  @Get(':id/evidence')
  listEvidence(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() actorPermissions: string[],
  ): Promise<ITaskEvidenceList> {
    return this.evidence.list(id, tenantId, viewer(userId, actorPermissions));
  }

  @Get(':id/evidence/:evidenceId/download')
  downloadEvidence(
    @Param('id') id: string,
    @Param('evidenceId') evidenceId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() actorPermissions: string[],
  ): Promise<IFileDownload> {
    return this.evidence.download(id, evidenceId, tenantId, viewer(userId, actorPermissions));
  }

  // ACC-189 — the in-app viewer's mint: exactly the download's entitlement
  // (checked in the service), and 409 PREVIEW_NOT_AVAILABLE for a type the
  // viewer does not render.
  @Get(':id/evidence/:evidenceId/view')
  viewEvidence(
    @Param('id') id: string,
    @Param('evidenceId') evidenceId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() actorPermissions: string[],
  ): Promise<IFileDownload> {
    return this.evidence.openView(id, evidenceId, tenantId, viewer(userId, actorPermissions));
  }

  // ACC-193 — the AI summary of an evidence file: exactly the view's
  // entitlement (checked in the service), so no @Permissions, like /view.
  // GET never calls the model; POST makes it, or returns the saved one.
  @Get(':id/evidence/:evidenceId/summary')
  getEvidenceSummary(
    @Param('id') id: string,
    @Param('evidenceId') evidenceId: string,
    @Query() query: EvidenceSummaryQueryDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() actorPermissions: string[],
  ): Promise<IFileSummaryView> {
    return this.evidence.getSummary(id, evidenceId, tenantId, viewer(userId, actorPermissions), query.language);
  }

  @Post(':id/evidence/:evidenceId/summary')
  @HttpCode(HttpStatus.OK)
  makeEvidenceSummary(
    @Param('id') id: string,
    @Param('evidenceId') evidenceId: string,
    @Body() dto: MakeEvidenceSummaryDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() actorPermissions: string[],
  ): Promise<IFileSummaryView> {
    return this.evidence.makeSummary(id, evidenceId, tenantId, viewer(userId, actorPermissions), dto.language);
  }

  @Delete(':id/evidence/:evidenceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeEvidence(
    @Param('id') id: string,
    @Param('evidenceId') evidenceId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<void> {
    return this.evidence.remove(id, evidenceId, tenantId, userId);
  }
}

function viewer(id: string, permissions: string[]): AssignmentViewer {
  return { id, permissions };
}

// ACC-199 — the record a people query names, when it names one whole.
function recordOf(query: { sourceType?: IRecordRef['sourceType']; sourceId?: string }): IRecordRef | null {
  return query.sourceType && query.sourceId ? { sourceType: query.sourceType, sourceId: query.sourceId } : null;
}
