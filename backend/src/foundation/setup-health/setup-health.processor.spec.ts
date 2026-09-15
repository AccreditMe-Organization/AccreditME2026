import { Job, Queue } from 'bullmq';
import {
  SETUP_HEALTH_INTERVAL_MS,
  SetupHealthProcessor,
} from './setup-health.processor';
import { SetupConditionReconciler } from './setup-condition.reconciler';

// ACC-82 — the hourly Setup health job (SYSTEM-REFERENCE §13.5).
describe('SetupHealthProcessor (ACC-82)', () => {
  let reconciler: { reconcileAll: jest.Mock };
  let queue: { add: jest.Mock };
  let processor: SetupHealthProcessor;

  beforeEach(() => {
    reconciler = { reconcileAll: jest.fn() };
    queue = { add: jest.fn().mockResolvedValue(undefined) };
    processor = new SetupHealthProcessor(
      reconciler as unknown as SetupConditionReconciler,
      queue as unknown as Queue,
    );
    jest.spyOn(processor['logger'], 'log').mockImplementation(() => undefined);
  });

  it('registers one hourly repeatable job under a fixed id', async () => {
    await processor.onModuleInit();
    expect(SETUP_HEALTH_INTERVAL_MS).toBe(60 * 60 * 1000);
    expect(queue.add).toHaveBeenCalledWith(
      'reconcile-setup-conditions',
      {},
      {
        repeat: { every: SETUP_HEALTH_INTERVAL_MS },
        jobId: 'setup-health-repeat',
      },
    );
  });

  it('reconciles every tenant and succeeds when nothing failed', async () => {
    reconciler.reconcileAll.mockResolvedValue({ tenants: 2, failed: [] });
    await expect(processor.process({} as Job)).resolves.toBeUndefined();
    expect(reconciler.reconcileAll).toHaveBeenCalledTimes(1);
  });

  // ACC-49's contract: the rest still ran, but the job does not report success.
  it('fails the job naming each failed pair when any pair failed', async () => {
    reconciler.reconcileAll.mockResolvedValue({
      tenants: 2,
      failed: [{ organizationId: 'org-b', type: 'TASK_WITHOUT_OWNER' }],
    });
    await expect(processor.process({} as Job)).rejects.toThrow(
      /1 failed tenant\/type pair\(s\) across 2 tenant\(s\): org-b:TASK_WITHOUT_OWNER/,
    );
  });

  it('fails the job when the tenant list itself cannot be read', async () => {
    reconciler.reconcileAll.mockRejectedValue(new Error('connection refused'));
    await expect(processor.process({} as Job)).rejects.toThrow(
      'connection refused',
    );
  });
});
