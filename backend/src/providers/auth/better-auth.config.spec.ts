import { createBetterAuthInstance } from './better-auth.config';
import type { PrismaService } from '../../prisma/prisma.service';

// Better Auth and its plugins are ESM-only; this spec needs only the OPTIONS
// our factory hands to betterAuth(), so betterAuth is the identity function.
jest.mock('better-auth', () => ({ betterAuth: (options: unknown) => options }));
jest.mock('better-auth/adapters/prisma', () => ({
  prismaAdapter: () => 'prisma-adapter',
}));
jest.mock('better-auth/plugins/two-factor', () => ({
  twoFactor: () => ({ id: 'two-factor' }),
}));
jest.mock('better-auth/plugins/haveibeenpwned', () => ({
  haveIBeenPwned: () => ({ id: 'have-i-been-pwned' }),
}));

interface CapturedOptions {
  emailAndPassword: Record<string, unknown>;
  verification: { modelName?: unknown; storeIdentifier?: unknown };
  baseURL: unknown;
  appName: unknown;
  advanced: { useSecureCookies?: unknown; database?: unknown };
}

// ACC-186 + ACC-148 — the settings that decide Better Auth's cookies and URLs.
describe('createBetterAuthInstance options (ACC-186, ACC-148)', () => {
  const saved = process.env['API_ORIGIN'];
  afterEach(() => {
    if (saved === undefined) delete process.env['API_ORIGIN'];
    else process.env['API_ORIGIN'] = saved;
  });

  function options(): CapturedOptions {
    return createBetterAuthInstance({} as PrismaService) as unknown as CapturedOptions;
  }

  it('takes its base URL from API_ORIGIN, as a STRING — never a per-request config', () => {
    process.env['API_ORIGIN'] = 'https://api.accreditme.app';
    const { baseURL } = options();
    // A string is Better Auth's static path: a direct auth.api call cannot
    // re-resolve it from a request's Host. An object would be dynamic.
    expect(typeof baseURL).toBe('string');
    expect(baseURL).toBe('https://api.accreditme.app');
  });

  it('refuses to build without API_ORIGIN rather than guess', () => {
    delete process.env['API_ORIGIN'];
    expect(() => options()).toThrow(/API_ORIGIN/);
  });

  it('makes Better Auth’s own cookies Secure whatever NODE_ENV says', () => {
    process.env['API_ORIGIN'] = 'http://localhost:3000';
    const savedNodeEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'development';
    try {
      expect(options().advanced.useSecureCookies).toBe(true);
    } finally {
      process.env['NODE_ENV'] = savedNodeEnv;
    }
  });

  it('names the product to authenticator apps', () => {
    process.env['API_ORIGIN'] = 'http://localhost:3000';
    expect(options().appName).toBe('AccreditMe');
  });
});

// ACC-188 — Better Auth never issues a reset link here, and a reset row's
// identifier (which holds the token) is stored hashed.
describe('createBetterAuthInstance — password reset (ACC-188)', () => {
  const saved = process.env['API_ORIGIN'];
  beforeEach(() => {
    process.env['API_ORIGIN'] = 'https://api.accreditme.app';
  });
  afterEach(() => {
    if (saved === undefined) delete process.env['API_ORIGIN'];
    else process.env['API_ORIGIN'] = saved;
  });
  const options = (): CapturedOptions =>
    createBetterAuthInstance({} as PrismaService) as unknown as CapturedOptions;

  it('configures NO sendResetPassword, so requestPasswordReset refuses and data.url is never sent', () => {
    expect(options().emailAndPassword).not.toHaveProperty('sendResetPassword');
  });

  it("ends Better Auth's own sessions on a reset", () => {
    expect(options().emailAndPassword['revokeSessionsOnPasswordReset']).toBe(true);
  });

  it('stores reset identifiers hashed, and every other identifier as before', () => {
    expect(options().verification).toEqual({
      modelName: 'authVerification',
      storeIdentifier: { default: 'plain', overrides: { 'reset-password:': 'hashed' } },
    });
  });
});
