import { firstValueFrom } from 'rxjs';
import { clientSideSource } from './data-list.source';

interface Row {
  id: string;
  name: string;
  email: string;
  order: number;
}

const ROWS: Row[] = [
  { id: '1', name: 'Nora Al-Otaibi', email: 'n.otaibi@example.com', order: 3 },
  { id: '2', name: 'Fahad Al-Anazi', email: 'f.anazi@example.com', order: 1 },
  { id: '3', name: 'Huda Zahrani', email: 'h.zahrani@example.com', order: 2 },
];

// ACC-78 — the client-side half of the shared source. Tested directly because
// Workflow Stages depends on it entirely: stages arrive nested inside
// getTemplate(), there is no endpoint to paginate, so every guarantee the
// backend gives a server-backed list has to hold here in memory instead.
describe('clientSideSource (ACC-78)', () => {
  const source = clientSideSource<Row>(() => ROWS, {
    searchFields: (r) => [r.name, r.email],
    comparators: {
      name: (a, b) => a.name.localeCompare(b.name),
      order: (a, b) => a.order - b.order,
    },
    defaultSort: { column: 'order', dir: 'asc' },
  });

  it('returns the whole set as one page when no pageSize is given', async () => {
    const page = await firstValueFrom(source({}));

    expect(page.data).toHaveSize(3);
    expect(page.total).toBe(3);
  });

  it('searches every declared field, not just the first', async () => {
    // Matches on EMAIL only — the name contains no "zahrani@".
    const page = await firstValueFrom(source({ search: 'h.zahrani@' }));

    expect(page.data.map((r) => r.id)).toEqual(['3']);
  });

  it('is case-insensitive', async () => {
    const page = await firstValueFrom(source({ search: 'NORA' }));

    expect(page.data.map((r) => r.id)).toEqual(['1']);
  });

  // THE assertion that keeps a paginator honest, and the one most likely to be
  // got wrong: total counts what matched, not what was returned. If it counted
  // the slice instead, a paginator would think there was only ever one page.
  it('counts total AFTER filtering and BEFORE slicing', async () => {
    const page = await firstValueFrom(source({ pageSize: 1, page: 1 }));

    expect(page.data).toHaveSize(1);
    expect(page.total).toBe(3);
  });

  it('slices the requested page', async () => {
    const first = await firstValueFrom(source({ pageSize: 2, page: 1, sortBy: 'name' }));
    const second = await firstValueFrom(source({ pageSize: 2, page: 2, sortBy: 'name' }));

    expect(first.data).toHaveSize(2);
    expect(second.data).toHaveSize(1);
    // No row appears on both pages — an off-by-one in the slice is exactly how
    // that happens.
    const ids = [...first.data, ...second.data].map((r) => r.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('applies the default sort when none is requested', async () => {
    const page = await firstValueFrom(source({}));

    expect(page.data.map((r) => r.order)).toEqual([1, 2, 3]);
  });

  it('sorts by a requested comparator in both directions', async () => {
    const asc = await firstValueFrom(source({ sortBy: 'name', sortDir: 'asc' }));
    const desc = await firstValueFrom(source({ sortBy: 'name', sortDir: 'desc' }));

    expect(asc.data[0]!.name).toBe('Fahad Al-Anazi');
    expect(desc.data[0]!.name).toBe('Nora Al-Otaibi');
  });

  // A column with no comparator is simply not sortable — the same answer the
  // server gives, minus the throw, because nothing but this table's own sort
  // menu can reach it.
  it('leaves order untouched for a column with no comparator', async () => {
    const page = await firstValueFrom(source({ sortBy: 'email' }));

    expect(page.data.map((r) => r.id)).toEqual(['1', '2', '3']);
  });

  // Sorting must not mutate the caller's array — the parent still renders from
  // it, and a source that reorders its input corrupts what it was given.
  it('does not mutate the source array', async () => {
    const before = ROWS.map((r) => r.id);
    await firstValueFrom(source({ sortBy: 'name', sortDir: 'desc' }));

    expect(ROWS.map((r) => r.id)).toEqual(before);
  });

  it('reports an empty result without breaking the page arithmetic', async () => {
    const page = await firstValueFrom(source({ search: 'nobody' }));

    expect(page.data).toHaveSize(0);
    expect(page.total).toBe(0);
    expect(page.page).toBe(1);
  });

  // The source reads items through a FUNCTION, so a parent whose array changes
  // gets fresh rows without rebuilding the source.
  it('reads the array on every call rather than closing over a snapshot', async () => {
    let live: Row[] = [ROWS[0]!];
    const dynamic = clientSideSource<Row>(() => live, { searchFields: (r) => [r.name] });

    expect((await firstValueFrom(dynamic({}))).total).toBe(1);
    live = ROWS;
    expect((await firstValueFrom(dynamic({}))).total).toBe(3);
  });
});

// ACC-160 — NULLS LAST, opt-in per column, in BOTH directions.
describe('clientSideSource nullsLast (ACC-160)', () => {
  interface Named {
    id: string;
    nameEn: string;
    nameAr: string | null;
  }
  // Deliberately interleaved, so "last" cannot be an accident of input order.
  const NAMED: Named[] = [
    { id: 'a', nameEn: 'Auditor', nameAr: 'مدقق' },
    { id: 'b', nameEn: 'Buyer', nameAr: null },
    { id: 'c', nameEn: 'Clerk', nameAr: 'كاتب' },
    { id: 'd', nameEn: 'Driver', nameAr: '  ' },
    { id: 'e', nameEn: 'Editor', nameAr: 'محرر' },
  ];
  const nameAr = (a: Named, b: Named): number => (a.nameAr ?? '').localeCompare(b.nameAr ?? '');
  const ids = async (src: ReturnType<typeof clientSideSource<Named>>, sortDir: 'asc' | 'desc'): Promise<string[]> =>
    (await firstValueFrom(src({ sortBy: 'nameAr', sortDir }))).data.map((r) => r.id);

  const withOption = clientSideSource<Named>(() => NAMED, {
    searchFields: (r) => [r.nameEn, r.nameAr],
    comparators: { nameAr, nameEn: (a, b) => a.nameEn.localeCompare(b.nameEn) },
    nullsLast: { nameAr: (r) => r.nameAr },
  });

  // THE RULE. The two unnamed rows (null, and whitespace-only) come last in
  // both directions, while the named ones really are reversed — the second
  // half is what proves direction is still applied, not ignored.
  it('puts unnamed rows last when sorted ascending AND descending', async () => {
    const asc = await ids(withOption, 'asc');
    const desc = await ids(withOption, 'desc');

    expect(asc.slice(3).sort()).toEqual(['b', 'd']);
    expect(desc.slice(3).sort()).toEqual(['b', 'd']);
    expect(desc.slice(0, 3)).toEqual([...asc.slice(0, 3)].reverse());
  });

  // The boundary: the option is per column. Sorting by another column orders
  // every row by that column, unnamed ones included.
  it('leaves a column that did not opt in exactly as before', async () => {
    const page = await firstValueFrom(withOption({ sortBy: 'nameEn', sortDir: 'desc' }));
    expect(page.data.map((r) => r.id)).toEqual(['e', 'd', 'c', 'b', 'a']);
  });

  // Every existing list is constructed without the option and must sort
  // exactly as it did: here '' sorts FIRST ascending, which is the behaviour
  // the option exists to change.
  it('is off entirely when the option is not given', async () => {
    const plain = clientSideSource<Named>(() => NAMED, {
      searchFields: (r) => [r.nameEn],
      comparators: { nameAr },
    });
    const asc = await ids(plain, 'asc');
    expect(asc.slice(0, 2).sort()).toEqual(['b', 'd']);
  });
});

