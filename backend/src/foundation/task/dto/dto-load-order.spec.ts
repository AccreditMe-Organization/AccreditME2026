import 'reflect-metadata';
import type * as Transformer from 'class-transformer';
import type * as Validator from 'class-validator';

// ACC-199 — found in the live proof: POST /tasks/assignment/workload-hint
// answered 400 "sourceType must be one of the following values: undefined".
// workload-hint.dto.ts and create-task.dto.ts imported each other. When
// create-task.dto loaded first, it required workload-hint.dto before its own
// constants (TASK_SOURCE_TYPES, TASK_PRIORITIES) existed, so workload-hint's
// @IsIn() decorators captured undefined. Which file loads first depends on the
// import order of the whole app, so specs that happened to load workload-hint
// first stayed green.
//
// Each case loads ONE task DTO file first, in a fresh module registry, then
// validates a correct body against EVERY task DTO in that registry. A cycle
// between them makes some combination fail.

type DtoClass = new () => object;

const FILES = ['./workload-hint.dto', './create-task.dto', './reassign-task.dto', './assignment-query.dto'];

const CASES: { file: string; exportName: string; body: Record<string, unknown> }[] = [
  {
    file: './workload-hint.dto',
    exportName: 'WorkloadHintDto',
    body: { committeeId: 'cmt-1', roleValueId: 'role-1', chosenUserId: 'user-1', sourceType: 'COMMITTEE', sourceId: 'cmt-1', priority: 'MEDIUM' },
  },
  {
    file: './create-task.dto',
    exportName: 'CreateTaskDto',
    body: { title: 'Check hand rub stock', sourceType: 'COMMITTEE', sourceId: 'cmt-1', priority: 'MEDIUM', aiWorkloadHint: { id: 'log-1' } },
  },
  {
    file: './reassign-task.dto',
    exportName: 'ReassignTaskDto',
    body: {
      assignTo: { kind: 'COMMITTEE_ROLE', committeeId: 'cmt-1', roleValueId: 'role-1', userId: 'user-1' },
      reason: 'Sara has room',
      aiWorkloadHint: { id: 'log-1' },
    },
  },
  {
    file: './assignment-query.dto',
    exportName: 'AssignmentCommitteeMembersQueryDto',
    body: { committeeId: 'cmt-1', roleValueId: 'role-1', sourceType: 'COMMITTEE', sourceId: 'cmt-1' },
  },
];

/** Load `first`, then validate `body` against `exportName` from `file`, all in one fresh registry. */
function errorsAfterLoading(first: string, file: string, exportName: string, body: Record<string, unknown>): string[] {
  let errors: string[] = [];
  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports -- a fresh registry per case is the point */
    require(first);
    const mod = require(file) as Record<string, DtoClass>;
    const { plainToInstance } = require('class-transformer') as typeof Transformer;
    const { validateSync } = require('class-validator') as typeof Validator;
    /* eslint-enable @typescript-eslint/no-require-imports */
    const collect = (list: Validator.ValidationError[]): string[] =>
      list.flatMap((e) => [...Object.values(e.constraints ?? {}), ...collect(e.children ?? [])]);
    errors = collect(validateSync(plainToInstance(mod[exportName]!, body)));
  });
  return errors;
}

describe('task DTOs validate the same whichever loads first (ACC-199)', () => {
  for (const first of FILES) {
    for (const c of CASES) {
      it(`${c.exportName}, with ${first} loaded first`, () => {
        expect(errorsAfterLoading(first, c.file, c.exportName, c.body)).toEqual([]);
      });
    }
  }

  it('a wrong value is still refused (the check is real, not vacuous)', () => {
    const c = CASES[0]!;
    expect(errorsAfterLoading('./create-task.dto', c.file, c.exportName, { ...c.body, sourceType: 'NOPE' }).join(' ')).toContain('sourceType');
  });
});
