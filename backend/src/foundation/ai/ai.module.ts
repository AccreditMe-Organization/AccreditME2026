import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogService } from '../../common/services/audit-log.service';
import { AI_PROVIDER } from '../../providers/ai/ai.provider';
import { AnthropicAiProvider } from '../../providers/ai/anthropic-ai.provider';
import { AiService } from './ai.service';
import { AiCreditService } from './ai-credit.service';
import { AiAllocationService } from './ai-allocation.service';

/**
 * ACC-194 — AI metering and the one gateway to a model.
 *
 * AI_PROVIDER is bound HERE and deliberately NOT exported: a feature gets AI
 * through AiService.run(), which prices, switches, meters and logs every call.
 * `npm run check:ai-gateway` fails the build if anything outside foundation/ai
 * and providers/ai references the provider.
 */
@Module({
  imports: [PrismaModule],
  providers: [
    AiService,
    AiCreditService,
    AiAllocationService,
    AuditLogService,
    { provide: AI_PROVIDER, useClass: AnthropicAiProvider },
  ],
  exports: [AiService, AiAllocationService],
})
export class AiModule {}
