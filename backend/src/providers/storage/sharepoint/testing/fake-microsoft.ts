// ACC-185 — a fake Microsoft for specs: the token endpoint, the tenant's OpenID
// metadata, and the handful of Graph calls SharePoint storage makes. No network.
// Each failure mode is a switch, so a spec states exactly what Microsoft says.

export const FAKE_TENANT_ID = '11111111-2222-3333-4444-555555555555';
export const FAKE_SITE_ID = 'contoso.sharepoint.com,aaaaaaaa-0000-0000-0000-000000000001,bbbbbbbb-0000-0000-0000-000000000002';
export const FAKE_LIST_ID = 'cccccccc-0000-0000-0000-000000000003';
export const FAKE_DRIVE_ID = 'b!fake-drive-id';
/** What the fake token endpoint issues — a spec asserts it never reaches a log. */
export const FAKE_ACCESS_TOKEN = 'eyJ.fake-access-token-never-logged';

export interface FakeMicrosoftOptions {
  /** AADSTS numbers the token endpoint answers with instead of a token. */
  tokenErrorCodes?: number[];
  /** The OpenID metadata status for a domain tenant (404 = unknown tenant). */
  metadataStatus?: number;
  /** Status for reading the site (by path or by id). */
  siteStatus?: number;
  /** Status for listing the site's lists. */
  listsStatus?: number;
  /** Lists the site reports; defaults to one document library "AccreditMe Files". */
  lists?: Array<{ id: string; displayName: string; template: string; driveId?: string }>;
  /** Status for reading one list by id. */
  listStatus?: number;
  /** Status for the drive of a list. */
  driveStatus?: number;
  /** Status for uploads; throttling answers carry Retry-After. */
  writeStatuses?: number[];
  retryAfter?: string;
}

export interface FakeCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

export function fakeMicrosoft(options: FakeMicrosoftOptions = {}) {
  const calls: FakeCall[] = [];
  /** Stored content, by path inside the library. */
  const files = new Map<string, Buffer>();
  /** path ↔ "item:{id}", both ways. */
  const aliases = new Map<string, string>();
  const writeStatuses = [...(options.writeStatuses ?? [])];
  let nextItem = 1;

  const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  const graphError = (status: number, code: string): Response => json(status, { error: { code, message: 'details that must not leak' } });

  const fetchFn = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const body =
      init.body == null ? null : typeof init.body === 'string' ? init.body : Buffer.from(init.body as Uint8Array).toString('utf8');
    calls.push({ method, url: input, headers, body });
    const url = new URL(input);

    if (url.hostname === 'login.microsoftonline.com') {
      if (url.pathname.endsWith('/oauth2/v2.0/token')) {
        if (options.tokenErrorCodes?.length) {
          return json(400, {
            error: 'invalid_client',
            error_description: `AADSTS${options.tokenErrorCodes[0]}: a description that echoes request details`,
            error_codes: options.tokenErrorCodes,
          });
        }
        return json(200, { token_type: 'Bearer', expires_in: 3599, access_token: FAKE_ACCESS_TOKEN });
      }
      if (url.pathname.endsWith('/.well-known/openid-configuration')) {
        const status = options.metadataStatus ?? 200;
        if (status !== 200) return json(status, { error: 'invalid_tenant' });
        return json(200, { issuer: `https://login.microsoftonline.com/${FAKE_TENANT_ID}/v2.0` });
      }
    }

    if (url.hostname !== 'graph.microsoft.com') return json(404, {});
    const path = decodeURIComponent(url.pathname.replace(/^\/v1\.0/, ''));

    // Site by path, or by id.
    if (/^\/sites\/[^/]+(:\/.+)?$/.test(path) && method === 'GET') {
      const status = options.siteStatus ?? 200;
      if (status !== 200) return graphError(status, status === 404 ? 'itemNotFound' : 'accessDenied');
      return json(200, { id: FAKE_SITE_ID, displayName: 'Quality', webUrl: 'https://contoso.sharepoint.com/sites/Quality' });
    }
    // The site's lists.
    if (/^\/sites\/[^/]+\/lists$/.test(path)) {
      const status = options.listsStatus ?? 200;
      if (status !== 200) return graphError(status, 'accessDenied');
      const lists = options.lists ?? [{ id: FAKE_LIST_ID, displayName: 'AccreditMe Files', template: 'documentLibrary', driveId: FAKE_DRIVE_ID }];
      return json(200, {
        value: lists.map((l) => ({
          id: l.id,
          displayName: l.displayName,
          webUrl: `https://contoso.sharepoint.com/sites/Quality/${encodeURIComponent(l.displayName)}`,
          list: { template: l.template },
          ...(l.driveId ? { drive: { id: l.driveId } } : {}),
        })),
      });
    }
    // One list by id, or its drive.
    if (/^\/sites\/[^/]+\/lists\/[^/]+\/drive$/.test(path)) {
      const status = options.driveStatus ?? 200;
      if (status !== 200) return graphError(status, 'itemNotFound');
      return json(200, { id: FAKE_DRIVE_ID });
    }
    if (/^\/sites\/[^/]+\/lists\/[^/]+$/.test(path)) {
      const status = options.listStatus ?? 200;
      if (status !== 200) return graphError(status, status === 404 ? 'itemNotFound' : 'accessDenied');
      return json(200, { id: FAKE_LIST_ID, displayName: 'AccreditMe Files', webUrl: 'https://contoso.sharepoint.com/sites/Quality/AccreditMe%20Files', drive: { id: FAKE_DRIVE_ID } });
    }

    // Files in the drive, by path (root:/a/b:) or by item id.
    const byPath = path.match(/^\/drives\/[^/]+\/root:\/(.+?)(:\/content|:)?$/);
    const byId = path.match(/^\/drives\/[^/]+\/items\/([^/]+)(\/content)?$/);
    const fileKey = byPath ? byPath[1]! : byId ? `item:${byId[1]}` : null;
    if (fileKey) {
      if (method === 'PUT') {
        const status = writeStatuses.shift() ?? 201;
        if (status === 429 || status === 503) {
          return json(status, { error: { code: 'TooManyRequests' } }, options.retryAfter ? { 'retry-after': options.retryAfter } : {});
        }
        if (status >= 400) return graphError(status, 'accessDenied');
        // One file, reachable by its path and by its item id, as in SharePoint.
        const id = `item-${nextItem++}`;
        files.set(fileKey, Buffer.from(init.body as Uint8Array));
        aliases.set(fileKey, `item:${id}`);
        aliases.set(`item:${id}`, fileKey);
        return json(201, { id, name: fileKey.split('/').pop() });
      }
      const stored = files.has(fileKey) ? fileKey : aliases.get(fileKey);
      if (method === 'GET') {
        const content = stored ? files.get(stored) : undefined;
        if (!content) return graphError(404, 'itemNotFound');
        return new Response(new Uint8Array(content), { status: 200 });
      }
      if (method === 'DELETE') {
        if (!stored || !files.has(stored)) return graphError(404, 'itemNotFound');
        files.delete(stored);
        return new Response(null, { status: 204 });
      }
    }
    return json(404, { error: { code: 'itemNotFound' } });
  };

  return { fetchFn, calls, files };
}
