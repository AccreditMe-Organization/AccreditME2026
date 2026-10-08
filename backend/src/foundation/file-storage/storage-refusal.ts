import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Stable codes for every file-storage refusal a person can see — ACC-177.
 *
 * Same shape as AuthRefusalException (ACC-120 slice 9b): the code travels in
 * the body HttpExceptionFilter already sends, `{ statusCode, message, error,
 * code, ...details }`. The frontend maps the CODE to its own words in English
 * and Arabic; the message is English, fixed per code, for a person reading a
 * log or a client that ignores the code.
 */
export type StorageRefusalCode =
  | 'STORAGE_NOT_CONFIRMED'
  | 'STORAGE_ALREADY_CONFIRMED'
  | 'STORAGE_CHANGE_BY_PLATFORM'
  | 'STORAGE_TEST_FAILED'
  | 'STORAGE_NOT_CONFIGURED'
  | 'STORAGE_PROVIDER_NOT_ALLOWED'
  | 'STORAGE_ENDPOINT_NOT_ALLOWED'
  | 'STORAGE_UNAVAILABLE'
  | 'STORAGE_QUOTA_EXCEEDED'
  | 'STORAGE_SETTINGS_INCOMPLETE'
  | 'FILE_MISSING'
  | 'FILE_EMPTY'
  | 'FILE_TOO_LARGE'
  | 'FILE_TYPE_NOT_ALLOWED'
  | 'FILE_UNAVAILABLE'
  | 'FILE_RECORD_GONE'
  // ACC-185 — a SharePoint connection test's plain reasons, one per failure.
  | 'SHAREPOINT_SITE_URL_INVALID'
  | 'SHAREPOINT_TENANT_NOT_FOUND'
  | 'SHAREPOINT_CLIENT_NOT_FOUND'
  | 'SHAREPOINT_SECRET_INVALID'
  | 'SHAREPOINT_APP_DISABLED'
  | 'SHAREPOINT_SITE_NOT_FOUND'
  | 'SHAREPOINT_LIBRARY_NOT_FOUND'
  | 'SHAREPOINT_NO_WRITE_ACCESS';

const STATUS: Readonly<Record<StorageRefusalCode, HttpStatus>> = {
  STORAGE_NOT_CONFIRMED: HttpStatus.CONFLICT,
  STORAGE_ALREADY_CONFIRMED: HttpStatus.CONFLICT,
  STORAGE_CHANGE_BY_PLATFORM: HttpStatus.FORBIDDEN,
  STORAGE_TEST_FAILED: HttpStatus.BAD_REQUEST,
  STORAGE_NOT_CONFIGURED: HttpStatus.SERVICE_UNAVAILABLE,
  STORAGE_PROVIDER_NOT_ALLOWED: HttpStatus.BAD_REQUEST,
  STORAGE_ENDPOINT_NOT_ALLOWED: HttpStatus.BAD_REQUEST,
  STORAGE_UNAVAILABLE: HttpStatus.BAD_GATEWAY,
  STORAGE_QUOTA_EXCEEDED: HttpStatus.CONFLICT,
  STORAGE_SETTINGS_INCOMPLETE: HttpStatus.BAD_REQUEST,
  FILE_MISSING: HttpStatus.BAD_REQUEST,
  FILE_EMPTY: HttpStatus.BAD_REQUEST,
  FILE_TOO_LARGE: HttpStatus.PAYLOAD_TOO_LARGE,
  FILE_TYPE_NOT_ALLOWED: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
  FILE_UNAVAILABLE: HttpStatus.CONFLICT,
  FILE_RECORD_GONE: HttpStatus.CONFLICT,
  SHAREPOINT_SITE_URL_INVALID: HttpStatus.BAD_REQUEST,
  SHAREPOINT_TENANT_NOT_FOUND: HttpStatus.BAD_REQUEST,
  SHAREPOINT_CLIENT_NOT_FOUND: HttpStatus.BAD_REQUEST,
  SHAREPOINT_SECRET_INVALID: HttpStatus.BAD_REQUEST,
  SHAREPOINT_APP_DISABLED: HttpStatus.BAD_REQUEST,
  SHAREPOINT_SITE_NOT_FOUND: HttpStatus.BAD_REQUEST,
  SHAREPOINT_LIBRARY_NOT_FOUND: HttpStatus.BAD_REQUEST,
  SHAREPOINT_NO_WRITE_ACCESS: HttpStatus.BAD_REQUEST,
};

