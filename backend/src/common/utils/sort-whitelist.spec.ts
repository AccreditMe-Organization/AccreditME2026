import { BadRequestException } from '@nestjs/common';
import { SortWhitelist, toSkipTake } from './sort-whitelist';

// ACC-78 — the shared list contract's two pieces of arithmetic-and-refusal.
// Tested here rather than only through a consuming endpoint: ~18 endpoints will
// depend on these, so a regression in either is a regression everywhere at
// once.
describe('SortWhitelist (ACC-78)', () => {
  const sort = new SortWhitelist(['name', 'createdAt', 'status'] as const, {
    column: 'createdAt',
    dir: 'desc',
  });

  describe('resolve', () => {
    // THE distinction that matters: absent and unknown are not the same thing.
    // No sortBy is the ordinary case — most callers never sort — and takes the
    // endpoint's default.
    it('falls back to the default when sortBy is ABSENT', () => {
      expect(sort.resolve(undefined)).toEqual({ createdAt: 'desc' });
    });

    // ...whereas an unknown column is a caller bug. Silently returning
    // differently-ordered data hides it, and the symptom surfaces weeks later
    // as "the sort is broken" with nothing pointing at the typo.
    it('REJECTS an unknown column rather than falling back', () => {
      expect(() => sort.resolve('passwordHash')).toThrow(BadRequestException);
      expect(() => sort.resolve('nmae')).toThrow(BadRequestException);
    });

    // The whole reason the whitelist exists: ordering by a scalar the endpoint
    // never returns is a weak oracle over hidden values, and any relation field
    // turns a typo into a 500. Neither is reachable.
    it('names the sortable columns in the rejection, so the caller can fix it', () => {
      expect(() => sort.resolve('nope')).toThrow(/name, createdAt, status/);
    });

    it('accepts a whitelisted column', () => {
      expect(sort.resolve('name')).toEqual({ name: 'desc' });
      expect(sort.resolve('status', 'asc')).toEqual({ status: 'asc' });
    });

    // Direction is independent of column validity — a caller may reverse the
    // default ordering without naming a column.
    it('honours sortDir against the default column', () => {
      expect(sort.resolve(undefined, 'asc')).toEqual({ createdAt: 'asc' });
    });

    // A sort menu built from this cannot drift from what the endpoint accepts,
    // which is the point of exposing it.
    it('advertises its sortable set', () => {
      expect(sort.sortable).toEqual(['name', 'createdAt', 'status']);
    });
  });

  describe('toSkipTake', () => {
    // The off-by-one this function exists to prevent. Page 1 is the FIRST page,
    // so it must skip nothing — every service deriving skip by hand is a place
    // to get this wrong.
    it('skips nothing on page 1', () => {
      expect(toSkipTake(1, 25)).toEqual({ skip: 0, take: 25, page: 1, pageSize: 25 });
    });

    it('skips a whole page per page beyond the first', () => {
      expect(toSkipTake(2, 25)).toMatchObject({ skip: 25, take: 25 });
      expect(toSkipTake(4, 10)).toMatchObject({ skip: 30, take: 10 });
    });

    // An unmigrated caller passes nothing and must still get a valid first
    // page — that is what made migrating ~18 endpoints tractable.
    it('defaults to page 1 at the endpoint default size when given nothing', () => {
      expect(toSkipTake(undefined, undefined)).toEqual({
        skip: 0,
        take: 25,
        page: 1,
        pageSize: 25,
      });
    });

    it('lets an endpoint set its own default page size', () => {
      expect(toSkipTake(undefined, undefined, 20)).toMatchObject({ take: 20, pageSize: 20 });
    });

    // Returns the RESOLVED page/pageSize, not the arguments, so the envelope
    // reports what was actually served rather than what was asked for.
    it('returns the resolved page and pageSize for the envelope', () => {
      expect(toSkipTake(3, undefined, 50)).toEqual({
        skip: 100,
        take: 50,
        page: 3,
        pageSize: 50,
      });
    });
  });
});
