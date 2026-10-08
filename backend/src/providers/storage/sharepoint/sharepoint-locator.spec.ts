import { GraphClient, GraphError } from './graph-client';
import { NotFoundInSharePointError, parseSiteUrl, SharePointLocator, SiteUrlRefusedError } from './sharepoint-locator';
import { FAKE_DRIVE_ID, FAKE_LIST_ID, FAKE_SITE_ID, fakeMicrosoft, FakeMicrosoftOptions } from './testing/fake-microsoft';

const TOKEN = 'tok';
const locatorFor = (options: FakeMicrosoftOptions = {}) => {
  const ms = fakeMicrosoft(options);
  return { ms, locator: new SharePointLocator(new GraphClient(ms.fetchFn, async () => undefined)) };
};

describe('parseSiteUrl — the site address is parsed, never fetched (ACC-185)', () => {
  it.each([
    ['https://contoso.sharepoint.com/sites/Quality', { hostname: 'contoso.sharepoint.com', path: '/sites/Quality' }],
    ['https://contoso.sharepoint.com/teams/QM', { hostname: 'contoso.sharepoint.com', path: '/teams/QM' }],
    ['https://Contoso.SharePoint.com/sites/Quality/AccreditMe%20Files/Forms/AllItems.aspx', { hostname: 'contoso.sharepoint.com', path: '/sites/Quality' }],
    ['https://contoso.sharepoint.com/', { hostname: 'contoso.sharepoint.com', path: '' }],
    ['  https://contoso.sharepoint.com/sites/Quality  ', { hostname: 'contoso.sharepoint.com', path: '/sites/Quality' }],
  ])('accepts %p', (value, expected) => {
    expect(parseSiteUrl(value)).toEqual(expected);
  });

  it.each([
    'http://contoso.sharepoint.com/sites/Quality',
    'https://contoso.sharepoint.com.evil.example/sites/Quality',
    'https://intranet.contoso.local/sites/Quality',
    'https://10.0.0.5/sites/Quality',
    'https://user:pass@contoso.sharepoint.com/sites/Quality',
    'https://contoso.sharepoint.com:8443/sites/Quality',
    'https://contoso-my.sharepoint.com/personal/someone',
    'https://contoso.sharepoint.com/sites/',
    'not a url',
  ])('refuses %p', (value) => {
    expect(() => parseSiteUrl(value)).toThrow(SiteUrlRefusedError);
  });
});

describe('SharePointLocator (ACC-185)', () => {
  it('finds the site by host and path', async () => {
    const { ms, locator } = locatorFor();
    expect(await locator.siteByUrl(TOKEN, { hostname: 'contoso.sharepoint.com', path: '/sites/Quality' })).toEqual({
      id: FAKE_SITE_ID,
      name: 'Quality',
      webUrl: 'https://contoso.sharepoint.com/sites/Quality',
    });
    expect(ms.calls[0]!.url).toBe('https://graph.microsoft.com/v1.0/sites/contoso.sharepoint.com:/sites/Quality?$select=id,displayName,webUrl');
  });

  it('fails the site lookup by URL when the app may not read it', async () => {
    const { locator } = locatorFor({ siteStatus: 403 });
    await expect(locator.siteByUrl(TOKEN, { hostname: 'contoso.sharepoint.com', path: '/sites/Quality' })).rejects.toBeInstanceOf(GraphError);
  });

  it('by id, a 403 on the site is not a failure — only its name is unknown', async () => {
    const { locator } = locatorFor({ siteStatus: 403 });
    expect(await locator.siteById(TOKEN, FAKE_SITE_ID)).toEqual({ id: FAKE_SITE_ID, name: null, webUrl: null });
  });

  it('by id, a 404 on the site still fails', async () => {
    const { locator } = locatorFor({ siteStatus: 404 });
    await expect(locator.siteById(TOKEN, FAKE_SITE_ID)).rejects.toBeInstanceOf(GraphError);
  });

  it('finds the document library by its exact name, with its drive', async () => {
    const { locator } = locatorFor();
    expect(await locator.libraryByName(TOKEN, FAKE_SITE_ID, 'AccreditMe Files')).toEqual(
      expect.objectContaining({ listId: FAKE_LIST_ID, driveId: FAKE_DRIVE_ID, name: 'AccreditMe Files' }),
    );
  });

  it('matches only a document library — a plain list with that name is not one', async () => {
    const { locator } = locatorFor({ lists: [{ id: 'l1', displayName: 'AccreditMe Files', template: 'genericList' }] });
    await expect(locator.libraryByName(TOKEN, FAKE_SITE_ID, 'AccreditMe Files')).rejects.toBeInstanceOf(NotFoundInSharePointError);
  });

  it('fetches the drive separately when the list came back without one', async () => {
    const { ms, locator } = locatorFor({ lists: [{ id: FAKE_LIST_ID, displayName: 'AccreditMe Files', template: 'documentLibrary' }] });
    const found = await locator.libraryByName(TOKEN, FAKE_SITE_ID, 'AccreditMe Files');
    expect(found.driveId).toBe(FAKE_DRIVE_ID);
    expect(ms.calls.at(-1)!.url).toContain(`/lists/${FAKE_LIST_ID}/drive`);
  });

  it('by id, reaches the drive even when the list itself is unreadable', async () => {
    const { locator } = locatorFor({ listStatus: 403 });
    expect(await locator.libraryById(TOKEN, FAKE_SITE_ID, FAKE_LIST_ID)).toEqual(
      expect.objectContaining({ listId: FAKE_LIST_ID, driveId: FAKE_DRIVE_ID }),
    );
  });

  it('by id, fails when neither the list nor its drive can be read', async () => {
    const { locator } = locatorFor({ listStatus: 403, driveStatus: 403 });
    await expect(locator.libraryById(TOKEN, FAKE_SITE_ID, FAKE_LIST_ID)).rejects.toBeInstanceOf(GraphError);
  });
});
