import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateWorkflowTransitionDto } from './create-workflow-transition.dto';
import { UpdateWorkflowTransitionDto } from './update-workflow-transition.dto';

/**
 * ACC-294 — `isApprovalPath` is gone from the transition DTOs. Nothing read it
 * since ACC-284 (a move's kind decides what a press on a group stage is). With the
 * API's global pipe (main.ts: whitelist + forbidNonWhitelisted), a create or an
 * update that still sends it is 400 "property isApprovalPath should not exist",
 * before any service runs. The pipe is built with main.ts's own options.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: false },
});

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

describe('isApprovalPath is gone from the transition DTOs (ACC-294)', () => {
  // Non-vacuity: the same bodies without it pass the same pipe.
  it('accepts a move create and update that send only what the DTOs take', async () => {
    expect(await messagesFor(CreateWorkflowTransitionDto, MOVE)).toBe('ACCEPTED');
    expect(await messagesFor(UpdateWorkflowTransitionDto, { labelEn: 'Renamed' })).toBe('ACCEPTED');
  });

  it.each([true, false])('a move create or update sending isApprovalPath: %s is 400 "property isApprovalPath should not exist"', async (value) => {
    for (const [metatype, body] of [
      [CreateWorkflowTransitionDto, MOVE],
      [UpdateWorkflowTransitionDto, { labelEn: 'Renamed' }],
    ] as const) {
      expect(await messagesFor(metatype, { ...body, isApprovalPath: value })).toEqual(['property isApprovalPath should not exist']);
    }
  });
});
