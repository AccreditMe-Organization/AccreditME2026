// ACC-78 — the single response shape every list endpoint returns.
//
// Before this, EVERY list endpoint returned a bare array and only
// GET /notifications paginated at all — and it returned no total, so a client
// could fetch a page and still not know whether more existed. A shared
// envelope is a breaking change to ~15-18 endpoints, taken deliberately once
// rather than per-endpoint as each list grows.
//
// PAGE-BASED, not offset-based. The one endpoint that already paginated used
// limit/offset, so this is the odd shape rather than the established one — and
// /notifications is migrated onto it in the same ticket rather than being left
// as the exception. A single contract is worth more than matching the one
// implementation that predates it.
export interface IPaginatedResponse<T> {
  data: T[];
  // TOTAL MATCHING ROWS, not the length of `data` — it is what the caller
  // cannot compute for itself, and the reason the old notification paging was
  // unusable for a paginator.
  total: number;
  // 1-based. Page 1 is the first page, so an empty result set still reports
  // page 1 rather than a 0 that means nothing.
  page: number;
  pageSize: number;
}

// Convenience for services: builds the envelope so no call site assembles it
// by hand and gets a field name subtly wrong.
export function paginated<T>(
  data: T[],
  total: number,
  page: number,
  pageSize: number,
): IPaginatedResponse<T> {
  return { data, total, page, pageSize };
}
