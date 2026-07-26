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
  UseGuards,
} from '@nestjs/common';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { WORKFLOWS_PERMISSIONS } from '../../common/constants/permissions';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkflowTemplateService } from './workflow-template.service';
import { CreateWorkflowTemplateDto } from './dto/create-workflow-template.dto';
import { UpdateWorkflowTemplateDto } from './dto/update-workflow-template.dto';
import { CreateWorkflowStageDto } from './dto/create-workflow-stage.dto';
import { UpdateWorkflowStageDto } from './dto/update-workflow-stage.dto';
import { CreateWorkflowTransitionDto } from './dto/create-workflow-transition.dto';
import { UpdateWorkflowTransitionDto } from './dto/update-workflow-transition.dto';
import { CreateWorkflowTransitionActionDto } from './dto/create-workflow-transition-action.dto';
import { UpdateWorkflowTransitionActionDto } from './dto/update-workflow-transition-action.dto';
import { IWorkflowTemplate } from './interfaces/workflow-template.interface';
import { IWorkflowStage } from './interfaces/workflow-stage.interface';
import { IWorkflowTransition, IWorkflowTransitionAction } from './interfaces/workflow-transition.interface';

// Route order is deliberate: static segments (transitions, stages) are
// declared before the dynamic '/:id' routes below them — Nest matches routes
// in declaration order, and '/:id' would otherwise swallow literal segments
// like 'transitions' or 'stages'.
@Controller('workflow-templates')
@UseGuards(TenantGuard, PermissionGuard)
export class WorkflowTemplateController {
  constructor(private readonly workflowTemplateService: WorkflowTemplateService) {}

  // ── Templates (list/create) ──────────────────────────────────────────────────

  @Get()
  @Permissions(WORKFLOWS_PERMISSIONS.VIEW)
  getTemplates(@CurrentTenant() tenantId: string): Promise<IWorkflowTemplate[]> {
    return this.workflowTemplateService.getTemplates(tenantId);
  }

  @Post()
  @Permissions(WORKFLOWS_PERMISSIONS.MANAGE)
  createTemplate(
    @Body() dto: CreateWorkflowTemplateDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<IWorkflowTemplate> {
    return this.workflowTemplateService.createTemplate(dto, tenantId, actorId);
  }

  // ── Transitions ──────────────────────────────────────────────────────────────

  @Post('transitions')
  @Permissions(WORKFLOWS_PERMISSIONS.MANAGE)
  addTransition(
    @Body() dto: CreateWorkflowTransitionDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<IWorkflowTransition> {
    return this.workflowTemplateService.addTransition(dto, tenantId, actorId);
  }

  @Patch('transitions/:id')
  @Permissions(WORKFLOWS_PERMISSIONS.MANAGE)
  updateTransition(
    @Param('id') id: string,
    @Body() dto: UpdateWorkflowTransitionDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<IWorkflowTransition> {
    return this.workflowTemplateService.updateTransition(id, dto, tenantId, actorId);
  }

  @Delete('transitions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions(WORKFLOWS_PERMISSIONS.MANAGE)
  removeTransition(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<void> {
    return this.workflowTemplateService.removeTransition(id, tenantId, actorId);
  }

  @Post('transitions/:id/actions')
  @Permissions(WORKFLOWS_PERMISSIONS.MANAGE)
  addTransitionAction(
    @Param('id') transitionId: string,
    @Body() dto: CreateWorkflowTransitionActionDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<IWorkflowTransitionAction> {
    return this.workflowTemplateService.addTransitionAction(transitionId, dto, tenantId, actorId);
  }

  @Patch('transitions/actions/:id')
  @Permissions(WORKFLOWS_PERMISSIONS.MANAGE)
  updateTransitionAction(
    @Param('id') id: string,
    @Body() dto: UpdateWorkflowTransitionActionDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<IWorkflowTransitionAction> {
    return this.workflowTemplateService.updateTransitionAction(id, dto, tenantId, actorId);
  }

  @Delete('transitions/actions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions(WORKFLOWS_PERMISSIONS.MANAGE)
  removeTransitionAction(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<void> {
    return this.workflowTemplateService.removeTransitionAction(id, tenantId, actorId);
  }

  // ── Stages ───────────────────────────────────────────────────────────────────

  @Patch('stages/:stageId')
  @Permissions(WORKFLOWS_PERMISSIONS.MANAGE)
  updateStage(
    @Param('stageId') stageId: string,
    @Body() dto: UpdateWorkflowStageDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<IWorkflowStage> {
    return this.workflowTemplateService.updateStage(stageId, dto, tenantId, actorId);
  }

  @Delete('stages/:stageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions(WORKFLOWS_PERMISSIONS.MANAGE)
  removeStage(
    @Param('stageId') stageId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<void> {
    return this.workflowTemplateService.removeStage(stageId, tenantId, actorId);
  }

  // ── Templates (single, by id) ─────────────────────────────────────────────────

  @Get(':id')
  @Permissions(WORKFLOWS_PERMISSIONS.VIEW)
  getTemplateById(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
  ): Promise<IWorkflowTemplate> {
    return this.workflowTemplateService.getTemplateById(id, tenantId);
  }

  @Patch(':id')
  @Permissions(WORKFLOWS_PERMISSIONS.MANAGE)
  updateTemplate(
    @Param('id') id: string,
    @Body() dto: UpdateWorkflowTemplateDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<IWorkflowTemplate> {
    return this.workflowTemplateService.updateTemplate(id, dto, tenantId, actorId);
  }

  @Post(':id/set-default')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions(WORKFLOWS_PERMISSIONS.MANAGE)
  setDefault(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<void> {
    return this.workflowTemplateService.setDefault(id, tenantId, actorId);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions(WORKFLOWS_PERMISSIONS.MANAGE)
  deactivateTemplate(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<void> {
    return this.workflowTemplateService.deactivateTemplate(id, tenantId, actorId);
  }

  @Post(':id/stages')
  @Permissions(WORKFLOWS_PERMISSIONS.MANAGE)
  addStage(
    @Param('id') templateId: string,
    @Body() dto: CreateWorkflowStageDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<IWorkflowStage> {
    return this.workflowTemplateService.addStage(templateId, dto, tenantId, actorId);
  }
}
