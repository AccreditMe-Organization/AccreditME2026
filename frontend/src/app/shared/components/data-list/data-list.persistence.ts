import { IListQuery } from '../../models/paginated-response';

// ACC-78 — list state has TWO lifetimes, and conflating them is what makes
// "restore my list" feel broken.
//
//   A VIEW is shareable and momentary. What you searched for, which page you
//   are on. It belongs in the URL, because the point of it is handing someone
//   a link that shows them what you were looking at.
//
//   A PREFERENCE is durable and personal. How you like this list sorted, how
//   many rows you want. It belongs in storage, because the point of it is not
//   having to set it again tomorrow.
//
// SEARCH AND PAGE ARE DELIBERATELY NOT PERSISTED. Restoring a search term
// someone typed last week — silently, on a fresh visit — makes a list look
// broken: rows are missing and the cause is a box they did not fill in this
// time. Restoring page 4 is the same problem with worse symptoms. Both are in
// the URL, so a shared link still carries them; they just do not follow the
// user around.
export interface PersistedListPreferences {
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  pageSize?: number;
  scope?: string | null;
  // ACC-78 — which columns this viewer hid. Stored rather than URL-synced on
  // purpose: a hidden column is a personal reading preference, not part of what
  // a shared link should impose on its recipient. Only the OVERRIDES are kept
  // (a column absent from the map is visible), so a table that later gains a
  // column shows it by default instead of inheriting someone's stale layout.
  hiddenCols?: string[];
}

const STORAGE_PREFIX = 'accreditme.list.';

// Every read and write is wrapped. localStorage throws outright in some
// contexts (private windows, browsers set to block site data), and a list that
// cannot remember a sort order must still render — so a storage failure is
// always "no preferences", never an error the user sees.
export function readPreferences(key: string): PersistedListPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    return raw ? (JSON.parse(raw) as PersistedListPreferences) : {};
  } catch {
    return {};
  }
}

export function writePreferences(key: string, prefs: PersistedListPreferences): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(prefs));
  } catch {
    // Nothing to do and nothing worth telling the user: they asked to sort a
    // list, not to save a setting.
  }
}

// URL params are namespaced by the list's own key, because a record page holds
// SEVERAL lists at once — Tasks, Members and Sub-committees on one Committee.
// Unnamespaced `?search=` would have all three reading each other's state.
export function urlParamsFor(
  key: string,
  query: IListQuery,
  scope: string | null,
): Record<string, string | null> {
  // null removes a param rather than writing an empty one, so a cleared filter
  // leaves a clean URL instead of `?q.search=&q.page=1`.
  return {
    [`${key}.q`]: query.search?.trim() ? query.search : null,
    [`${key}.sort`]: query.sortBy ?? null,
    [`${key}.dir`]: query.sortDir ?? null,
    [`${key}.page`]: query.page && query.page > 1 ? String(query.page) : null,
    [`${key}.scope`]: scope,
    // Namespaced twice — by list key and by `.f.` — so a filter named `page`
    // or `sort` cannot collide with the list's own params.
    ...Object.fromEntries(
      Object.entries(query.filters ?? {}).map(([name, value]) => [
        `${key}.f.${name}`,
        value?.trim() ? value : null,
      ]),
    ),
  };
}

export function readUrlParams(
  key: string,
  params: Record<string, string | undefined>,
): { query: IListQuery; scope: string | null } {
  const page = Number(params[`${key}.page`]);
  const dir = params[`${key}.dir`];
  return {
    query: {
      search: params[`${key}.q`] ?? undefined,
      sortBy: params[`${key}.sort`] ?? undefined,
      // Guarded rather than cast: these come from a URL anyone can edit, and a
      // bad value should fall back to the default rather than reach the
      // backend and earn a 400. The backend whitelist is the real gate; this
      // just avoids sending obvious nonsense.
      sortDir: dir === 'asc' || dir === 'desc' ? dir : undefined,
      page: Number.isFinite(page) && page > 0 ? page : undefined,
    },
    scope: params[`${key}.scope`] ?? null,
  };
}

// Filters are read separately because the caller declares which names exist —
// the component cannot know, and scanning for any `.f.*` param would let a
// crafted URL inject filter names the list never offered.
export function readUrlFilters(
  key: string,
  names: readonly string[],
  params: Record<string, string | undefined>,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const name of names) {
    out[name] = params[`${key}.f.${name}`] ?? null;
  }
  return out;
}
