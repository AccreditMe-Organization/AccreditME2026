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
}
