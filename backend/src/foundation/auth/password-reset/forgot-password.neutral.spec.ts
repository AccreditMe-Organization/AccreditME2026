import { ValidationPipe } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { NotificationService } from '../../notification/notification.service';
import { TransactionalEmailService } from '../../notification/transactional-email.service';
import { SecurityNoticeService } from '../../notification/security-notice';
import { UserService } from '../../user/user.service';
import { WorkingCalendarService } from '../../working-calendar/working-calendar.service';
import { AuthController } from '../auth.controller';
import { AuthService } from '../auth.service';
import { LoginAttemptService } from '../login-attempt.service';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { PasswordBreachCheckService } from './password-breach-check.service';
import { PasswordResetService } from './password-reset.service';

jest.mock('better-auth/api', () => ({ isAPIError: () => false }));
jest.mock('../../../providers/auth/better-auth.config', () => ({
  createBetterAuthInstance: jest.fn(() => ({ api: { requestPasswordReset: jest.fn() } })),
}));

/**
 * ACC-188 — Forgot password answers IDENTICALLY for every address.
 *
 * Through the real controller, the real ValidationPipe, the real AuthService
 * and the real PasswordResetService. The database is a trap: ANY read in the
 * request throws, so "nothing about the account is looked up in the request"
 * is enforced, not assumed. Each case must give the same status, the same body
 * and the same sequence of calls — one queue add, nothing else. That sequence
 * is the timing shape, made checkable.
 */
describe('Forgot password is neutral (ACC-188)', () => {
  const trap = new Proxy(
    {},
    {
      get(_target, model) {
        throw new Error(`the request read the database (${String(model)})`);
      },
    },
  ) as PrismaService;

  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

  async function answer(body: Record<string, unknown>): Promise<{ result: unknown; calls: unknown[] }> {
    const queue = { add: jest.fn().mockResolvedValue({}) };
    const passwordReset = new PasswordResetService(
      trap,
      queue as never,
      {} as TransactionalEmailService,
      {} as SecurityNoticeService,
      {} as AuditLogService,
      {} as PasswordBreachCheckService,
    );
    const auth = new AuthService(
      trap,
      {} as AuditLogService,
      {} as NotificationService,
      {} as LoginAttemptService,
      {} as UserService,
      passwordReset,
    );
    const controller = new AuthController(auth, {} as UserService, {} as WorkingCalendarService);
    const dto = (await pipe.transform(body, { type: 'body', metatype: ForgotPasswordDto })) as ForgotPasswordDto;
    const result = await controller.forgotPassword(dto);
    return { result, calls: queue.add.mock.calls.map(([name, , opts]: unknown[]) => [name, opts]) };
  }

  it('gives a real address, an unknown address, an unknown organisation and a mixed-case address the same answer and the same work', async () => {
    const answers = await Promise.all([
      answer({ organizationSlug: 'al-nakheel', email: 'hessa@example.test' }),
      answer({ organizationSlug: 'al-nakheel', email: 'nobody@example.test' }),
      answer({ organizationSlug: 'no-such-place', email: 'hessa@example.test' }),
      answer({ organizationSlug: 'al-nakheel', email: '  Hessa@Example.TEST ' }),
    ]);
    for (const a of answers) {
      expect(a.result).toBeUndefined(); // the controller's 200 with no body
      expect(a.calls).toEqual(answers[0].calls);
      expect(a.calls).toHaveLength(1);
    }
  });

  it('still answers the same when the queue is down', async () => {
    const queue = { add: jest.fn().mockRejectedValue(new Error('down')) };
    const passwordReset = new PasswordResetService(
      trap,
      queue as never,
      {} as TransactionalEmailService,
      {} as SecurityNoticeService,
      {} as AuditLogService,
      {} as PasswordBreachCheckService,
    );
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(passwordReset.request({ organizationSlug: 'al-nakheel', email: 'a@b.test' })).resolves.toBeUndefined();
    errorSpy.mockRestore();
  });
});
