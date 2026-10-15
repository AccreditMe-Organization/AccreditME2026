import { aiBalanceOf, AiBalanceSource, aiUsageOf, openAiFeatures } from '../ai/ai-balance';
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
import { Prisma } from '../../../generated/prisma/client';
import { AuditLogService } from '../../common/services/audit-log.service';
import {
  decryptTenantConfig,
  encryptTenantConfig,
  getEncryptionKey,
} from '../../common/utils/tenant-config-crypto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { UpdateEmailConfigDto } from './dto/update-email-config.dto';
import {
  IStoredEmailConfig,
  keepKnownFields,
  maskEmailConfig,
  missingEmailFields,
  readEmailConfig,
  secretFieldsOf,
  writeEmailConfig,
} from './email-config';
import { EmailSettingsIncompleteException } from './email-settings-refusal';
import { changedFieldNames, mergeKeepingSecrets } from '../../common/config/write-only-secrets';
import { resolvePlatformSender } from '../../common/config/email-sender.config';
import { UpdateAiOverageDto } from './dto/update-ai-overage.dto';
import { UpdateTaskSlaDto } from './dto/update-task-sla.dto';
import {
  ITenant,
  ITenantConfig,
  ITenantEntitlements,
  IEmailConfig,
  ITaskSlaSettings,
} from './interfaces/tenant.interface';
import { ModuleAccessLevel, resolveModuleEntitlements } from './module-entitlements';
import { DEFAULT_TASK_SLA_SETTINGS, taskSlaFromSettings } from './task-sla-settings';
import { stageDeadlineConflicts } from '../workflow/stage-deadline-rule';
import { WorkflowRefusalException } from '../workflow/workflow-refusal';

