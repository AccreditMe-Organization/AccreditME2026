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
  | 'STORAGE_NOT_CONFIGURED'
  | 'STORAGE_PROVIDER_NOT_ALLOWED'
  | 'STORAGE_ENDPOINT_NOT_ALLOWED'
  | 'STORAGE_UNAVAILABLE'
  | 'STORAGE_QUOTA_EXCEEDED'
  | 'STORAGE_LOCATION_IN_USE'
  | 'STORAGE_SETTINGS_INCOMPLETE'
  | 'FILE_MISSING'
  | 'FILE_EMPTY'
  | 'FILE_TOO_LARGE'
  | 'FILE_TYPE_NOT_ALLOWED'
  | 'FILE_UNAVAILABLE';

const STATUS: Readonly<Record<StorageRefusalCode, HttpStatus>> = {
  STORAGE_NOT_CONFIGURED: HttpStatus.SERVICE_UNAVAILABLE,
  STORAGE_PROVIDER_NOT_ALLOWED: HttpStatus.BAD_REQUEST,
  STORAGE_ENDPOINT_NOT_ALLOWED: HttpStatus.BAD_REQUEST,
  STORAGE_UNAVAILABLE: HttpStatus.BAD_GATEWAY,
  STORAGE_QUOTA_EXCEEDED: HttpStatus.CONFLICT,
  STORAGE_LOCATION_IN_USE: HttpStatus.CONFLICT,
  STORAGE_SETTINGS_INCOMPLETE: HttpStatus.BAD_REQUEST,
  FILE_MISSING: HttpStatus.BAD_REQUEST,
  FILE_EMPTY: HttpStatus.BAD_REQUEST,
  FILE_TOO_LARGE: HttpStatus.PAYLOAD_TOO_LARGE,
  FILE_TYPE_NOT_ALLOWED: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
  FILE_UNAVAILABLE: HttpStatus.CONFLICT,
};

/** ONE message per code, and the only place a refusal's wording is written. */
export const STORAGE_REFUSAL_MESSAGES: Readonly<Record<StorageRefusalCode, string>> = {
  STORAGE_NOT_CONFIGURED: "File storage isn't set up yet",
  STORAGE_PROVIDER_NOT_ALLOWED: "This storage option isn't available on this installation",
  STORAGE_ENDPOINT_NOT_ALLOWED: 'The storage endpoint must be a public HTTPS address',
  STORAGE_UNAVAILABLE: "File storage couldn't be reached. Try again.",
  STORAGE_QUOTA_EXCEEDED: "Your organization's file storage is full",
  STORAGE_LOCATION_IN_USE: 'Files are stored at this location. Changing it would make them unreadable.',
  STORAGE_SETTINGS_INCOMPLETE: 'Fill in every setting this storage option needs',
  FILE_MISSING: 'Choose a file to upload',
  FILE_EMPTY: 'The file is empty',
  FILE_TOO_LARGE: 'The file is larger than the upload limit',
  FILE_TYPE_NOT_ALLOWED: "This type of file can't be uploaded",
  FILE_UNAVAILABLE: 'This file is no longer available from its storage location',
};

export interface StorageRefusalDetails {
  /** FILE_TOO_LARGE, STORAGE_QUOTA_EXCEEDED */
  maxBytes?: number;
  /** STORAGE_LOCATION_IN_USE — how many live files are at the location. */
  fileCount?: number;
}

export class StorageRefusalException extends HttpException {
  constructor(
    readonly code: StorageRefusalCode,
    details: StorageRefusalDetails = {},
  ) {
    const status = STATUS[code];
    const message =
      code === 'STORAGE_LOCATION_IN_USE' && details.fileCount !== undefined
        ? details.fileCount === 1
          ? '1 file is stored at this location. Changing it would make it unreadable.'
          : `${details.fileCount} files are stored at this location. Changing it would make them unreadable.`
        : STORAGE_REFUSAL_MESSAGES[code];
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
