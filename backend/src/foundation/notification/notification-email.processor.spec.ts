import { Job } from 'bullmq';
import { NotificationEmailProcessor } from './notification-email.processor';
import { TransactionalEmailService } from './transactional-email.service';
import { PrismaService } from '../../prisma/prisma.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { PLATFORM_SENDER_MISSING } from '../../common/config/email-sender.config';

// The processor constructs its Resend client in a field initializer, so the
// module is mocked rather than the instance. `mockSend` is hoisted with it.
interface SentEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
}
const mockSend = jest.fn<Promise<unknown>, [SentEmail]>();
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockSend } })),
}));

/**
 * ACC-158 — what the email-delivery worker actually hands Resend.
 *
 * The prisma mock is a small in-memory table that honours BOTH the id and the
 * organizationId in a where clause, so the tenant-isolation test exercises the
 * processor's real query rather than a mock told what to return.
 */
const ORG_A = 'org-a';
const ORG_B = 'org-b';
const INVITE =
  'https://al-nakheel.accreditme.app/accept-invitation?token=0123abcd';

interface Where {
  id?: string;
  organizationId?: string;
}

interface Row {
  id: string;
  organizationId: string;
  titleEn: string;
  titleAr: string | null;
  bodyEn: string;
  bodyAr: string | null;
  user: { email: string; language: string };
}

