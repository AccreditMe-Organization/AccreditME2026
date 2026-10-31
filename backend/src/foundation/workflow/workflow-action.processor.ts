import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { redactSecrets } from './webhook-config-secrets';

interface WebhookActionJobData {
  workflowTransitionActionId: string;
  workflowInstanceId: string;
  organizationId: string;
  payload: Record<string, unknown>;
}

// Consumes jobs enqueued by WorkflowService.fireTransitionActions() for every
// WEBHOOK-type WorkflowTransitionAction. Every attempt (success, retry, or
// final failure) writes its own WorkflowActionLog row — non-negotiable per
// CLAUDE.md ("Every webhook call logged in WorkflowActionLog").
@Processor('workflow-actions')
export class WorkflowActionProcessor extends WorkerHost {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<WebhookActionJobData>): Promise<void> {
    const { workflowTransitionActionId, workflowInstanceId, organizationId, payload } = job.data;

    const action = await this.prisma.workflowTransitionAction.findUnique({
      where: { id: workflowTransitionActionId },
    });
    if (!action) return; // action was removed since the job was enqueued — nothing to do

    const config = action.configJson as
      | { webhookUrl?: string; headers?: Record<string, string>; timeoutMs?: number }
      | null;

    if (!config?.webhookUrl) {
      await this.logAttempt(
        organizationId,
        workflowTransitionActionId,
        workflowInstanceId,
        job.attemptsMade + 1,
        'FAILED',
        undefined,
        'No webhookUrl configured for this action',
      );
      return;
    }

    try {
      const response = await fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(config.headers ?? {}) },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(config.timeoutMs ?? 10000),
      });

      const bodyText = await response.text();
      if (!response.ok) {
        throw new Error(`Webhook responded with status ${response.status}`);
      }

      await this.logAttempt(
        organizationId,
        workflowTransitionActionId,
        workflowInstanceId,
        job.attemptsMade + 1,
        'SUCCESS',
        // ACC-277 — an endpoint may echo a header back; no stored secret is logged.
        redactSecrets(bodyText, config).slice(0, 500),
      );
    } catch (err) {
      const totalAttempts = job.opts.attempts ?? 1;
      const isFinalAttempt = job.attemptsMade + 1 >= totalAttempts;
      // ACC-277 — fetch quotes a malformed header's value in its error.
      const errorMessage = redactSecrets(err instanceof Error ? err.message : 'Unknown error', config);

      await this.logAttempt(
        organizationId,
        workflowTransitionActionId,
        workflowInstanceId,
        job.attemptsMade + 1,
        isFinalAttempt ? 'FAILED' : 'RETRYING',
        undefined,
        errorMessage,
      );

      // Re-throw so BullMQ's own retry mechanism (attempts + backoff,
      // configured in QueueModule) handles the next attempt. ACC-277: as a new
      // error carrying the redacted message, because BullMQ keeps the thrown
      // error's message and stack with the job in Redis.
      throw new Error(errorMessage);
    }
  }

  private async logAttempt(
    organizationId: string,
    workflowTransitionActionId: string,
    workflowInstanceId: string,
    attemptCount: number,
    status: 'SUCCESS' | 'FAILED' | 'RETRYING',
    responseSummary?: string,
    errorMessage?: string,
  ): Promise<void> {
    await this.prisma.workflowActionLog.create({
      data: {
        organizationId,
        workflowTransitionActionId,
        workflowInstanceId,
        actionType: 'WEBHOOK',
        status,
        attemptCount,
        responseSummary: responseSummary ?? null,
        errorMessage: errorMessage ?? null,
      },
    });
  }
}
