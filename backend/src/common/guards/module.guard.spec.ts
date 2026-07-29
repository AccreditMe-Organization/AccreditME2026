import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ModuleGuard } from './module.guard';
import { PrismaService } from '../../prisma/prisma.service';

function buildContext(tenantId: string): ExecutionContext {
  const request = { tenantId };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => jest.fn(),
  } as unknown as ExecutionContext;
}

describe('ModuleGuard', () => {
  let guard: ModuleGuard;
  let mockPrisma: { organization: { findUnique: jest.Mock } };
  let mockReflector: { get: jest.Mock };

  beforeEach(() => {
    mockPrisma = { organization: { findUnique: jest.fn() } };
    mockReflector = { get: jest.fn() };
    guard = new ModuleGuard(mockPrisma as unknown as PrismaService, mockReflector as unknown as Reflector);
  });

  // Critical — every existing controller must keep working unmodified once
  // this guard is registered anywhere globally, since no real controller
  // uses @RequiresModule() yet (see this guard's own header comment).
  it('is a no-op when no @RequiresModule() metadata is present on the handler', async () => {
    mockReflector.get.mockReturnValue(undefined);
    const ctx = buildContext('org-a');

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(mockPrisma.organization.findUnique).not.toHaveBeenCalled();
  });

  it('throws when the required module is not present in settings.modules', async () => {
    mockReflector.get.mockReturnValue('documents');
    mockPrisma.organization.findUnique.mockResolvedValue({ settings: { modules: {} } });
    const ctx = buildContext('org-a');

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('throws when the required module is explicitly false', async () => {
    mockReflector.get.mockReturnValue('documents');
    mockPrisma.organization.findUnique.mockResolvedValue({ settings: { modules: { documents: false } } });
    const ctx = buildContext('org-a');

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('throws when settings itself is null', async () => {
    mockReflector.get.mockReturnValue('documents');
    mockPrisma.organization.findUnique.mockResolvedValue({ settings: null });
    const ctx = buildContext('org-a');

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('allows when the required module is explicitly true', async () => {
    mockReflector.get.mockReturnValue('documents');
    mockPrisma.organization.findUnique.mockResolvedValue({ settings: { modules: { documents: true } } });
    const ctx = buildContext('org-a');

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
