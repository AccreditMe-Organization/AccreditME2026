/** GET /tenant/recycle-bin — one deleted, unpurged file. Never its key or location. */
export interface IRecycleBinItem {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  /** The record it came from. `name` null: that record no longer exists. */
  record: { type: string; id: string; name: string | null };
  deletedBy: { id: string; name: string } | null;
  deletedAt: Date;
  /** When the daily job purges it. */
  purgesAt: Date;
  daysLeft: number;
}
