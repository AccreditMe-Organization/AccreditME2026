import { Queue } from 'bullmq';
import { AiCreditsRenewalProcessor, AI_CREDITS_RENEWAL_INTERVAL_MS, AI_CREDITS_RENEWAL_JOB } from './ai-credits-renewal.processor';
import { AiAllocationService } from './ai-allocation.service';

describe('AiCreditsRenewalProcessor (ACC-194)', () => {
  function setup(result: { renewed: number; failed: string[] }) {
    const allocation = { renewDue: jest.fn().mockResolvedValue(result) };
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const processor = new AiCreditsRenewalProcessor(allocation as unknown as AiAllocationService, queue as unknown as Queue);
    return { processor, allocation, queue };
  }

  it('schedules itself hourly under one fixed job id, so restarts do not stack repeats', async () => {
    const { processor, queue } = setup({ renewed: 0, failed: [] });
    await processor.onModuleInit();
    expect(AI_CREDITS_RENEWAL_INTERVAL_MS).toBe(3_600_000);
    expect(queue.add).toHaveBeenCalledWith(AI_CREDITS_RENEWAL_JOB, {}, { repeat: { every: 3_600_000 }, jobId: 'ai-credits-renewal-repeat' });
  });

  it('renews what is due, and a run with nothing due is a quiet success', async () => {
    const { processor, allocation } = setup({ renewed: 0, failed: [] });
    await expect(processor.process()).resolves.toBeUndefined();
    expect(allocation.renewDue).toHaveBeenCalledTimes(1);
  });

  it('a failed organisation fails the job so it is visible, after the others renewed', async () => {
    const { processor } = setup({ renewed: 3, failed: ['org-x'] });
    await expect(processor.process()).rejects.toThrow('AI credit renewal failed for 1 organisation(s): org-x. 3 renewed.');
  });
});
