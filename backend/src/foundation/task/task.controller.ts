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

  @Get('my-tasks')
  @Permissions(TASKS_PERMISSIONS.VIEW)
  getMyTasks(
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @Query('status') status?: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'OVERDUE' | 'CANCELLED' | 'UNASSIGNED',
  ): Promise<ITask[]> {
    return this.taskService.getMyTasks(userId, tenantId, { status });
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
