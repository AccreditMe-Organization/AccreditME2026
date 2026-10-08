import { createHash } from 'crypto';

// ACC-185 — the app-only token for a CUSTOMER's own app registration.
//
// SharePoint storage works like MinIO: the customer's IT registers a
// single-tenant app in their own Entra tenant, gives it write on one library,
// and creates a client secret; the tenant admin enters the values. AccreditMe
// has no Entra app of its own.
//
// With a client secret the client-credentials token is one form POST
// (https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow),
// so there is no MSAL: what MSAL adds — signing a certificate assertion — does
// not apply, and its cache is the few lines below. No refresh token exists in
// this flow ("refresh tokens will never be granted").
//
// THE SECRET AND EVERY TOKEN STAY IN MEMORY. Nothing here logs, and no error
// thrown from here carries the request body, a token or Microsoft's message.

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export type MicrosoftSignInFailure =
  /** AADSTS90002 / 900023 — no such tenant. */
  | 'TENANT_NOT_FOUND'
  /** AADSTS700016 — the client id is not an app in that tenant. */
  | 'CLIENT_NOT_FOUND'
  /** AADSTS7000215 (invalid) / 7000222 (expired). */
  | 'SECRET_INVALID'
  /** AADSTS7000112 — the app is disabled. */
  | 'APP_DISABLED'
  /** Anything else: Microsoft unreachable, or an answer we don't recognise. */
  | 'UNAVAILABLE';

/**
 * A sign-in that did not produce a token. Carries the classified reason and
 * the AADSTS numbers — never the request, the secret, or Microsoft's own
 * description (which can echo request details).
 */
export class MicrosoftSignInError extends Error {
  constructor(
    readonly reason: MicrosoftSignInFailure,
    readonly aadsts: number[] = [],
  ) {
    super(`Microsoft sign-in failed: ${reason}${aadsts.length ? ` (AADSTS${aadsts.join(', AADSTS')})` : ''}`);
    this.name = 'MicrosoftSignInError';
  }
}

export interface IAppCredentials {
  /** The customer's tenant: a GUID, or a domain such as contoso.onmicrosoft.com. */
  tenant: string;
  clientId: string;
  clientSecret: string;
}

const LOGIN_HOST = 'https://login.microsoftonline.com';
const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';
/** A cached token is reused until this long before it expires. */
const REUSE_MARGIN_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function classify(codes: number[]): MicrosoftSignInFailure {
  if (codes.includes(7000215) || codes.includes(7000222)) return 'SECRET_INVALID';
  if (codes.includes(700016)) return 'CLIENT_NOT_FOUND';
  if (codes.includes(90002) || codes.includes(900023)) return 'TENANT_NOT_FOUND';
  if (codes.includes(7000112)) return 'APP_DISABLED';
  return 'UNAVAILABLE';
}

export class MicrosoftIdentity {
  /**
   * Keyed by tenant, client AND a hash of the secret: a replaced secret can
   * never be answered with a token the old one earned, and two organisations
   * that happen to share a Microsoft tenant never share a token.
   */
  private readonly tokens = new Map<string, { accessToken: string; expiresAt: number }>();
  private readonly tenantIds = new Map<string, string>();

  constructor(
    private readonly fetchFn: FetchFn = (input, init) => fetch(input, init),
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** An app-only Microsoft Graph token for these credentials. */
  async appToken(credentials: IAppCredentials): Promise<string> {
    const key = cacheKey(credentials);
    const cached = this.tokens.get(key);
    if (cached && cached.expiresAt - REUSE_MARGIN_MS > this.now()) return cached.accessToken;

    const body = new URLSearchParams({
      client_id: credentials.clientId,
      scope: GRAPH_SCOPE,
      client_secret: credentials.clientSecret,
      grant_type: 'client_credentials',
    });
    let response: Response;
    try {
      response = await this.fetchFn(`${LOGIN_HOST}/${encodeURIComponent(credentials.tenant)}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new MicrosoftSignInError('UNAVAILABLE');
    }

    const payload = (await response.json().catch(() => null)) as
      | { access_token?: string; expires_in?: number; error_codes?: number[] }
      | null;
    if (!response.ok || !payload?.access_token) {
      const codes = Array.isArray(payload?.error_codes) ? payload.error_codes.filter((c) => typeof c === 'number') : [];
      throw new MicrosoftSignInError(classify(codes), codes);
    }
    const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 3599;
    this.tokens.set(key, { accessToken: payload.access_token, expiresAt: this.now() + expiresIn * 1000 });
    return payload.access_token;
  }

  /**
   * The tenant's GUID. A GUID is returned as given; a domain is resolved
   * through Microsoft's published OpenID metadata, whose issuer names the
   * tenant id — the token itself is never read (Microsoft: "Don't attempt to
   * validate or read tokens for any API you don't own").
   */
  async tenantId(tenant: string): Promise<string> {
    if (GUID.test(tenant)) return tenant.toLowerCase();
    const known = this.tenantIds.get(tenant.toLowerCase());
    if (known) return known;
    let response: Response;
    try {
      response = await this.fetchFn(
        `${LOGIN_HOST}/${encodeURIComponent(tenant)}/v2.0/.well-known/openid-configuration`,
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
    } catch {
      throw new MicrosoftSignInError('UNAVAILABLE');
    }
    if (response.status === 400 || response.status === 404) throw new MicrosoftSignInError('TENANT_NOT_FOUND');
    const metadata = (await response.json().catch(() => null)) as { issuer?: string } | null;
    const match = metadata?.issuer?.match(/login\.microsoftonline\.com\/([0-9a-f-]{36})\//i);
    if (!response.ok || !match?.[1]) throw new MicrosoftSignInError('UNAVAILABLE');
    const id = match[1].toLowerCase();
    this.tenantIds.set(tenant.toLowerCase(), id);
    return id;
  }

  /** Drops a cached token — after Microsoft refused it. */
  forget(credentials: IAppCredentials): void {
    this.tokens.delete(cacheKey(credentials));
  }
}

function cacheKey(credentials: IAppCredentials): string {
  const secretHash = createHash('sha256').update(credentials.clientSecret).digest('hex');
  return `${credentials.tenant.toLowerCase()}|${credentials.clientId.toLowerCase()}|${secretHash}`;
}
