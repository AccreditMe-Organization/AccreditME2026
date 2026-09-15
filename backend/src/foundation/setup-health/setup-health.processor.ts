import { Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { SetupConditionReconciler } from './setup-condition.reconciler';

export const SETUP_HEALTH_INTERVAL_MS = 60 * 60 * 1000;

// ACC-82 — SYSTEM-REFERENCE §13.5. Runs the Setup health reconciler hourly for
// every tenant.
//
// Hourly, not on write: the conditions are derived from state that many writers
// change (units, positions, users, roles, stages, tasks), and hooking each of
// them is the on-write failure mode §13.5 rejects. Two of the detectors also
// read flags SlaMonitorProcessor refreshes every 15 minutes, so reconciling more
// often than that would not make them fresher.
//
// Its own queue rather than a step inside SlaMonitorProcessor: the reconciler is
// the only writer of SetupCondition, and keeping it out of the SLA sweep means
// neither can take the other down (ACC-48).
@Processor('setup-health')
export class SetupHealthProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(SetupHealthProcessor.name);

  constructor(
    private readonly reconciler: SetupConditionReconciler,
    @InjectQueue('setup-health') private readonly setupHealthQueue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    // Fixed jobId makes this idempotent across restarts and redeploys, the same
    // as sla-monitor-repeat.
    await this.setupHealthQueue.add(
      'reconcile-setup-conditions',
      {},
      {
        repeat: { every: SETUP_HEALTH_INTERVAL_MS },
        jobId: 'setup-health-repeat',
      },
    );
  }

  // Each (tenant, type) pair is isolated inside the reconciler, and a failed
  // pair is already recorded on SetupConditionRun, which is what the page reads.
  // The job still FAILS when any pair failed, for the same reason as ACC-49: a
  // job reporting success while part of it is broken is a blind spot.
  async process(_job: Job): Promise<void> {
    const { tenants, failed } = await this.reconciler.reconcileAll();

    if (failed.length > 0) {
      throw new Error(
        `Setup health reconciliation completed with ${failed.length} failed tenant/type pair(s) across ${tenants} tenant(s): ` +
          failed.map((f) => `${f.organizationId}:${f.type}`).join(', ') +
          '. Every other pair still ran, and the failed pairs kept their open conditions.',
      );
    }

    this.logger.log(`Setup health reconciled for ${tenants} tenant(s).`);
  }
}
