import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { WORKFLOWS_PERMISSIONS } from '../../common/constants/permissions';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUserPermissions } from '../../common/decorators/current-user-permissions.decorator';
import { WorkflowService } from './workflow.service';
import { TriggerTransitionDto } from './dto/trigger-transition.dto';
import { SubmitApprovalDto } from './dto/submit-approval.dto';
import { CancelWorkflowInstanceDto } from './dto/cancel-workflow-instance.dto';
import { IWorkflowInstance, IWorkflowApproval } from './interfaces/workflow-instance.interface';

@Controller('workflows')
@UseGuards(TenantGuard, PermissionGuard)
export class WorkflowController {
  constructor(private readonly workflowService: WorkflowService) {}

  @Get('instances/:id')
  @Permissions(WORKFLOWS_PERMISSIONS.VIEW)
  getInstanceById(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
  ): Promise<IWorkflowInstance> {
    return this.workflowService.getInstanceById(id, tenantId);
  }

  @Get('instances')
  @Permissions(WORKFLOWS_PERMISSIONS.VIEW)
  getInstancesByObject(
    @Query('objectType') objectType: string,
    @Query('objectId') objectId: string,
    @CurrentTenant() tenantId: string,
  ): Promise<IWorkflowInstance[]> {
    return this.workflowService.getInstancesByObject(objectType, objectId, tenantId);
  }

  // No class-level @Permissions — the required permission is data-driven
  // (whatever the specific WorkflowTransition.requiredPermission says), not a
  // fixed string known at compile time. TenantGuard/PermissionGuard still run
  // (authentication + userPermissions population); WorkflowService performs
  // the fine-grained check itself. Deliberate, documented exception — see
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

  // Same deliberate exception as triggerTransition() above.
  @Post('instance-stages/:id/approvals')
  submitApproval(
    @Param('id') id: string,
    @Body() dto: SubmitApprovalDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<IWorkflowApproval> {
    return this.workflowService.submitApproval(id, dto, tenantId, actorId);
  }

  // Unlike the two endpoints above, cancellation bypasses the transition graph
  // entirely — there is no per-transition requiredPermission to defer to, so
  // this one gets its own explicit @Permissions() rather than a class-level one.
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
