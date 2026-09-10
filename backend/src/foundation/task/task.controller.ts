import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { TASKS_PERMISSIONS } from '../../common/constants/permissions';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TaskService } from './task.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { ReassignTaskDto } from './dto/reassign-task.dto';
import { AddTaskEvidenceDto } from './dto/add-task-evidence.dto';
import { ITask } from './interfaces/task.interface';
import { ITaskEvidence } from './interfaces/task-evidence.interface';

@Controller('tasks')
@UseGuards(TenantGuard, PermissionGuard)
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

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
  @Get('my-tasks')
  getMyTasks(
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @Query('status') status?: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'OVERDUE' | 'CANCELLED' | 'UNASSIGNED',
  ): Promise<ITask[]> {
    return this.taskService.getMyTasks(userId, tenantId, { status });
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
  ): Promise<ITask[]> {
    return this.taskService.getForSource(sourceType, sourceId, tenantId);
  }

  @Get(':id')
  @Permissions(TASKS_PERMISSIONS.VIEW)
  getById(@Param('id') id: string, @CurrentTenant() tenantId: string): Promise<ITask> {
    return this.taskService.getById(id, tenantId);
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

  @Post(':id/complete')
  @Permissions(TASKS_PERMISSIONS.COMPLETE)
  complete(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<ITask> {
    return this.taskService.complete(id, userId, tenantId);
  }

  @Post(':id/reassign')
  @Permissions(TASKS_PERMISSIONS.REASSIGN)
  reassign(
    @Param('id') id: string,
    @Body() dto: ReassignTaskDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<ITask> {
    return this.taskService.reassign(id, dto, tenantId, userId);
  }

  @Post(':id/evidence')
  @Permissions(TASKS_PERMISSIONS.COMPLETE)
  addEvidence(
    @Param('id') id: string,
    @Body() dto: AddTaskEvidenceDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<ITaskEvidence> {
    return this.taskService.addEvidence(id, dto, tenantId, userId);
  }
}