// ACC-46 Section 2.7.d — replaces TaskService's own old
// DEFAULT_TASK_SLA_HOURS/FALLBACK_SLA_HOURS pair (a flat hours-per-priority
// map with no escalation concept at all) with the fuller three-field-per-
// tier shape. dueAfterHours values match the previous hardcoded hours
// exactly — no behavior change for a tenant that never visits the new
// settings page. managerEscalationAfterHours/headEscalationAfterHours are
// new grace periods with no prior equivalent; the values below are a
// reasonable starting point (roughly half of dueAfterHours for the
// Manager tier, dueAfterHours again for the Head tier), not a fixed
// product decision — a tenant admin can change every field via the new
// settings page. The values live in task-sla-settings.ts (ACC-174), with the
// one function that reads them, so the SLA limit and its backfill share them.

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
    return this.mapToITenant(org, await this.aiOf(org));
  }

  // ACC-79 — what the shell needs to draw navigation, and nothing else.
  //
  // Scoped by the caller's own organization id, which the controller takes
  // from @CurrentTenant() and never from the request. The Organization row is
  // the tenant itself, so a lookup by id is the whole of the scoping; the plan
  // modules are then read through THAT row's planId, never a planId supplied
  // from outside. PlanModule is platform catalog data rather than tenant data,
  // but reading another tenant's plan would still disclose which plan they are
  // on — so the chain from caller to plan must not have a second entry point.
  async getEntitlements(organizationId: string): Promise<ITenantEntitlements> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, nameAr: true, slug: true, isPlatformOrg: true, settings: true, planId: true },
    });
    if (!org) throw new NotFoundException('Tenant not found');

    // null, not [], when there is no plan. The resolver treats those two very
    // differently: [] is "a plan that grants nothing", null is the legacy
    // no-plan state that falls back to FULL.
    const planModules = org.planId
      ? await this.prisma.planModule.findMany({
          where: { planId: org.planId },
          select: { moduleKey: true, accessLevel: true },
        })
      : null;

    const enabledModules =
      (org.settings as { modules?: Record<string, boolean> } | null)?.modules ?? {};

    return {
      name: org.name,
      nameAr: org.nameAr,
      slug: org.slug,
      isPlatformOrg: org.isPlatformOrg,
      modules: resolveModuleEntitlements(
        enabledModules,
        planModules?.map((m) => ({
          moduleKey: m.moduleKey,
          accessLevel: m.accessLevel as ModuleAccessLevel,
        })) ?? null,
      ),
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

    return this.mapToITenant(updated, await this.aiOf(updated));
  }

  // The AI block: the balance from the dedicated columns (ACC-194), the
  // features open to the organisation, and what this period's credits went on
  // (ACC-120 slice 8). Usage is read from the period the balance resolves to,
  // so a renewal that is due but not yet stored reads as an empty period.
  private async aiOf(org: AiBalanceSource & { id: string }): Promise<ITenant['ai']> {
    const balance = aiBalanceOf(org);
    const [features, usage] = await Promise.all([
      openAiFeatures(this.prisma, org.id),
      aiUsageOf(this.prisma, org.id, balance.periodStart),
    ]);
    return { ...balance, features, usage };
  }

  // Shared by findById/update — modules/ai (ACC-13) are the frontend
  // navigation's one-stop source for "what am I licensed to see." Modules come
  // from Organization.settings; the AI balance from the dedicated AI columns
  // (ACC-194 — the old settings.ai counters are ignored everywhere).
  private mapToITenant(org: AiBalanceSource & {
    id: string;
    name: string;
    nameAr: string | null;
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
  }, ai: ITenant['ai']): ITenant {
    const settings = (org.settings as { modules?: Record<string, boolean> } | null) ?? {};

    return {
      id: org.id,
      name: org.name,
      // ACC-120 — null for any tenant that has never filled it in, which is all
      // three today. Passed through as-is: this layer does not substitute the
      // English name, because choosing which name to SHOW is a display decision
      // and belongs to whoever renders it, not to the mapper.
      nameAr: org.nameAr,
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
      ai,
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
    };
  }

  async getTenantConfig(id: string): Promise<ITenantConfig> {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Tenant not found');

    // ACC-177 — each config is reported as "set" or null, never decrypted.
    // These blobs hold provider secrets (a MinIO secret key, an AI key), and
    // this route used to return them in clear to anyone holding
    // tenant:manage_config. Nothing on the frontend reads this route; storage
    // settings have their own masked read at GET /tenant/storage.
    return {
      authProvider: org.authProvider,
      storageProvider: org.storageProvider,
      aiProvider: org.aiProvider,
      authConfig: org.authConfig ? 'set' : null,
      storageConfig: org.storageConfig ? 'set' : null,
      aiConfig: org.aiConfig ? 'set' : null,
    };
  }

  // ── Email provider settings (ACC-181) ─────────────────────────────────────
  // Typed per provider, secrets write-only: GET answers each secret 'set' or
  // null, a save merges with what is stored, the audit names fields only.
  // Nothing sends mail with these yet (email-config.ts).

  async getEmailConfig(id: string): Promise<IEmailConfig> {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Tenant not found');
    return maskEmailConfig(this.readStoredEmailConfig(org.emailConfig), resolvePlatformSender());
  }

  /**
   * Merges the chosen provider's settings with the stored ones:
   * - a secret omitted or sent '' keeps its stored value, but only while the
   *   provider is unchanged — a switch never carries the old provider's secret;
   * - the result must be complete, else 400 EMAIL_SETTINGS_INCOMPLETE (D6);
   * - only a newly sent secret gets a new set date (D2);
   * - the audit records the provider and the changed field NAMES.
   */
  async updateEmailConfig(id: string, dto: UpdateEmailConfigDto, actorId: string): Promise<IEmailConfig> {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Tenant not found');

    const stored = this.readStoredEmailConfig(org.emailConfig);
    const provider = dto.provider;
    const sameProvider = stored?.provider === provider;
    const before = sameProvider ? stored.settings : {};
    const sent = (dto[provider] ?? {}) as Record<string, unknown>;
    const secrets = secretFieldsOf(provider);

    const settings = keepKnownFields(provider, mergeKeepingSecrets(before, sent, secrets));
    const missing = missingEmailFields(provider, settings);
    if (missing.length > 0) throw new EmailSettingsIncompleteException(missing);

    const now = new Date().toISOString();
    const newlySent = secrets.filter((name) => typeof sent[name] === 'string' && sent[name] !== '');
    const secretsSetAt: Record<string, string> = {};
    for (const name of secrets) {
      if (settings[name] === undefined) continue;
      if (newlySent.includes(name)) secretsSetAt[name] = now;
      else if (sameProvider && stored.secretsSetAt[name]) secretsSetAt[name] = stored.secretsSetAt[name];
    }

    const next = { provider, settings, secretsSetAt };
    await this.prisma.organization.update({
      where: { id },
      data: { emailConfig: this.encryptConfig(writeEmailConfig(next)) },
    });

    // Names only. A secret that was sent counts as changed even when the value
    // is the same, because it was replaced.
    const changedFields = [
      ...(stored?.provider !== provider ? ['provider'] : []),
      ...new Set([
        ...changedFieldNames(before, settings, `${provider}.`),
        ...newlySent.map((name) => `${provider}.${name}`),
      ]),
    ];
    await this.auditLog.log({
      action: 'UPDATE',
      objectType: 'Organization',
      objectId: id,
      actorId,
      tenantId: id,
      metadata: {
        event: 'email_config_updated',
        provider,
        previousProvider: stored?.provider ?? null,
        changedFields,
      },
    });

    return maskEmailConfig(next, resolvePlatformSender());
  }

  /** Disconnect: back to AccreditMe's default delivery. The whole provider goes (D3). */
  async disconnectEmailConfig(id: string, actorId: string): Promise<IEmailConfig> {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Tenant not found');
    if (org.emailConfig) {
      const stored = this.readStoredEmailConfig(org.emailConfig);
      await this.prisma.organization.update({ where: { id }, data: { emailConfig: null } });
      await this.auditLog.log({
        action: 'UPDATE',
        objectType: 'Organization',
        objectId: id,
        actorId,
        tenantId: id,
        metadata: { event: 'email_config_disconnected', previousProvider: stored?.provider ?? null },
      });
    }
    return maskEmailConfig(null, resolvePlatformSender());
  }

  private readStoredEmailConfig(encrypted: string | null): IStoredEmailConfig | null {
    if (!encrypted) return null;
    return readEmailConfig(JSON.parse(this.decryptConfig(encrypted)));
  }

  // ACC-194 — overage stays off and NOTHING reads this value any more (D9):
  // the gateway refuses at zero whatever it says, and the AI credits screen no
  // longer shows the toggle. The route is kept until a later contract step
  // removes it, so an old client gets a 200 rather than a 404. Credits live in
  // dedicated Organization columns, written only by foundation/ai/.
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

  // ACC-46 Section 2.7.d — read-side fallback covers an absent key
  // functionally forever; bootstrap() also writes DEFAULT_TASK_SLA_SETTINGS
  // for real at tenant creation so the settings page always has a genuine
  // saved row to display, not just a runtime default.
  async getTaskSla(id: string): Promise<ITaskSlaSettings> {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Tenant not found');

    return taskSlaFromSettings(org.settings);
  }

  async updateTaskSla(id: string, dto: UpdateTaskSlaDto, actorId: string): Promise<void> {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Tenant not found');

    const settings = (org.settings as Record<string, unknown> | null) ?? {};

    // ACC-190 — raising a priority's hours must not make any workflow stage end
    // before a task defined on it is due.
    const conflicts = await stageDeadlineConflicts(this.prisma, id, (priority) => dto[priority].dueAfterHours);
    if (conflicts.length > 0) {
      throw new WorkflowRefusalException('TASK_SLA_EXCEEDS_STAGE_DEADLINES', { stages: conflicts });
    }

    await this.prisma.organization.update({
      where: { id },
      data: { settings: { ...settings, taskSla: dto } as unknown as Prisma.InputJsonValue },
    });

    await this.auditLog.log({
      action: 'UPDATE',
      objectType: 'Organization',
      objectId: id,
      actorId,
      tenantId: id,
      metadata: { event: 'task_sla_updated' },
    });
  }

  /**
   * The `organization` lookup value, for the root unit bootstrap() creates.
   *
   * ACC-141. Throws rather than falling back: a root with no type is the exact
   * state ACC-137's Setup health condition exists to report, and creating one
   * silently while provisioning a tenant would put every new customer into it.
   * seedSystemData() runs immediately above the caller, so by this point the
   * value exists unless the seed itself is broken - in which case failing the
   * provisioning loudly is right.
   *
   * Not resolved through OrganizationService: importing it here is circular
   * (OrganizationModule -> TenantModule -> OrganizationService), which is why
   * this file already talks to Prisma directly for the root unit.
   */
  private async resolveOrganizationTypeValue(): Promise<{ id: string; key: string }> {
    const category = await this.prisma.lookupCategory.findFirst({
      where: { key: 'org_unit_type', organizationId: null },
      select: { id: true },
    });
    if (!category) {
      throw new Error(
        "Lookup category 'org_unit_type' not found. seedSystemData() runs immediately " +
          'before this and should have created it.',
      );
    }

    const value = await this.prisma.lookupValue.findFirst({
      where: { categoryId: category.id, key: 'organization', organizationId: null },
      select: { id: true, key: true },
    });
    if (!value) {
      throw new Error(
        "SYSTEM lookup value 'organization' not found in org_unit_type. The tenant's root " +
          'unit cannot be typed without it (ACC-141).',
      );
    }
    return value;
  }

  async bootstrap(id: string, actorId: string): Promise<void> {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Tenant not found');
    if (org.isBootstrapped) {
      throw new ConflictException('Tenant has already been bootstrapped');
    }

    // ACC-145 — BEFORE the root unit, not after. The global SYSTEM lookups are
    // what a unit's type resolves against, and creating the thing that needs
    // them before the thing that creates them is an ordering that only works by
    // accident: the values are global, so the second and every later tenant
    // finds them already seeded by an earlier bootstrap. Only the very first
    // tenant on a fresh database hit the gap — which is why it passed every
    // manual test on dev and would have failed on a clean production database.
    //
    // This is belt-and-braces, not the fix. The real guarantee is the pre-deploy
    // step (ACC-145), because the values must exist before the REQUEST is made,
    // not before this line runs. Kept because relying on a previous tenant
    // having seeded the globals is not a guarantee.
    await this.lookupService.seedSystemData();

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
      // ACC-141 - the root's type is `organization`, resolved here and written
      // with the unit. Nobody chooses it: a root unit IS the organisation, so
      // asking would be ceremony that also permits a wrong answer. It is NOT
      // the "guessed default" this ticket's earlier draft rejected - that was
      // about guessing among six plausible options for a unit whose type
      // genuinely varies. Here there is exactly one correct answer.
      //
      // Resolved by KEY among the values this tenant can see, not hardcoded by
      // id, because ids are generated per database.
      //
      // Both shapes are written, as everywhere else during the expand step.
      const organizationType = await this.resolveOrganizationTypeValue();

      await this.prisma.orgUnit.create({
        data: {
          organizationId: id,
          nameEn: org.name,
          code,
          sortOrder: 0,
          type: organizationType.key,
          typeValueId: organizationType.id,
        },
      });
    }

    await this.orgPositionService.seedDefaultPositions(id);
    await this.roleService.seedSystemRoles(id);
    await this.workflowTemplateService.seedDefaultWorkflows(id);

    // ACC-46 Section 2.7.d — not strictly required for correctness
    // (getTaskSla()'s own fallback covers an absent key forever), but means
    // the settings page always has a real saved row from day one.
    const existingSettings = (org.settings as Record<string, unknown> | null) ?? {};

    await this.prisma.organization.update({
      where: { id },
      data: {
        isBootstrapped: true,
        bootstrappedAt: new Date(),
        settings: { ...existingSettings, taskSla: DEFAULT_TASK_SLA_SETTINGS } as unknown as Prisma.InputJsonValue,
      },
    });

    await this.auditLog.log({
      action: 'CREATE',
      objectType: 'TenantBootstrap',
      objectId: id,
      actorId,
      tenantId: id,
    });
  }

  // ACC-40 Section 2.4 — bootstrap() itself never creates a User (the
  // tenant's first admin is created separately, via
  // PlatformTenantService.createTenant()'s own UserService.invite() call,
  // immediately after bootstrap() runs). That invite() call now requires
  // positionId unconditionally and primaryOrgUnitId once an active OrgUnit
  // exists — which, for a just-bootstrapped tenant, is always true:
  // bootstrap() itself guarantees both the "Director" position (highest-
  // graded of DEFAULT_POSITIONS) and a root OrgUnit (parentId: null)
  // already exist by the time this is called.
  async resolveDefaultTenantAdminAssignment(
    organizationId: string,
  ): Promise<{ positionId: string; primaryOrgUnitId: string }> {
    const position = await this.prisma.orgPosition.findFirst({
      where: { organizationId, nameEn: 'Director' },
    });
    if (!position) {
      throw new Error('Default "Director" position not found after bootstrap — this should never happen');
    }

    const rootUnit = await this.prisma.orgUnit.findFirst({
      where: { organizationId, parentId: null },
    });
    if (!rootUnit) {
      throw new Error('Root org unit not found after bootstrap — this should never happen');
    }

    return { positionId: position.id, primaryOrgUnitId: rootUnit.id };
  }

  encryptConfig(data: Record<string, unknown>): string {
    return encryptTenantConfig(data, this.encryptionKey);
  }

  private decryptConfig(encrypted: string): string {
    return decryptTenantConfig(encrypted, this.encryptionKey);
  }
}
