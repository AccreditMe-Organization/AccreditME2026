import { Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { RecycleBinService } from './recycle-bin.service';
import { SharePointAccessService } from './sharepoint-access.service';

export const STORAGE_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const SHAREPOINT_PROBE_INTERVAL_MS = 60 * 60 * 1000;

export const PURGE_JOB = 'purge-expired-files';
export const SHAREPOINT_PROBE_JOB = 'probe-sharepoint';

/**
 * ACC-177 — the daily purge: files deleted more than 30 days ago lose their
 * bytes and are marked purged, audited (RecycleBinService.purgeExpired()).
 *
 * ACC-185 — the same queue carries two SharePoint duties:
 *   - daily, beside the purge: the one-time 30-day warning before a client
 *     secret expires (SharePointAccessService.warnExpiringSecrets());
 *   - hourly: the probe that sets and clears "SharePoint access withdrawn" for
 *     every confirmed SharePoint organisation — the flag's single scheduled
 *     recomputer (ACC-82's rule).
 *
 * Registered only behind workersEnabled() (ACC-92), like every processor; it
 * both consumes the queue and schedules its own repeats. Verify it locally by
 * calling the services in-process, never by enqueueing — the Redis queue is
 * shared with the deployed instance.
 */
@Processor('storage-purge')
export class StoragePurgeProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(StoragePurgeProcessor.name);

  constructor(
    private readonly recycleBin: RecycleBinService,
    private readonly sharePointAccess: SharePointAccessService,
    @InjectQueue('storage-purge') private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.add(PURGE_JOB, {}, { repeat: { every: STORAGE_PURGE_INTERVAL_MS }, jobId: 'storage-purge-repeat' });
    await this.queue.add(SHAREPOINT_PROBE_JOB, {}, { repeat: { every: SHAREPOINT_PROBE_INTERVAL_MS }, jobId: 'storage-sharepoint-probe-repeat' });
  }

  async process(job: Job): Promise<void> {
    if (job.name === SHAREPOINT_PROBE_JOB) {
      const { checked, withdrawn, unavailable } = await this.sharePointAccess.probeAll();
      this.logger.log(`SharePoint probe: ${checked} organisation(s) checked, ${withdrawn} withdrawn, ${unavailable} could not be checked.`);
      return;
    }

    // The daily job. Each half runs whatever the other did.
    let expiryError: Error | null = null;
    try {
      const { warned } = await this.sharePointAccess.warnExpiringSecrets();
      if (warned > 0) this.logger.log(`SharePoint secret expiry: ${warned} organisation(s) warned.`);
    } catch (error) {
      expiryError = error as Error;
      this.logger.error(`SharePoint secret-expiry warning failed: ${expiryError.message}`);
    }

    const { purged, failedOrganizations, deferredOrganizations } = await this.recycleBin.purgeExpired();
    if (deferredOrganizations.length > 0) {
      this.logger.warn(`Expired-file purge deferred for ${deferredOrganizations.length} organisation(s) whose SharePoint can't be reached; their files wait for the next run.`);
    }
    if (failedOrganizations.length > 0) {
      // Failed, so it shows as failed; every other organisation still ran.
      throw new Error(`Expired-file purge failed for ${failedOrganizations.length} organisation(s): ${failedOrganizations.join(', ')}. ${purged} file(s) purged elsewhere.`);
    }
    if (expiryError) throw expiryError;
    this.logger.log(`Expired-file purge: ${purged} file(s) purged.`);
  }
}
