import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PlatformGuard } from './platform.guard';
import { PrismaService } from '../../prisma/prisma.service';

function buildContext(opts: { tenantId: string; userPermissions?: string[] }): ExecutionContext {
  const request = {
    tenantId: opts.tenantId,
    userPermissions: opts.userPermissions ?? [],
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('PlatformGuard', () => {
  let guard: PlatformGuard;
  let mockPrisma: { organization: { findUnique: jest.Mock } };

  beforeEach(() => {
    mockPrisma = { organization: { findUnique: jest.fn() } };
    guard = new PlatformGuard(mockPrisma as unknown as PrismaService);
  });

  it('allows when the caller is in the platform org AND holds platform:admin', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({ isPlatformOrg: true });
    const ctx = buildContext({ tenantId: 'platform-org', userPermissions: ['platform:admin'] });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(mockPrisma.organization.findUnique).toHaveBeenCalledWith({
      where: { id: 'platform-org' },
      select: { isPlatformOrg: true },
    });
  });

  // The actual exploit scenario found during planning: SYSTEM_ROLE_SEED seeds
  // PLATFORM_ADMIN (holding platform:admin) into every tenant's own Role
  // table, so an ordinary tenant admin can self-assign it via the existing
  // role-assignment UI. platform:admin permission alone must NEVER be
  // sufficient — the caller's own org must also be the designated platform org.
  it('rejects when the caller holds platform:admin but their org is NOT the platform org', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({ isPlatformOrg: false });
    const ctx = buildContext({ tenantId: 'ordinary-tenant', userPermissions: ['platform:admin'] });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('rejects when the org is the platform org but platform:admin is missing', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({ isPlatformOrg: true });
    const ctx = buildContext({ tenantId: 'platform-org', userPermissions: ['documents:view'] });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('rejects when the organization cannot be found', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue(null);
    const ctx = buildContext({ tenantId: 'missing-org', userPermissions: ['platform:admin'] });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });
});
