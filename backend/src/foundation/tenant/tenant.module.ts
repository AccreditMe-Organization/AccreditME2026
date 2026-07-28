import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LookupModule } from '../lookup/lookup.module';
import { RolesModule } from '../roles/roles.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { OrgPositionModule } from '../org-position/org-position.module';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { STORAGE_PROVIDER } from '../../providers/storage/storage.provider';
import { S3StorageProvider } from '../../providers/storage/s3-storage.provider';
import { AI_PROVIDER } from '../../providers/ai/ai.provider';
import { AnthropicAiProvider } from '../../providers/ai/anthropic-ai.provider';
import { AUTH_PROVIDER } from '../../providers/auth/auth.provider';
import { BetterAuthProvider } from '../../providers/auth/better-auth.provider';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => LookupModule),
    forwardRef(() => RolesModule),
    forwardRef(() => WorkflowModule),
    forwardRef(() => OrgPositionModule),
  ],
  controllers: [TenantController],
  providers: [
    TenantService,
    AuditLogService,
    { provide: STORAGE_PROVIDER, useClass: S3StorageProvider },
    { provide: AI_PROVIDER, useClass: AnthropicAiProvider },
    { provide: AUTH_PROVIDER, useClass: BetterAuthProvider },
  ],
  exports: [
    TenantService,
    AuditLogService,
    STORAGE_PROVIDER,
    AI_PROVIDER,
    AUTH_PROVIDER,
  ],
})
export class TenantModule {}
