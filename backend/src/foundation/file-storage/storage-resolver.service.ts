import { Injectable, Optional } from '@nestjs/common';
import { isAbsolute, resolve, sep } from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageProvider } from '../../providers/storage/storage.provider';
import { S3CompatibleStorageProvider } from '../../providers/storage/s3-compatible-storage.provider';
import { LocalFilesystemStorageProvider } from '../../providers/storage/local-filesystem-storage.provider';
import { PrivateEndpointRefusedError } from '../../providers/storage/endpoint-guard';
import {
  ISharePointLocation,
  SharePointConnectStep,
  SharePointConnector,
} from '../../providers/storage/sharepoint/sharepoint-connector';
import { parseSiteUrl, SiteUrlRefusedError } from '../../providers/storage/sharepoint/sharepoint-locator';
import { SharePointStorageProvider } from '../../providers/storage/sharepoint/sharepoint-storage.provider';
import { completeMinio, completeSharePoint, IMinioConfig, IStorageConfig, readStorageConfig, StorageChoice } from './storage-config';
import { allowPrivateEndpoints, localStorageBase, platformS3Settings } from './storage-platform-env';
import { StorageRefusalException } from './storage-refusal';

/**
 * The kinds Organization.storageProvider and StoredFile.provider can hold
 * TODAY. SharePoint is a StorageChoice a tenant can set up and test, and joins
 * this type with the stage-3 migration that adds it to the database enum —
 * until then TypeScript itself stops anything writing it.
 */
export type StorageProviderKind = 'S3' | 'MINIO' | 'LOCAL_FILESYSTEM';

/** Where a file lives. Written onto every StoredFile row. */
export interface IStorageLocation {
  provider: StorageProviderKind;
  bucket: string | null;
  endpoint: string | null;
  rootPath: string | null;
}

export interface IResolvedStorage {
  provider: StorageProvider;
  location: IStorageLocation;
}

/** Just the parts of a StoredFile row that say where it lives. */
export interface IStoredFileLocation {
  organizationId: string;
  provider: StorageProviderKind;
  bucket: string | null;
  endpoint: string | null;
  rootPath: string | null;
}

/**
 * ACC-177 — THE ONLY CODE THAT BUILDS A STORAGE PROVIDER.
 *
 *   forUpload(org)       — the organisation's CURRENT provider, for new files;
 *   forFile(file)        — the location THAT FILE was written to;
 *   forCandidate(...)    — a configuration under test, never saved.
 *
 * S3 is AccreditMe's own bucket, from platform env only. MinIO is the
 * customer's endpoint, guarded against private addresses at connect time.
 * A local folder is offered only where LOCAL_STORAGE_BASE is set, and its root
 * is confined under it. Anything missing is a refusal, never a default.
 */
@Injectable()
export class StorageResolverService {
  constructor(
    private readonly prisma: PrismaService,
    // ACC-185 — the customer's SharePoint, through their own app. One shared
    // instance holds the in-memory token cache; specs pass a fake.
    @Optional() private readonly sharePoint: SharePointConnector = new SharePointConnector(),
  ) {}

