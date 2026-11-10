/**
 * ACC-280 — GET /tasks/record-choices' contract without a database: the DTO's
 * bounds (the 50 cap), how many queries a page costs, and that a caller with no
 * Create tasks key reads nothing. The rows themselves are pinned on a real
 * Postgres (task-record-choices.db-spec.ts).
 */
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RecordChoicesQueryDto } from './dto/record-choices-query.dto';
import { createTypes, mayCreateTasks, recordChoices } from './task-record-choices';
import type { PrismaService } from '../../prisma/prisma.service';

const ORG = 'org-a';
const KEY = 'committees:create_tasks';
const VIEW = 'committees:view';

function client(answers: unknown[][] = []) {
  const $queryRaw = jest.fn(() => Promise.resolve(answers.shift() ?? []));
  return { $queryRaw } as unknown as Pick<PrismaService, '$queryRaw'> & { $queryRaw: jest.Mock };
}

const errors = (query: Record<string, unknown>) =>
  validateSync(plainToInstance(RecordChoicesQueryDto, query)).map((e) => e.property);

describe('GET /tasks/record-choices (ACC-280)', () => {
  describe('the query', () => {
    it('takes 1 to 50 a page, whole numbers only, and skip from 0: anything else is a 400', () => {
      expect(errors({ type: 'COMMITTEE', take: '50', skip: '0' })).toEqual([]);
      expect(errors({ type: 'COMMITTEE', take: '1' })).toEqual([]);
      expect(errors({ type: 'COMMITTEE', take: '0' })).toEqual(['take']);
      expect(errors({ type: 'COMMITTEE', take: '51' })).toEqual(['take']);
      expect(errors({ type: 'COMMITTEE', take: '1.5' })).toEqual(['take']);
      expect(errors({ type: 'COMMITTEE', skip: '-1' })).toEqual(['skip']);
    });

    it('needs a type, and a language of en or ar', () => {
      expect(errors({})).toEqual(['type']);
      expect(errors({ type: 'COMMITTEE', lang: 'fr' })).toEqual(['lang']);
    });
  });

  describe('what a page costs', () => {
    it('two queries for any page, the rows and both counts, sent together', async () => {
      const db = client([[{ id: 'c-1', nameEn: 'Quality', nameAr: null }], [{ total: 7n, matching: 1n }]]);
      const page = await recordChoices(db, plainToInstance(RecordChoicesQueryDto, { type: 'COMMITTEE', q: 'qual', take: 50 }), ORG, {
        id: 'u-1',
        permissions: [KEY, VIEW],
      });
      expect(db.$queryRaw).toHaveBeenCalledTimes(2);
      expect(page).toEqual({ items: [{ id: 'c-1', nameEn: 'Quality', nameAr: null }], total: 7, matching: 1 });
    });

    it('a type the caller holds no Create tasks key on: an empty page, and nothing read', async () => {
      const db = client();
      const page = await recordChoices(db, plainToInstance(RecordChoicesQueryDto, { type: 'COMMITTEE' }), ORG, { id: 'u-1', permissions: [VIEW] });
      expect(page).toEqual({ items: [], total: 0, matching: 0 });
      expect(db.$queryRaw).not.toHaveBeenCalled();
    });

    it('a type with no choices entry: an empty page, and nothing read (fail closed)', async () => {
      const db = client();
      const page = await recordChoices(db, plainToInstance(RecordChoicesQueryDto, { type: 'MEETING' }), ORG, {
        id: 'u-1',
        permissions: [KEY, VIEW, 'meetings:view'],
      });
      expect(page).toEqual({ items: [], total: 0, matching: 0 });
      expect(db.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('create.types, and "may create tasks at all"', () => {
    it('a key holder with the view permission: no query at all', async () => {
      const db = client();
      expect(await createTypes(db, { id: 'u-1', permissions: [KEY, VIEW] }, ORG)).toEqual(['COMMITTEE']);
      expect(await mayCreateTasks(db, { id: 'u-1', permissions: [KEY, VIEW] }, ORG)).toBe(true);
      expect(db.$queryRaw).not.toHaveBeenCalled();
    });

    it('no key: nothing, and no query', async () => {
      const db = client();
      expect(await createTypes(db, { id: 'u-1', permissions: [VIEW] }, ORG)).toEqual([]);
      expect(db.$queryRaw).not.toHaveBeenCalled();
    });

    it('the key without the view: ONE membership query decides it', async () => {
      const member = client([[{ member: true }]]);
      expect(await createTypes(member, { id: 'u-1', permissions: [KEY] }, ORG)).toEqual(['COMMITTEE']);
      expect(member.$queryRaw).toHaveBeenCalledTimes(1);
      const stranger = client([[{ member: false }]]);
      expect(await mayCreateTasks(stranger, { id: 'u-2', permissions: [KEY] }, ORG)).toBe(false);
      expect(stranger.$queryRaw).toHaveBeenCalledTimes(1);
    });
  });
});
