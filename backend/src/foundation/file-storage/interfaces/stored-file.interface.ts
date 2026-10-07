/** The part of a multer file this module reads. */
export interface IUploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** A stored file as a client sees it — never its key or location. */
export interface IStoredFileSummary {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: Date;
}

/**
 * Where to fetch a file for the next fifteen minutes. `viaApi` means `url` is
 * a path on this API (a local folder's token route), to be joined to the API
 * base; otherwise it is a pre-signed storage URL to open as it is.
 */
export interface IFileDownload {
  url: string;
  viaApi: boolean;
  expiresAt: string;
}
