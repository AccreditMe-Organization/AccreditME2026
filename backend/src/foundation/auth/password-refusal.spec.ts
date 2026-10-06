import { HttpStatus } from '@nestjs/common';
import {
  PasswordRefusalException,
  passwordRefusalCode,
} from './password-refusal';

/**
 * The REAL class Better Auth throws (its own APIError subclasses it), loaded
 * from better-call's CommonJS build. Required rather than imported: under this
 * project's "node" module resolution an import of the `better-call/error`
 * subpath has no types (it lives only in the package's `exports` map), and
 * Jest resolves the package ROOT to its ESM build, which it cannot run.
 */
type BetterAuthApiError = new (
  status: string,
  body?: { message?: string; code?: string },
) => Error & {
  statusCode: number;
  body?: { message?: string; code?: string };
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { APIError } = require('better-call/error') as {
  APIError: BetterAuthApiError;
};

/**
 * ACC-120 slice 9e — accept-invitation's password refusals.
 *
 * The facts these depend on (the codes, the outage message, the `APIError`
 * name) are pinned against the installed library in
 * better-auth.contract.spec.ts.
 */
describe('password refusals (ACC-120 slice 9e)', () => {
  it('the fixture is a real Better Auth APIError, not a look-alike', () => {
    // Non-vacuity guard: every test below means something only if this holds.
    const e = new APIError('BAD_REQUEST', { message: 'x', code: 'X' });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('APIError');
    expect(e.statusCode).toBe(400);
    expect(e.body).toEqual({ message: 'x', code: 'X' });
  });

  it.each([
    ['PASSWORD_COMPROMISED', 'PASSWORD_COMPROMISED'],
    ['PASSWORD_TOO_SHORT', 'PASSWORD_TOO_SHORT'],
    ['PASSWORD_TOO_LONG', 'PASSWORD_TOO_LONG'],
  ] as const)('maps Better Auth %s to %s', (betterAuthCode, ours) => {
    const e = new APIError('BAD_REQUEST', {
      message: 'whatever Better Auth says',
      code: betterAuthCode,
    });
    expect(passwordRefusalCode(e)).toBe(ours);
  });

  it.each([
    'Failed to check password. Please try again later.',
    'Failed to check password. Status: 503',
  ])(
    'maps the breach-check outage "%s" to PASSWORD_CHECK_UNAVAILABLE',
    (message) => {
      const e = new APIError('INTERNAL_SERVER_ERROR', { message });
      expect(passwordRefusalCode(e)).toBe('PASSWORD_CHECK_UNAVAILABLE');
    },
  );

  it('leaves every other Better Auth error alone', () => {
    expect(
      passwordRefusalCode(
        new APIError('UNPROCESSABLE_ENTITY', {
          message: 'User already exists. Use another email.',
          code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
        }),
      ),
    ).toBeNull();
    // A 500 that is NOT the breach check — a failed user insert — is not
    // reported as "the password could not be checked".
    expect(
      passwordRefusalCode(
        new APIError('INTERNAL_SERVER_ERROR', {
          message: 'Failed to create user',
          code: 'FAILED_TO_CREATE_USER',
        }),
      ),
    ).toBeNull();
    expect(
      passwordRefusalCode(
        new APIError('INTERNAL_SERVER_ERROR', { message: 'Something else' }),
      ),
    ).toBeNull();
  });

  it('leaves an error that is not a Better Auth APIError alone, whatever it carries', () => {
    const lookalike = Object.assign(new Error('x'), {
      body: { code: 'PASSWORD_COMPROMISED' },
    });
    expect(passwordRefusalCode(lookalike)).toBeNull();
    expect(passwordRefusalCode(new Error('connection reset'))).toBeNull();
    expect(passwordRefusalCode('PASSWORD_COMPROMISED')).toBeNull();
    expect(passwordRefusalCode(undefined)).toBeNull();
  });

  it.each([
    ['PASSWORD_COMPROMISED', HttpStatus.BAD_REQUEST, 'Bad Request'],
    ['PASSWORD_TOO_SHORT', HttpStatus.BAD_REQUEST, 'Bad Request'],
    ['PASSWORD_TOO_LONG', HttpStatus.BAD_REQUEST, 'Bad Request'],
    [
      'PASSWORD_CHECK_UNAVAILABLE',
      HttpStatus.SERVICE_UNAVAILABLE,
      'Service Unavailable',
    ],
  ] as const)(
    '%s answers %i with its code in the body',
    (code, status, error) => {
      const e = new PasswordRefusalException(code);
      expect(e.getStatus()).toBe(status);
      const { message, ...rest } = e.getResponse() as Record<string, unknown>;
      expect(rest).toEqual({ statusCode: status, error, code });
      expect(typeof message).toBe('string');
    },
  );
});
