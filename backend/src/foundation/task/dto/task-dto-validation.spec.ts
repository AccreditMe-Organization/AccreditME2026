import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { RejectTaskDto } from './reject-task.dto';
import { AddTaskEvidenceDto } from './add-task-evidence.dto';
import { GetMyTasksQueryDto } from './get-my-tasks-query.dto';
import { ReleaseTaskDto } from './release-task.dto';
import { CreateTaskDto } from './create-task.dto';
import { ReassignTaskDto } from './reassign-task.dto';
import { AssignmentHoldersQueryDto } from './assignment-query.dto';

// ACC-163 — these DTOs ARE the refusal for most bad input, so they are tested
// through a pipe configured exactly as main.ts configures the app's, not by
// calling validate() with defaults that differ from production. In particular
// forbidNonWhitelisted is what makes a removed field a 400 rather than a
// silently dropped one.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: false },
});

function run<T>(
  metatype: new () => T,
  value: unknown,
  type: 'body' | 'query' = 'body',
): Promise<T> {
  return pipe.transform(value, { type, metatype }) as Promise<T>;
}

async function messages(promise: Promise<unknown>): Promise<string[]> {
  try {
    await promise;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (
      (error as BadRequestException).getResponse() as { message: string[] }
    ).message;
  }
  throw new Error('Expected a 400, but the input was accepted');
}

describe('RejectTaskDto', () => {
  it('accepts a reason, trimmed', async () => {
    const dto = await run(RejectTaskDto, { reason: '  Not my unit  ' });

    expect(dto.reason).toBe('Not my unit');
  });

  it.each([
    ['missing', {}],
    ['empty', { reason: '' }],
    ['whitespace only', { reason: '   ' }],
    ['not a string', { reason: 42 }],
  ])('refuses a %s reason', async (_label, body) => {
    expect(await messages(run(RejectTaskDto, body))).toEqual(
      expect.arrayContaining([expect.stringMatching(/^reason /)]),
    );
  });

  it('refuses a reason over 1000 characters, and accepts exactly 1000', async () => {
    await expect(
      run(RejectTaskDto, { reason: 'x'.repeat(1000) }),
    ).resolves.toBeDefined();
    expect(
      await messages(run(RejectTaskDto, { reason: 'x'.repeat(1001) })),
    ).toEqual(expect.arrayContaining([expect.stringContaining('1000')]));
  });

  it('refuses any other field', async () => {
    expect(
      await messages(run(RejectTaskDto, { reason: 'x', status: 'COMPLETED' })),
    ).toEqual(expect.arrayContaining(['property status should not exist']));
  });
});

