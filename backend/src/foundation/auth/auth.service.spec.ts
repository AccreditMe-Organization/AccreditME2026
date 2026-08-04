import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { NotificationService } from '../notification/notification.service';
import { LoginAttemptService } from './login-attempt.service';

// Explicit factory — a bare jest.mock(path) auto-mock still requires Jest to
// load the real module first to infer its shape, which pulls in
// better-auth's own ESM-only (.mjs) package and fails Jest's CJS transform.
// The factory below means the real file is never executed at all.
const mockAuthApi = {
  signInEmail: jest.fn(),
  verifyTOTP: jest.fn(),
  signUpEmail: jest.fn(),
  requestPasswordReset: jest.fn(),
  resetPassword: jest.fn(),
  enableTwoFactor: jest.fn(),
  disableTwoFactor: jest.fn(),
};

jest.mock('../../providers/auth/better-auth.config', () => ({
  createBetterAuthInstance: jest.fn(() => ({ api: mockAuthApi })),
}));

// Same rationale/pattern as above — better-auth/api is also ESM-only and
// breaks Jest's transform if loaded for real (ACC-25 added
// AuthService.acceptInvitation()'s import of isAPIError from it). This mock
// isAPIError recognizes only MockAPIError instances, letting tests prove
// AuthService's real control flow (recognized -> BadRequestException with
// the real message; anything else -> rethrown unchanged) without the real
// better-auth/api module ever loading. isAPIError's own correctness is a
// better-auth library invariant, verified separately by reading its actual
// source — not re-tested here.
class MockAPIError extends Error {
  constructor(public body: { message?: string; code?: string }) {
    super(body.message);
    this.name = 'MockAPIError';
  }
}
jest.mock('better-auth/api', () => ({
  isAPIError: (err: unknown) => err instanceof MockAPIError,
}));

const ORG_A = 'org-a';
const ORG_B = 'org-b';

function fakeResponse(body: unknown, setCookies: string[] = []) {
  return {
    json: async () => body,
    headers: { getSetCookie: () => setCookies },
  };
}

function fakeExpressReq(overrides: Partial<{ cookies: Record<string, string>; headers: Record<string, string>; ip: string }> = {}) {
  return {
    cookies: overrides.cookies ?? {},
    headers: overrides.headers ?? {},
    ip: overrides.ip ?? '127.0.0.1',
  } as any;
}

function fakeExpressRes() {
  const res: any = {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    append: jest.fn(),
  };
  return res;
}

