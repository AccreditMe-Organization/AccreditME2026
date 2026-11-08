import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { WORKFLOWS_PERMISSIONS } from '../../common/constants/permissions';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUserPermissions } from '../../common/decorators/current-user-permissions.decorator';
import { AwaitingMeQueryDto } from './dto/awaiting-me-query.dto';
import { WorkflowService } from './workflow.service';
import { TriggerTransitionDto } from './dto/trigger-transition.dto';
import { SubmitApprovalDto } from './dto/submit-approval.dto';
import { CancelWorkflowInstanceDto } from './dto/cancel-workflow-instance.dto';
import { IWorkflowInstance, IWorkflowApproval, IWorkflowMoves } from './interfaces/workflow-instance.interface';
import { IWorkflowStageHistory } from './interfaces/workflow-stage-history.interface';
import { IWorkflowAwaitingMe } from './interfaces/workflow-awaiting.interface';
import { WorkflowAwaitingService } from './workflow-awaiting.service';

@Controller('workflows')
@UseGuards(TenantGuard, PermissionGuard)
export class WorkflowController {
  constructor(
    private readonly workflowService: WorkflowService,
    private readonly awaiting: WorkflowAwaitingService,
  ) {}

  // ACC-271 — Home's "Awaiting my action": the records waiting on THIS viewer's
  // decision. No @Permissions, deliberately, like the self-scoped reads
  // (my-tasks, the notification inbox): it answers only for the caller, row by
  // row through the service's gates — the viewer works the stage now, may make
  // its person moves, and may see the record's type. Holding no permission
  // means an empty answer, never another person's work. One segment, so it
  // cannot clash with 'instances/:id'.
  @Get('awaiting-me')
  // ACC-281 — ?skip=&take= pages it (take 1–50); with neither, today's answer.
  getAwaitingMe(
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
    @CurrentUserPermissions() actorPermissions: string[],
    @Query() query: AwaitingMeQueryDto,
  ): Promise<IWorkflowAwaitingMe> {
    return this.awaiting.awaitingMe(tenantId, actorId, actorPermissions, { skip: query.skip, take: query.take });
  }

  // ACC-282 (Ahmad, 8 Nov) — the four reads below carry no route permission:
  // whoever may open the record may read its workflow (the instance, the list,
  // stage history), and the moves list is pool-only. The service decides, through
  // InstanceAccess (instance-access.ts), the one place the rule lives. Anyone who
  // may not open the record gets exactly the refusal a missing record gets: the
  // 404 where the instance is read first, the parent's 403 where the request names
  // the record (ACC-101). The permission set goes to the service, which needs the
  // record to know which parent applies.
  @Get('instances/:id')
  getInstanceById(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUserPermissions() actorPermissions: string[],
    // Named in the refusal log, which records what the 404 conceals.
    @CurrentUser() actorId: string,
  ): Promise<IWorkflowInstance> {
    return this.workflowService.getInstanceByIdForViewer(id, tenantId, actorPermissions, actorId);
  }

  @Get('instances')
  getInstancesByObject(
    @Query('objectType') objectType: string,
    @Query('objectId') objectId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUserPermissions() actorPermissions: string[],
    @CurrentUser() actorId: string,
  ): Promise<IWorkflowInstance[]> {
    return this.workflowService.getInstancesByObject(objectType, objectId, tenantId, actorPermissions, actorId);
  }

  // ACC-76 — the object-detail stage indicator's data: who acted at each stage
  // and any comment they left. ACC-282 (Ahmad, 8 Nov): open to whoever may open
  // the record, like the instance (it was workflows:view).
  //
  // No route conflict with 'instances/:id' above — three segments, not two.
  @Get('instances/:id/stage-history')
  getStageHistory(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUserPermissions() actorPermissions: string[],
    @CurrentUser() actorId: string,
  ): Promise<IWorkflowStageHistory> {
    return this.workflowService.getStageHistory(id, tenantId, actorPermissions, actorId);
  }

  // ACC-271 PR 2 — the moves this viewer may press from the record's current
  // stage, for the record page's buttons: the instance read's visibility, then
  // the stage's pool (empty for anyone else who may open the record). A small
  // answer (the moves of one stage), no paging. ACC-282: each move carries its
  // label and the stage it leads to.
  @Get('instances/:id/moves')
  getMoves(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUserPermissions() actorPermissions: string[],
    @CurrentUser() actorId: string,
  ): Promise<IWorkflowMoves> {
    return this.workflowService.getMovesForViewer(id, tenantId, actorPermissions, actorId);
  }

  // No class-level @Permissions — who may move a record is data-driven (the
  // from-stage's pool, ACC-271), not a fixed string known at compile time.
  // TenantGuard/PermissionGuard still run (authentication + userPermissions
  // population); WorkflowService performs the fine-grained check itself. Deliberate, documented exception — see
  // Step 6 plan, Business Rules, "Permission Model for Runtime Transitions".
  @Post('instances/:id/transitions')
  triggerTransition(
    @Param('id') id: string,
    @Body() dto: TriggerTransitionDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
    @CurrentUserPermissions() userPermissions: string[],
  ): Promise<IWorkflowInstance> {
    return this.workflowService.triggerTransition(id, dto, tenantId, actorId, userPermissions);
  }

  // Same deliberate exception as triggerTransition() above. ACC-282: the voter's
  // permissions go to the service, which checks they may open the record.
  @Post('instance-stages/:id/approvals')
  submitApproval(
    @Param('id') id: string,
    @Body() dto: SubmitApprovalDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
    @CurrentUserPermissions() actorPermissions: string[],
  ): Promise<IWorkflowApproval> {
    return this.workflowService.submitApproval(id, dto, tenantId, actorId, actorPermissions);
  }

  // Unlike the two endpoints above, cancellation bypasses the transition graph
  // entirely — there is no stage pool to defer to, so this one gets its own
  // explicit @Permissions() rather than a class-level one.
  @Post('instances/:id/cancel')
  @Permissions(WORKFLOWS_PERMISSIONS.MANAGE)
  cancelInstance(
    @Param('id') id: string,
    @Body() dto: CancelWorkflowInstanceDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<void> {
    return this.workflowService.cancelInstance(id, tenantId, actorId, dto.reason);
  }
}
