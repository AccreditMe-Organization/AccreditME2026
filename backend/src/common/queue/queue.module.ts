import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

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
export class QueueModule {}
