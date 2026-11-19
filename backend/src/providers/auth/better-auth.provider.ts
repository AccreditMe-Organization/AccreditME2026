import { Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';
import { AuthProvider, AuthenticatedUser } from './auth.provider';

interface JwtPayload {
  sub: string;
  email: string;
  organizationId: string;
  tokenVersion: number;
  exp: number;
}

function parseJwt(token: string, secret: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts as [
      string,
      string,
      string,
    ];

    const expected = createHmac('sha256', secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    if (expected !== signatureB64) return null;

    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8'),
    ) as JwtPayload;

    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

@Injectable()
export class BetterAuthProvider implements AuthProvider {
  async validateToken(token: string): Promise<AuthenticatedUser | null> {
    const secret = process.env['JWT_SECRET'];
    if (!secret) return null;

    const payload = parseJwt(token, secret);
    if (!payload?.sub || !payload.organizationId) return null;

    return {
      id: payload.sub,
      email: payload.email,
      organizationId: payload.organizationId,
      tokenVersion: payload.tokenVersion,
    };
  }
}
