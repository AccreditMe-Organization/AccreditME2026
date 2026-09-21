import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { logWorkerRegistration } from './workers.config';

// First activation of BullMQ in the codebase — bullmq/@nestjs/bullmq have
// been in package.json since scaffold but BullModule was never registered.
@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: {
          url: process.env['REDIS_URL'] || 'redis://localhost:6379',
        },
      }),
    }),
    BullModule.registerQueue({
      name: 'workflow-actions',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    }),
    BullModule.registerQueue({ name: 'sla-monitor' }),
    // ACC-82 — hourly Setup health reconciliation. No defaultJobOptions, like
    // sla-monitor: a failed run does not retry, it stays visible in the failed
    // list and the next hourly run tries again.
    BullModule.registerQueue({ name: 'setup-health' }),
    BullModule.registerQueue({
      name: 'email-delivery',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    }),
  ],
  exports: [BullModule],
})
export class QueueModule implements OnModuleInit {
  private readonly logger = new Logger('Queue');

  // ACC-92 — lives here rather than in main.ts so it also fires under
  // createApplicationContext(), which is how queue-driven behaviour is
  // verified locally. A verification run should state which side of this
  // gate it is on, not leave it to be inferred.
  onModuleInit(): void {
    logWorkerRegistration(this.logger);
  }
}