  async forUpload(organizationId: string): Promise<IResolvedStorage> {
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId },
      select: { storageProvider: true, storageConfig: true },
    });
    if (!org) throw new StorageRefusalException('STORAGE_NOT_CONFIGURED');
    return this.forCandidate(org.storageProvider, readStorageConfig(org.storageConfig));
  }

  /** Builds the provider for a provider choice and configuration. Saves nothing. */
  forCandidate(provider: StorageProviderKind, config: IStorageConfig): IResolvedStorage {
    switch (provider) {
      case 'S3':
        return this.platformS3();
      case 'MINIO': {
        const minio = completeMinio(config);
        if (!minio) throw new StorageRefusalException('STORAGE_NOT_CONFIGURED');
        return {
          provider: this.minio(minio),
          location: { provider: 'MINIO', bucket: minio.bucket, endpoint: minio.endpoint, rootPath: null },
        };
      }
      case 'LOCAL_FILESYSTEM': {
        const rootPath = config.local?.rootPath;
        if (!rootPath) throw new StorageRefusalException('STORAGE_NOT_CONFIGURED');
        return {
          provider: new LocalFilesystemStorageProvider(this.localRoot(rootPath)),
          location: { provider: 'LOCAL_FILESYSTEM', bucket: null, endpoint: null, rootPath },
        };
      }
    }
  }

  /**
   * The provider for the location a file was WRITTEN to. Switching the
   * organisation's provider never moves a file, so this reads the file's own
   * location; if that location is no longer configured, the file is
   * unavailable rather than read from somewhere else.
   */
  async forFile(file: IStoredFileLocation): Promise<StorageProvider> {
    switch (file.provider) {
      case 'S3': {
        const resolved = this.platformS3();
        if (resolved.location.bucket !== file.bucket || resolved.location.endpoint !== file.endpoint) {
          throw new StorageRefusalException('FILE_UNAVAILABLE');
        }
        return resolved.provider;
      }
      case 'MINIO': {
        const minio = completeMinio(await this.configOf(file.organizationId));
        if (!minio || minio.endpoint !== file.endpoint || minio.bucket !== file.bucket) {
          throw new StorageRefusalException('FILE_UNAVAILABLE');
        }
        return this.minio(minio);
      }
      case 'LOCAL_FILESYSTEM': {
        const config = await this.configOf(file.organizationId);
        if (!file.rootPath || config.local?.rootPath !== file.rootPath || !localStorageBase()) {
          throw new StorageRefusalException('FILE_UNAVAILABLE');
        }
        return new LocalFilesystemStorageProvider(this.localRoot(file.rootPath));
      }
    }
  }

  /**
   * Which options this installation offers a tenant. SharePoint needs nothing
   * from the platform — the customer brings their own app — so it is always
   * offered.
   */
  offeredProviders(): StorageChoice[] {
    return ['S3', 'MINIO', ...(localStorageBase() ? (['LOCAL_FILESYSTEM'] as const) : []), 'SHAREPOINT'];
  }

  /**
   * ACC-185 — the customer's SharePoint library: sign in as their app, find
   * the site and the library, and return a provider for it, reporting each
   * step as it passes so a connection test can name the one that failed.
   */
  async connectSharePoint(
    config: IStorageConfig,
    onStep?: (step: SharePointConnectStep) => void,
  ): Promise<{ provider: SharePointStorageProvider; location: ISharePointLocation }> {
    const settings = completeSharePoint(config);
    if (!settings) throw new StorageRefusalException('STORAGE_SETTINGS_INCOMPLETE');
    return this.sharePoint.connect(settings, onStep);
  }

  /** The site address must be https on a .sharepoint.com host (Q3). */
  assertSharePointSiteAllowed(siteUrl: string): void {
    try {
      parseSiteUrl(siteUrl);
    } catch (error) {
      if (error instanceof SiteUrlRefusedError) throw new StorageRefusalException('SHAREPOINT_SITE_URL_INVALID');
      throw error;
    }
  }

  /**
   * A MinIO endpoint is an absolute http(s) URL. On the cloud tier it must be
   * HTTPS; the private-ADDRESS check happens when the provider connects.
   */
  assertMinioEndpointAllowed(endpoint: string): void {
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new StorageRefusalException('STORAGE_ENDPOINT_NOT_ALLOWED');
    }
    const allowedProtocols = allowPrivateEndpoints() ? ['https:', 'http:'] : ['https:'];
    if (!allowedProtocols.includes(url.protocol) || url.username || url.password) {
      throw new StorageRefusalException('STORAGE_ENDPOINT_NOT_ALLOWED');
    }
  }

  /** The absolute folder for a tenant's root path, confined under the base. */
  localRoot(rootPath: string): string {
    const base = localStorageBase();
    if (!base) throw new StorageRefusalException('STORAGE_PROVIDER_NOT_ALLOWED');
    const baseAbs = resolve(base);
    if (isAbsolute(rootPath)) throw new StorageRefusalException('STORAGE_PROVIDER_NOT_ALLOWED');
    const root = resolve(baseAbs, rootPath);
    if (root !== baseAbs && !root.startsWith(baseAbs + sep)) {
      throw new StorageRefusalException('STORAGE_PROVIDER_NOT_ALLOWED');
    }
    return root;
  }

  private platformS3(): IResolvedStorage {
    const s3 = platformS3Settings();
    if (!s3) throw new StorageRefusalException('STORAGE_NOT_CONFIGURED');
    return {
      provider: new S3CompatibleStorageProvider({
        region: s3.region,
        bucket: s3.bucket,
        accessKeyId: s3.accessKeyId,
        secretAccessKey: s3.secretAccessKey,
        ...(s3.endpoint ? { endpoint: s3.endpoint } : {}),
        forcePathStyle: s3.forcePathStyle,
        // AccreditMe's own settings are trusted; only a customer endpoint is guarded.
        guardPrivateAddresses: false,
      }),
      location: { provider: 'S3', bucket: s3.bucket, endpoint: s3.endpoint, rootPath: null },
    };
  }

  private minio(minio: IMinioConfig): StorageProvider {
    this.assertMinioEndpointAllowed(minio.endpoint);
    try {
      return new S3CompatibleStorageProvider({
        region: minio.region,
        bucket: minio.bucket,
        accessKeyId: minio.accessKeyId,
        secretAccessKey: minio.secretAccessKey,
        endpoint: minio.endpoint,
        forcePathStyle: true,
        guardPrivateAddresses: !allowPrivateEndpoints(),
      });
    } catch (error) {
      if (error instanceof PrivateEndpointRefusedError) {
        throw new StorageRefusalException('STORAGE_ENDPOINT_NOT_ALLOWED');
      }
      throw error;
    }
  }

  private async configOf(organizationId: string): Promise<IStorageConfig> {
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId },
      select: { storageConfig: true },
    });
    return readStorageConfig(org?.storageConfig ?? null);
  }
}
