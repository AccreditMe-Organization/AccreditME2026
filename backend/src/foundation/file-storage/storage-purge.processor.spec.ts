import { Job, Queue } from 'bullmq';
import { StoragePurgeProcessor, STORAGE_PURGE_INTERVAL_MS } from './storage-purge.processor';
import { RecycleBinService } from './recycle-bin.service';

// ACC-177 — the daily purge job: it schedules itself once a day and runs
// RecycleBinService.purgeExpired(); a failing organisation fails the job so it
// shows as failed, after every other organisation has run.
describe('StoragePurgeProcessor (ACC-177)', () => {
  const recycleBin = { purgeExpired: jest.fn() };
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const processor = new StoragePurgeProcessor(recycleBin as unknown as RecycleBinService, queue as unknown as Queue);

  beforeEach(() => jest.clearAllMocks());

  it('schedules itself daily, under one fixed job id', async () => {
    await processor.onModuleInit();
    expect(queue.add).toHaveBeenCalledWith('purge-expired-files', {}, { repeat: { every: STORAGE_PURGE_INTERVAL_MS }, jobId: 'storage-purge-repeat' });
    expect(STORAGE_PURGE_INTERVAL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('purges expired files', async () => {
    recycleBin.purgeExpired.mockResolvedValue({ purged: 3, failedOrganizations: [] });
    await expect(processor.process({} as Job)).resolves.toBeUndefined();
    expect(recycleBin.purgeExpired).toHaveBeenCalledTimes(1);
  });

  it('fails the job, naming the organisations, when any failed', async () => {
    recycleBin.purgeExpired.mockResolvedValue({ purged: 1, failedOrganizations: ['org-a'] });
    await expect(processor.process({} as Job)).rejects.toThrow('org-a');
  });
});
