import { Test } from '@nestjs/testing';
import { TenantService } from './tenant.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { LookupService } from '../lookup/lookup.service';
import { RoleService } from '../roles/role.service';
import { WorkflowTemplateService } from '../workflow/workflow-template.service';
import { OrgPositionService } from '../org-position/org-position.service';
import { EMAIL_PROVIDERS, EmailProvider, writeEmailConfig } from './email-config';
import { EmailSettingsIncompleteException } from './email-settings-refusal';
import { UpdateEmailConfigDto } from './dto/update-email-config.dto';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';

// ACC-181 — a tenant's email settings keep their secrets write-only. Every
// secret value below is a distinctive string, so a leak anywhere in a response
// or an audit row is caught by a plain search.

const SECRET = (p: string) => `SECRET-VALUE-${p}-9f3c`;

/** A complete stored block per provider, with its secret filled. */
const COMPLETE: Record<EmailProvider, Record<string, string | number>> = {
  resend: { apiKey: SECRET('resend'), fromAddress: 'quality@example.test', fromName: 'Quality' },
  smtp: {
    host: 'mail.example.test',
    port: 587,
    encryption: 'STARTTLS',
    username: 'svc-accreditme',
    password: SECRET('smtp'),
    fromAddress: 'quality@example.test',
    fromName: 'Quality',
  },
  office365: {
    tenantId: '11111111-2222-3333-4444-555555555555',
    clientId: '66666666-7777-8888-9999-000000000000',
    clientSecret: SECRET('office365'),
    fromAddress: 'quality@example.test',
  },
  sendgrid: { apiKey: SECRET('sendgrid'), fromAddress: 'quality@example.test', fromName: 'Quality' },
  ses: {
    region: 'eu-central-1',
    accessKeyId: 'AKIAEXAMPLE000000000',
    secretAccessKey: SECRET('ses'),
    fromAddress: 'quality@example.test',
  },
};
const SECRET_FIELD: Record<EmailProvider, string> = {
  resend: 'apiKey',
  smtp: 'password',
  office365: 'clientSecret',
  sendgrid: 'apiKey',
  ses: 'secretAccessKey',
};
const SET_AT = '2026-09-29T08:00:00.000Z';

