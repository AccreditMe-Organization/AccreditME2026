// ACC-78 — mirrors the backend's IPaginatedResponse. Every list endpoint
// returns this shape; a bare array from a list endpoint is the pre-ACC-78
// contract and should not be reintroduced.
//
// Lives in shared/models rather than beside any one feature's service, because
// ~18 services will type against it.
export interface IPaginatedResponse<T> {
  data: T[];
  // Total MATCHING rows, not data.length. This is the field that makes a
  // paginator renderable and that the old notification paging lacked.
  total: number;
  // 1-based, matching the backend.
  page: number;
  pageSize: number;
}

// The query half. All optional: omitting everything asks for page 1 at the
// server's default size, which is what an unmigrated caller effectively did.
export interface IListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  // A column name the backend validates against a per-endpoint whitelist. An
  // unknown column is a 400, not a silent reorder — so a sort menu should be
  // built from what the endpoint advertises rather than from guessed names.
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  // ACC-78 — the active scope chip, if any. Frontend-only: no endpoint has a
  // `scope` param. It is here rather than as a second argument because a scope
  // means something different per list — `status` on Users, an open/overdue
  // predicate on Tasks — so the list component carries it and the caller's
  // source function decides what it maps to.
  scope?: string | null;
  // ACC-78 — named filters beyond the scope chip: org unit, position, and
  // whatever a future list needs. Kept as an open map rather than typed fields
  // because the component must not know what any of them mean — the caller's
  // source function maps each key to its endpoint's own parameter, exactly as
  // it does for `scope`.
  //
  // A null value means "not filtered" and is dropped from the URL rather than
  // written empty, so clearing a filter leaves a clean link.
  filters?: Record<string, string | null>;
}
