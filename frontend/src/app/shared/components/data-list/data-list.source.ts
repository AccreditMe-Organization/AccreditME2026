import { Observable, of } from 'rxjs';
import { IListQuery, IPaginatedResponse } from '../../models/paginated-response';

// ACC-78 — how DataListComponent gets its rows.
//
// ONE function shape for both worlds. The component never asks whether its data
// comes from an endpoint or an array in memory; it calls this and renders what
// comes back.
//
// That matters because the proving set contains both. Users and Roles are
// server-paginated. Workflow Stages is NOT — stages arrive nested inside
// getTemplate() as `template.stages`, and there is no GET /stages to paginate.
// Without a shared shape, a client-side table would either reimplement search
// and sort in its own component (once per table) or force a fake endpoint into
// existence.
export type DataListSource<T> = (query: IListQuery) => Observable<IPaginatedResponse<T>>;

// Turns a plain array into a DataListSource, doing in memory exactly what the
// backend does in SQL.
//
// DELIBERATELY NOT a general-purpose client-side table engine. It does search,
// sort and slice, and nothing else — the moment a client-side list needs more
// than that, it has outgrown being an array and wants an endpoint.
export function clientSideSource<T>(
  items: () => readonly T[],
  options: {
    // Which fields free-text search reads. Explicit rather than "every string
    // field", for the same reason the backend whitelists its search columns:
    // what a search covers is a decision, and searching a field the reader
    // cannot see produces matches that look like bugs.
    searchFields: (item: T) => readonly (string | null | undefined)[];
    // Sort comparators by column key, mirroring the backend's sort whitelist.
    // A column with no comparator is simply not sortable, which is the same
    // answer the server gives — it just does not need to throw, because
    // nothing but this table's own sort menu can reach it.
    comparators?: Record<string, (a: T, b: T) => number>;
    defaultSort?: { column: string; dir: 'asc' | 'desc' };
  },
): DataListSource<T> {
  return (query: IListQuery) => {
    let rows = [...items()];

    const term = query.search?.trim().toLowerCase();
    if (term) {
      rows = rows.filter((row) =>
        options
          .searchFields(row)
          .some((field) => (field ?? '').toLowerCase().includes(term)),
      );
    }

    const sortColumn = query.sortBy ?? options.defaultSort?.column;
    const comparator = sortColumn ? options.comparators?.[sortColumn] : undefined;
    if (comparator) {
      const dir = query.sortDir ?? options.defaultSort?.dir ?? 'asc';
      rows.sort((a, b) => (dir === 'asc' ? comparator(a, b) : comparator(b, a)));
    }

    // `total` is the count AFTER filtering and BEFORE slicing — the same thing
    // the backend's count() means. Getting this wrong is how a paginator ends
    // up offering pages that come back empty.
    const total = rows.length;
    const page = query.page ?? 1;
    // No pageSize means "everything", which is the ordinary case for a
    // client-side list small enough to be an array. The `|| 1` guards an empty
    // result, where a pageSize of 0 would make the slice arithmetic nonsense.
    const pageSize = query.pageSize ?? (total || 1);
    const start = (page - 1) * pageSize;

    return of({ data: rows.slice(start, start + pageSize), total, page, pageSize });
  };
}
