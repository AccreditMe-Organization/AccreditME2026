import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { RejectTaskDto } from './reject-task.dto';
import { AddTaskEvidenceDto } from './add-task-evidence.dto';
import { GetMyTasksQueryDto } from './get-my-tasks-query.dto';

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