describe('AuthService', () => {
  let service: AuthService;
  let mockPrisma: any;
  let mockAuditLog: { log: jest.Mock };
  let mockNotification: { create: jest.Mock };
  let mockLoginAttemptService: { record: jest.Mock; isLocked: jest.Mock; isNewIp: jest.Mock };

  beforeEach(() => {
    process.env['JWT_SECRET'] = 'test-jwt-secret';
    jest.clearAllMocks();

    mockPrisma = {
      organization: { findUnique: jest.fn() },
      user: { findFirst: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
      authUser: { findUnique: jest.fn() },
      refreshToken: {
        create: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    mockAuditLog = { log: jest.fn() };
    mockNotification = { create: jest.fn() };
    mockLoginAttemptService = {
      record: jest.fn().mockResolvedValue(undefined),
      isLocked: jest.fn().mockResolvedValue(false),
      isNewIp: jest.fn().mockReturnValue(false),
    };

    service = new AuthService(
      mockPrisma as unknown as PrismaService,
      mockAuditLog as unknown as AuditLogService,
      mockNotification as unknown as NotificationService,
      mockLoginAttemptService as unknown as LoginAttemptService,
    );
  });

  describe('login', () => {
    it('completes login and sets cookies when credentials are valid and MFA is not required', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: ORG_A, slug: 'acme' });
      mockAuthApi.signInEmail.mockResolvedValue(
        fakeResponse({ user: { id: 'authuser-1' } }),
      );
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        organizationId: ORG_A,
        email: 'a@example.com',
        name: 'A User',
        status: 'ACTIVE',
        tokenVersion: 1,
      });

      const req = fakeExpressReq();
      const res = fakeExpressRes();

      const result = await service.login(
        { organizationSlug: 'acme', email: 'a@example.com', password: 'pw' },
        req,
        res,
      );

      expect(result).toEqual({
        success: true,
        user: { id: 'user-1', email: 'a@example.com', name: 'A User' },
        language: 'en',
      });
      expect(res.cookie).toHaveBeenCalledWith('access_token', expect.any(String), expect.any(Object));
      expect(res.cookie).toHaveBeenCalledWith('refresh_token', expect.any(String), expect.any(Object));
      expect(mockAuditLog.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'LOGIN' }));
    });

    it('returns mfaRequired and forwards the two-factor cookie without completing login', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: ORG_A, slug: 'acme' });
      mockAuthApi.signInEmail.mockResolvedValue(
        fakeResponse({ twoFactorRedirect: true }, ['ba_2fa=abc; Path=/']),
      );

      const req = fakeExpressReq();
      const res = fakeExpressRes();

      const result = await service.login(
        { organizationSlug: 'acme', email: 'a@example.com', password: 'pw' },
        req,
        res,
      );

      expect(result).toEqual({ mfaRequired: true });
      expect(res.append).toHaveBeenCalledWith('Set-Cookie', 'ba_2fa=abc; Path=/');
      expect(res.cookie).not.toHaveBeenCalled();
      expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when Better Auth rejects the credentials', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: ORG_A, slug: 'acme' });
      mockAuthApi.signInEmail.mockRejectedValue(new Error('INVALID_EMAIL_OR_PASSWORD'));

      await expect(
        service.login({ organizationSlug: 'acme', email: 'a@example.com', password: 'wrong' }, fakeExpressReq(), fakeExpressRes()),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when the organization slug does not resolve', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ organizationSlug: 'nope', email: 'a@example.com', password: 'pw' }, fakeExpressReq(), fakeExpressRes()),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockAuthApi.signInEmail).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when the resolved user is not ACTIVE', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: ORG_A, slug: 'acme' });
      mockAuthApi.signInEmail.mockResolvedValue(fakeResponse({ user: { id: 'authuser-1' } }));
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        organizationId: ORG_A,
        email: 'a@example.com',
        name: 'A User',
        status: 'SUSPENDED',
        tokenVersion: 1,
      });

      await expect(
        service.login({ organizationSlug: 'acme', email: 'a@example.com', password: 'pw' }, fakeExpressReq(), fakeExpressRes()),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should NOT complete login using a user resolved from a different tenant', async () => {
      // Even if a stale/corrupt authUserId lookup somehow matched a user in a
      // different org than the one the slug resolved to, the JWT must be
      // minted from that user's OWN organizationId — never the DTO's slug
      // blindly — so cross-tenant confusion can't silently grant access to
      // the wrong tenant's data.
      mockPrisma.organization.findUnique.mockResolvedValue({ id: ORG_A, slug: 'acme' });
      mockAuthApi.signInEmail.mockResolvedValue(fakeResponse({ user: { id: 'authuser-1' } }));
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        organizationId: ORG_B,
        email: 'a@example.com',
        name: 'A User',
        status: 'ACTIVE',
        tokenVersion: 1,
      });

      const req = fakeExpressReq();
      const res = fakeExpressRes();
      await service.login({ organizationSlug: 'acme', email: 'a@example.com', password: 'pw' }, req, res);

      expect(mockPrisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ organizationId: ORG_B }) }),
      );
    });

    it('rejects a locked account before calling Better Auth at all', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: ORG_A, slug: 'acme' });
      mockLoginAttemptService.isLocked.mockResolvedValue(true);

      await expect(
        service.login({ organizationSlug: 'acme', email: 'a@example.com', password: 'pw' }, fakeExpressReq(), fakeExpressRes()),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockAuthApi.signInEmail).not.toHaveBeenCalled();
      expect(mockLoginAttemptService.record).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, failureReason: 'locked' }),
      );
    });

    it('records a failed attempt when Better Auth rejects the credentials', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: ORG_A, slug: 'acme' });
      mockAuthApi.signInEmail.mockRejectedValue(new Error('INVALID_EMAIL_OR_PASSWORD'));

      await expect(
        service.login({ organizationSlug: 'acme', email: 'a@example.com', password: 'wrong' }, fakeExpressReq(), fakeExpressRes()),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockLoginAttemptService.record).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, failureReason: 'invalid_password' }),
      );
    });

    it('records a successful attempt on successful login', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: ORG_A, slug: 'acme' });
      mockAuthApi.signInEmail.mockResolvedValue(fakeResponse({ user: { id: 'authuser-1' } }));
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        organizationId: ORG_A,
        email: 'a@example.com',
        name: 'A User',
        status: 'ACTIVE',
        tokenVersion: 1,
        lastLoginIp: '9.9.9.9',
      });

      await service.login({ organizationSlug: 'acme', email: 'a@example.com', password: 'pw' }, fakeExpressReq(), fakeExpressRes());

      expect(mockLoginAttemptService.record).toHaveBeenCalledWith(
        expect.objectContaining({ success: true }),
      );
    });

    it('sends a new-IP email notification when isNewIp returns true', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: ORG_A, slug: 'acme' });
      mockAuthApi.signInEmail.mockResolvedValue(fakeResponse({ user: { id: 'authuser-1' } }));
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        organizationId: ORG_A,
        email: 'a@example.com',
        name: 'A User',
        status: 'ACTIVE',
        tokenVersion: 1,
        lastLoginIp: '9.9.9.9',
      });
      mockLoginAttemptService.isNewIp.mockReturnValue(true);

      await service.login({ organizationSlug: 'acme', email: 'a@example.com', password: 'pw' }, fakeExpressReq(), fakeExpressRes());

      expect(mockNotification.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', channel: 'EMAIL' }),
        ORG_A,
      );
    });

    it('does NOT send a new-IP email notification when isNewIp returns false', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: ORG_A, slug: 'acme' });
      mockAuthApi.signInEmail.mockResolvedValue(fakeResponse({ user: { id: 'authuser-1' } }));
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        organizationId: ORG_A,
        email: 'a@example.com',
        name: 'A User',
        status: 'ACTIVE',
        tokenVersion: 1,
        lastLoginIp: '127.0.0.1',
      });
      mockLoginAttemptService.isNewIp.mockReturnValue(false);

      await service.login({ organizationSlug: 'acme', email: 'a@example.com', password: 'pw' }, fakeExpressReq(), fakeExpressRes());

      expect(mockNotification.create).not.toHaveBeenCalled();
    });
  });

  describe('verifyMfa', () => {
    it('completes login on a valid TOTP code', async () => {
      mockAuthApi.verifyTOTP.mockResolvedValue(fakeResponse({ user: { id: 'authuser-1' } }));
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        organizationId: ORG_A,
        email: 'a@example.com',
        name: 'A User',
        status: 'ACTIVE',
        tokenVersion: 1,
      });

      const result = await service.verifyMfa({ code: '123456' }, fakeExpressReq(), fakeExpressRes());
      expect(result.success).toBe(true);
    });

    it('throws UnauthorizedException on an invalid or expired code', async () => {
      mockAuthApi.verifyTOTP.mockRejectedValue(new Error('invalid'));

      await expect(
        service.verifyMfa({ code: '000000' }, fakeExpressReq(), fakeExpressRes()),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refresh', () => {
    it('rotates the refresh token and issues a new access token', async () => {
      mockPrisma.refreshToken.findFirst.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        organizationId: ORG_A,
        status: 'ACTIVE',
        tokenVersion: 2,
      });

      const req = fakeExpressReq({ cookies: { refresh_token: 'raw-token-value' } });
      const res = fakeExpressRes();
      const result = await service.refresh(req, res);

      expect(result).toEqual({ success: true });
      expect(mockPrisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-1' },
        data: { revokedAt: expect.any(Date) },
      });
      expect(res.cookie).toHaveBeenCalledWith('access_token', expect.any(String), expect.any(Object));
    });

    it('throws UnauthorizedException when no refresh_token cookie is present', async () => {
      await expect(service.refresh(fakeExpressReq(), fakeExpressRes())).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for a revoked refresh token', async () => {
      mockPrisma.refreshToken.findFirst.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });

      const req = fakeExpressReq({ cookies: { refresh_token: 'raw-token-value' } });
      await expect(service.refresh(req, fakeExpressRes())).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for an expired refresh token', async () => {
      mockPrisma.refreshToken.findFirst.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1000),
      });

      const req = fakeExpressReq({ cookies: { refresh_token: 'raw-token-value' } });
      await expect(service.refresh(req, fakeExpressRes())).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('revokes the refresh token and clears both cookies', async () => {
      const req = fakeExpressReq({ cookies: { refresh_token: 'raw-token-value' } });
      const res = fakeExpressRes();

      const result = await service.logout(req, res);

      expect(result).toEqual({ success: true });
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { revokedAt: expect.any(Date) } }),
      );
      expect(res.clearCookie).toHaveBeenCalledWith('access_token', { path: '/' });
      expect(res.clearCookie).toHaveBeenCalledWith('refresh_token', { path: '/api/v1/auth/refresh' });
    });

    it('does not throw when no refresh_token cookie is present', async () => {
      await expect(service.logout(fakeExpressReq(), fakeExpressRes())).resolves.toEqual({ success: true });
    });
  });

  describe('acceptInvitation', () => {
    it('creates the AuthUser/AuthAccount and activates the user for a valid token', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        organizationId: ORG_A,
        email: 'a@example.com',
        name: 'A User',
        invitationToken: 'valid-token',
        invitationExpiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });
      mockAuthApi.signUpEmail.mockResolvedValue({ user: { id: 'authuser-1' } });

      await service.acceptInvitation({ token: 'valid-token', password: 'newpassword123' });

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          authUserId: 'authuser-1',
          status: 'ACTIVE',
          invitationToken: null,
          invitationExpiresAt: null,
        },
      });
    });

    it('throws BadRequestException for an unknown token', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.acceptInvitation({ token: 'nope', password: 'newpassword123' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for an expired invitation', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        organizationId: ORG_A,
        email: 'a@example.com',
        name: 'A User',
        invitationToken: 'expired-token',
        invitationExpiresAt: new Date(Date.now() - 1000),
      });

      await expect(
        service.acceptInvitation({ token: 'expired-token', password: 'newpassword123' }),
      ).rejects.toThrow(BadRequestException);
    });

    // ACC-25
    it('translates a genuine Better Auth APIError into a BadRequestException carrying the real message', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        organizationId: ORG_A,
        email: 'a@example.com',
        name: 'A User',
        invitationToken: 'valid-token',
        invitationExpiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });
      mockAuthApi.signUpEmail.mockRejectedValue(
        new MockAPIError({
          message: 'The password you entered has been compromised. Please choose a different password.',
          code: 'PASSWORD_COMPROMISED',
        }),
      );

      await expect(
        service.acceptInvitation({ token: 'valid-token', password: 'password123' }),
      ).rejects.toThrow(
        new BadRequestException(
          'The password you entered has been compromised. Please choose a different password.',
        ),
      );
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('does not convert a non-APIError failure — it still propagates unhandled', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        organizationId: ORG_A,
        email: 'a@example.com',
        name: 'A User',
        invitationToken: 'valid-token',
        invitationExpiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });
      const internalFailure = new Error('connection reset');
      mockAuthApi.signUpEmail.mockRejectedValue(internalFailure);

      await expect(
        service.acceptInvitation({ token: 'valid-token', password: 'password123' }),
      ).rejects.toThrow(internalFailure);
      await expect(
        service.acceptInvitation({ token: 'valid-token', password: 'password123' }),
      ).rejects.not.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('forgotPassword', () => {
    it('calls Better Auth requestPasswordReset with the namespaced email when the org resolves', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: ORG_A, slug: 'acme' });

      await service.forgotPassword({ organizationSlug: 'acme', email: 'a@example.com' });

      expect(mockAuthApi.requestPasswordReset).toHaveBeenCalledWith({
        body: { email: `a+${ORG_A}@example.com` },
      });
    });

    it('does not throw and does not call Better Auth when the org does not resolve', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);

      await expect(
        service.forgotPassword({ organizationSlug: 'nope', email: 'a@example.com' }),
      ).resolves.toBeUndefined();
      expect(mockAuthApi.requestPasswordReset).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('delegates to Better Auth resetPassword', async () => {
      await service.resetPassword({ token: 'tok', password: 'newpassword123' });

      expect(mockAuthApi.resetPassword).toHaveBeenCalledWith({
        body: { newPassword: 'newpassword123', token: 'tok' },
      });
    });
  });

  const appUserFixture = {
    id: 'user-1',
    organizationId: ORG_A,
    email: 'a@example.com',
    name: 'A User',
    authUserId: 'authuser-1',
  };

  describe('setupMfa', () => {
    it('re-authenticates, enables two-factor, and returns a QR code data URL + secret + backup codes', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(appUserFixture);
      mockAuthApi.signInEmail.mockResolvedValue(
        fakeResponse({ user: { id: 'authuser-1' } }, ['authSession.token=sess123; Path=/; HttpOnly']),
      );
      mockAuthApi.enableTwoFactor.mockResolvedValue({
        totpURI: 'otpauth://totp/AccreditMe:a%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=AccreditMe',
        backupCodes: ['code1', 'code2'],
      });

      const result = await service.setupMfa('user-1', ORG_A, { password: 'pw' });

      expect(result.secret).toBe('JBSWY3DPEHPK3PXP');
      expect(result.backupCodes).toEqual(['code1', 'code2']);
      expect(result.qrCodeDataUrl.startsWith('data:image/png;base64,')).toBe(true);
      expect(mockAuthApi.enableTwoFactor).toHaveBeenCalledWith({
        body: { password: 'pw' },
        headers: new Headers({ cookie: 'authSession.token=sess123' }),
      });
    });

    it('throws UnauthorizedException when the password is wrong', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(appUserFixture);
      mockAuthApi.signInEmail.mockRejectedValue(new Error('INVALID_EMAIL_OR_PASSWORD'));

      await expect(service.setupMfa('user-1', ORG_A, { password: 'wrong' })).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockAuthApi.enableTwoFactor).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when the user is not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(service.setupMfa('user-1', ORG_A, { password: 'pw' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws BadRequestException when Better Auth rejects enableTwoFactor', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(appUserFixture);
      mockAuthApi.signInEmail.mockResolvedValue(
        fakeResponse({ user: { id: 'authuser-1' } }, ['authSession.token=sess123; Path=/']),
      );
      mockAuthApi.enableTwoFactor.mockRejectedValue(new Error('boom'));

      await expect(service.setupMfa('user-1', ORG_A, { password: 'pw' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('verifySetupMfa', () => {
    async function runSetupMfa() {
      mockPrisma.user.findFirst.mockResolvedValue(appUserFixture);
      mockAuthApi.signInEmail.mockResolvedValue(
        fakeResponse({ user: { id: 'authuser-1' } }, ['authSession.token=sess123; Path=/']),
      );
      mockAuthApi.enableTwoFactor.mockResolvedValue({
        totpURI: 'otpauth://totp/AccreditMe:a%40example.com?secret=JBSWY3DPEHPK3PXP',
        backupCodes: ['code1'],
      });
      await service.setupMfa('user-1', ORG_A, { password: 'pw' });
    }

    it('verifies the code using the session bridged from setupMfa and logs the event', async () => {
      await runSetupMfa();
      mockAuthApi.verifyTOTP.mockResolvedValue({});

      await service.verifySetupMfa('user-1', ORG_A, { code: '123456' });

      expect(mockAuthApi.verifyTOTP).toHaveBeenCalledWith({
        body: { code: '123456' },
        headers: new Headers({ cookie: 'authSession.token=sess123' }),
      });
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { event: 'mfa_enabled' } }),
      );
    });

    it('throws BadRequestException when no setup session is pending', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(appUserFixture);

      await expect(service.verifySetupMfa('user-1', ORG_A, { code: '123456' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws UnauthorizedException on an invalid code', async () => {
      await runSetupMfa();
      mockAuthApi.verifyTOTP.mockRejectedValue(new Error('invalid'));

      await expect(service.verifySetupMfa('user-1', ORG_A, { code: '000000' })).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('disableMfa', () => {
    it('re-authenticates and calls Better Auth disableTwoFactor, then logs the event', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(appUserFixture);
      mockAuthApi.signInEmail.mockResolvedValue(
        fakeResponse({ user: { id: 'authuser-1' } }, ['authSession.token=sess456; Path=/']),
      );
      mockAuthApi.disableTwoFactor.mockResolvedValue({ status: true });

      await service.disableMfa('user-1', ORG_A, { password: 'pw' });

      expect(mockAuthApi.disableTwoFactor).toHaveBeenCalledWith({
        body: { password: 'pw' },
        headers: new Headers({ cookie: 'authSession.token=sess456' }),
      });
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { event: 'mfa_disabled' } }),
      );
    });

    it('throws UnauthorizedException when the password is wrong', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(appUserFixture);
      mockAuthApi.signInEmail.mockRejectedValue(new Error('INVALID_EMAIL_OR_PASSWORD'));

      await expect(service.disableMfa('user-1', ORG_A, { password: 'wrong' })).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockAuthApi.disableTwoFactor).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when Better Auth rejects disableTwoFactor', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(appUserFixture);
      mockAuthApi.signInEmail.mockResolvedValue(
        fakeResponse({ user: { id: 'authuser-1' } }, ['authSession.token=sess456; Path=/']),
      );
      mockAuthApi.disableTwoFactor.mockRejectedValue(new Error('boom'));

      await expect(service.disableMfa('user-1', ORG_A, { password: 'pw' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getMfaStatus', () => {
    it('returns enabled: true when the linked AuthUser has twoFactorEnabled set', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(appUserFixture);
      mockPrisma.authUser.findUnique.mockResolvedValue({ id: 'authuser-1', twoFactorEnabled: true });

      await expect(service.getMfaStatus('user-1', ORG_A)).resolves.toEqual({ enabled: true });
    });

    it('returns enabled: false when the user has no linked AuthUser', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ ...appUserFixture, authUserId: null });

      await expect(service.getMfaStatus('user-1', ORG_A)).resolves.toEqual({ enabled: false });
      expect(mockPrisma.authUser.findUnique).not.toHaveBeenCalled();
    });

    it('returns enabled: false when the user is not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(service.getMfaStatus('user-1', ORG_A)).resolves.toEqual({ enabled: false });
    });
  });

  describe('getPublicUserById', () => {
    it('returns the mapped public shape without any organizationId filter', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(appUserFixture);

      const result = await service.getPublicUserById('user-1');

      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({ where: { id: 'user-1' } });
      expect(result).toEqual({ id: appUserFixture.id, email: appUserFixture.email, name: appUserFixture.name });
    });

    it('returns null when the user does not exist', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      await expect(service.getPublicUserById('missing')).resolves.toBeNull();
    });
  });

  describe('resolveLanguage', () => {
    it("returns the user's own language without querying the organization", async () => {
      const result = await service.resolveLanguage('ar', ORG_A);
      expect(result).toBe('ar');
      expect(mockPrisma.organization.findUnique).not.toHaveBeenCalled();
    });

    it("falls back to the organization's language when the user has none set", async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ language: 'ar' });
      const result = await service.resolveLanguage(null, ORG_A);
      expect(result).toBe('ar');
      expect(mockPrisma.organization.findUnique).toHaveBeenCalledWith({
        where: { id: ORG_A },
        select: { language: true },
      });
    });

    it("falls back to 'en' when neither the user nor the organization has a language set", async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      const result = await service.resolveLanguage(null, ORG_A);
      expect(result).toBe('en');
    });
  });
});
