import { Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { RecycleBinService } from './recycle-bin.service';

export const STORAGE_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * ACC-177 — the daily purge: files deleted more than 30 days ago lose their
 * bytes and are marked purged, audited (RecycleBinService.purgeExpired()).
 * Registered only behind workersEnabled() (ACC-92), like every processor; it
 * both consumes the queue and schedules its own daily repeat. Verify it
 * locally by calling purgeExpired() in-process, never by enqueueing — the
 * Redis queue is shared with the deployed instance.
 */
@Processor('storage-purge')
export class StoragePurgeProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(StoragePurgeProcessor.name);

  constructor(
    private readonly recycleBin: RecycleBinService,
    @InjectQueue('storage-purge') private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.add('purge-expired-files', {}, { repeat: { every: STORAGE_PURGE_INTERVAL_MS }, jobId: 'storage-purge-repeat' });
  }

  async process(_job: Job): Promise<void> {
    const { purged, failedOrganizations } = await this.recycleBin.purgeExpired();
    if (failedOrganizations.length > 0) {
      // Failed, so it shows as failed; every other organisation still ran.
      throw new Error(`Expired-file purge failed for ${failedOrganizations.length} organisation(s): ${failedOrganizations.join(', ')}. ${purged} file(s) purged elsewhere.`);
    }
    this.logger.log(`Expired-file purge: ${purged} file(s) purged.`);
  }
}
