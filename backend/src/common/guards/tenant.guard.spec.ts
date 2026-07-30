import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { TenantGuard } from './tenant.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionResolver } from '../services/permission-resolver.interface';

const JWT_SECRET = 'test-secret-value';

function signJwt(payload: Record<string, unknown>): string {
  const base64url = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const headerB64 = base64url({ alg: 'HS256', typ: 'JWT' });
  const payloadB64 = base64url(payload);
  const signature = createHmac('sha256', JWT_SECRET)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');
  return `${headerB64}.${payloadB64}.${signature}`;
}

function buildContext(opts: { cookies?: Record<string, string>; authHeader?: string }): ExecutionContext {
  const request = {
    headers: opts.authHeader ? { authorization: opts.authHeader } : {},
    cookies: opts.cookies ?? {},
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('TenantGuard', () => {
  let guard: TenantGuard;
  let mockPermissionResolver: PermissionResolver;
  let mockPrisma: { user: { findFirst: jest.Mock } };
  let validToken: string;

  beforeEach(() => {
    process.env['JWT_SECRET'] = JWT_SECRET;
    validToken = signJwt({
      sub: 'user-a',
      organizationId: 'org-a',
      tokenVersion: 3,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    mockPermissionResolver = { getUserPermissions: jest.fn().mockResolvedValue(['documents:view']) };
    mockPrisma = {
      user: { findFirst: jest.fn().mockResolvedValue({ tokenVersion: 3 }) },
    };

    guard = new TenantGuard(mockPermissionResolver, mockPrisma as unknown as PrismaService);
  });

  it('reads the token from the access_token cookie when present', async () => {
    const ctx = buildContext({ cookies: { access_token: validToken } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'user-a', organizationId: 'org-a' },
      select: { tokenVersion: true },
    });
  });

  it('attaches impersonatedBy to the request when present in the JWT payload', async () => {
    const impersonationToken = signJwt({
      sub: 'user-a',
      organizationId: 'org-a',
      tokenVersion: 3,
      exp: Math.floor(Date.now() / 1000) + 3600,
      impersonatedBy: 'platform-admin-1',
    });
    const ctx = buildContext({ cookies: { access_token: impersonationToken } });

    await guard.canActivate(ctx);

    const request = ctx.switchToHttp().getRequest() as unknown as { impersonatedBy?: string };
    expect(request.impersonatedBy).toBe('platform-admin-1');
  });

  it('does not set impersonatedBy on a normal (non-impersonated) session', async () => {
    const ctx = buildContext({ cookies: { access_token: validToken } });

    await guard.canActivate(ctx);

    const request = ctx.switchToHttp().getRequest() as unknown as { impersonatedBy?: string };
    expect(request.impersonatedBy).toBeUndefined();
  });

  it('falls back to the Authorization header when no cookie is present', async () => {
    const ctx = buildContext({ authHeader: `Bearer ${validToken}` });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('prefers the cookie over the Authorization header when both are present', async () => {
    const headerToken = signJwt({
      sub: 'user-b',
      organizationId: 'org-a',
      tokenVersion: 1,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    mockPrisma.user.findFirst.mockResolvedValue({ tokenVersion: 3 });

    const ctx = buildContext({ cookies: { access_token: validToken }, authHeader: `Bearer ${headerToken}` });
    await guard.canActivate(ctx);

    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'user-a', organizationId: 'org-a' },
      select: { tokenVersion: true },
    });
  });

  it('throws UnauthorizedException when neither cookie nor header is present', async () => {
    const ctx = buildContext({});
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when the DB tokenVersion does not match the token claim (revoked session)', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ tokenVersion: 4 });
    const ctx = buildContext({ cookies: { access_token: validToken } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when the user no longer exists in this tenant', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    const ctx = buildContext({ cookies: { access_token: validToken } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('should NOT resolve a user from a different tenant than the token claims', async () => {
    const ctx = buildContext({ cookies: { access_token: validToken } });
    await guard.canActivate(ctx);

    const call = mockPrisma.user.findFirst.mock.calls[0][0];
    expect(call.where.organizationId).toBe('org-a');
  });

  it('throws UnauthorizedException for an expired token', async () => {
    const expired = signJwt({
      sub: 'user-a',
      organizationId: 'org-a',
      tokenVersion: 3,
      exp: Math.floor(Date.now() / 1000) - 10,
    });
    const ctx = buildContext({ cookies: { access_token: expired } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException for a token with an invalid signature', async () => {
    const parts = validToken.split('.');
    const tampered = `${parts[0]}.${parts[1]}.tamperedsignature`;
    const ctx = buildContext({ cookies: { access_token: tampered } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });
});
