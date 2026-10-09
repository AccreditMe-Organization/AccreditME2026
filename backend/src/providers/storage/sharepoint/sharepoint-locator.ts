import { GraphClient, GraphError } from './graph-client';

// ACC-185 — turning what the tenant admin typed into Graph ids.
//
// Two ways in (Ahmad, Q2):
//   - the SITE URL and the LIBRARY NAME, as shown in SharePoint;
//   - the SITE ID and the LIBRARY ID, from the guide's PowerShell output —
//     the fallback for when an app holding only a library grant cannot read
//     the site by its path (Graph documents Sites.Read.All as that call's
//     least privilege, and neither Selected permission).
// Ids win when both are present.
//
// The site URL is PARSED into a host and a path for Graph and never fetched
// directly — AccreditMe only ever calls login.microsoftonline.com and
// graph.microsoft.com, so no address can be reached through this field.

export class SiteUrlRefusedError extends Error {
  constructor() {
    super('The site address must be an https:// address on a .sharepoint.com host');
    this.name = 'SiteUrlRefusedError';
  }
}

export interface ISiteRef {
  hostname: string;
  /** Server-relative, e.g. /sites/Quality; "" for the root site. */
  path: string;
}

/** https://{host}.sharepoint.com[/sites|/teams/...] — anything else is refused. */
export function parseSiteUrl(value: string): ISiteRef {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new SiteUrlRefusedError();
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !/^[a-z0-9-]+(-my)?\.sharepoint\.com$/.test(hostname)
  ) {
    throw new SiteUrlRefusedError();
  }
  // A copied address often carries the library or a page after the site:
  // keep /sites/{name} or /teams/{name}; the root site has no path.
  const segments = decodeURIComponent(url.pathname).split('/').filter(Boolean);
  if (segments.length === 0) return { hostname, path: '' };
  const kind = segments[0]!.toLowerCase();
  if ((kind !== 'sites' && kind !== 'teams') || !segments[1]) throw new SiteUrlRefusedError();
  return { hostname, path: `/${kind}/${segments[1]}` };
}

export interface IResolvedSite {
  id: string;
  name: string | null;
  webUrl: string | null;
}

export interface IResolvedLibrary {
  listId: string;
  driveId: string;
  name: string;
  webUrl: string | null;
}

/** Thrown when a lookup ran but found nothing to match. */
export class NotFoundInSharePointError extends Error {
  constructor(readonly what: 'site' | 'library') {
    super(`SharePoint ${what} not found`);
    this.name = 'NotFoundInSharePointError';
  }
}

export class SharePointLocator {
  constructor(private readonly graph: GraphClient) {}

  async siteByUrl(token: string, site: ISiteRef): Promise<IResolvedSite> {
    const path = site.path
      ? `/sites/${encodeURIComponent(site.hostname)}:${site.path.split('/').map(encodeURIComponent).join('/')}`
      : `/sites/${encodeURIComponent(site.hostname)}`;
    const found = await this.graph.json<{ id?: string; displayName?: string; webUrl?: string }>({
      method: 'GET',
      path: `${path}?$select=id,displayName,webUrl`,
      token,
      purpose: 'site',
    });
    if (!found.id) throw new NotFoundInSharePointError('site');
    return { id: found.id, name: found.displayName ?? null, webUrl: found.webUrl ?? null };
  }

  /**
   * By id. The display name is a courtesy: an app holding only a library grant
   * may not be allowed to read the site itself, and that is not a reason to
   * fail when the library is reachable — so a 403 here yields no name.
   */
  async siteById(token: string, siteId: string): Promise<IResolvedSite> {
    try {
      const found = await this.graph.json<{ id?: string; displayName?: string; webUrl?: string }>({
        method: 'GET',
        path: `/sites/${encodeURIComponent(siteId)}?$select=id,displayName,webUrl`,
        token,
        purpose: 'site',
      });
      return { id: found.id ?? siteId, name: found.displayName ?? null, webUrl: found.webUrl ?? null };
    } catch (error) {
      if (error instanceof GraphError && error.status === 403) return { id: siteId, name: null, webUrl: null };
      throw error;
    }
  }

  /** The document library with exactly this display name on the site. */
  async libraryByName(token: string, siteId: string, name: string): Promise<IResolvedLibrary> {
    const lists = await this.graph.json<{
      value?: Array<{ id?: string; displayName?: string; webUrl?: string; list?: { template?: string }; drive?: { id?: string } }>;
    }>({
      method: 'GET',
      path: `/sites/${encodeURIComponent(siteId)}/lists?$select=id,displayName,webUrl,list&$expand=drive($select=id)&$top=999`,
      token,
      purpose: 'library',
    });
    const wanted = name.trim();
    const match = (lists.value ?? []).find(
      (l) => l.displayName === wanted && l.list?.template === 'documentLibrary',
    );
    if (!match?.id) throw new NotFoundInSharePointError('library');
    const driveId = match.drive?.id ?? (await this.driveOf(token, siteId, match.id));
    return { listId: match.id, driveId, name: match.displayName ?? wanted, webUrl: match.webUrl ?? null };
  }

  async libraryById(token: string, siteId: string, listId: string): Promise<IResolvedLibrary> {
    let list: { id?: string; displayName?: string; webUrl?: string; drive?: { id?: string } } | null = null;
    try {
      list = await this.graph.json({
        method: 'GET',
        path: `/sites/${encodeURIComponent(siteId)}/lists/${encodeURIComponent(listId)}?$select=id,displayName,webUrl&$expand=drive($select=id)`,
        token,
        purpose: 'library',
      });
    } catch (error) {
      // The list itself may be unreadable while its drive is — try the drive.
      if (!(error instanceof GraphError) || (error.status !== 403 && error.status !== 400)) throw error;
    }
    const driveId = list?.drive?.id ?? (await this.driveOf(token, siteId, listId));
    return { listId: list?.id ?? listId, driveId, name: list?.displayName ?? '', webUrl: list?.webUrl ?? null };
  }

  private async driveOf(token: string, siteId: string, listId: string): Promise<string> {
    const drive = await this.graph.json<{ id?: string }>({
      method: 'GET',
      path: `/sites/${encodeURIComponent(siteId)}/lists/${encodeURIComponent(listId)}/drive?$select=id`,
      token,
      purpose: 'library',
    });
    if (!drive.id) throw new NotFoundInSharePointError('library');
    return drive.id;
  }
}
