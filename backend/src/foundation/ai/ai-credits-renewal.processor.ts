import { Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { AiAllocationService } from './ai-allocation.service';

export const AI_CREDITS_RENEWAL_INTERVAL_MS = 60 * 60 * 1000;
export const AI_CREDITS_RENEWAL_JOB = 'renew-due-ai-credits';

/**
 * ACC-194 — the hourly AI credit renewal: every organisation whose renewal
 * time has passed gets its period renewed (AiAllocationService.renewDue()).
 * Hourly rather than one cron on a date, because periods are anchored to each
 * organisation's own activation day (D2), and so a deploy or a Redis outage
 * delays a renewal by at most an hour.
 *
 * It is the stored state's single scheduled recomputer (ACC-82). Decisions
 * never wait for it: the gateway renews a due period inline before reserving,
 * and GET /tenant reads a due period as renewed. Re-runs and a second worker
 * change nothing — renewal takes the row lock and only touches a period that
 * is due.
 *
 * Registered only behind workersEnabled() (ACC-92). Verify it locally by
 * calling AiAllocationService.renewDue() in-process, never by enqueueing — the
 * Redis queue is shared with the deployed instance.
 */
@Processor('ai-credits')
export class AiCreditsRenewalProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(AiCreditsRenewalProcessor.name);

  constructor(
    private readonly allocation: AiAllocationService,
    @InjectQueue('ai-credits') private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.add(AI_CREDITS_RENEWAL_JOB, {}, { repeat: { every: AI_CREDITS_RENEWAL_INTERVAL_MS }, jobId: 'ai-credits-renewal-repeat' });
  }

  async process(_job: Job): Promise<void> {
    const { renewed, failed } = await this.allocation.renewDue();
    if (failed.length > 0) {
      // Failed, so the job shows as failed; every other organisation still renewed.
      throw new Error(`AI credit renewal failed for ${failed.length} organisation(s): ${failed.join(', ')}. ${renewed} renewed.`);
    }
    this.logger.log(`AI credit renewal: ${renewed} organisation(s) renewed.`);
  }
}
