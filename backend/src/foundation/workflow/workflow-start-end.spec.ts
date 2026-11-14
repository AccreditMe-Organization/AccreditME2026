import { startEndRefusal, startEndViolations, type StartEndStage } from './workflow-start-end';

// ACC-57 — the rule itself, without a database: what a template's start and end
// may look like, and when a save made it worse. The paths that call it are
// proved against a real Postgres in workflow-start-end.db-spec.ts.

const stage = (id: string, isInitial = false, isFinal = false): StartEndStage => ({ id, nameEn: id, nameAr: null, isInitial, isFinal });

const codeOf = (refusal: ReturnType<typeof startEndRefusal>): string | undefined =>
  (refusal?.getResponse() as { code?: string } | undefined)?.code;
const bodyOf = (refusal: ReturnType<typeof startEndRefusal>): Record<string, unknown> =>
  (refusal?.getResponse() as Record<string, unknown> | undefined) ?? {};

describe('startEndViolations', () => {
  it('finds nothing wrong with one starting stage and a separate final one', () => {
    expect(startEndViolations([stage('a', true), stage('b'), stage('c', false, true)])).toEqual([]);
  });

  it('finds nothing wrong with a template that has no stages yet, unless stages are required', () => {
    expect(startEndViolations([])).toEqual([]);
    expect(startEndViolations([], { requireStages: true })).toEqual([{ kind: 'NO_INITIAL' }]);
  });

  it('names each of the three problems', () => {
    expect(startEndViolations([stage('a'), stage('b')])).toEqual([{ kind: 'NO_INITIAL' }]);
    expect(startEndViolations([stage('a', true), stage('b', true)])).toEqual([{ kind: 'MULTIPLE_INITIAL', stageIds: ['a', 'b'] }]);
    expect(startEndViolations([stage('a', true, true)])).toEqual([{ kind: 'INITIAL_AND_FINAL', stageIds: ['a'] }]);
  });
});

describe('startEndRefusal', () => {
  it('refuses 400 STAGE_INITIAL_AND_FINAL, naming the stage, when a save makes one stage both', () => {
    const refusal = startEndRefusal([stage('a', true), stage('b')], [stage('a', true, true), stage('b')]);
    expect(codeOf(refusal)).toBe('STAGE_INITIAL_AND_FINAL');
    expect(refusal?.getStatus()).toBe(400);
    expect(bodyOf(refusal)).toMatchObject({ stageIds: ['a'], stageNames: [{ nameEn: 'a', nameAr: null }] });
  });

  it('refuses 409 STAGE_INITIAL_REQUIRED, naming the subject, when a save leaves no starting stage', () => {
    const refusal = startEndRefusal([stage('a', true), stage('b')], [stage('a'), stage('b')], { id: 'a', nameEn: 'Draft', nameAr: 'مسودة' });
    expect(codeOf(refusal)).toBe('STAGE_INITIAL_REQUIRED');
    expect(refusal?.getStatus()).toBe(409);
    expect(bodyOf(refusal)).toMatchObject({ stageIds: ['a'], stageNames: [{ nameEn: 'Draft', nameAr: 'مسودة' }] });
  });

  it('refuses STAGE_INITIAL_REQUIRED when the first stage added to an empty template is not the starting stage', () => {
    expect(codeOf(startEndRefusal([], [stage('a')], { id: 'a', nameEn: 'a', nameAr: null }))).toBe('STAGE_INITIAL_REQUIRED');
  });

  it('refuses 409 STAGE_INITIAL_NOT_UNIQUE, naming every starting stage, when a save adds a second', () => {
    const refusal = startEndRefusal([stage('a', true), stage('b')], [stage('a', true), stage('b', true)]);
    expect(codeOf(refusal)).toBe('STAGE_INITIAL_NOT_UNIQUE');
    expect(refusal?.getStatus()).toBe(409);
    expect(bodyOf(refusal)).toMatchObject({ stageIds: ['a', 'b'] });
  });

  it('passes a save that leaves the template well formed, or empties it', () => {
    expect(startEndRefusal([stage('a', true), stage('b')], [stage('a', true), stage('b', false, true)])).toBeNull();
    expect(startEndRefusal([stage('a', true)], [])).toBeNull();
  });

  // ACC-120's root-role shape: only a save that makes it WORSE is refused, so a
  // template already in breach can be renamed, and fixed one save at a time.
  describe('a template already in breach', () => {
    it('passes a save that leaves each breach as it was', () => {
      expect(startEndRefusal([stage('a'), stage('b')], [stage('a'), stage('b')])).toBeNull();
      expect(startEndRefusal([stage('a', true), stage('b', true)], [stage('a', true), stage('b', true)])).toBeNull();
      expect(startEndRefusal([stage('a', true, true)], [stage('a', true, true)])).toBeNull();
    });

    it('passes a save that mends it', () => {
      expect(startEndRefusal([stage('a', true), stage('b', true)], [stage('a', true), stage('b')])).toBeNull();
      expect(startEndRefusal([stage('a'), stage('b')], [stage('a', true), stage('b')])).toBeNull();
      expect(startEndRefusal([stage('a', true, true), stage('b')], [stage('a', true), stage('b', false, true)])).toBeNull();
    });

    it('refuses a save that makes it worse', () => {
      // A third starting stage on top of two.
      expect(codeOf(startEndRefusal([stage('a', true), stage('b', true), stage('c')], [stage('a', true), stage('b', true), stage('c', true)]))).toBe(
        'STAGE_INITIAL_NOT_UNIQUE',
      );
      // A second stage both initial and final, beside one that already was.
      expect(
        codeOf(startEndRefusal([stage('a', true, true), stage('b', true)], [stage('a', true, true), stage('b', true, true)])),
      ).toBe('STAGE_INITIAL_AND_FINAL');
      // Two starting stages, both unticked.
      expect(codeOf(startEndRefusal([stage('a', true), stage('b', true)], [stage('a'), stage('b')]))).toBe('STAGE_INITIAL_REQUIRED');
    });
  });
});
