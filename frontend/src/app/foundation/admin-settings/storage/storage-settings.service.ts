import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

/** Where an organisation's files can be kept (backend `StorageChoice`). */
export type StorageKind = 'S3' | 'MINIO' | 'LOCAL_FILESYSTEM' | 'SHAREPOINT';

export type SharePointAccessLostReason = 'SECRET_INVALID' | 'CONSENT_REVOKED' | 'GRANT_REMOVED' | 'LIBRARY_GONE';

/**
 * GET /tenant/storage (ACC-177, ACC-185), as the backend's IStorageSettings
 * (`foundation/file-storage/interfaces/storage-settings.interface.ts`).
 *
 * Secrets come back as "set" or null, never their values. Nothing here is
 * AccreditMe's own: for AccreditMe cloud the API returns only the provider,
 * and this screen shows only that AccreditMe manages it (ACC-260 rule 1).
 * Dates arrive as ISO strings.
 */
export interface IStorageSettings {
  provider: StorageKind;
  /** What this installation lets a tenant choose (a local folder only where configured). */
  offeredProviders: StorageKind[];
  /** Before confirmation, the option being set up. Null once confirmed. */
  draftProvider: StorageKind | null;
  /** Uploads are refused everywhere until a tenant admin confirms where files go. */
  confirmed: boolean;
  confirmedAt: string | null;
  confirmedBy: { id: string; name: string } | null;
  /** The last request to AccreditMe to change the location, if any. */
  changeRequestedAt: string | null;
  changeRequestedBy: { id: string; name: string } | null;
  minio: {
    endpoint: string | null;
    region: string | null;
    bucket: string | null;
    accessKeyId: 'set' | null;
    secretAccessKey: 'set' | null;
  };
  local: { rootPath: string | null };
  sharepoint: {
    tenant: string | null;
    clientId: string | null;
    clientSecret: 'set' | null;
    siteUrl: string | null;
    libraryName: string | null;
    siteId: string | null;
    listId: string | null;
    /** YYYY-MM-DD, as the admin typed it. */
    secretExpiresOn: string | null;
    tenantId: string | null;
    siteName: string | null;
    siteWebUrl: string | null;
    libraryWebUrl: string | null;
    /** Set while Microsoft access is withdrawn. */
    accessLostAt: string | null;
    accessLostReason: SharePointAccessLostReason | null;
    filesStored: number;
    disconnectAllowed: boolean;
  };
  /** AccreditMe cloud only: deleted files count until they are purged. */
  usage: { usedBytes: number; maxStorageGb: number };
  maxUploadBytes: number;
}

/** ACC-260 — the organisation's file storage settings. PR A reads only. */
@Injectable({ providedIn: 'root' })
export class StorageSettingsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/tenant/storage`;

  get(): Observable<IStorageSettings> {
    return this.http.get<IStorageSettings>(this.baseUrl);
  }
}
