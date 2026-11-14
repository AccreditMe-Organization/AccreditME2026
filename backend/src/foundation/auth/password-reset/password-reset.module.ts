import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { QueueModule } from '../../../common/queue/queue.module';
import { workersEnabled } from '../../../common/queue/workers.config';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { TransactionalEmailService } from '../../notification/transactional-email.service';
import { SecurityNoticeService } from '../../notification/security-notice';
import { PasswordBreachCheckService } from './password-breach-check.service';
import { PasswordResetService } from './password-reset.service';
import { PasswordResetProcessor } from './password-reset.processor';

/**
 * ACC-188 — password reset, in a module of its own so it imports nothing back:
 * only PrismaModule and QueueModule, and it provides its own stateless email,
 * notice and audit services (ACC-297's shape). It never imports Better Auth;
 * AuthService, which owns the Better Auth instance, hands reset() the one call
 * it needs. So the worker-registration spec can load this module.
 *
 * The processor consumes the shared queue, so it is registered only where
 * workers run (ACC-92).
 */
@Module({
  imports: [PrismaModule, QueueModule],
  providers: [
    PasswordResetService,
    PasswordBreachCheckService,
    TransactionalEmailService,
    SecurityNoticeService,
    AuditLogService,
    ...(workersEnabled() ? [PasswordResetProcessor] : []),
  ],
  exports: [PasswordResetService],
})
export class PasswordResetModule {}
