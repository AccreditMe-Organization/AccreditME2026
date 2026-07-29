import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
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
  };

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
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: service }],
    })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
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
});
