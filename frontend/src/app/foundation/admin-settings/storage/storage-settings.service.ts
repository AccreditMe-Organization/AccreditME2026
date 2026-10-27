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

/**
 * A connection test's steps (backend `StorageTestStep`). MinIO and a local
 * folder run configure, write, read, verify and delete; `token`, `site` and
 * `library` are SharePoint's own (PR C).
 */
export type StorageTestStep = 'configure' | 'token' | 'site' | 'library' | 'write' | 'read' | 'verify' | 'delete';

/** POST /tenant/storage/test (backend IStorageTestResult). Always a 200; nothing is saved. */
export interface IStorageTestResult {
  ok: boolean;
  provider: StorageKind;
  /** The steps that passed, in order. */
  passed: StorageTestStep[];
  failedStep: StorageTestStep | null;
  /** A storage refusal code; the screen shows its own words for it, never `message`. */
  code: string | null;
  message: string | null;
  sharepoint: unknown;
}

/**
 * The body of test, confirm and PATCH (backend UpdateStorageSettingsDto). A
 * secret is present only when the person typed one: omitted, the server keeps
 * the stored value (ACC-260 rule 2).
 */
export interface IStorageCandidate {
  provider: StorageKind;
  minio?: { endpoint?: string; region?: string; bucket?: string; accessKeyId?: string; secretAccessKey?: string };
  local?: { rootPath?: string };
}

/** POST /tenant/storage/change-request's contact (backend StorageChangeRequestDto). */
export interface IStorageChangeContact {
  contactName: string;
  contactEmail: string;
  /** "+" and a country code, then digits, spaces or dashes; sent as typed. */
  contactPhone: string;
}

/** ACC-260 — the organisation's file storage settings. Every write answers with the whole settings again. */
@Injectable({ providedIn: 'root' })
export class StorageSettingsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/tenant/storage`;

  get(): Observable<IStorageSettings> {
    return this.http.get<IStorageSettings>(this.baseUrl);
  }

  /** Writes a probe file into the storage under test and deletes it. Saves nothing. */
  test(candidate: IStorageCandidate): Observable<IStorageTestResult> {
    return this.http.post<IStorageTestResult>(`${this.baseUrl}/test`, candidate);
  }

  /** Once, for good: where the organisation's files are kept. */
  confirm(candidate: IStorageCandidate): Observable<IStorageSettings> {
    return this.http.post<IStorageSettings>(`${this.baseUrl}/confirm`, candidate);
  }

  /** After confirming: new MinIO keys for the same endpoint and bucket. The server tests them first. */
  replaceKeys(candidate: IStorageCandidate): Observable<IStorageSettings> {
    return this.http.patch<IStorageSettings>(this.baseUrl, candidate);
  }

  /**
   * Asks AccreditMe to move the organisation's files: who to contact about it
   * (ACC-260, PR B2), and an optional note. Both go to AccreditMe only.
   */
  requestChange(contact: IStorageChangeContact, message: string): Observable<IStorageSettings> {
    const note = message.trim();
    const body: IStorageChangeContact & { message?: string } = {
      contactName: contact.contactName.trim(),
      contactEmail: contact.contactEmail.trim(),
      contactPhone: contact.contactPhone.trim(),
    };
    if (note) body.message = note;
    return this.http.post<IStorageSettings>(`${this.baseUrl}/change-request`, body);
  }
}
