import { Test, TestingModule } from '@nestjs/testing';
import { createHmac } from 'crypto';
import { BetterAuthProvider } from './better-auth.provider';
import { PrismaService } from '../../prisma/prisma.service';

function signJwt(payload: Record<string, unknown>, secret: string): string {
  const base64url = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const headerB64 = base64url({ alg: 'HS256', typ: 'JWT' });
  const payloadB64 = base64url(payload);
  const signature = createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');
  return `${headerB64}.${payloadB64}.${signature}`;
}

describe('BetterAuthProvider', () => {
  let provider: BetterAuthProvider;
  let mockPrisma: { user: { update: jest.Mock } };
  const JWT_SECRET = 'test-secret-value';

  beforeEach(async () => {
    process.env['JWT_SECRET'] = JWT_SECRET;
    mockPrisma = { user: { update: jest.fn().mockResolvedValue({}) } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BetterAuthProvider,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    provider = module.get<BetterAuthProvider>(BetterAuthProvider);
  });

  describe('validateToken', () => {
    it('returns the decoded user for a valid, unexpired token', async () => {
      const token = signJwt(
        {
          sub: 'user-1',
          email: 'a@example.com',
          organizationId: 'org-a',
          tokenVersion: 2,
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        JWT_SECRET,
      );

      const result = await provider.validateToken(token);
      expect(result).toEqual({
        id: 'user-1',
        email: 'a@example.com',
        organizationId: 'org-a',
        tokenVersion: 2,
      });
    });

    it('returns null for an expired token', async () => {
      const token = signJwt(
        {
          sub: 'user-1',
          email: 'a@example.com',
          organizationId: 'org-a',
          tokenVersion: 2,
          exp: Math.floor(Date.now() / 1000) - 10,
        },
        JWT_SECRET,
      );

      expect(await provider.validateToken(token)).toBeNull();
    });

    it('returns null for a token with an invalid signature', async () => {
      const token = signJwt(
        { sub: 'user-1', organizationId: 'org-a', tokenVersion: 1, exp: Math.floor(Date.now() / 1000) + 3600 },
        'wrong-secret',
      );

      expect(await provider.validateToken(token)).toBeNull();
    });
  });

  describe('invalidateUserSessions', () => {
    it('increments the user tokenVersion', async () => {
      await provider.invalidateUserSessions('user-1');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { tokenVersion: { increment: 1 } },
      });
    });
  });
});
