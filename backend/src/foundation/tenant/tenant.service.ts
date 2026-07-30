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
import { OrgPositionService } from '../org-position/org-position.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import {
  decryptTenantConfig,
  encryptTenantConfig,
  getEncryptionKey,
} from '../../common/utils/tenant-config-crypto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { UpdateEmailConfigDto } from './dto/update-email-config.dto';
import { UpdateAiOverageDto } from './dto/update-ai-overage.dto';
import { ITenant, ITenantConfig, IEmailConfig } from './interfaces/tenant.interface';

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
    @Inject(forwardRef(() => OrgPositionService))
    private readonly orgPositionService: OrgPositionService,
  ) {
    this.encryptionKey = getEncryptionKey();
  }

  async findById(id: string): Promise<ITenant> {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Tenant not found');
    return this.mapToITenant(org);
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

    return this.mapToITenant(updated);
  }

  // Shared by findById/update — modules/ai (ACC-13) are the frontend
  // navigation's one-stop source for "what am I licensed to see," derived
  // from Organization.settings rather than a dedicated endpoint.
  private mapToITenant(org: {
    id: string;
    name: string;
    slug: string;
    country: string;
    timezone: string;
    language: string;
    authProvider: ITenant['authProvider'];
    storageProvider: ITenant['storageProvider'];
    aiProvider: ITenant['aiProvider'];
    plan: ITenant['plan'];
    status: ITenant['status'];
    trialEndsAt: Date | null;
    maxUsers: number;
    maxStorageGb: number;
    isBootstrapped: boolean;
    bootstrappedAt: Date | null;
    logo: string | null;
    isPlatformOrg: boolean;
    settings: unknown;
    createdAt: Date;
    updatedAt: Date;
  }): ITenant {
    const settings = (org.settings as {
      modules?: Record<string, boolean>;
      ai?: {
        enabled?: boolean;
        monthlyCredits?: number;
        creditsUsed?: number;
        creditsRemaining?: number;
        resetDate?: string;
        overageEnabled?: boolean;
      };
    } | null) ?? {};

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
      logo: org.logo,
      isPlatformOrg: org.isPlatformOrg,
      modules: settings.modules ?? {},
      ai: {
        enabled: settings.ai?.enabled ?? false,
        monthlyCredits: settings.ai?.monthlyCredits ?? 0,
        creditsUsed: settings.ai?.creditsUsed ?? 0,
        creditsRemaining: settings.ai?.creditsRemaining ?? 0,
        resetDate: settings.ai?.resetDate ?? null,
        overageEnabled: settings.ai?.overageEnabled ?? false,
      },
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
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

  // UI only for now (ACC-13) — see UpdateEmailConfigDto's own header comment.
  // Same encrypted-JSON pattern as authConfig/storageConfig/aiConfig.
  async getEmailConfig(id: string): Promise<IEmailConfig> {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Tenant not found');

    if (!org.emailConfig) {
      return { emailProvider: null, config: null };
    }

    const parsed = JSON.parse(this.decryptConfig(org.emailConfig)) as {
      emailProvider: IEmailConfig['emailProvider'];
      config: Record<string, unknown>;
    };
    return { emailProvider: parsed.emailProvider, config: parsed.config };
  }

  async updateEmailConfig(
    id: string,
    dto: UpdateEmailConfigDto,
    actorId: string,
  ): Promise<void> {
    await this.findById(id);

    const encrypted = this.encryptConfig({
      emailProvider: dto.emailProvider,
      config: dto.config,
    });

    await this.prisma.organization.update({
      where: { id },
      data: { emailConfig: encrypted },
    });

    await this.auditLog.log({
      action: 'UPDATE',
      objectType: 'Organization',
      objectId: id,
      actorId,
      tenantId: id,
      metadata: { event: 'email_config_updated', emailProvider: dto.emailProvider },
    });
  }

  // Deliberately narrow (ACC-13) — a tenant admin may only toggle this one
  // field within their own org's settings.ai; monthlyCredits/creditsUsed/
  // creditsRemaining are exclusively set by a Platform Admin via
  // PlatformTenantService.allocateAiCredits(), never from this endpoint.
  async updateAiOverageSetting(id: string, dto: UpdateAiOverageDto, actorId: string): Promise<void> {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Tenant not found');

    const settings = (org.settings as { ai?: Record<string, unknown> } | null) ?? {};
    const ai = { ...(settings.ai ?? {}), overageEnabled: dto.overageEnabled };

    await this.prisma.organization.update({
      where: { id },
      data: { settings: { ...settings, ai } },
    });

    await this.auditLog.log({
      action: 'UPDATE',
      objectType: 'Organization',
      objectId: id,
      actorId,
      tenantId: id,
      metadata: { event: 'ai_overage_setting_updated', overageEnabled: dto.overageEnabled },
    });
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

    await this.orgPositionService.seedDefaultPositions(id);
    await this.lookupService.seedSystemData();
    await this.roleService.seedSystemRoles(id);
    await this.workflowTemplateService.seedDefaultWorkflows(id);
    // TODO(Step 8 — Tasks): register default task SLA settings

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