describe('AddTaskEvidenceDto', () => {
  it.each([
    'https://intranet.hospital.sa/minutes/2026-02',
    'http://intranet/minutes', // a bare intranet host name, no TLD
  ])('accepts a LINK to %s', async (url) => {
    const dto = await run(AddTaskEvidenceDto, {
      type: 'LINK',
      url,
      linkTitle: 'February minutes',
    });

    expect(dto.url).toBe(url);
  });

  it.each([
    ['a javascript: URL', 'javascript:alert(document.cookie)'],
    ['a data: URL', 'data:text/html,<script>alert(1)</script>'],
    ['an ftp: URL', 'ftp://files.example.com/report.pdf'],
    ['a URL with no protocol', 'intranet.hospital.sa/minutes'],
    ['not a URL', 'see the shared drive'],
  ])('refuses a LINK with %s', async (_label, url) => {
    expect(
      await messages(run(AddTaskEvidenceDto, { type: 'LINK', url })),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/^url /)]));
  });

  it('refuses a LINK with no URL', async () => {
    expect(await messages(run(AddTaskEvidenceDto, { type: 'LINK' }))).toEqual(
      expect.arrayContaining([expect.stringMatching(/^url /)]),
    );
  });

  it('accepts an INTERNAL_REFERENCE with a reference type and id', async () => {
    const dto = await run(AddTaskEvidenceDto, {
      type: 'INTERNAL_REFERENCE',
      refType: 'DOCUMENT',
      refId: 'doc-9',
    });

    expect(dto).toMatchObject({
      type: 'INTERNAL_REFERENCE',
      refType: 'DOCUMENT',
      refId: 'doc-9',
    });
  });

  it('refuses an INTERNAL_REFERENCE without its reference', async () => {
    const found = await messages(
      run(AddTaskEvidenceDto, { type: 'INTERNAL_REFERENCE' }),
    );

    expect(found).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^refType /),
        expect.stringMatching(/^refId /),
      ]),
    );
  });

  // Q11 — a note is a comment, and attachments wait for the storage tickets.
  it.each(['TEXT', 'ATTACHMENT'])('refuses new %s evidence', async (type) => {
    expect(
      await messages(
        run(AddTaskEvidenceDto, { type, url: 'https://x.example' }),
      ),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/^type /)]));
  });

  it.each(['content', 's3Key', 'fileName', 'fileSize', 'mimeType'])(
    'refuses the removed %s field rather than ignoring it',
    async (field) => {
      expect(
        await messages(
          run(AddTaskEvidenceDto, {
            type: 'LINK',
            url: 'https://x.example',
            [field]: 'x',
          }),
        ),
      ).toEqual(expect.arrayContaining([`property ${field} should not exist`]));
    },
  );
});

describe('GetMyTasksQueryDto', () => {
  it('accepts no filters at all', async () => {
    await expect(run(GetMyTasksQueryDto, {}, 'query')).resolves.toEqual({});
  });

  it.each(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])(
    'accepts status=%s',
    async (status) => {
      await expect(
        run(GetMyTasksQueryDto, { status }, 'query'),
      ).resolves.toMatchObject({ status });
    },
  );

  // OVERDUE is a flag now, not a status; an unknown status used to reach
  // Prisma as an invalid enum and come back a 500.
  it.each(['OVERDUE', 'REJECTED', 'UNASSIGNED', 'nonsense'])(
    'refuses status=%s with a 400',
    async (status) => {
      expect(
        await messages(run(GetMyTasksQueryDto, { status }, 'query')),
      ).toEqual(expect.arrayContaining([expect.stringMatching(/^status /)]));
    },
  );

  it('reads overdue=true and overdue=false from the query string as booleans', async () => {
    await expect(
      run(GetMyTasksQueryDto, { overdue: 'true' }, 'query'),
    ).resolves.toEqual({ overdue: true });
    await expect(
      run(GetMyTasksQueryDto, { overdue: 'false' }, 'query'),
    ).resolves.toEqual({ overdue: false });
  });

  it('refuses any other overdue value', async () => {
    expect(
      await messages(run(GetMyTasksQueryDto, { overdue: 'yes' }, 'query')),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/^overdue /)]));
  });
});

// ── ACC-167 ─────────────────────────────────────────────────────────────────

describe('ReleaseTaskDto (ACC-167)', () => {
  it('accepts a reason, trimmed', async () => {
    const dto = await run(ReleaseTaskDto, { reason: '  On leave from tomorrow  ' });
    expect(dto.reason).toBe('On leave from tomorrow');
  });

  it.each([
    ['missing', {}],
    ['blank after trimming', { reason: '   ' }],
    ['over 1000 characters', { reason: 'x'.repeat(1001) }],
  ])('refuses a reason that is %s', async (_label, body) => {
    expect(await messages(run(ReleaseTaskDto, body))).toEqual(
      expect.arrayContaining([expect.stringMatching(/^reason /)]),
    );
  });

  it('accepts exactly 1000 characters', async () => {
    await expect(run(ReleaseTaskDto, { reason: 'x'.repeat(1000) })).resolves.toBeDefined();
  });
});

