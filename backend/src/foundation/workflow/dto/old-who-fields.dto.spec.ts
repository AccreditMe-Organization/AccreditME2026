import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateWorkflowStageDto } from './create-workflow-stage.dto';
import { UpdateWorkflowStageDto } from './update-workflow-stage.dto';
import { CreateWorkflowTransitionDto } from './create-workflow-transition.dto';
import { UpdateWorkflowTransitionDto } from './update-workflow-transition.dto';

/**
 * ACC-271 PR 6b — the stage and transition DTOs carry no old who field. Who
 * works a stage is its `who`; who makes a move is its mover. With the API's
 * global pipe (main.ts: whitelist + forbidNonWhitelisted), a create or an update
 * that still sends one is 400 "property X should not exist", before any service
 * runs. The pipe is built with main.ts's own options.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: false },
});

const OLD_STAGE_FIELDS: [string, unknown][] = [
  ['assigneeStrategy', 'ROLE'],
  ['assigneeRoleId', 'role-1'],
  ['assigneeUserId', 'user-1'],
  ['committeeId', 'committee-1'],
  ['assigneeCommitteeRoleValueId', 'value-1'],
  ['assigneePositionId', 'position-1'],
  ['assigneeOrgUnitId', 'unit-1'],
  ['approvalMode', 'SINGLE'],
  ['parallelThreshold', 'ALL'],
];
const OLD_TRANSITION_FIELDS: [string, unknown][] = [
  ['triggerCondition', 'ROLE_BASED'],
  ['triggerRoleId', 'role-1'],
  ['triggerUserId', 'user-1'],
  ['requiredPermission', 'committees:approve'],
];

const STAGE = { nameEn: 'Review', order: 20, who: { mode: 'ANY_ONE', entries: [{ kind: 'CREATOR' }] } };
const MOVE = { fromStageId: 'stage-1', toStageId: 'stage-2', labelEn: 'Approve' };

async function messagesFor(metatype: new () => object, body: Record<string, unknown>): Promise<string[] | 'ACCEPTED'> {
  try {
    await pipe.transform(body, { type: 'body', metatype });
    return 'ACCEPTED';
  } catch (e) {
    if (!(e instanceof BadRequestException)) throw e;
    return (e.getResponse() as { message: string[] }).message;
  }
}

describe('the old who fields are gone from the workflow DTOs (ACC-271 PR 6b)', () => {
  // Non-vacuity: the same bodies without an old field pass the same pipe.
  it('accepts a stage and a move that send only what the DTOs take', async () => {
    expect(await messagesFor(CreateWorkflowStageDto, STAGE)).toBe('ACCEPTED');
    expect(await messagesFor(UpdateWorkflowStageDto, { nameEn: 'Renamed' })).toBe('ACCEPTED');
    expect(await messagesFor(CreateWorkflowTransitionDto, MOVE)).toBe('ACCEPTED');
    expect(await messagesFor(UpdateWorkflowTransitionDto, { labelEn: 'Renamed' })).toBe('ACCEPTED');
  });

  it.each(OLD_STAGE_FIELDS)('a stage create or update sending %s is 400: "property … should not exist"', async (field, value) => {
    for (const [metatype, body] of [
      [CreateWorkflowStageDto, STAGE],
      [UpdateWorkflowStageDto, { nameEn: 'Renamed' }],
    ] as const) {
      expect(await messagesFor(metatype, { ...body, [field]: value })).toEqual([`property ${field} should not exist`]);
    }
  });

  it.each(OLD_TRANSITION_FIELDS)('a move create or update sending %s is 400: "property … should not exist"', async (field, value) => {
    for (const [metatype, body] of [
      [CreateWorkflowTransitionDto, MOVE],
      [UpdateWorkflowTransitionDto, { labelEn: 'Renamed' }],
    ] as const) {
      expect(await messagesFor(metatype, { ...body, [field]: value })).toEqual([`property ${field} should not exist`]);
    }
  });
});
