import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { COMMITTEE_TRANSFER_NOTICE_QUEUE, CommitteeTransferNoticeService, type TransferNoticeJob } from './committee-transfer-notice.service';

/**
 * ACC-297 — runs the delayed notice two minutes after a transfer, so the seats
 * the Transfer wizard removes right after it are told as removed.
 *
 * Registered only behind workersEnabled() (ACC-92; `check:worker-gate`). Verify
 * it locally by calling CommitteeTransferNoticeService.run() in-process, never by
 * enqueueing: the Redis queue is shared with the deployed instance.
 */
@Processor(COMMITTEE_TRANSFER_NOTICE_QUEUE)
export class CommitteeTransferNoticeProcessor extends WorkerHost {
  private readonly logger = new Logger(CommitteeTransferNoticeProcessor.name);

  constructor(private readonly notices: CommitteeTransferNoticeService) {
    super();
  }

  async process(job: Job<TransferNoticeJob>): Promise<void> {
    const sent = await this.notices.run(job.data);
    // Ids only: the notice's text names a person.
    this.logger.log(`Committee transfer notice: ${sent} sent (organisation ${job.data.organizationId}, user ${job.data.userId}).`);
  }
}
