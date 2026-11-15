import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  PASSWORD_RESET_QUEUE,
  PasswordResetJobData,
  PasswordResetService,
} from './password-reset.service';

/**
 * ACC-188 — issues a reset link: looks the account up, makes the link, emails
 * it. Its own queue, because it does more than send an email (lane B).
 *
 * Registered only behind workersEnabled() (ACC-92). NEVER enqueue to verify it
 * locally: Redis is shared, so the deployed worker would take the job and email
 * a real link. Call PasswordResetService.issue() in-process instead.
 */
@Processor(PASSWORD_RESET_QUEUE)
export class PasswordResetProcessor extends WorkerHost {
  constructor(private readonly passwordReset: PasswordResetService) {
    super();
  }

  async process(job: Job<PasswordResetJobData>): Promise<void> {
    await this.passwordReset.issue(job.data);
  }
}
