import { GraphClient } from './graph-client';
import { IAppCredentials, MicrosoftIdentity } from './microsoft-identity';
import { IResolvedLibrary, IResolvedSite, parseSiteUrl, SharePointLocator } from './sharepoint-locator';
import { SharePointStorageProvider } from './sharepoint-storage.provider';

// ACC-185 — from the values a tenant admin entered to a working provider, one
// step at a time, so the connection test can say WHICH step failed:
//
//   token    — sign in as the customer's app (tenant, client id, secret)
//   site     — find the site (by URL, or by id)
//   library  — find the document library (by name, or by id) and its drive
//
// Each step's failure is thrown as a SharePointStepError naming the step, with
// the underlying cause (MicrosoftSignInError, GraphError, a not-found, or the
// site-URL refusal) for the caller to put into plain words. Nothing here logs.

export type SharePointConnectStep = 'token' | 'site' | 'library';

export interface ISharePointSettings extends IAppCredentials {
  siteUrl?: string;
  libraryName?: string;
  /** The fallback inputs (Q2): from the guide's PowerShell output. */
  siteId?: string;
  listId?: string;
}

export interface ISharePointLocation {
  /** The customer's tenant as a GUID, whatever form was typed. */
  tenantId: string;
  siteId: string;
  siteName: string | null;
  siteWebUrl: string | null;
  listId: string;
  driveId: string;
  libraryName: string;
  libraryWebUrl: string | null;
  /** How the site and library were found. */
  resolvedBy: 'URL_AND_NAME' | 'IDS';
}

export class SharePointStepError extends Error {
  constructor(
    readonly step: SharePointConnectStep,
    readonly cause: unknown,
  ) {
    super(`SharePoint connection failed at ${step}`);
    this.name = 'SharePointStepError';
  }
}

export class SharePointConnector {
  private readonly locator: SharePointLocator;

  constructor(
    private readonly identity: MicrosoftIdentity = new MicrosoftIdentity(),
    private readonly graph: GraphClient = new GraphClient(),
  ) {
    this.locator = new SharePointLocator(graph);
  }

  /** Which way the site and library will be found: ids win when both are set. */
  static usesIds(settings: ISharePointSettings): boolean {
    return Boolean(settings.siteId && settings.listId);
  }

  async connect(
    settings: ISharePointSettings,
    onStep: (step: SharePointConnectStep) => void = () => undefined,
  ): Promise<{ provider: SharePointStorageProvider; location: ISharePointLocation }> {
    const byIds = SharePointConnector.usesIds(settings);
    const credentials: IAppCredentials = {
      tenant: settings.tenant,
      clientId: settings.clientId,
      clientSecret: settings.clientSecret,
    };

    let token: string;
    let tenantId: string;
    try {
      token = await this.identity.appToken(credentials);
      tenantId = await this.identity.tenantId(settings.tenant);
    } catch (cause) {
      throw new SharePointStepError('token', cause);
    }
    onStep('token');

    let site: IResolvedSite;
    try {
      site = byIds
        ? await this.locator.siteById(token, settings.siteId!)
        : await this.locator.siteByUrl(token, parseSiteUrl(settings.siteUrl ?? ''));
    } catch (cause) {
      throw new SharePointStepError('site', cause);
    }
    onStep('site');

    let library: IResolvedLibrary;
    try {
      library = byIds
        ? await this.locator.libraryById(token, site.id, settings.listId!)
        : await this.locator.libraryByName(token, site.id, settings.libraryName ?? '');
    } catch (cause) {
      throw new SharePointStepError('library', cause);
    }
    onStep('library');

    const provider = new SharePointStorageProvider({
      graph: this.graph,
      token: () => this.identity.appToken(credentials),
      driveId: library.driveId,
    });
    return {
      provider,
      location: {
        tenantId,
        siteId: site.id,
        siteName: site.name,
        siteWebUrl: site.webUrl,
        listId: library.listId,
        driveId: library.driveId,
        libraryName: library.name || settings.libraryName || '',
        libraryWebUrl: library.webUrl,
        resolvedBy: byIds ? 'IDS' : 'URL_AND_NAME',
      },
    };
  }
}