describe('CreateTaskDto.assignTo (ACC-167)', () => {
  const BASE = { title: 'Collect the sample', sourceType: 'COMMITTEE', sourceId: 'committee-1' };

  it('accepts a unit and position, with or without a person', async () => {
    await expect(
      run(CreateTaskDto, { ...BASE, assignTo: { kind: 'POSITION', orgUnitId: 'u1', positionId: 'p1' } }),
    ).resolves.toBeDefined();
    await expect(
      run(CreateTaskDto, { ...BASE, assignTo: { kind: 'POSITION', orgUnitId: 'u1', positionId: 'p1', userId: 'x' } }),
    ).resolves.toBeDefined();
  });

  it('accepts a committee role', async () => {
    await expect(
      run(CreateTaskDto, { ...BASE, assignTo: { kind: 'COMMITTEE_ROLE', committeeId: 'c1', roleValueId: 'r1' } }),
    ).resolves.toBeDefined();
  });

  it('accepts no assignee at all — the UNASSIGNED path is unchanged', async () => {
    await expect(run(CreateTaskDto, BASE)).resolves.toBeDefined();
  });

  it('refuses a position target missing its unit or position', async () => {
    const errors = await messages(run(CreateTaskDto, { ...BASE, assignTo: { kind: 'POSITION' } }));
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^assignTo\.orgUnitId /),
        expect.stringMatching(/^assignTo\.positionId /),
      ]),
    );
  });

  it('refuses a committee target missing its committee or role', async () => {
    const errors = await messages(run(CreateTaskDto, { ...BASE, assignTo: { kind: 'COMMITTEE_ROLE' } }));
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^assignTo\.committeeId /),
        expect.stringMatching(/^assignTo\.roleValueId /),
      ]),
    );
  });

  // Decision 9 — ROLE is never a task option.
  it.each(['ROLE', 'USER', ''])('refuses the kind %p', async (kind) => {
    expect(
      await messages(run(CreateTaskDto, { ...BASE, assignTo: { kind, orgUnitId: 'u1', positionId: 'p1' } })),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/^assignTo\.kind /)]));
  });

  it('refuses a field the target does not have', async () => {
    expect(
      await messages(
        run(CreateTaskDto, { ...BASE, assignTo: { kind: 'POSITION', orgUnitId: 'u1', positionId: 'p1', roleKey: 'QM' } }),
      ),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/roleKey/)]));
  });
});

describe('ReassignTaskDto.assignTo (ACC-167)', () => {
  it('accepts a target in place of named people', async () => {
    await expect(
      run(ReassignTaskDto, { reason: 'Pharmacy owns this', assignTo: { kind: 'POSITION', orgUnitId: 'u1', positionId: 'p1' } }),
    ).resolves.toBeDefined();
  });

  it('still accepts the legacy named people', async () => {
    await expect(run(ReassignTaskDto, { reason: 'x', newAssigneeUserIds: ['u'] })).resolves.toBeDefined();
  });

  it('still refuses an empty list of named people', async () => {
    expect(await messages(run(ReassignTaskDto, { reason: 'x', newAssigneeUserIds: [] }))).toEqual(
      expect.arrayContaining([expect.stringMatching(/^newAssigneeUserIds /)]),
    );
  });
});

describe('AssignmentHoldersQueryDto (ACC-167)', () => {
  it('needs both the unit and the position', async () => {
    const errors = await messages(run(AssignmentHoldersQueryDto, {}, 'query'));
    expect(errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/^orgUnitId /), expect.stringMatching(/^positionId /)]),
    );
  });

  it('takes an optional taskId', async () => {
    await expect(
      run(AssignmentHoldersQueryDto, { orgUnitId: 'u1', positionId: 'p1', taskId: 't1' }, 'query'),
    ).resolves.toEqual({ orgUnitId: 'u1', positionId: 'p1', taskId: 't1' });
  });
});
