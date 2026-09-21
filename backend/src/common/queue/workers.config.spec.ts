import {
  RUN_WORKERS_ENV,
  logWorkerRegistration,
  looksLikeDeployment,
  workersEnabled,
  type WorkerRegistrationLogger,
} from './workers.config';

describe('ACC-92 — workersEnabled()', () => {
  it('is false when RUN_WORKERS is unset — the safe default', () => {
    expect(workersEnabled({})).toBe(false);
  });

  it('is true only for the exact string "true"', () => {
    expect(workersEnabled({ [RUN_WORKERS_ENV]: 'true' })).toBe(true);
  });

  // The safe state must not depend on guessing what someone meant. Each of
  // these is a plausible typo, and every one of them leaves workers OFF.
  it.each(['TRUE', 'True', '1', 'yes', 'on', '', ' true'])(
    'is false for %p — near-misses do not enable workers',
    (value) => {
      expect(workersEnabled({ [RUN_WORKERS_ENV]: value })).toBe(false);
    },
  );
});

describe('ACC-92 — looksLikeDeployment()', () => {
  it('is false for a bare local environment', () => {
    expect(looksLikeDeployment({})).toBe(false);
    expect(looksLikeDeployment({ NODE_ENV: 'development' })).toBe(false);
  });

  it('is true for NODE_ENV=production', () => {
    expect(looksLikeDeployment({ NODE_ENV: 'production' })).toBe(true);
  });

  it("is true when Railway's own injected variable is present", () => {
    expect(looksLikeDeployment({ RAILWAY_ENVIRONMENT: 'production' })).toBe(true);
  });
});

describe('ACC-92 — logWorkerRegistration()', () => {
  const makeLogger = (): jest.Mocked<WorkerRegistrationLogger> => ({
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  });

  it('logs at INFO and names the queues when workers are enabled', () => {
    const logger = makeLogger();
    logWorkerRegistration(logger, { [RUN_WORKERS_ENV]: 'true' });

    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    const [message] = logger.log.mock.calls[0] as [string];
    expect(message).toContain('ENABLED');
    expect(message).toContain('sla-monitor');
    expect(message).toContain('setup-health');
  });

  // Locally, disabled is the DESIRED state, so a warning that says so is
  // informative rather than alarming.
  it('logs at WARN locally when workers are disabled, and says that is correct', () => {
    const logger = makeLogger();
    logWorkerRegistration(logger, {});

    expect(logger.error).not.toHaveBeenCalled();
    const [message] = logger.warn.mock.calls[0] as [string];
    expect(message).toContain('DISABLED');
    expect(message).toContain('correct default for local development');
  });

  // THIS is the case the whole design rests on. Default-off means a
  // deployment that forgets the flag runs no scheduled work and nothing
  // reports it (ACC-93 does not exist yet), so the startup log is the only
  // thing standing between that and a silent outage. It must not be a WARN
  // buried among other warnings.
  it('ESCALATES TO ERROR when a process that looks like a deployment has workers disabled', () => {
    const logger = makeLogger();
    logWorkerRegistration(logger, { NODE_ENV: 'production' });

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.log).not.toHaveBeenCalled();
    const [message] = logger.error.mock.calls[0] as [string];
    expect(message).toContain('DISABLED');
    expect(message).toContain('DEPLOYMENT');
    expect(message).toContain(`Set ${RUN_WORKERS_ENV}=true`);
  });

  it('names what stops, not just that something is off', () => {
    const logger = makeLogger();
    logWorkerRegistration(logger, {});

    const [message] = logger.warn.mock.calls[0] as [string];
    expect(message).toContain('SLA sweeps');
    expect(message).toContain('Setup health');
  });
});
