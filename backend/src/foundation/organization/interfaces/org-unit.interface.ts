/**
 * A unit's type, resolved from the org_unit_type lookup — ACC-137.
 *
 * ## Why the read path resolves this at all, when Committee does not
 *
 * `Committee` and `Meeting` return a bare `typeValueId` and leave the caller to
 * find the label. ACC-137 deliberately does not: `LookupValue` carries
 * `labelOverrideEn` / `labelOverrideAr`, which is how a tenant renames a system
 * value for itself, and a client that maps keys to labels from its own table
 * shows that tenant the wrong word. Resolving here is the only place the
 * override is guaranteed to be applied.
 *
 * ## Why BOTH labels, rather than one in "the reader's language"
 *
 * The ticket says "the resolved label in the reader's language". The backend has
 * no reliable reader-language signal on these endpoints, and ACC-79 already
 * settled that the UI language decides which of a record's two stored names is
 * shown — `nameEn` / `nameAr` are returned as a pair for exactly this reason.
 * So the pair is returned already override-resolved, and the frontend picks one.
 * That still satisfies what the instruction is protecting against: the client
 * never maps a KEY to a label, which is where the override would be lost.
 */
export interface IOrgUnitType {
  id: string;
  /** The stable key (`department`, `ward`). For logic, never for display. */
  key: string;
  /** `labelOverrideEn ?? labelEn` — the tenant's word if it set one. */
  labelEn: string;
  /** `labelOverrideAr ?? labelAr`. */
  labelAr: string;
  /**
   * The value is deactivated or hidden, but a unit still holds it.
   *
   * Such a unit keeps rendering its type — marked, never blank. A type that
   * silently disappeared from a column because an admin tidied the Lookups page
   * would read as data loss, and the acceptance criteria require it to stay.
   */
  isRetired: boolean;
}

export interface IOrgUnit {
  id: string;
  organizationId: string;
  parentId: string | null;
  nameEn: string;
  nameAr: string | null;
  code: string;
  /**
   * ACC-137 — SUPERSEDED by `typeValueId` / `typeValue`, and DELIBERATELY LEFT
   * IN PLACE AND UNCHANGED, both in name and in shape.
   *
   * Free text holding a lookup key by convention with nothing enforcing it. It
   * is tempting to rename this to `legacyType` and give `type` the resolved
   * object — and that breaks a live screen: `org-unit-tree.component.ts:72`
   * renders `{{ rowData.type ?? '—' }}`, so an object there prints
   * "[object Object]". Expand then contract applies to the API's shape exactly
   * as it does to the database's: the old field keeps its name and its type, the
   * new ones sit beside it, and the rename waits until nothing reads this.
   *
   * Still WRITTEN on create and update, not just read, so the container running
   * the old code keeps working across the deploy.
   */
  type: string | null;
  typeValueId: string | null;
  /** Resolved, or null for a unit with no type — see IOrgUnitType. */
  typeValue: IOrgUnitType | null;
  description: string | null;
  isActive: boolean;
  isCodeLocked: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  children?: IOrgUnit[];
}
