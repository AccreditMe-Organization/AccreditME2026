import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import {
  Prisma,
  WorkflowTemplate as PrismaWorkflowTemplate,
  WorkflowStage as PrismaWorkflowStage,
  WorkflowTransition as PrismaWorkflowTransition,
  WorkflowTransitionAction as PrismaWorkflowTransitionAction,
} from '../../../generated/prisma/client';
import { IWorkflowTemplate } from './interfaces/workflow-template.interface';
import { IWorkflowStage } from './interfaces/workflow-stage.interface';
import { IWorkflowTransition, IWorkflowTransitionAction } from './interfaces/workflow-transition.interface';
import { CreateWorkflowTemplateDto } from './dto/create-workflow-template.dto';
import { UpdateWorkflowTemplateDto } from './dto/update-workflow-template.dto';
import { CreateWorkflowStageDto } from './dto/create-workflow-stage.dto';
import { UpdateWorkflowStageDto } from './dto/update-workflow-stage.dto';
import { CreateWorkflowTransitionDto } from './dto/create-workflow-transition.dto';
import { UpdateWorkflowTransitionDto } from './dto/update-workflow-transition.dto';
import { CreateWorkflowTransitionActionDto } from './dto/create-workflow-transition-action.dto';
import { UpdateWorkflowTransitionActionDto } from './dto/update-workflow-transition-action.dto';
import { SYSTEM_WORKFLOW_SEED } from './workflow.seed';

