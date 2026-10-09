import { GraphClient, GraphError } from './graph-client';
import { MicrosoftIdentity, MicrosoftSignInError } from './microsoft-identity';
import { SharePointConnectStep, SharePointConnector, SharePointStepError } from './sharepoint-connector';
import { NotFoundInSharePointError } from './sharepoint-locator';
import { FAKE_DRIVE_ID, FAKE_LIST_ID, FAKE_SITE_ID, FAKE_TENANT_ID, fakeMicrosoft, FakeMicrosoftOptions } from './testing/fake-microsoft';

const BY_NAME = {
  tenant: 'contoso.onmicrosoft.com',
  clientId: '99999999-8888-7777-6666-555555555555',
  clientSecret: 'cl1ent~secret',
  siteUrl: 'https://contoso.sharepoint.com/sites/Quality',
  libraryName: 'AccreditMe Files',
};
const connectorFor = (options: FakeMicrosoftOptions = {}) => {
  const ms = fakeMicrosoft(options);
  return { ms, connector: new SharePointConnector(new MicrosoftIdentity(ms.fetchFn), new GraphClient(ms.fetchFn, async () => undefined)) };
};
async function stepErrorOf(promise: Promise<unknown>): Promise<SharePointStepError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SharePointStepError) return error;
    throw error;
  }
  throw new Error('expected a SharePointStepError');
}

describe('SharePointConnector (ACC-185)', () => {
  it('signs in, finds the site, finds the library — reporting each step in order', async () => {
    const { connector } = connectorFor();
    const steps: SharePointConnectStep[] = [];
    const { location } = await connector.connect(BY_NAME, (s) => steps.push(s));

    expect(steps).toEqual(['token', 'site', 'library']);
    expect(location).toEqual({
      tenantId: FAKE_TENANT_ID,
      siteId: FAKE_SITE_ID,
      siteName: 'Quality',
      siteWebUrl: 'https://contoso.sharepoint.com/sites/Quality',
      listId: FAKE_LIST_ID,
      driveId: FAKE_DRIVE_ID,
      libraryName: 'AccreditMe Files',
      libraryWebUrl: expect.any(String),
      resolvedBy: 'URL_AND_NAME',
    });
  });

  it('uses the Site ID and Library ID when both are given — the guide’s fallback', async () => {
    const { ms, connector } = connectorFor();
    const { location } = await connector.connect({ ...BY_NAME, siteId: FAKE_SITE_ID, listId: FAKE_LIST_ID });
    expect(location.resolvedBy).toBe('IDS');
    expect(ms.calls.some((c) => c.url.includes('/sites/contoso.sharepoint.com:'))).toBe(false);
  });

  it('the provider it returns writes to the library it found', async () => {
    const { ms, connector } = connectorFor();
    const { provider } = await connector.connect(BY_NAME);
    await provider.put('org/_probe/p.txt', Buffer.from('x'), 'text/plain');
    expect(ms.calls.at(-1)!.url).toContain(`/drives/${encodeURIComponent(FAKE_DRIVE_ID)}/root:/AccreditMe/_probe/p.txt`);
  });

  it('names the token step when the app cannot sign in', async () => {
    const { connector } = connectorFor({ tokenErrorCodes: [7000222] });
    const error = await stepErrorOf(connector.connect(BY_NAME));
    expect(error.step).toBe('token');
    expect(error.cause).toBeInstanceOf(MicrosoftSignInError);
  });

  it('names the site step when the site cannot be read', async () => {
    const { connector } = connectorFor({ siteStatus: 403 });
    const error = await stepErrorOf(connector.connect(BY_NAME));
    expect(error.step).toBe('site');
    expect(error.cause).toBeInstanceOf(GraphError);
  });

  it('names the library step when no library has that name', async () => {
    const { connector } = connectorFor();
    const error = await stepErrorOf(connector.connect({ ...BY_NAME, libraryName: 'Nope' }));
    expect(error.step).toBe('library');
    expect(error.cause).toBeInstanceOf(NotFoundInSharePointError);
  });
});
