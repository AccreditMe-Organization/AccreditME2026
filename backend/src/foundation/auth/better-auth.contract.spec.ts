import { readFileSync } from 'fs';
import { join } from 'path';
import { createHmac } from 'crypto';
import {
  BETTER_AUTH_API_ERROR_NAME,
  BETTER_AUTH_INVALID_CREDENTIALS,
  BETTER_AUTH_PASSWORD_CHECK_FAILED,
  BETTER_AUTH_PASSWORD_CODES,
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

  // ACC-120 slice 9e — accept-invitation maps these to its own stable codes
  // (password-refusal.ts). A change here would turn a field-level message back
  // into a generic error, so it fails by name instead.
  describe('sign-up password refusals', () => {
    it(`throws errors named ${BETTER_AUTH_API_ERROR_NAME}`, () => {
      for (const build of [
        'better-call/dist/error.cjs',
        'better-call/dist/error.mjs',
      ]) {
        expect(source(build)).toContain(
          `this.name = "${BETTER_AUTH_API_ERROR_NAME}";`,
        );
      }
    });

    it('builds every base error code with code equal to its key', () => {
      expect(source('@better-auth/core/dist/utils/error-codes.mjs')).toMatch(
        /\[key, \{\s*code: key,\s*message: value,/,
      );
      const codes = source('@better-auth/core/dist/error/codes.mjs');
      expect(codes).toContain(
        `${BETTER_AUTH_PASSWORD_CODES.TOO_SHORT}: "Password too short"`,
      );
      expect(codes).toContain(
        `${BETTER_AUTH_PASSWORD_CODES.TOO_LONG}: "Password too long"`,
      );
    });

    it(`refuses a short or long sign-up password with ${BETTER_AUTH_PASSWORD_CODES.TOO_SHORT} / ${BETTER_AUTH_PASSWORD_CODES.TOO_LONG}`, () => {
      const signUp = source(`${BETTER_AUTH}/api/routes/sign-up.mjs`);
      expect(signUp).toContain(
        `throw APIError.from("BAD_REQUEST", BASE_ERROR_CODES.${BETTER_AUTH_PASSWORD_CODES.TOO_SHORT});`,
      );
      expect(signUp).toContain(
        `throw APIError.from("BAD_REQUEST", BASE_ERROR_CODES.${BETTER_AUTH_PASSWORD_CODES.TOO_LONG});`,
      );
    });

    it(`checks a sign-up password for breaches, refusing with ${BETTER_AUTH_PASSWORD_CODES.COMPROMISED}`, () => {
      const pwned = source(`${BETTER_AUTH}/plugins/haveibeenpwned/index.mjs`);
      expect(pwned).toContain('"/sign-up/email",');
      expect(pwned).toContain(
        'await checkPasswordCompromise(password, options?.customPasswordCompromisedMessage);',
      );
      expect(pwned).toContain(
        `defineErrorCodes({ ${BETTER_AUTH_PASSWORD_CODES.COMPROMISED}: `,
      );
      expect(pwned).toContain(
        `code: ERROR_CODES.${BETTER_AUTH_PASSWORD_CODES.COMPROMISED}.code`,
      );
    });

    it(`reports a breach-check outage as a 500 with no code, its message starting "${BETTER_AUTH_PASSWORD_CHECK_FAILED}"`, () => {
      const pwned = source(`${BETTER_AUTH}/plugins/haveibeenpwned/index.mjs`);
      const outages = [
        ...pwned.matchAll(
          /new APIError\("INTERNAL_SERVER_ERROR", \{ message: [`"]([^`"]*)/g,
        ),
      ].map((m) => m[1] ?? '');
      // Non-vacuity guard: both outage throws are found before they are judged.
      expect(outages).toHaveLength(2);
      for (const message of outages) {
        expect(message.startsWith(BETTER_AUTH_PASSWORD_CHECK_FAILED)).toBe(
          true,
        );
      }
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

  // ACC-148 — why a forged Host cannot influence a URL Better Auth builds. Each
  // fact is read off the INSTALLED source, so an upgrade that changes one fails
  // here by name. Verified on the deployed API too (8 Oct): Railway's edge
  // answers a forged Host with its own 404 before the app sees it.
  describe('no auth URL is derived from a request (ACC-148)', () => {
    it('derives an origin from a request only inside its HTTP handler, which this API never mounts', () => {
      const base = source(`${BETTER_AUTH}/auth/base.mjs`);
      expect(base).toContain(
        'const baseURL = getBaseURL(void 0, basePath, request, void 0, ctx.options.advanced?.trustedProxyHeaders);',
      );
      expect(base).toContain('handler: async (request) => {');
      // Nothing here mounts it: no toNodeHandler, no auth.handler anywhere.
      const service = readFileSync(join(__dirname, 'auth.service.ts'), 'utf8');
      expect(service).not.toMatch(/toNodeHandler|auth\.handler\(/);
    });

    it('resolves a STRING baseURL once at start-up, from configuration alone', () => {
      const context = source(`${BETTER_AUTH}/context/create-context.mjs`);
      expect(context).toContain(
        'const baseURL = isDynamicConfig ? void 0 : getBaseURL(typeof options.baseURL === "string" ? options.baseURL : void 0, options.basePath);',
      );
      // A direct auth.api call re-resolves the origin only for an OBJECT
      // (dynamic) baseURL; ours is a string (better-auth.config.spec.ts).
      const endpoints = source(`${BETTER_AUTH}/api/to-auth-endpoints.mjs`);
      expect(endpoints).toContain(
        'const authContext = isDynamicBaseURLConfig(rawContext.options.baseURL) ? await resolveDynamicContext(rawContext, context) : rawContext;',
      );
    });

    it('builds the reset link from that configured base URL', () => {
      const password = source(`${BETTER_AUTH}/api/routes/password.mjs`);
      expect(password).toContain(
        'const url = `${ctx.context.baseURL}/reset-password/${verificationToken}?callbackURL=${callbackURL}`;',
      );
    });

    it('our auth.api calls carry at most a cookie — never a request, a Host or an X-Forwarded-Host', () => {
      const service = readFileSync(join(__dirname, 'auth.service.ts'), 'utf8');
      const headerArgs =
        service.match(/headers:\s*new Headers\(\{[^}]*\}\)/g) ?? [];
      // Non-vacuity guard: the calls that do pass headers were found.
      expect(headerArgs.length).toBeGreaterThanOrEqual(4);
      for (const arg of headerArgs) {
        expect(arg).toMatch(/^headers:\s*new Headers\(\{\s*cookie:/);
        expect(arg).not.toMatch(/host/i);
      }
      expect(service).not.toMatch(/auth\.api\.\w+\(\{[^)]*\brequest\s*:/);
      expect(service).not.toMatch(/['"]x-forwarded-host['"]/i);
    });
  });
});
