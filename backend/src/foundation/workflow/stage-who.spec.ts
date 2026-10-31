import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { HttpException } from '@nestjs/common';
import {
  assertWhoShape,
  assigneeKindsFor,
  entryKey,
  STAGE_ASSIGNEE_KINDS,
  whoAuditEntries,
  whoSentence,
  type WhoEntryForSentence,
  type WhoEntryInput,
} from './stage-who';
import { UpdateWorkflowStageDto } from './dto/update-workflow-stage.dto';
import type { StageWhoMode } from '../../../generated/prisma/client';

const ROUTES = { unit: true, committee: true };
const NO_ROUTES = { unit: false, committee: false };

/** The refusal code a call throws, or undefined. */
function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return ((e as HttpException).getResponse() as { code?: string }).code;
  }
}

const shape = (mode: StageWhoMode, entries: WhoEntryInput[], routes = ROUTES) =>
  codeOf(() => assertWhoShape('COMMITTEE', { mode, entries }, routes));

describe('stage-who (ACC-271 PR 3)', () => {
  describe('the DTO (shape only)', () => {
    const errors = async (body: unknown) =>
      (await validate(plainToInstance(UpdateWorkflowStageDto, body), { whitelist: true, forbidNonWhitelisted: true })).map((e) => e.property);

    it('accepts a who with a mode and entries of known kinds', async () => {
      expect(await errors({ who: { mode: 'ANY_ONE', entries: [{ kind: 'CREATOR' }, { kind: 'SPECIFIC_USER', userId: 'u1' }] } })).toEqual([]);
    });

    it('refuses an unknown mode, an unknown kind, a non-string id and an unknown field', async () => {
      expect(await errors({ who: { mode: 'MAJORITY', entries: [{ kind: 'CREATOR' }] } })).toEqual(['who']);
      expect(await errors({ who: { mode: 'ANY_ONE', entries: [{ kind: 'ROLE' }] } })).toEqual(['who']);
      expect(await errors({ who: { mode: 'ANY_ONE', entries: [{ kind: 'SPECIFIC_USER', userId: 42 }] } })).toEqual(['who']);
      expect(await errors({ who: { mode: 'ANY_ONE', entries: [{ kind: 'CREATOR', roleId: 'r' }] } })).toEqual(['who']);
    });

    it('caps what one request may carry at 20 entries', async () => {
      const entries = Array.from({ length: 21 }, (_, i) => ({ kind: 'SPECIFIC_USER', userId: `u${i}` }));
      expect(await errors({ who: { mode: 'ANY_ONE', entries } })).toEqual(['who']);
    });

    it('leaves who optional, so a save without it is unchanged', async () => {
      expect(await errors({ nameEn: 'Review' })).toEqual([]);
    });
  });

  describe('assertWhoShape', () => {
    it('needs at least one entry', () => {
      expect(shape('ANY_ONE', [])).toBe('WHO_ENTRIES_REQUIRED');
    });

    it('refuses two identical entries, an empty id counting as not set', () => {
      expect(shape('ANY_ONE', [{ kind: 'SPECIFIC_USER', userId: 'u1' }, { kind: 'SPECIFIC_USER', userId: 'u1' }])).toBe('WHO_ENTRY_DUPLICATE');
      expect(shape('ANY_ONE', [{ kind: 'ORG_UNIT_HEAD', orgUnitId: null }, { kind: 'ORG_UNIT_HEAD', orgUnitId: '' }])).toBe('WHO_ENTRY_DUPLICATE');
      expect(shape('ANY_ONE', [{ kind: 'SPECIFIC_USER', userId: 'u1' }, { kind: 'SPECIFIC_USER', userId: 'u2' }])).toBeUndefined();
    });

    it('requires what each kind needs', () => {
      expect(shape('ANY_ONE', [{ kind: 'SPECIFIC_USER' }])).toBe('WHO_ENTRY_INCOMPLETE');
      expect(shape('ANY_ONE', [{ kind: 'POSITION_IN_UNIT', positionId: 'p1' }])).toBe('WHO_ENTRY_INCOMPLETE');
      expect(shape('ANY_ONE', [{ kind: 'POSITION_IN_UNIT', orgUnitId: 'o1' }])).toBe('WHO_ENTRY_INCOMPLETE');
      expect(shape('ANY_ONE', [{ kind: 'POSITION_IN_UNIT', positionId: 'p1', orgUnitId: 'o1' }])).toBeUndefined();
    });

    it('refuses a field the kind does not use, but not a null one', () => {
      expect(shape('ANY_ONE', [{ kind: 'CREATOR', userId: 'u1' }])).toBe('WHO_ENTRY_FIELD_NOT_USED');
      expect(shape('ANY_ONE', [{ kind: 'SPECIFIC_USER', userId: 'u1', orgUnitId: 'o1' }])).toBe('WHO_ENTRY_FIELD_NOT_USED');
      expect(shape('ANY_ONE', [{ kind: 'ORG_UNIT_HEAD', orgUnitId: 'o1', committeeId: 'c1' }])).toBe('WHO_ENTRY_FIELD_NOT_USED');
      expect(shape('ANY_ONE', [{ kind: 'CREATOR', userId: null, positionId: null }])).toBeUndefined();
    });

    it("allows the record's unit or committee only where the record type has the route", () => {
      expect(shape('ANY_ONE', [{ kind: 'ORG_UNIT_HEAD' }], NO_ROUTES)).toBe('WHO_RECORD_ROUTE_NOT_AVAILABLE');
      expect(shape('ANY_ONE', [{ kind: 'COMMITTEE' }], NO_ROUTES)).toBe('WHO_RECORD_ROUTE_NOT_AVAILABLE');
      expect(shape('ANY_ONE', [{ kind: 'ORG_UNIT_HEAD', orgUnitId: 'o1' }], NO_ROUTES)).toBeUndefined();
      expect(shape('ANY_ONE', [{ kind: 'COMMITTEE', committeeId: 'c1' }], NO_ROUTES)).toBeUndefined();
      expect(shape('ANY_ONE', [{ kind: 'ORG_UNIT_HEAD' }])).toBeUndefined();
    });

    it('allows a Committee vote only for a single Committee entry', () => {
      expect(shape('COMMITTEE_VOTE', [{ kind: 'COMMITTEE', committeeId: 'c1' }])).toBeUndefined();
      expect(shape('COMMITTEE_VOTE', [{ kind: 'COMMITTEE' }])).toBeUndefined();
      expect(shape('COMMITTEE_VOTE', [{ kind: 'COMMITTEE', committeeId: 'c1' }, { kind: 'COMMITTEE', committeeId: 'c2' }])).toBe(
        'COMMITTEE_VOTE_NEEDS_ONE_COMMITTEE',
      );
      expect(shape('COMMITTEE_VOTE', [{ kind: 'COMMITTEE', committeeId: 'c1' }, { kind: 'CREATOR' }])).toBe('COMMITTEE_VOTE_NEEDS_ONE_COMMITTEE');
      expect(shape('COMMITTEE_VOTE', [{ kind: 'SPECIFIC_USER', userId: 'u1' }])).toBe('COMMITTEE_VOTE_NEEDS_ONE_COMMITTEE');
    });

    it('refuses an unknown mode as a refusal, not a crash', () => {
      expect(shape('MAJORITY' as StageWhoMode, [{ kind: 'CREATOR' }])).toBe('WHO_MODE_UNKNOWN');
    });

    it('refuses a kind the record type does not offer', () => {
      const original = STAGE_ASSIGNEE_KINDS.COMMITTEE;
      (STAGE_ASSIGNEE_KINDS as Record<string, readonly string[]>).COMMITTEE = ['CREATOR'];
      try {
        expect(shape('ANY_ONE', [{ kind: 'SPECIFIC_USER', userId: 'u1' }])).toBe('WHO_KIND_NOT_ALLOWED');
      } finally {
        (STAGE_ASSIGNEE_KINDS as Record<string, readonly string[]>).COMMITTEE = original;
      }
    });

    it('returns the entries with only the fields their kind uses', () => {
      expect(assertWhoShape('COMMITTEE', { mode: 'ANY_ONE', entries: [{ kind: 'ORG_UNIT_HEAD', orgUnitId: '' }] }, ROUTES)).toEqual([
        { kind: 'ORG_UNIT_HEAD', userId: null, positionId: null, orgUnitId: null, committeeId: null, committeeRoleValueId: null },
      ]);
    });
  });

  it('offers every kind on every record type, served as assigneeKinds', () => {
    expect(assigneeKindsFor('COMMITTEE')).toEqual(['SPECIFIC_USER', 'POSITION_IN_UNIT', 'ORG_UNIT_HEAD', 'CREATOR', 'COMMITTEE']);
    for (const kinds of Object.values(STAGE_ASSIGNEE_KINDS)) expect(kinds.length).toBeGreaterThan(0);
  });

  it('identifies an entry by its kind and the fields it uses', () => {
    expect(entryKey({ kind: 'CREATOR', userId: 'ignored' })).toBe(entryKey({ kind: 'CREATOR' }));
    expect(entryKey({ kind: 'COMMITTEE', committeeId: 'c1' })).not.toBe(entryKey({ kind: 'COMMITTEE', committeeId: 'c1', committeeRoleValueId: 'r1' }));
  });

  describe('whoSentence, in both languages', () => {
    const e = (entry: WhoEntryInput & Partial<WhoEntryForSentence>): WhoEntryForSentence => ({
      userId: null,
      positionId: null,
      orgUnitId: null,
      committeeId: null,
      committeeRoleValueId: null,
      ...entry,
    }) as WhoEntryForSentence;
    const user = e({ kind: 'SPECIFIC_USER', userId: 'u1', userName: 'Huda Al-Harbi' });
    const position = e({
      kind: 'POSITION_IN_UNIT',
      positionId: 'p1',
      orgUnitId: 'o1',
      positionNameEn: 'Team Leader',
      positionNameAr: 'قائد الفريق',
      orgUnitNameEn: 'Quality Department',
      orgUnitNameAr: 'إدارة الجودة',
    });
    const head = e({ kind: 'ORG_UNIT_HEAD', orgUnitId: 'o1', orgUnitNameEn: 'Quality Department', orgUnitNameAr: 'إدارة الجودة' });
    const recordHead = e({ kind: 'ORG_UNIT_HEAD' });
    const creator = e({ kind: 'CREATOR' });
    const committee = e({ kind: 'COMMITTEE', committeeId: 'c1', committeeNameEn: 'Quality Committee', committeeNameAr: 'لجنة الجودة' });
    const committeeRole = e({
      kind: 'COMMITTEE',
      committeeId: 'c1',
      committeeRoleValueId: 'r1',
      committeeNameEn: 'Quality Committee',
      committeeNameAr: 'لجنة الجودة',
      roleLabelEn: 'Chairman',
      roleLabelAr: 'رئيس اللجنة',
    });
    const recordCommittee = e({ kind: 'COMMITTEE' });

    it.each([
      ['a person', user, 'Huda Al-Harbi.', 'Huda Al-Harbi.'],
      ['a position in a unit', position, 'Whoever holds Team Leader in Quality Department.', 'من يشغل وظيفة قائد الفريق في إدارة الجودة.'],
      ['the head of a unit', head, 'The head of Quality Department.', 'من يرأس إدارة الجودة.'],
      ["the head of the record's unit", recordHead, "The head of the record's unit.", 'من يرأس وحدة السجل.'],
      ['the creator', creator, 'Whoever created the record.', 'من أنشأ السجل.'],
      ['a committee', committee, 'The members of Quality Committee.', 'أعضاء لجنة الجودة.'],
      ['a committee role', committeeRole, 'The members of Quality Committee in the role Chairman.', 'أعضاء لجنة الجودة بدور رئيس اللجنة.'],
      ["the record's committee", recordCommittee, "The members of the record's committee.", 'أعضاء لجنة السجل.'],
    ])('reads %s on its own (Any one of them)', (_name, entry, en, ar) => {
      expect(whoSentence('ANY_ONE', [entry])).toEqual({ en, ar });
    });

    it('joins several with "or" for Any one of them', () => {
      expect(whoSentence('ANY_ONE', [head, position])).toEqual({
        en: 'Any one of: the head of Quality Department, or whoever holds Team Leader in Quality Department.',
        ar: 'أيٌّ من: من يرأس إدارة الجودة، أو من يشغل وظيفة قائد الفريق في إدارة الجودة.',
      });
    });

    it('lists them with "and" for All of them, even one', () => {
      expect(whoSentence('ALL', [user, creator, committee])).toEqual({
        en: 'All of: Huda Al-Harbi, whoever created the record, and the members of Quality Committee.',
        ar: 'كلٌّ من: Huda Al-Harbi، ومن أنشأ السجل، وأعضاء لجنة الجودة.',
      });
      expect(whoSentence('ALL', [position]).en).toBe('All of: whoever holds Team Leader in Quality Department.');
    });

    it("names the committee for a Committee vote, or the record's", () => {
      expect(whoSentence('COMMITTEE_VOTE', [committee])).toEqual({ en: 'A vote of Quality Committee.', ar: 'تصويت لجنة الجودة.' });
      expect(whoSentence('COMMITTEE_VOTE', [recordCommittee])).toEqual({ en: "A vote of the record's committee.", ar: 'تصويت لجنة السجل.' });
    });

    it('falls back to English for a missing Arabic name, and says what was removed', () => {
      const noArabic = e({ kind: 'ORG_UNIT_HEAD', orgUnitId: 'o1', orgUnitNameEn: 'Pharmacy', orgUnitNameAr: null });
      expect(whoSentence('ANY_ONE', [noArabic]).ar).toBe('من يرأس Pharmacy.');
      expect(whoSentence('ANY_ONE', [e({ kind: 'SPECIFIC_USER', userId: 'gone' })])).toEqual({
        en: 'A person who was removed.',
        ar: 'شخص أُزيل.',
      });
    });

    it('says when nobody works the stage', () => {
      expect(whoSentence('ANY_ONE', [])).toEqual({ en: 'Nobody works this stage yet.', ar: 'لا أحد يعمل على هذه المرحلة بعد.' });
    });

    it('audits each entry as a numbered phrase, marking a starting one', () => {
      expect(whoAuditEntries([{ ...user, isStartingAssignment: true }, creator])).toEqual([
        '1. Huda Al-Harbi (starting assignment)',
        '2. whoever created the record',
      ]);
    });
  });
});
