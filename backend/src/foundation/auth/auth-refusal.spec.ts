import {
  AuthRefusalException,
  AUTH_REFUSAL_MESSAGES,
  AuthRefusalCode,
} from './auth-refusal';

// ACC-120 slice 9b — the refusal's body, code by code. Outcomes are tested
// against the real service in sign-in-outcomes.spec.ts; this pins the shape.
describe('AuthRefusalException', () => {
  const base = (code: AuthRefusalCode) => ({
    statusCode: 401,
    message: AUTH_REFUSAL_MESSAGES[code],
    error: 'Unauthorized',
    code,
  });

  it('is a 401 carrying only its code for the codes with no details', () => {
    for (const code of [
      'INVALID_CREDENTIALS',
      'ACCOUNT_INACTIVE',
      'MFA_EXPIRED',
    ] as const) {
      const e = new AuthRefusalException(code);
      expect(e.getStatus()).toBe(401);
      expect(e.code).toBe(code);
      // Exact keys: no lockedUntil or attemptsRemaining key, not even undefined.
      expect(e.getResponse()).toStrictEqual(base(code));
    }
  });

  it('carries lockedUntil as an ISO instant on ACCOUNT_LOCKED', () => {
    const until = new Date('2026-10-05T09:15:01.000Z');
    expect(
      new AuthRefusalException('ACCOUNT_LOCKED', {
        lockedUntil: until,
      }).getResponse(),
    ).toStrictEqual({
      ...base('ACCOUNT_LOCKED'),
      lockedUntil: '2026-10-05T09:15:01.000Z',
    });
  });

  it('carries attemptsRemaining on MFA_INVALID, including zero', () => {
    expect(
      new AuthRefusalException('MFA_INVALID', {
        attemptsRemaining: 0,
      }).getResponse(),
    ).toStrictEqual({
      ...base('MFA_INVALID'),
      attemptsRemaining: 0,
    });
  });

  it('words every code, and no two the same', () => {
    const messages = Object.values(AUTH_REFUSAL_MESSAGES);
    // Six since ACC-168 added ORGANIZATION_UNAVAILABLE.
    expect(messages).toHaveLength(6);
    expect(new Set(messages).size).toBe(6);
  });
});
