import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { LookupService } from '../lookup/lookup.service';
import { RoleService } from '../roles/role.service';
import { WorkflowTemplateService } from '../workflow/workflow-template.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import {
  decryptTenantConfig,
  encryptTenantConfig,
  getEncryptionKey,
} from '../../common/utils/tenant-config-crypto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { ITenant, ITenantConfig } from './interfaces/tenant.interface';

@Injectable()
export class TenantService {
  private readonly encryptionKey: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    @Inject(forwardRef(() => LookupService))
    private readonly lookupService: LookupService,
    @Inject(forwardRef(() => RoleService))
    private readonly roleService: RoleService,
    @Inject(forwardRef(() => WorkflowTemplateService))
    private readonly workflowTemplateService: WorkflowTemplateService,
  ) {
    this.encryptionKey = getEncryptionKey();
  }

  async findById(id: string): Promise<ITenant> {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Tenant not found');
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      country: org.country,
      timezone: org.timezone,
      language: org.language,
      authProvider: org.authProvider,
      storageProvider: org.storageProvider,
      aiProvider: org.aiProvider,
      plan: org.plan,
      status: org.status,
      trialEndsAt: org.trialEndsAt,
      maxUsers: org.maxUsers,
      maxStorageGb: org.maxStorageGb,
      isBootstrapped: org.isBootstrapped,
      bootstrappedAt: org.bootstrappedAt,
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
    };
  }

  async update(
    id: string,
    dto: UpdateTenantDto,
    actorId: string,
  ): Promise<ITenant> {
    await this.findById(id);

    const updated = await this.prisma.organization.update({
      where: { id },
      data: dto,
    });

    await this.auditLog.log({
      action: 'UPDATE',
      objectType: 'Organization',
      objectId: id,
      actorId,
      tenantId: id,
      after: dto as Record<string, unknown>,
    });

    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      country: updated.country,
      timezone: updated.timezone,
      language: updated.language,
      authProvider: updated.authProvider,
      storageProvider: updated.storageProvider,
      aiProvider: updated.aiProvider,
      plan: updated.plan,
      status: updated.status,
      trialEndsAt: updated.trialEndsAt,
      maxUsers: updated.maxUsers,
      maxStorageGb: updated.maxStorageGb,
      isBootstrapped: updated.isBootstrapped,
      bootstrappedAt: updated.bootstrappedAt,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  async getTenantConfig(id: string): Promise<ITenantConfig> {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Tenant not found');

    return {
      authProvider: org.authProvider,
      storageProvider: org.storageProvider,
      aiProvider: org.aiProvider,
      authConfig: org.authConfig
        ? (JSON.parse(
            this.decryptConfig(org.authConfig),
          ) as Record<string, unknown>)
        : null,
      storageConfig: org.storageConfig
        ? (JSON.parse(
            this.decryptConfig(org.storageConfig),
          ) as Record<string, unknown>)
        : null,
      aiConfig: org.aiConfig
        ? (JSON.parse(
            this.decryptConfig(org.aiConfig),
          ) as Record<string, unknown>)
        : null,
    };
  }

  async bootstrap(id: string, actorId: string): Promise<void> {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Tenant not found');
    if (org.isBootstrapped) {
      throw new ConflictException('Tenant has already been bootstrapped');
    }

    // Prisma called directly — importing OrganizationService would be circular
    // (OrganizationModule → TenantModule → OrganizationService).
    const rootUnitExists = await this.prisma.orgUnit.findFirst({
      where: { organizationId: id, parentId: null },
    });
    if (!rootUnitExists) {
      const code =
        org.name
          .toUpperCase()
          .replace(/[^A-Z0-9\s-]/g, '')
          .trim()
          .replace(/\s+/g, '-')
          .slice(0, 10) || 'ROOT';
      await this.prisma.orgUnit.create({
        data: { organizationId: id, nameEn: org.name, code, sortOrder: 0 },
      });
    }

    await this.lookupService.seedSystemData();
    await this.roleService.seedSystemRoles(id);
    await this.workflowTemplateService.seedDefaultWorkflows(id);
    // TODO(Step 7 — Notifications): register default notification rules

    await this.prisma.organization.update({
      where: { id },
      data: { isBootstrapped: true, bootstrappedAt: new Date() },
    });

    await this.auditLog.log({
      action: 'CREATE',
      objectType: 'TenantBootstrap',
      objectId: id,
      actorId,
      tenantId: id,
    });
  }

  encryptConfig(data: Record<string, unknown>): string {
    return encryptTenantConfig(data, this.encryptionKey);
  }

  private decryptConfig(encrypted: string): string {
    return decryptTenantConfig(encrypted, this.encryptionKey);
  }
}