describe('TenantService email settings (ACC-181)', () => {
  let service: TenantService;
  let orgs: Record<string, { id: string; emailConfig: string | null }>;
  let prisma: { organization: { findUnique: jest.Mock; update: jest.Mock } };
  let auditLog: { log: jest.Mock };
  const savedSender = process.env['RESEND_FROM_EMAIL'];

  beforeEach(async () => {
    process.env['ENCRYPTION_KEY'] = 'a'.repeat(64);
    process.env['RESEND_FROM_EMAIL'] = 'no-reply@example.test';
    orgs = { 'org-a': { id: 'org-a', emailConfig: null }, 'org-b': { id: 'org-b', emailConfig: null } };
    prisma = {
      organization: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) => Promise.resolve(orgs[where.id] ?? null)),
        update: jest.fn(({ where, data }: { where: { id: string }; data: { emailConfig: string | null } }) => {
          orgs[where.id] = { ...orgs[where.id]!, emailConfig: data.emailConfig };
          return Promise.resolve(orgs[where.id]);
        }),
      },
    };
    auditLog = { log: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: auditLog },
        { provide: LookupService, useValue: {} },
        { provide: RoleService, useValue: {} },
        { provide: WorkflowTemplateService, useValue: {} },
        { provide: OrgPositionService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(TenantService);
  });

  afterAll(() => {
    if (savedSender === undefined) delete process.env['RESEND_FROM_EMAIL'];
    else process.env['RESEND_FROM_EMAIL'] = savedSender;
  });

  const store = (orgId: string, provider: EmailProvider, settings: Record<string, string | number>, setAt = SET_AT) => {
    const secretsSetAt: Record<string, string> = {};
    if (settings[SECRET_FIELD[provider]] !== undefined) secretsSetAt[SECRET_FIELD[provider]] = setAt;
    orgs[orgId]!.emailConfig = service.encryptConfig(writeEmailConfig({ provider, settings, secretsSetAt }));
  };
  /** What the service wrote, decrypted — what will be stored. */
  const written = (orgId = 'org-a'): Record<string, Record<string, unknown>> & { provider: EmailProvider } => {
    const enc = orgs[orgId]!.emailConfig;
    if (!enc) throw new Error('nothing stored');
    const decrypt = (service as unknown as { decryptConfig: (s: string) => string }).decryptConfig.bind(service);
    return JSON.parse(decrypt(enc)) as Record<string, Record<string, unknown>> & { provider: EmailProvider };
  };
  const patch = (body: Partial<UpdateEmailConfigDto> & { provider: EmailProvider }) =>
    service.updateEmailConfig('org-a', body as UpdateEmailConfigDto, 'admin-1');
  const smtpWithout = (field: string) => {
    const { [field]: _omit, ...rest } = COMPLETE.smtp;
    void _omit;
    return rest;
  };

  // 1 — the bug itself: GET never carries a secret.
  it.each(EMAIL_PROVIDERS)('GET (%s, secret stored): no secret value in the response; the secret reads "set"', async (provider) => {
    store('org-a', provider, COMPLETE[provider]);
    const res = await service.getEmailConfig('org-a');
    expect(JSON.stringify(res)).not.toContain('SECRET-VALUE');
    expect(res.provider).toBe(provider);
    expect(res.settings?.[SECRET_FIELD[provider]]).toBe('set');
    expect(res.secretsSetAt[SECRET_FIELD[provider]]).toBe(SET_AT);
  });

  // 2
  it('GET: a secret that is not set reads null, with no date', async () => {
    store('org-a', 'smtp', smtpWithout('password'));
    const res = await service.getEmailConfig('org-a');
    expect(res.settings?.['password']).toBeNull();
    expect(res.secretsSetAt['password']).toBeNull();
    expect(res.settings?.['host']).toBe('mail.example.test');
  });

  it('GET with nothing stored: no provider, no settings', async () => {
    expect(await service.getEmailConfig('org-a')).toEqual({
      provider: null,
      settings: null,
      secretsSetAt: {},
      defaultSender: 'no-reply@example.test',
    });
  });

  it('GET with a legacy { emailProvider, config } blob: the provider only, every secret unset', async () => {
    orgs['org-a']!.emailConfig = service.encryptConfig({ emailProvider: 'smtp', config: { password: SECRET('legacy') } });
    const res = await service.getEmailConfig('org-a');
    expect(res.provider).toBe('smtp');
    expect(res.settings?.['password']).toBeNull();
    expect(JSON.stringify(res)).not.toContain('SECRET-VALUE');
  });

  // 3
  it('PATCH without the secret keeps the stored one', async () => {
    store('org-a', 'smtp', COMPLETE.smtp);
    await patch({ provider: 'smtp', smtp: { ...smtpWithout('password'), host: 'smtp2.example.test' } });
    expect(written()['smtp']).toMatchObject({ host: 'smtp2.example.test', password: SECRET('smtp') });
  });

  // 4
  it('PATCH with the secret sent empty keeps it too', async () => {
    store('org-a', 'smtp', COMPLETE.smtp);
    await patch({ provider: 'smtp', smtp: { ...smtpWithout('password'), password: '' } });
    expect(written()['smtp']?.['password']).toBe(SECRET('smtp'));
  });

  // 5
  it('a replaced secret gets a new set date; an untouched one keeps its date', async () => {
    store('org-a', 'resend', COMPLETE.resend);
    await patch({ provider: 'resend', resend: { fromAddress: 'quality@example.test' } });
    expect(written()['secretsSetAt']).toEqual({ apiKey: SET_AT });

    await patch({ provider: 'resend', resend: { apiKey: 'NEW-KEY-value', fromAddress: 'quality@example.test' } });
    const stamped = (written()['secretsSetAt'] as Record<string, string>)['apiKey']!;
    expect(stamped).not.toBe(SET_AT);
    expect(Date.parse(stamped)).toBeGreaterThan(Date.parse(SET_AT));
    expect(written()['resend']?.['apiKey']).toBe('NEW-KEY-value');
  });

  // 6
  it('a provider switch never carries the old secret — even one with the same field name', async () => {
    store('org-a', 'resend', COMPLETE.resend);
    await expect(patch({ provider: 'sendgrid', sendgrid: { fromAddress: 'quality@example.test' } })).rejects.toMatchObject({
      missing: ['apiKey'],
    });
    // The refused save wrote nothing.
    expect(written()['provider']).toBe('resend');
  });

  it('a provider switch keeps only the new provider\'s block', async () => {
    store('org-a', 'smtp', COMPLETE.smtp);
    await patch({ provider: 'sendgrid', sendgrid: { apiKey: 'SG-new-key', fromAddress: 'quality@example.test' } });
    const w = written();
    expect(w.provider).toBe('sendgrid');
    expect(w['smtp']).toBeUndefined();
    expect(JSON.stringify(w)).not.toContain(SECRET('smtp'));
  });

  // 7
  it('incomplete settings: 400 EMAIL_SETTINGS_INCOMPLETE naming the missing fields', async () => {
    const err = await patch({ provider: 'smtp', smtp: { port: 587, encryption: 'STARTTLS' } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmailSettingsIncompleteException);
    const body = (err as EmailSettingsIncompleteException).getResponse() as Record<string, unknown>;
    expect(body).toMatchObject({ statusCode: 400, code: 'EMAIL_SETTINGS_INCOMPLETE' });
    expect(body['missing']).toEqual(['host', 'fromAddress']);
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  // 8
  it('the audit holds the provider and the changed field NAMES — no secret, no value', async () => {
    store('org-a', 'smtp', COMPLETE.smtp);
    await patch({ provider: 'smtp', smtp: { ...COMPLETE.smtp, password: 'REPLACED-SECRET-value', host: 'smtp3.example.test' } });
    const row = JSON.stringify(auditLog.log.mock.calls);
    expect(row).not.toContain('REPLACED-SECRET-value');
    expect(row).not.toContain('SECRET-VALUE');
    expect(row).not.toContain('smtp3.example.test');
    expect(auditLog.log).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'org-a',
        metadata: expect.objectContaining({
          event: 'email_config_updated',
          provider: 'smtp',
          changedFields: expect.arrayContaining(['smtp.password', 'smtp.host']),
        }),
      }),
    );
  });

  // 9
  it('Disconnect nulls the config and is audited', async () => {
    store('org-a', 'smtp', COMPLETE.smtp);
    const res = await service.disconnectEmailConfig('org-a', 'admin-1');
    expect(orgs['org-a']!.emailConfig).toBeNull();
    expect(res.provider).toBeNull();
    expect(auditLog.log).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { event: 'email_config_disconnected', previousProvider: 'smtp' },
      }),
    );
  });

  it('Disconnect with nothing connected writes nothing and audits nothing', async () => {
    await service.disconnectEmailConfig('org-a', 'admin-1');
    expect(prisma.organization.update).not.toHaveBeenCalled();
    expect(auditLog.log).not.toHaveBeenCalled();
  });

  // 11 — D5
  it('SMTP username without a password is refused, naming the password', async () => {
    await expect(patch({ provider: 'smtp', smtp: smtpWithout('password') })).rejects.toMatchObject({ missing: ['password'] });
  });

  it('SMTP password without a username is refused, naming the username', async () => {
    await expect(patch({ provider: 'smtp', smtp: smtpWithout('username') })).rejects.toMatchObject({ missing: ['username'] });
  });

  it('SMTP with neither username nor password is accepted', async () => {
    const { username: _u, password: _p, ...anon } = COMPLETE.smtp;
    void _u;
    void _p;
    await patch({ provider: 'smtp', smtp: anon });
    expect(written()['smtp']).toEqual(anon);
  });

  it('an ordinary field sent empty is cleared, not kept (the sender name)', async () => {
    store('org-a', 'resend', COMPLETE.resend);
    await patch({ provider: 'resend', resend: { fromAddress: 'quality@example.test', fromName: '' } });
    expect(written()['resend']).toEqual({ apiKey: SECRET('resend'), fromAddress: 'quality@example.test' });
  });

  // 13
  itEnforcesTenantIsolation('email settings are read and written for the caller organisation only', async () => {
    store('org-b', 'smtp', COMPLETE.smtp);
    const a = await service.getEmailConfig('org-a');
    expect(a.provider).toBeNull();

    await patch({ provider: 'resend', resend: { apiKey: 'A-key', fromAddress: 'a@example.test' } });
    expect(prisma.organization.update).toHaveBeenCalledTimes(1);
    expect(prisma.organization.update.mock.calls[0]![0].where).toEqual({ id: 'org-a' });
    expect(written('org-b').provider).toBe('smtp');
    expect(written('org-b')['smtp']?.['password']).toBe(SECRET('smtp'));
  });

  // 14 — D7
  it('defaultSender is RESEND_FROM_EMAIL, or null when unset — never a guessed address', async () => {
    expect((await service.getEmailConfig('org-a')).defaultSender).toBe('no-reply@example.test');
    delete process.env['RESEND_FROM_EMAIL'];
    const res = await service.getEmailConfig('org-a');
    expect(res.defaultSender).toBeNull();
    expect(JSON.stringify(res)).not.toMatch(/accreditme\.com/);
  });
});
