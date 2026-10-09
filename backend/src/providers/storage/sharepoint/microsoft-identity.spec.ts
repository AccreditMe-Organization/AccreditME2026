import { MicrosoftIdentity, MicrosoftSignInError } from './microsoft-identity';
import { FAKE_ACCESS_TOKEN, FAKE_TENANT_ID, fakeMicrosoft } from './testing/fake-microsoft';

const SECRET = 'cl1ent~secret-value-never-shown';
const CREDS = { tenant: FAKE_TENANT_ID, clientId: '99999999-8888-7777-6666-555555555555', clientSecret: SECRET };

async function reasonOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof MicrosoftSignInError) return error.reason;
    throw error;
  }
  return undefined;
}

describe('MicrosoftIdentity — the customer app’s token (ACC-185)', () => {
  it('asks the tenant’s token endpoint for a Graph app-only token with the client credentials', async () => {
    const ms = fakeMicrosoft();
    const token = await new MicrosoftIdentity(ms.fetchFn).appToken(CREDS);

    expect(token).toBe(FAKE_ACCESS_TOKEN);
    const call = ms.calls[0]!;
    expect(call.url).toBe(`https://login.microsoftonline.com/${FAKE_TENANT_ID}/oauth2/v2.0/token`);
    expect(call.method).toBe('POST');
    const form = new URLSearchParams(call.body!);
    expect(Object.fromEntries(form)).toEqual({
      client_id: CREDS.clientId,
      scope: 'https://graph.microsoft.com/.default',
      client_secret: SECRET,
      grant_type: 'client_credentials',
    });
  });

  it('reuses a token until five minutes before it expires', async () => {
    const ms = fakeMicrosoft();
    let now = 1_000_000;
    const identity = new MicrosoftIdentity(ms.fetchFn, () => now);
    await identity.appToken(CREDS);
    now += 50 * 60 * 1000; // 50 of its 60 minutes
    await identity.appToken(CREDS);
    expect(ms.calls).toHaveLength(1);
    now += 6 * 60 * 1000; // inside the last five minutes
    await identity.appToken(CREDS);
    expect(ms.calls).toHaveLength(2);
  });

  it('never answers a replaced secret with the old secret’s token — the cache key includes the secret', async () => {
    const ms = fakeMicrosoft();
    const identity = new MicrosoftIdentity(ms.fetchFn);
    await identity.appToken(CREDS);
    await identity.appToken({ ...CREDS, clientSecret: 'a-brand-new-secret-value' });
    expect(ms.calls).toHaveLength(2);
  });

  it.each([
    [[7000215], 'SECRET_INVALID'],
    [[7000222], 'SECRET_INVALID'],
    [[700016], 'CLIENT_NOT_FOUND'],
    [[90002], 'TENANT_NOT_FOUND'],
    [[900023], 'TENANT_NOT_FOUND'],
    [[7000112], 'APP_DISABLED'],
    [[70011], 'UNAVAILABLE'],
  ])('classifies AADSTS %p as %s', async (codes, reason) => {
    const ms = fakeMicrosoft({ tokenErrorCodes: codes as number[] });
    expect(await reasonOf(new MicrosoftIdentity(ms.fetchFn).appToken(CREDS))).toBe(reason);
  });

  it('carries no secret and none of Microsoft’s own description in the error it throws', async () => {
    const ms = fakeMicrosoft({ tokenErrorCodes: [7000215] });
    const error = (await new MicrosoftIdentity(ms.fetchFn).appToken(CREDS).catch((e: unknown) => e)) as Error;
    expect(error.message).toContain('SECRET_INVALID');
    expect(error.message).not.toContain(SECRET);
    expect(error.message).not.toContain('echoes request details');
    expect(JSON.stringify(error)).not.toContain(SECRET);
  });

  it('is UNAVAILABLE, not a wrong-credentials answer, when Microsoft cannot be reached', async () => {
    const identity = new MicrosoftIdentity(async () => {
      throw new Error(`connect ECONNREFUSED — body was client_secret=${SECRET}`);
    });
    const error = (await identity.appToken(CREDS).catch((e: unknown) => e)) as MicrosoftSignInError;
    expect(error.reason).toBe('UNAVAILABLE');
    expect(error.message).not.toContain(SECRET);
  });

  describe('tenantId', () => {
    it('returns a GUID as given, without asking Microsoft', async () => {
      const ms = fakeMicrosoft();
      expect(await new MicrosoftIdentity(ms.fetchFn).tenantId(FAKE_TENANT_ID.toUpperCase())).toBe(FAKE_TENANT_ID);
      expect(ms.calls).toHaveLength(0);
    });

    it('resolves a domain through the published OpenID metadata — the token is never read', async () => {
      const ms = fakeMicrosoft();
      expect(await new MicrosoftIdentity(ms.fetchFn).tenantId('contoso.onmicrosoft.com')).toBe(FAKE_TENANT_ID);
      expect(ms.calls[0]!.url).toBe('https://login.microsoftonline.com/contoso.onmicrosoft.com/v2.0/.well-known/openid-configuration');
    });

    it('is TENANT_NOT_FOUND for a domain Microsoft does not know', async () => {
      const ms = fakeMicrosoft({ metadataStatus: 400 });
      expect(await reasonOf(new MicrosoftIdentity(ms.fetchFn).tenantId('nobody.example'))).toBe('TENANT_NOT_FOUND');
    });
  });
});