@Injectable()
export class WorkflowTemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  // ── Seed ─────────────────────────────────────────────────────────────────────

  async seedDefaultWorkflows(organizationId: string): Promise<void> {
    const roleKeys = new Set<string>();
    for (const seedWorkflow of SYSTEM_WORKFLOW_SEED) {
      for (const stage of seedWorkflow.stages) {
        if (stage.assigneeRoleKey) roleKeys.add(stage.assigneeRoleKey);
      }
      for (const transition of seedWorkflow.transitions) {
        if (transition.triggerRoleKey) roleKeys.add(transition.triggerRoleKey);
      }
    }

    const roles = await this.prisma.role.findMany({
      where: { organizationId, key: { in: Array.from(roleKeys) } },
    });
    const roleIdByKey = new Map(roles.map((r) => [r.key, r.id]));

    const resolveRoleId = (key: string | undefined): string | undefined => {
      if (!key) return undefined;
      const id = roleIdByKey.get(key);
      if (!id) {
        throw new Error(
          `Role key '${key}' referenced in workflow seed data was not found for organization ${organizationId} — seedSystemRoles() must run first`,
        );
      }
      return id;
    };

    for (const seedWorkflow of SYSTEM_WORKFLOW_SEED) {
      const existingTemplate = await this.prisma.workflowTemplate.findFirst({
        where: { organizationId, objectType: seedWorkflow.objectType, isDefault: true },
      });

      const templateData = {
        nameEn: seedWorkflow.nameEn,
        nameAr: seedWorkflow.nameAr,
        objectType: seedWorkflow.objectType,
        isDefault: true,
        isActive: true,
      };

      const template = existingTemplate
        ? await this.prisma.workflowTemplate.update({
            where: { id: existingTemplate.id },
            data: templateData,
          })
        : await this.prisma.workflowTemplate.create({
            data: { organizationId, ...templateData },
          });

      const stageIdByKey = new Map<string, string>();

      for (const seedStage of seedWorkflow.stages) {
        const existingStage = await this.prisma.workflowStage.findFirst({
          where: { workflowTemplateId: template.id, nameEn: seedStage.nameEn },
        });

        const stageData = {
          nameEn: seedStage.nameEn,
          nameAr: seedStage.nameAr,
          order: seedStage.order,
          slaWorkingHours: seedStage.slaWorkingHours ?? null,
          isInitial: seedStage.isInitial,
          isFinal: seedStage.isFinal,
          approvalMode: seedStage.approvalMode,
          parallelThreshold: seedStage.parallelThreshold ?? null,
          assigneeStrategy: seedStage.assigneeStrategy,
          assigneeRoleId: resolveRoleId(seedStage.assigneeRoleKey) ?? null,
        };

        const stage = existingStage
          ? await this.prisma.workflowStage.update({ where: { id: existingStage.id }, data: stageData })
          : await this.prisma.workflowStage.create({
              data: { workflowTemplateId: template.id, ...stageData },
            });

        stageIdByKey.set(seedStage.key, stage.id);
      }

      for (const seedTransition of seedWorkflow.transitions) {
        const fromStageId = stageIdByKey.get(seedTransition.fromStageKey);
        const toStageId = stageIdByKey.get(seedTransition.toStageKey);
        if (!fromStageId || !toStageId) {
          throw new Error(
            `Workflow seed for objectType '${seedWorkflow.objectType}' references an unknown stage key in a transition`,
          );
        }

        const existingTransition = await this.prisma.workflowTransition.findFirst({
          where: { fromStageId, toStageId },
        });

        const transitionData = {
          labelEn: seedTransition.labelEn,
          labelAr: seedTransition.labelAr,
          requiredPermission: seedTransition.requiredPermission ?? null,
          triggerCondition: seedTransition.triggerCondition,
          triggerRoleId: resolveRoleId(seedTransition.triggerRoleKey) ?? null,
          validatorConfig: this.toJson(seedTransition.validatorConfig),
          isApprovalPath: seedTransition.isApprovalPath ?? false,
        };

        const transition = existingTransition
          ? await this.prisma.workflowTransition.update({
              where: { id: existingTransition.id },
              data: transitionData,
            })
          : await this.prisma.workflowTransition.create({
              data: { fromStageId, toStageId, ...transitionData },
            });

        for (const seedAction of seedTransition.actions) {
          const existingAction = await this.prisma.workflowTransitionAction.findFirst({
            where: {
              workflowTransitionId: transition.id,
              actionType: seedAction.actionType,
              order: seedAction.order,
            },
          });

          const actionData = {
            isEnabled: true,
            configJson: this.toJson(seedAction.configJson),
          };

          if (existingAction) {
            await this.prisma.workflowTransitionAction.update({
              where: { id: existingAction.id },
              data: actionData,
            });
          } else {
            await this.prisma.workflowTransitionAction.create({
              data: {
                workflowTransitionId: transition.id,
                actionType: seedAction.actionType,
                order: seedAction.order,
                ...actionData,
              },
            });
          }
        }
      }
    }
  }

  // ── Templates ────────────────────────────────────────────────────────────────

  async getTemplates(organizationId: string): Promise<IWorkflowTemplate[]> {
    const templates = await this.prisma.workflowTemplate.findMany({
      where: { organizationId },
      orderBy: [{ objectType: 'asc' }, { nameEn: 'asc' }],
    });
    return templates.map((t) => this.mapTemplate(t));
  }

  async getTemplateById(id: string, organizationId: string): Promise<IWorkflowTemplate> {
    const template = await this.prisma.workflowTemplate.findFirst({ where: { id, organizationId } });
    if (!template) throw new NotFoundException('Workflow template not found');

    const stages = await this.prisma.workflowStage.findMany({
      where: { workflowTemplateId: id },
      orderBy: { order: 'asc' },
      include: {
        transitionsFrom: {
          include: { actions: { orderBy: { order: 'asc' } } },
        },
      },
    });

    return {
      ...this.mapTemplate(template),
      stages: stages.map((s) =>
        this.mapStage(
          s,
          s.transitionsFrom.map((t) => this.mapTransition(t, t.actions.map((a) => this.mapTransitionAction(a)))),
        ),
      ),
    };
  }

  async createTemplate(
    dto: CreateWorkflowTemplateDto,
    organizationId: string,
    actorId: string,
  ): Promise<IWorkflowTemplate> {
    const template = await this.prisma.workflowTemplate.create({
      data: {
        organizationId,
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        objectType: dto.objectType,
        isDefault: dto.isDefault ?? false,
        isActive: true,
      },
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'CREATE',
      objectType: 'WorkflowTemplate',
      objectId: template.id,
      after: { nameEn: template.nameEn, nameAr: template.nameAr, objectType: template.objectType },
    });

    return this.mapTemplate(template);
  }

  async updateTemplate(
    id: string,
    dto: UpdateWorkflowTemplateDto,
    organizationId: string,
    actorId: string,
  ): Promise<IWorkflowTemplate> {
    const template = await this.prisma.workflowTemplate.findFirst({ where: { id, organizationId } });
    if (!template) throw new NotFoundException('Workflow template not found');

    const updated = await this.prisma.workflowTemplate.update({
      where: { id },
      data: {
        ...(dto.nameEn !== undefined && { nameEn: dto.nameEn }),
        ...(dto.nameAr !== undefined && { nameAr: dto.nameAr }),
        ...(dto.objectType !== undefined && { objectType: dto.objectType }),
        ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
      },
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'WorkflowTemplate',
      objectId: id,
      before: { nameEn: template.nameEn, nameAr: template.nameAr, objectType: template.objectType },
      after: { nameEn: updated.nameEn, nameAr: updated.nameAr, objectType: updated.objectType },
    });

    return this.mapTemplate(updated);
  }

  async setDefault(id: string, organizationId: string, actorId: string): Promise<void> {
    const template = await this.prisma.workflowTemplate.findFirst({ where: { id, organizationId } });
    if (!template) throw new NotFoundException('Workflow template not found');
    if (template.isDefault) return;

    await this.prisma.$transaction([
      this.prisma.workflowTemplate.updateMany({
        where: { organizationId, objectType: template.objectType, NOT: { id } },
        data: { isDefault: false },
      }),
      this.prisma.workflowTemplate.update({ where: { id }, data: { isDefault: true } }),
    ]);

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'WorkflowTemplate',
      objectId: id,
      before: { isDefault: false },
      after: { isDefault: true },
    });
  }

  async deactivateTemplate(id: string, organizationId: string, actorId: string): Promise<void> {
    const template = await this.prisma.workflowTemplate.findFirst({ where: { id, organizationId } });
    if (!template) throw new NotFoundException('Workflow template not found');
    if (!template.isActive) return;

    await this.prisma.workflowTemplate.update({ where: { id }, data: { isActive: false } });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'WorkflowTemplate',
      objectId: id,
      before: { isActive: true },
      after: { isActive: false },
    });
  }

  // ── Stages ───────────────────────────────────────────────────────────────────

  async addStage(
    templateId: string,
    dto: CreateWorkflowStageDto,
    organizationId: string,
    actorId: string,
  ): Promise<IWorkflowStage> {
    const template = await this.prisma.workflowTemplate.findFirst({
      where: { id: templateId, organizationId },
    });
    if (!template) throw new NotFoundException('Workflow template not found');

    if (dto.assigneeUserId) {
      await this.validateAssigneeUserId(dto.assigneeUserId, organizationId);
    }

    const stage = await this.prisma.workflowStage.create({
      data: {
        workflowTemplateId: templateId,
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        description: dto.description ?? null,
        order: dto.order,
        slaWorkingHours: dto.slaWorkingHours ?? null,
        requiredPermission: dto.requiredPermission ?? null,
        isInitial: dto.isInitial ?? false,
        isFinal: dto.isFinal ?? false,
        approvalMode: dto.approvalMode,
        parallelThreshold: dto.parallelThreshold ?? null,
        // TODO(Committee Management): not org-validated like assigneeUserId
        // just below — no Committee/CommitteeMember data exists anywhere
        // yet, so there's nothing to validate against today. Must add the
        // same re-scoping check here once that module ships (see ACC-17).
        committeeId: dto.committeeId ?? null,
        assigneeStrategy: dto.assigneeStrategy,
        assigneeUserId: dto.assigneeUserId ?? null,
        assigneeRoleId: dto.assigneeRoleId ?? null,
        escalationConfig: this.toJson(dto.escalationConfig),
      },
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'CREATE',
      objectType: 'WorkflowStage',
      objectId: stage.id,
      after: { nameEn: stage.nameEn, nameAr: stage.nameAr, order: stage.order },
    });

    return this.mapStage(stage);
  }

  async updateStage(
    id: string,
    dto: UpdateWorkflowStageDto,
    organizationId: string,
    actorId: string,
  ): Promise<IWorkflowStage> {
    const stage = await this.prisma.workflowStage.findFirst({
      where: { id, workflowTemplate: { organizationId } },
    });
    if (!stage) throw new NotFoundException('Workflow stage not found');

    if (dto.assigneeUserId) {
      await this.validateAssigneeUserId(dto.assigneeUserId, organizationId);
    }

    const updated = await this.prisma.workflowStage.update({
      where: { id },
      data: {
        ...(dto.nameEn !== undefined && { nameEn: dto.nameEn }),
        ...(dto.nameAr !== undefined && { nameAr: dto.nameAr }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.order !== undefined && { order: dto.order }),
        ...(dto.slaWorkingHours !== undefined && { slaWorkingHours: dto.slaWorkingHours }),
        ...(dto.requiredPermission !== undefined && { requiredPermission: dto.requiredPermission }),
        ...(dto.isInitial !== undefined && { isInitial: dto.isInitial }),
        ...(dto.isFinal !== undefined && { isFinal: dto.isFinal }),
        ...(dto.approvalMode !== undefined && { approvalMode: dto.approvalMode }),
        ...(dto.parallelThreshold !== undefined && { parallelThreshold: dto.parallelThreshold }),
        // TODO(Committee Management): see the same TODO in addStage above —
        // not org-validated yet, nothing real to validate against today.
        ...(dto.committeeId !== undefined && { committeeId: dto.committeeId }),
        ...(dto.assigneeStrategy !== undefined && { assigneeStrategy: dto.assigneeStrategy }),
        ...(dto.assigneeUserId !== undefined && { assigneeUserId: dto.assigneeUserId }),
        ...(dto.assigneeRoleId !== undefined && { assigneeRoleId: dto.assigneeRoleId }),
        ...(dto.escalationConfig !== undefined && { escalationConfig: this.toJson(dto.escalationConfig) }),
      },
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'WorkflowStage',
      objectId: id,
      before: { nameEn: stage.nameEn, nameAr: stage.nameAr },
      after: { nameEn: updated.nameEn, nameAr: updated.nameAr },
    });

    return this.mapStage(updated);
  }

  async removeStage(id: string, organizationId: string, actorId: string): Promise<void> {
    const stage = await this.prisma.workflowStage.findFirst({
      where: { id, workflowTemplate: { organizationId } },
    });
    if (!stage) throw new NotFoundException('Workflow stage not found');

    const referencingTransition = await this.prisma.workflowTransition.findFirst({
      where: { OR: [{ fromStageId: id }, { toStageId: id }] },
    });
    if (referencingTransition) {
      throw new ConflictException(
        'This stage is still referenced by a transition and cannot be removed',
      );
    }

    if (stage.isInitial) {
      const siblingCount = await this.prisma.workflowStage.count({
        where: { workflowTemplateId: stage.workflowTemplateId, NOT: { id } },
      });
      if (siblingCount > 0) {
        throw new ConflictException(
          'The initial stage cannot be removed while other stages exist in this template',
        );
      }
    }

    await this.prisma.workflowStage.delete({ where: { id } });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'DELETE',
      objectType: 'WorkflowStage',
      objectId: id,
      before: { nameEn: stage.nameEn, nameAr: stage.nameAr },
    });
  }

  // ── Transitions ──────────────────────────────────────────────────────────────

  async addTransition(
    dto: CreateWorkflowTransitionDto,
    organizationId: string,
    actorId: string,
  ): Promise<IWorkflowTransition> {
    const fromStage = await this.prisma.workflowStage.findFirst({
      where: { id: dto.fromStageId, workflowTemplate: { organizationId } },
    });
    if (!fromStage) throw new NotFoundException('From-stage not found');

    const toStage = await this.prisma.workflowStage.findFirst({
      where: { id: dto.toStageId, workflowTemplate: { organizationId } },
    });
    if (!toStage) throw new NotFoundException('To-stage not found');

    if (fromStage.workflowTemplateId !== toStage.workflowTemplateId) {
      throw new ConflictException('A transition must connect two stages of the same template');
    }

    const transition = await this.prisma.workflowTransition.create({
      data: {
        fromStageId: dto.fromStageId,
        toStageId: dto.toStageId,
        labelEn: dto.labelEn,
        labelAr: dto.labelAr,
        requiredPermission: dto.requiredPermission ?? null,
        triggerCondition: dto.triggerCondition,
        triggerUserId: dto.triggerUserId ?? null,
        triggerRoleId: dto.triggerRoleId ?? null,
        validatorConfig: this.toJson(dto.validatorConfig),
      },
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'CREATE',
      objectType: 'WorkflowTransition',
      objectId: transition.id,
      after: { labelEn: transition.labelEn, labelAr: transition.labelAr },
    });

    return this.mapTransition(transition);
  }

  async updateTransition(
    id: string,
    dto: UpdateWorkflowTransitionDto,
    organizationId: string,
    actorId: string,
  ): Promise<IWorkflowTransition> {
    const transition = await this.prisma.workflowTransition.findFirst({
      where: { id, fromStage: { workflowTemplate: { organizationId } } },
    });
    if (!transition) throw new NotFoundException('Workflow transition not found');

    const updated = await this.prisma.workflowTransition.update({
      where: { id },
      data: {
        ...(dto.labelEn !== undefined && { labelEn: dto.labelEn }),
        ...(dto.labelAr !== undefined && { labelAr: dto.labelAr }),
        ...(dto.requiredPermission !== undefined && { requiredPermission: dto.requiredPermission }),
        ...(dto.triggerCondition !== undefined && { triggerCondition: dto.triggerCondition }),
        ...(dto.triggerUserId !== undefined && { triggerUserId: dto.triggerUserId }),
        ...(dto.triggerRoleId !== undefined && { triggerRoleId: dto.triggerRoleId }),
        ...(dto.validatorConfig !== undefined && { validatorConfig: this.toJson(dto.validatorConfig) }),
        ...(dto.isApprovalPath !== undefined && { isApprovalPath: dto.isApprovalPath }),
      },
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'WorkflowTransition',
      objectId: id,
      before: {
        labelEn: transition.labelEn,
        labelAr: transition.labelAr,
        requiredPermission: transition.requiredPermission,
        triggerCondition: transition.triggerCondition,
        triggerUserId: transition.triggerUserId,
        triggerRoleId: transition.triggerRoleId,
        validatorConfig: transition.validatorConfig,
        isApprovalPath: transition.isApprovalPath,
      },
      after: {
        labelEn: updated.labelEn,
        labelAr: updated.labelAr,
        requiredPermission: updated.requiredPermission,
        triggerCondition: updated.triggerCondition,
        triggerUserId: updated.triggerUserId,
        triggerRoleId: updated.triggerRoleId,
        validatorConfig: updated.validatorConfig,
        isApprovalPath: updated.isApprovalPath,
      },
    });

    return this.mapTransition(updated);
  }

  async removeTransition(id: string, organizationId: string, actorId: string): Promise<void> {
    const transition = await this.prisma.workflowTransition.findFirst({
      where: { id, fromStage: { workflowTemplate: { organizationId } } },
    });
    if (!transition) throw new NotFoundException('Workflow transition not found');

    await this.prisma.workflowTransitionAction.deleteMany({ where: { workflowTransitionId: id } });
    await this.prisma.workflowTransition.delete({ where: { id } });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'DELETE',
      objectType: 'WorkflowTransition',
      objectId: id,
      before: { labelEn: transition.labelEn, labelAr: transition.labelAr },
    });
  }

  // ── Transition Actions ───────────────────────────────────────────────────────

  async addTransitionAction(
    transitionId: string,
    dto: CreateWorkflowTransitionActionDto,
    organizationId: string,
    actorId: string,
  ): Promise<IWorkflowTransitionAction> {
    const transition = await this.prisma.workflowTransition.findFirst({
      where: { id: transitionId, fromStage: { workflowTemplate: { organizationId } } },
    });
    if (!transition) throw new NotFoundException('Workflow transition not found');

    const action = await this.prisma.workflowTransitionAction.create({
      data: {
        workflowTransitionId: transitionId,
        actionType: dto.actionType,
        order: dto.order,
        isEnabled: dto.isEnabled ?? true,
        configJson: this.toJson(dto.configJson),
      },
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'CREATE',
      objectType: 'WorkflowTransitionAction',
      objectId: action.id,
      after: { actionType: action.actionType, order: action.order },
    });

    return this.mapTransitionAction(action);
  }

  async updateTransitionAction(
    id: string,
    dto: UpdateWorkflowTransitionActionDto,
    organizationId: string,
    actorId: string,
  ): Promise<IWorkflowTransitionAction> {
    const action = await this.prisma.workflowTransitionAction.findFirst({
      where: { id, workflowTransition: { fromStage: { workflowTemplate: { organizationId } } } },
    });
    if (!action) throw new NotFoundException('Workflow transition action not found');

    const updated = await this.prisma.workflowTransitionAction.update({
      where: { id },
      data: {
        ...(dto.actionType !== undefined && { actionType: dto.actionType }),
        ...(dto.order !== undefined && { order: dto.order }),
        ...(dto.isEnabled !== undefined && { isEnabled: dto.isEnabled }),
        ...(dto.configJson !== undefined && { configJson: this.toJson(dto.configJson) }),
      },
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'WorkflowTransitionAction',
      objectId: id,
      before: { actionType: action.actionType, order: action.order, isEnabled: action.isEnabled },
      after: { actionType: updated.actionType, order: updated.order, isEnabled: updated.isEnabled },
    });

    return this.mapTransitionAction(updated);
  }

  async removeTransitionAction(id: string, organizationId: string, actorId: string): Promise<void> {
    const action = await this.prisma.workflowTransitionAction.findFirst({
      where: { id, workflowTransition: { fromStage: { workflowTemplate: { organizationId } } } },
    });
    if (!action) throw new NotFoundException('Workflow transition action not found');

    await this.prisma.workflowTransitionAction.delete({ where: { id } });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'DELETE',
      objectType: 'WorkflowTransitionAction',
      objectId: id,
      before: { actionType: action.actionType, order: action.order },
    });
  }

  // ── Internal helpers ─────────────────────────────────────────────────────────

  // Record<string, unknown> doesn't structurally satisfy Prisma's InputJsonValue
  // type (it lacks the array-like index signature Prisma's Json type union
  // expects) — cast explicitly at every Json-field write, same pattern already
  // used by LookupService for attributeSchema/attributes.
  private toJson(value: unknown): Prisma.InputJsonValue | undefined {
    return value === undefined || value === null ? undefined : (value as Prisma.InputJsonValue);
  }

  // Re-validates a client-supplied assigneeUserId belongs to this org before
  // it's written onto a WorkflowStage — mirrors the re-scoping the ROLE case
  // already gets for free downstream (assigneeRoleId's eventual userRole
  // lookup is joined against user:{organizationId}); SPECIFIC_USER had no
  // equivalent check at write time (see ACC-17). dto.committeeId has the
  // same gap but is NOT validated here — no Committee/CommitteeMember data
  // exists anywhere yet (Committee Management hasn't shipped), so there's
  // nothing real to validate against. Must be revisited when that module
  // ships, at the latest.
  private async validateAssigneeUserId(userId: string, organizationId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, organizationId } });
    if (!user) {
      throw new NotFoundException('Assignee user not found in this tenant');
    }
  }

  // ── Internal mappers ─────────────────────────────────────────────────────────

  private mapTemplate(template: PrismaWorkflowTemplate): IWorkflowTemplate {
    return {
      id: template.id,
      organizationId: template.organizationId,
      nameEn: template.nameEn,
      nameAr: template.nameAr,
      objectType: template.objectType,
      isDefault: template.isDefault,
      isActive: template.isActive,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    };
  }

  private mapStage(stage: PrismaWorkflowStage, transitions?: IWorkflowTransition[]): IWorkflowStage {
    return {
      id: stage.id,
      workflowTemplateId: stage.workflowTemplateId,
      nameEn: stage.nameEn,
      nameAr: stage.nameAr,
      description: stage.description,
      order: stage.order,
      slaWorkingHours: stage.slaWorkingHours,
      requiredPermission: stage.requiredPermission,
      isInitial: stage.isInitial,
      isFinal: stage.isFinal,
      approvalMode: stage.approvalMode,
      parallelThreshold: stage.parallelThreshold,
      committeeId: stage.committeeId,
      assigneeStrategy: stage.assigneeStrategy,
      assigneeUserId: stage.assigneeUserId,
      assigneeRoleId: stage.assigneeRoleId,
      escalationConfig: stage.escalationConfig as Record<string, unknown> | null,
      ...(transitions !== undefined && { transitions }),
    };
  }

  private mapTransition(
    transition: PrismaWorkflowTransition,
    actions?: IWorkflowTransitionAction[],
  ): IWorkflowTransition {
    return {
      id: transition.id,
      fromStageId: transition.fromStageId,
      toStageId: transition.toStageId,
      labelEn: transition.labelEn,
      labelAr: transition.labelAr,
      requiredPermission: transition.requiredPermission,
      triggerCondition: transition.triggerCondition,
      triggerUserId: transition.triggerUserId,
      triggerRoleId: transition.triggerRoleId,
      validatorConfig: transition.validatorConfig as Record<string, unknown> | null,
      isApprovalPath: transition.isApprovalPath,
      ...(actions !== undefined && { actions }),
    };
  }

  private mapTransitionAction(action: PrismaWorkflowTransitionAction): IWorkflowTransitionAction {
    return {
      id: action.id,
      workflowTransitionId: action.workflowTransitionId,
      actionType: action.actionType,
      order: action.order,
      isEnabled: action.isEnabled,
      configJson: action.configJson as Record<string, unknown> | null,
    };
  }
}
