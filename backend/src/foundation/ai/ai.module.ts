import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { QueueModule } from '../../common/queue/queue.module';
import { workersEnabled } from '../../common/queue/workers.config';
import { AiCreditsRenewalProcessor } from './ai-credits-renewal.processor';
import { AuditLogService } from '../../common/services/audit-log.service';
import { AI_PROVIDER } from '../../providers/ai/ai.provider';
import { AnthropicAiProvider } from '../../providers/ai/anthropic-ai.provider';
import { AiService } from './ai.service';
import { AiCreditService } from './ai-credit.service';
import { AiAllocationService } from './ai-allocation.service';
import { AiNoticesService } from './ai-notices.service';

/**
 * ACC-194 — AI metering and the one gateway to a model.
 *
 * AI_PROVIDER is bound HERE and deliberately NOT exported: a feature gets AI
 * through AiService.run(), which prices, switches, meters and logs every call.
 * `npm run check:ai-gateway` fails the build if anything outside foundation/ai
 * and providers/ai references the provider.
 */
@Module({
  imports: [PrismaModule, QueueModule],
  providers: [
    AiService,
    AiCreditService,
    AiAllocationService,
    AiNoticesService,
    AuditLogService,
    { provide: AI_PROVIDER, useClass: AnthropicAiProvider },
    // The hourly renewal both consumes its queue and schedules its own repeat,
    // so it is registered only where workers run (ACC-92).
    ...(workersEnabled() ? [AiCreditsRenewalProcessor] : []),
  ],
  exports: [AiService, AiAllocationService],
})
export class AiModule {}