describe('NotificationEmailProcessor (ACC-158)', () => {
  const savedEnv = {
    APP_BASE_DOMAIN: process.env['APP_BASE_DOMAIN'],
    APP_LINK_ORIGIN: process.env['APP_LINK_ORIGIN'],
    RESEND_FROM_EMAIL: process.env['RESEND_FROM_EMAIL'],
  };
  beforeAll(() => {
    process.env['APP_BASE_DOMAIN'] = 'accreditme.app';
    delete process.env['APP_LINK_ORIGIN'];
    process.env['RESEND_FROM_EMAIL'] = 'noreply@accreditme.app';
  });
  afterAll(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  let row: Row;
  let rows: Row[];
  let prisma: {
    notification: { findFirst: jest.Mock; updateMany: jest.Mock };
  };
  let processor: NotificationEmailProcessor;

  // Filters on exactly the keys the where clause names, as Prisma does — so a
  // read that omits organizationId really does find another tenant's row, and
  // the isolation test below fails on BEHAVIOUR (an email sent), not only on
  // the shape of the query.
  const matches = (candidate: Row, where: Where): boolean =>
    (where.id === undefined || candidate.id === where.id) &&
    (where.organizationId === undefined ||
      candidate.organizationId === where.organizationId);

  beforeEach(() => {
    mockSend
      .mockReset()
      .mockResolvedValue({ data: { id: 'email-1' }, error: null });
    row = {
      id: 'n-1',
      organizationId: ORG_A,
      titleEn: 'You have been invited',
      titleAr: 'تمت دعوتك',
      bodyEn: `Accept your invitation: ${INVITE}`,
      bodyAr: `اقبل الدعوة: ${INVITE}`,
      user: { email: 'invitee@example.com', language: 'en' },
    };
    rows = [row];
    prisma = {
      notification: {
        findFirst: jest.fn(({ where }: { where: Where }) =>
          Promise.resolve(rows.find((r) => matches(r, where)) ?? null),
        ),
        updateMany: jest.fn(({ where }: { where: Where }) =>
          Promise.resolve({
            count: rows.filter((r) => matches(r, where)).length,
          }),
        ),
      },
    };
    processor = new NotificationEmailProcessor(
      prisma as unknown as PrismaService,
      new TransactionalEmailService(),
    );
  });

  const run = (notificationId: string, organizationId: string): Promise<void> =>
    processor.process({ data: { notificationId, organizationId } } as Job<{
      notificationId: string;
      organizationId: string;
    }>);

  const sentEmail = (): SentEmail => {
    expect(mockSend).toHaveBeenCalledTimes(1);
    const [email] = mockSend.mock.calls[0] ?? [];
    if (!email) throw new Error('no email was sent');
    return email;
  };
  const sentHtml = (): string => sentEmail().html;

  it('sends the invitation link as an anchor to the tenant host, in an English paragraph', async () => {
    await run('n-1', ORG_A);
    expect(sentHtml()).toBe(
      `<p>Accept your invitation: <a href="${INVITE}" dir="ltr">${INVITE}</a></p>`,
    );
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'n-1', organizationId: ORG_A } }),
    );
  });

  describe('an Arabic recipient', () => {
    beforeEach(() => {
      row.user.language = 'ar';
    });

    it('gets the Arabic body in a right-to-left paragraph', async () => {
      await run('n-1', ORG_A);
      const html = sentHtml();
      expect(html.startsWith('<p dir="rtl">اقبل الدعوة: ')).toBe(true);
      expect(sentEmail()).toEqual(
        expect.objectContaining({ subject: 'تمت دعوتك' }),
      );
    });

    it('gets the link as a left-to-right anchor inside that paragraph', async () => {
      await run('n-1', ORG_A);
      expect(sentHtml()).toContain(
        `<a href="${INVITE}" dir="ltr">${INVITE}</a>`,
      );
    });

    it('falls back to the English body, as an English paragraph, when there is no Arabic one', async () => {
      row.bodyAr = null;
      await run('n-1', ORG_A);
      expect(sentHtml().startsWith('<p>Accept your invitation: ')).toBe(true);
    });
  });

  it('escapes markup that arrived in the body from tenant data', async () => {
    row.bodyEn = `Join <img src=x onerror=alert(1)> & Co: ${INVITE}`;
    await run('n-1', ORG_A);
    const html = sentHtml();
    expect(html).toContain(
      'Join &lt;img src=x onerror=alert(1)&gt; &amp; Co: ',
    );
    expect(html).not.toContain('<img');
  });

  // The job names a notification of ORG_A but claims ORG_B. Before ACC-158 the
  // read was by id alone, so this sent ORG_A's email.
  itEnforcesTenantIsolation('NotificationEmailProcessor.process', async () => {
    await run('n-1', ORG_B);
    // Behaviour first: no email left the building, and nothing was stamped.
    expect(mockSend).not.toHaveBeenCalled();
    expect(prisma.notification.updateMany).not.toHaveBeenCalled();
    expect(prisma.notification.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'n-1', organizationId: ORG_B } }),
    );
  });

  // ACC-130 — the sender is RESEND_FROM_EMAIL and nothing else.
  it('sends from RESEND_FROM_EMAIL', async () => {
    await run('n-1', ORG_A);
    expect(sentEmail().from).toBe('noreply@accreditme.app');
  });

  it('refuses to send without RESEND_FROM_EMAIL, rather than guess a sender, and does not stamp sentAt', async () => {
    delete process.env['RESEND_FROM_EMAIL'];
    try {
      await expect(run('n-1', ORG_A)).rejects.toThrow(PLATFORM_SENDER_MISSING);
      expect(mockSend).not.toHaveBeenCalled();
      expect(prisma.notification.updateMany).not.toHaveBeenCalled();
    } finally {
      process.env['RESEND_FROM_EMAIL'] = 'noreply@accreditme.app';
    }
  });

  it('rethrows a Resend API error so BullMQ retries, and does not stamp sentAt', async () => {
    mockSend.mockResolvedValue({
      data: null,
      error: { message: 'domain not verified' },
    });
    await expect(run('n-1', ORG_A)).rejects.toThrow(
      'Resend delivery failed: domain not verified',
    );
    expect(prisma.notification.updateMany).not.toHaveBeenCalled();
  });

  // ACC-188 — a security notice: an email only, read from the person and the
  // organisation, never from a Notification row.
  describe('a security notice', () => {
    interface PersonRow {
      id: string;
      organizationId: string;
      email: string;
      language: string | null;
      organization: { name: string; nameAr: string | null; language: string };
    }
    let people: PersonRow[];
    const notice = (userId: string, organizationId: string): Promise<void> =>
      processor.process({
        name: 'security-notice',
        data: { organizationId, userId, notice: 'password_changed' },
      } as Job<never>);

    beforeEach(() => {
      people = [
        { id: 'u-a', organizationId: ORG_A, email: 'hessa@example.test', language: null, organization: { name: 'Al Nakheel', nameAr: 'مستشفى النخيل', language: 'ar' } },
        { id: 'u-en', organizationId: ORG_A, email: 'sam@example.test', language: 'en', organization: { name: 'Al Nakheel', nameAr: 'مستشفى النخيل', language: 'ar' } },
      ];
      (prisma as unknown as { user: unknown }).user = {
        findFirst: jest.fn(({ where }: { where: { id: string; organizationId: string } }) =>
          Promise.resolve(people.find((p) => p.id === where.id && p.organizationId === where.organizationId) ?? null),
        ),
      };
    });

    it("is written in the organisation's language when the person has none, and never touches a notification", async () => {
      await notice('u-a', ORG_A);
      const email = sentEmail();
      expect(email.to).toBe('hessa@example.test');
      expect(email.subject).toBe('تم تغيير كلمة مرور AccreditMe');
      expect(email.html).toContain('dir="rtl"');
      expect(email.html).toContain('منشأة مستشفى النخيل');
      expect(prisma.notification.findFirst).not.toHaveBeenCalled();
      expect(prisma.notification.updateMany).not.toHaveBeenCalled();
    });

    it("is written in the person's own language first", async () => {
      await notice('u-en', ORG_A);
      expect(sentEmail().subject).toBe('Your AccreditMe password was changed');
    });

    itEnforcesTenantIsolation('NotificationEmailProcessor security notice', async () => {
      await notice('u-a', ORG_B);
      expect(mockSend).not.toHaveBeenCalled();
    });
  });
});
