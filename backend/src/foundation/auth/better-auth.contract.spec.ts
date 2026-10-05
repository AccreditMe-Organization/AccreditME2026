import { readFileSync } from 'fs';
import { join } from 'path';
import { createHmac } from 'crypto';
import {
  BETTER_AUTH_INVALID_CREDENTIALS,
  BETTER_AUTH_TWO_FACTOR_CODES,
  SECURE_COOKIE_PREFIX,
  TWO_FACTOR_ATTEMPTS_PER_CHALLENGE,
  TWO_FACTOR_ATTEMPTS_PREFIX,
  TWO_FACTOR_CHALLENGE_PREFIX,
  TWO_FACTOR_CHALLENGE_SECONDS,
  TWO_FACTOR_COOKIE_NAME,
  TWO_FACTOR_MAX_FAILURES_PER_USER,
} from './better-auth.contract';
import { verifiedChallengeIdentifier } from './two-factor-challenge';

/**
 * ACC-120 slice 9b — the facts this codebase relies on INSIDE Better Auth,
 * checked against the library that is actually installed.
 *
 * Sign-in outcomes depend on details Better Auth's public API does not promise:
 * that a refused sign-in is RETURNED rather than thrown, the shape of the MFA
 * challenge, its limits, and the cookie's signing. They are copied once into
 * better-auth.contract.ts. This spec reads the installed dist source and
 * asserts each one, so an upgrade that changes any of them fails here, by
 * name, instead of quietly turning a lockout off — which is exactly what the
 * first of these facts did, unnoticed, until this ticket.
 *
 * If this fails after an upgrade: re-read the named file, update
 * better-auth.contract.ts AND the code that relies on it, then this spec.
 */
const MODULES = join(__dirname, '..', '..', '..', 'node_modules');
const source = (relative: string): string =>
  readFileSync(join(MODULES, relative), 'utf8');
const BETTER_AUTH = 'better-auth/dist';

describe('Better Auth contract (ACC-120 slice 9b)', () => {
  it('is the version these facts were read from', () => {
    const { version } = JSON.parse(source('better-auth/package.json')) as {
      version: string;
    };
    // Not a reason to pin the dependency — a reason to re-read the facts below
    // when it moves. Update this line only after doing so.
    expect(version).toBe('1.6.22');
  });

  describe('sign-in', () => {
    it('RETURNS an APIError as a Response when asResponse is set — it only throws without it', () => {
      const dispatch = source(`${BETTER_AUTH}/api/dispatch.mjs`);
      expect(dispatch).toContain(
        'if (isAPIError(result.response) && !shouldReturnResponse) {',
      );
      expect(dispatch).toContain(
        'return shouldReturnResponse ? toResponse(result.response, {',
      );
    });

    it(`refuses an unknown user and a wrong password alike with ${BETTER_AUTH_INVALID_CREDENTIALS}, hashing a dummy for the unknown one`, () => {
      const signIn = source(`${BETTER_AUTH}/api/routes/sign-in.mjs`);
      const unknownUser = signIn.slice(
        signIn.indexOf(
          'const user = await ctx.context.internalAdapter.findUserByEmail',
        ),
      );
      expect(unknownUser).toMatch(
        /if \(!user\) \{\s*await ctx\.context\.password\.hash\(password\);[\s\S]*?BASE_ERROR_CODES\.INVALID_EMAIL_OR_PASSWORD/,
      );
      const codes = source('@better-auth/core/dist/error/codes.mjs');
      expect(codes).toContain(
        `${BETTER_AUTH_INVALID_CREDENTIALS}: "Invalid email or password"`,
      );
    });
  });

  describe('the MFA challenge', () => {
    const twoFactor = (file: string) =>
      source(`${BETTER_AUTH}/plugins/two-factor/${file}`);

    it('lives for 600 seconds, as two rows with these identifiers', () => {
      const index = twoFactor('index.mjs');
      expect(index).toContain(
        `const maxAge = options?.twoFactorCookieMaxAge ?? ${TWO_FACTOR_CHALLENGE_SECONDS};`,
      );
      expect(index).toContain(
        `const identifier = \`${TWO_FACTOR_CHALLENGE_PREFIX}\${generateRandomString(20)}\`;`,
      );
      expect(index).toContain(
        `identifier: \`${TWO_FACTOR_ATTEMPTS_PREFIX}\${identifier}\`,`,
      );
    });

    it(`allows ${TWO_FACTOR_ATTEMPTS_PER_CHALLENGE} codes per challenge`, () => {
      expect(twoFactor('totp/index.mjs')).toContain(
        `const attempt = isSignIn ? await beginAttempt(${TWO_FACTOR_ATTEMPTS_PER_CHALLENGE}) : null;`,
      );
    });

    it(`locks the user's MFA after ${TWO_FACTOR_MAX_FAILURES_PER_USER} failures`, () => {
      expect(twoFactor('verify-two-factor.mjs')).toContain(
        `maxFailedAttempts: lockout?.maxFailedAttempts ?? ${TWO_FACTOR_MAX_FAILURES_PER_USER},`,
      );
    });

    it('refuses with the codes this codebase maps', () => {
      const errors = twoFactor('error-code.mjs');
      for (const code of Object.values(BETTER_AUTH_TWO_FACTOR_CODES)) {
        expect(errors).toMatch(new RegExp(`\\b${code}: "`));
      }
    });

    it('names its cookie better-auth.two_factor, __Secure- prefixed over https', () => {
      expect(twoFactor('constant.mjs')).toContain(
        'const TWO_FACTOR_COOKIE_NAME = "two_factor";',
      );
      const cookies = source(`${BETTER_AUTH}/cookies/index.mjs`);
      expect(cookies).toContain(
        'const prefix = options.advanced?.cookiePrefix || "better-auth";',
      );
      expect(cookies).toContain('name: `${secureCookiePrefix}${name}`,');
      expect(TWO_FACTOR_COOKIE_NAME).toBe('better-auth.two_factor');
      expect(SECURE_COOKIE_PREFIX).toBe('__Secure-');
    });

    it('signs the cookie as `value.base64(HMAC-SHA256)` — the format the reader verifies', () => {
      const crypto = source('better-call/dist/crypto.cjs');
      expect(crypto).toContain('hash: "SHA-256"');
      expect(crypto).toContain(
        'return btoa(String.fromCharCode(...new Uint8Array(signature)));',
      );
      expect(crypto).toContain('value = `${value}.${signature}`;');
      expect(crypto).toContain('value = encodeURIComponent(value);');

      // And the reader accepts exactly that format, and nothing signed otherwise.
      const identifier = '2fa-abcdefghijklmnopqrst';
      const sign = (secret: string) =>
        encodeURIComponent(
          `${identifier}.${createHmac('sha256', secret).update(identifier).digest('base64')}`,
        );
      expect(verifiedChallengeIdentifier(sign('s3cret'), 's3cret')).toBe(
        identifier,
      );
      expect(verifiedChallengeIdentifier(sign('other'), 's3cret')).toBeNull();
    });
  });
});
