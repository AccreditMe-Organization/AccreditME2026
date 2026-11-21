import { readFileSync } from 'fs';
import { join } from 'path';
// The browser namespace: the same generated field lists as plain constants. The
// client itself is mapped to a stub in unit tests (package.json moduleNameMapper).
import * as Prisma from '../../../generated/prisma/internal/prismaNamespaceBrowser';

/**
 * ACC-316 contract (plan §6 item 9), in ACC-278's shape.
 *
 * 9a takes four superseded columns out of the generated client (@ignore, no
 * migration): Meeting.status and Meeting.minutesText (a meeting's state is its
 * workflow stage; its minutes are the minutes tables), AgendaItem.presenter
 * (presenterAttendeeId) and Task.meetingId (never written or read). A client
 * that knows a column names it in every findMany, findFirst and returning
 * write, and fails with P2022 once 9b drops it; so 9a's client must be the one
 * serving when 9b's migration runs. Knowing one again turns these tests red,
 * naming it.
 */

const CONTRACT_COLUMNS = [
  ['Meeting', 'status'],
  ['Meeting', 'minutesText'],
  ['AgendaItem', 'presenter'],
  ['Task', 'meetingId'],
] as const;

const fields: Record<(typeof CONTRACT_COLUMNS)[number][0], string[]> = {
  Meeting: Object.keys(Prisma.MeetingScalarFieldEnum),
  AgendaItem: Object.keys(Prisma.AgendaItemScalarFieldEnum),
  Task: Object.keys(Prisma.TaskScalarFieldEnum),
};

const schema = readFileSync(
  join(__dirname, '..', '..', '..', 'prisma', 'schema.prisma'),
  'utf8',
);

/** The body of one model block in schema.prisma. */
function modelBody(name: string): string {
  const match = new RegExp(`^model ${name} \\{([\\s\\S]*?)^\\}`, 'm').exec(
    schema,
  );
  if (!match) throw new Error(`model ${name} not found`);
  return match[1]!;
}

/** The declaration line of a field in a model block, or null. */
const declaration = (model: string, field: string): string | null =>
  new RegExp(`^\\s+${field}\\s+\\S+.*$`, 'm').exec(modelBody(model))?.[0] ??
  null;

describe('ACC-316 contract — the four superseded columns', () => {
  it('reads the generated field lists, which name the columns that stay (non-vacuity)', () => {
    expect(fields.Meeting).toEqual(
      expect.arrayContaining(['id', 'scheduledAt', 'minutesApprovedAt']),
    );
    expect(fields.AgendaItem).toEqual(
      expect.arrayContaining(['id', 'presenterAttendeeId']),
    );
    expect(fields.Task).toEqual(
      expect.arrayContaining(['id', 'sourceType', 'sourceId']),
    );
  });

  it('are not in the generated client', () => {
    expect(
      CONTRACT_COLUMNS.filter(([model, column]) =>
        fields[model].includes(column),
      ).map(([model, column]) => `${model}.${column}`),
    ).toEqual([]);
  });

  it('are still declared, @ignore, so 9a needs no migration (9b drops them)', () => {
    expect(
      CONTRACT_COLUMNS.filter(
        ([model, column]) => !/@ignore\b/.test(declaration(model, column) ?? ''),
      ).map(([model, column]) => `${model}.${column}`),
    ).toEqual([]);
  });
});
