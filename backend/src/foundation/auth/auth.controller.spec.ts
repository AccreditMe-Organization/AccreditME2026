import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';
import { TenantGuard } from '../../common/guards/tenant.guard';

// AuthController imports the real AuthService module for its DI token even
// though useValue below swaps the implementation — that real file's own
// top-level import of better-auth.config would otherwise pull in
// better-auth's ESM-only package and fail Jest's CJS transform.
jest.mock('../../providers/auth/better-auth.config', () => ({
  createBetterAuthInstance: jest.fn(() => ({ api: {} })),
}));

describe('AuthController', () => {
  let controller: AuthController;
  let service: {
    login: jest.Mock;
    verifyMfa: jest.Mock;
    refresh: jest.Mock;
    logout: jest.Mock;
    acceptInvitation: jest.Mock;
    forgotPassword: jest.Mock;
    resetPassword: jest.Mock;
    setupMfa: jest.Mock;
    verifySetupMfa: jest.Mock;
    disableMfa: jest.Mock;
    getMfaStatus: jest.Mock;
    getPublicUserById: jest.Mock;
  };
  let userService: { getById: jest.Mock };

  const req = {} as any;
  const res = {} as any;

  beforeEach(async () => {
    service = {
      login: jest.fn().mockResolvedValue({ success: true, user: {} }),
      verifyMfa: jest.fn().mockResolvedValue({ success: true, user: {} }),
      refresh: jest.fn().mockResolvedValue({ success: true }),
      logout: jest.fn().mockResolvedValue({ success: true }),
      acceptInvitation: jest.fn().mockResolvedValue(undefined),
      forgotPassword: jest.fn().mockResolvedValue(undefined),
      resetPassword: jest.fn().mockResolvedValue(undefined),
      setupMfa: jest.fn().mockResolvedValue({ qrCodeDataUrl: 'data:image/png;base64,x', secret: 'SECRET', backupCodes: ['a1b2'] }),
      verifySetupMfa: jest.fn().mockResolvedValue(undefined),
      disableMfa: jest.fn().mockResolvedValue(undefined),
      getMfaStatus: jest.fn().mockResolvedValue({ enabled: false }),
      getPublicUserById: jest.fn().mockResolvedValue(null),
    };
    userService = {
      getById: jest.fn().mockResolvedValue({ id: 'user-1', email: 'a@example.com', name: 'A User' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: service },
        { provide: UserService, useValue: userService },
      ],
    })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('getMe returns the current user via UserService.getById, with impersonatedBy: null on a normal session', async () => {
    const result = await controller.getMe('user-1', 'org-1', undefined);
    expect(userService.getById).toHaveBeenCalledWith('user-1', 'org-1');
    expect(service.getPublicUserById).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'user-1', email: 'a@example.com', name: 'A User', impersonatedBy: null });
  });

  it('getMe resolves impersonatedBy via AuthService.getPublicUserById when the session is impersonated', async () => {
    service.getPublicUserById.mockResolvedValue({ id: 'platform-admin-1', email: 'admin@accreditme.com', name: 'Platform Admin' });

    const result = await controller.getMe('user-1', 'org-1', 'platform-admin-1');

    expect(service.getPublicUserById).toHaveBeenCalledWith('platform-admin-1');
    expect(result.impersonatedBy).toEqual({ id: 'platform-admin-1', email: 'admin@accreditme.com', name: 'Platform Admin' });
  });

  it('login delegates to AuthService.login', async () => {
    const dto = { organizationSlug: 'acme', email: 'a@example.com', password: 'pw' };
    await controller.login(dto, req, res);
    expect(service.login).toHaveBeenCalledWith(dto, req, res);
  });

  it('verifyMfa delegates to AuthService.verifyMfa', async () => {
    const dto = { code: '123456' };
    await controller.verifyMfa(dto, req, res);
    expect(service.verifyMfa).toHaveBeenCalledWith(dto, req, res);
  });

  it('refresh delegates to AuthService.refresh', async () => {
    await controller.refresh(req, res);
    expect(service.refresh).toHaveBeenCalledWith(req, res);
  });

  it('logout delegates to AuthService.logout', async () => {
    await controller.logout(req, res);
    expect(service.logout).toHaveBeenCalledWith(req, res);
  });

  it('acceptInvitation delegates to AuthService.acceptInvitation', async () => {
    const dto = { token: 'tok', password: 'newpassword123' };
    await controller.acceptInvitation(dto);
    expect(service.acceptInvitation).toHaveBeenCalledWith(dto);
  });

  it('forgotPassword delegates to AuthService.forgotPassword', async () => {
    const dto = { organizationSlug: 'acme', email: 'a@example.com' };
    await controller.forgotPassword(dto);
    expect(service.forgotPassword).toHaveBeenCalledWith(dto);
  });

  it('resetPassword delegates to AuthService.resetPassword', async () => {
    const dto = { token: 'tok', password: 'newpassword123' };
    await controller.resetPassword(dto);
    expect(service.resetPassword).toHaveBeenCalledWith(dto);
  });

  it('setupMfa delegates to AuthService.setupMfa', async () => {
    const dto = { password: 'pw' };
    const result = await controller.setupMfa(dto, 'user-1', 'org-1');
    expect(service.setupMfa).toHaveBeenCalledWith('user-1', 'org-1', dto);
    expect(result).toEqual({ qrCodeDataUrl: 'data:image/png;base64,x', secret: 'SECRET', backupCodes: ['a1b2'] });
  });

  it('verifySetupMfa delegates to AuthService.verifySetupMfa', async () => {
    const dto = { code: '123456' };
    await controller.verifySetupMfa(dto, 'user-1', 'org-1');
    expect(service.verifySetupMfa).toHaveBeenCalledWith('user-1', 'org-1', dto);
  });

  it('disableMfa delegates to AuthService.disableMfa', async () => {
    const dto = { password: 'pw' };
    await controller.disableMfa(dto, 'user-1', 'org-1');
    expect(service.disableMfa).toHaveBeenCalledWith('user-1', 'org-1', dto);
  });

  it('getMfaStatus delegates to AuthService.getMfaStatus', async () => {
    const result = await controller.getMfaStatus('user-1', 'org-1');
    expect(service.getMfaStatus).toHaveBeenCalledWith('user-1', 'org-1');
    expect(result).toEqual({ enabled: false });
  });
});
