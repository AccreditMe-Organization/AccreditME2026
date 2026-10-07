export interface ITaskEvidence {
  id: string;
  organizationId: string;
  taskId: string;
  type: string; // TaskEvidenceType
  content: string | null;
  s3Key: string | null;
  fileName: string | null;
  fileSize: number | null;
  mimeType: string | null;
  url: string | null;
  linkTitle: string | null;
  refType: string | null; // TaskEvidenceRefType
  refId: string | null;
  refDisplay: string | null;
  uploadedById: string;
  uploadedAt: Date;
  // ACC-177 — file evidence points at its StoredFile; evidence is soft-deleted.
  storedFileId: string | null;
  deletedAt: Date | null;
  deletedById: string | null;
}

/**
 * ACC-177 — one piece of evidence as the evidence list shows it. A file is
 * its summary only: never its storage key or location.
 */
export interface ITaskEvidenceView {
  id: string;
  type: string; // TaskEvidenceType — ATTACHMENT is a file
  url: string | null;
  linkTitle: string | null;
  refType: string | null;
  refId: string | null;
  refDisplay: string | null;
  file: {
    id: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    uploadedAt: Date;
  } | null;
  uploadedBy: { id: string; name: string };
  uploadedAt: Date;
  /** The viewer added it, is still on the task, and the task is open or on hold. */
  canDelete: boolean;
}

export interface ITaskEvidenceList {
  items: ITaskEvidenceView[];
  /** The viewer may add evidence: an active assignee on an open or on-hold task. */
  canAdd: boolean;
  /** The task is completed or cancelled: its evidence is read-only for everyone. */
  closed: boolean;
}
