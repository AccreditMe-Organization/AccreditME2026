import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { TASKS_PERMISSIONS } from '../../common/constants/permissions';
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
} from './interfaces/task-assignment.interface';
import { ITask } from './interfaces/task.interface';
import { IMyTaskListItem, ITaskListItem } from './interfaces/task-list-item.interface';
import { ITaskWithAssignees } from './interfaces/task-with-assignees.interface';
import { ITaskEvidence } from './interfaces/task-evidence.interface';

@Controller('tasks')
@UseGuards(TenantGuard, PermissionGuard)
export class TaskController {
  constructor(
    private readonly taskService: TaskService,
    private readonly assignment: TaskAssignmentService,
    private readonly requests: TaskRequestService,
  ) {}

  // ACC-70 — deliberately NOT @Permissions(TASKS_PERMISSIONS.VIEW).
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
  // Note the contrast with the neighbouring endpoints, which stay gated and
  // should: getForSource()/getById() can return ANY task in the tenant, and
  // 'unassigned' is an administrative view. Only this one is self-scoped.
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
  @Get('sla-preview')
  @Permissions(TASKS_PERMISSIONS.CREATE)
  getSlaPreview(@CurrentTenant() tenantId: string): Promise<Record<string, { dueAt: Date; limitAt: Date }>> {
    return this.taskService.slaPreview(tenantId);
  }

  // The assignment picker (decision 8). No @Permissions on any of these, by
  // design: who may use it is "tasks:create, OR the creator / a tasks:reassign
  // holder of the task named by ?taskId", and the second half is only knowable
  // from the row. TaskAssignmentService.assertMayAssign() decides.
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
    return this.assignment.listCommitteeRoles(viewer(userId, permissions), tenantId, query.committeeId, query.taskId);
  }

  @Get('assignees/committee')
  getCommitteeAssignees(
    @Query() query: AssignmentCommitteeMembersQueryDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IAssignableHolder[]> {
    return this.assignment.listCommitteeMembers(
      viewer(userId, permissions),
      tenantId,
      query.committeeId,
      query.roleValueId,
      query.taskId,
    );
  }

  @Get('assignees')
  getAssignees(
    @Query() query: AssignmentHoldersQueryDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IAssignableHolder[]> {
    return this.assignment.listHolders(
      viewer(userId, permissions),
      tenantId,
      query.orgUnitId,
      query.positionId,
      query.taskId,
    );
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

  // Must be declared before ':id' — Nest matches routes in declaration order
  // and :id would otherwise swallow the literal 'unassigned' segment.
  @Get('unassigned')
  @Permissions(TASKS_PERMISSIONS.MANAGE)
  getUnassigned(@CurrentTenant() tenantId: string): Promise<ITask[]> {
    return this.taskService.listUnassigned(tenantId);
  }

  // Must be declared before ':id' — Nest matches routes in declaration order
  // and :id would otherwise swallow the literal 'my-tasks' segment above.
  @Get()
  @Permissions(TASKS_PERMISSIONS.VIEW)
  getForSource(
    @CurrentTenant() tenantId: string,
    @Query('sourceType')
    sourceType:
      | 'MEETING'
      | 'DOCUMENT'
      | 'AUDIT'
      | 'CAPA'
      | 'INCIDENT'
      | 'CORRECTIVE_ACTION'
      | 'STANDARD'
      | 'KPI'
      | 'GAP'
      | 'QUALITY_IMPROVEMENT_PLAN'
      | 'COMMITTEE',
    @Query('sourceId') sourceId: string,
    // ACC-76 — the ONLY list endpoint returning assignees. Stays gated on
    // tasks:view (unlike my-tasks above, which is self-scoped): this can
    // return any task in the tenant, and now names the people on it.
    //
    // ACC-101 — tasks:view is no longer sufficient. The permission set is
    // passed to the service, which refuses a caller who cannot see the source
    // record. Same decorator UserService.getByIdForViewer() already uses.
    @CurrentUserPermissions() actorPermissions: string[],
    @CurrentUser() actorId: string,
  ): Promise<ITaskWithAssignees[]> {
    return this.taskService.getForSource(
      sourceType,
      sourceId,
      tenantId,
      actorPermissions,
      actorId,
    );
  }

  @Get(':id')
  @Permissions(TASKS_PERMISSIONS.VIEW)
  getById(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUserPermissions() actorPermissions: string[],
    // Named in the refusal log, which records what the 404 conceals.
    @CurrentUser() actorId: string,
  ): Promise<ITask> {
    return this.taskService.getByIdForViewer(id, tenantId, actorPermissions, actorId);
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

  @Post()
  @Permissions(TASKS_PERMISSIONS.CREATE)
  create(
    @Body() dto: CreateTaskDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<ITask> {
    return this.taskService.create(dto, tenantId, userId);
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
  // TASKS_PERMISSIONS and the seed, and from existing tenants by
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
}

function viewer(id: string, permissions: string[]): AssignmentViewer {
  return { id, permissions };
}