/** ONE message per code, and the only place a refusal's wording is written. */
export const STORAGE_REFUSAL_MESSAGES: Readonly<Record<StorageRefusalCode, string>> = {
  STORAGE_NOT_CONFIRMED: "File storage isn't set up yet. Ask your administrator.",
  STORAGE_ALREADY_CONFIRMED: 'Where files are stored has already been confirmed',
  STORAGE_CHANGE_BY_PLATFORM: 'Changing where files are stored is done by AccreditMe. Contact support.',
  STORAGE_TEST_FAILED: 'The storage connection test did not pass',
  STORAGE_NOT_CONFIGURED: "File storage isn't set up yet",
  STORAGE_PROVIDER_NOT_ALLOWED: "This storage option isn't available on this installation",
  STORAGE_ENDPOINT_NOT_ALLOWED: 'The storage endpoint must be a public HTTPS address',
  STORAGE_UNAVAILABLE: "File storage couldn't be reached. Try again.",
  STORAGE_QUOTA_EXCEEDED: "Your organization's file storage is full",
  STORAGE_SETTINGS_INCOMPLETE: 'Fill in every setting this storage option needs',
  FILE_MISSING: 'Choose a file to upload',
  FILE_EMPTY: 'The file is empty',
  FILE_TOO_LARGE: 'The file is larger than the upload limit',
  FILE_TYPE_NOT_ALLOWED: "This type of file can't be uploaded",
  FILE_UNAVAILABLE: 'This file is no longer available from its storage location',
  FILE_RECORD_GONE: 'The record this file came from no longer exists, so it cannot be restored',
  SHAREPOINT_SITE_URL_INVALID: "Enter the SharePoint site's address, starting https:// and on a .sharepoint.com host",
  SHAREPOINT_TENANT_NOT_FOUND: "Microsoft doesn't recognise this tenant ID",
  SHAREPOINT_CLIENT_NOT_FOUND: "Wrong tenant or client ID: this app isn't registered in that tenant",
  SHAREPOINT_SECRET_INVALID: 'The client secret is invalid or has expired',
  SHAREPOINT_APP_DISABLED: 'The app is disabled in your Microsoft tenant',
  SHAREPOINT_SITE_NOT_FOUND: 'Site not found, or the app has no access to it',
  SHAREPOINT_LIBRARY_NOT_FOUND: 'Library not found on this site, or the app has no access to it',
  SHAREPOINT_NO_WRITE_ACCESS: "The app can see the library but can't add files to it. Give it write access",
};

export interface StorageRefusalDetails {
  /** FILE_TOO_LARGE, STORAGE_QUOTA_EXCEEDED */
  maxBytes?: number;
  /** STORAGE_TEST_FAILED — the step of the connection test that failed. */
  failedStep?: string;
  /** STORAGE_TEST_FAILED — the code that step failed with. */
  cause?: string;
}

export class StorageRefusalException extends HttpException {
  constructor(
    readonly code: StorageRefusalCode,
    details: StorageRefusalDetails = {},
  ) {
    const status = STATUS[code];
    const message = STORAGE_REFUSAL_MESSAGES[code];
    super(
      {
        statusCode: status,
        message,
        error: HttpStatus[status]
          .toLowerCase()
          .split('_')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' '),
        code,
        ...details,
      },
      status,
    );
  }
}
