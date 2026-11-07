import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AwaitingMeQueryDto } from './awaiting-me-query.dto';

// ACC-281 — take is 1 to 50; anything else is a 400 (a validation error here).
// skip is 0 or more. Both optional.
const errors = (query: Record<string, unknown>) => validateSync(plainToInstance(AwaitingMeQueryDto, query));

describe('AwaitingMeQueryDto (ACC-281)', () => {
  it('accepts no parameters, and any take from 1 to 50 with a skip of 0 or more', () => {
    expect(errors({})).toHaveLength(0);
    for (const take of ['1', '5', '50']) expect(errors({ take, skip: '0' })).toHaveLength(0);
    expect(errors({ skip: '120' })).toHaveLength(0);
  });

  it.each([['0'], ['51'], ['1.5'], ['x'], ['-1']])('refuses take=%s', (take) => {
    expect(errors({ take }).length).toBeGreaterThan(0);
  });

  it.each([['-1'], ['2.5'], ['x']])('refuses skip=%s', (skip) => {
    expect(errors({ skip }).length).toBeGreaterThan(0);
  });
});
