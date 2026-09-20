import { RUN_WORKERS_ENV } from './workers.config';

// ACC-92 — the helper's own unit tests live in workers.config.spec.ts. THIS
// file asserts the thing that actually matters: that the gate is WIRED into
// the modules, so a process without the flag registers no BullMQ worker.
//
// It reads Nest's own `providers` metadata rather than booting the modules,
// because booting WorkflowModule needs the whole DI graph and a database.
// The metadata is what Nest itself reads at bootstrap, so asserting on it is
// asserting on the real wiring, not on a restatement of it.
//
// The modules must be require()d INSIDE jest.isolateModules() with the env
// already set: `providers` is evaluated once, when the decorator runs at
// import time, so setting the variable afterwards would prove nothing.

// Better Auth's `better-auth/api` is ESM-only and breaks Jest for any spec
// that transitively loads it — and requiring these modules does. Established
// mitigation, recorded in CLAUDE.md after this recurred three times.
jest.mock('better-auth/api', () => ({ isAPIError: () => false }));

type Ctor = new (...args: never[]) => unknown;

function providersOf(modulePath: string, exportName: string, runWorkers: string | undefined): Ctor[] {
  const previous = process.env[RUN_WORKERS_ENV];
  let providers: Ctor[] = [];

  try {
    if (runWorkers === undefined) {
      delete process.env[RUN_WORKERS_ENV];
    } else {
      process.env[RUN_WORKERS_ENV] = runWorkers;
    }

    jest.isolateModules(() => {
      const loaded = require(modulePath) as Record<string, Ctor | undefined>;
      const moduleClass = loaded[exportName];
      // Throw rather than default to []. A renamed module export would
      // otherwise make every "is NOT registered" assertion pass vacuously —
      // the exact failure this file exists to catch.
      if (!moduleClass) {
        throw new Error(`${modulePath} has no export named ${exportName}`);
      }
      const metadata = Reflect.getMetadata('providers', moduleClass) as Ctor[] | undefined;
      if (!metadata) {
        throw new Error(`${exportName} has no @Module providers metadata`);
      }
      providers = metadata;
    });
  } finally {
    if (previous === undefined) {
      delete process.env[RUN_WORKERS_ENV];
    } else {
      process.env[RUN_WORKERS_ENV] = previous;
    }
  }

  return providers;
}

const names = (providers: Ctor[]): string[] => providers.map((p) => p?.name).filter(Boolean);

// Every @Processor() in the app, with the module that provides it.
const PROCESSORS = [
  {
    processor: 'SlaMonitorProcessor',
    modulePath: '../../foundation/workflow/workflow.module',
    exportName: 'WorkflowModule',
  },
  {
    processor: 'WorkflowActionProcessor',
    modulePath: '../../foundation/workflow/workflow.module',
    exportName: 'WorkflowModule',
  },
  {
    processor: 'SetupHealthProcessor',
    modulePath: '../../foundation/setup-health/setup-health.module',
    exportName: 'SetupHealthModule',
  },
  {
    processor: 'NotificationEmailProcessor',
    modulePath: '../../foundation/notification/notification.module',
    exportName: 'NotificationModule',
  },
];

describe('ACC-92 — queue processors register only when RUN_WORKERS=true', () => {
  describe.each(PROCESSORS)('$processor', ({ processor, modulePath, exportName }) => {
    it('is NOT registered when RUN_WORKERS is unset', () => {
      expect(names(providersOf(modulePath, exportName, undefined))).not.toContain(processor);
    });

    it('is NOT registered when RUN_WORKERS is not exactly "true"', () => {
      expect(names(providersOf(modulePath, exportName, 'false'))).not.toContain(processor);
    });

    it('IS registered when RUN_WORKERS=true', () => {
      expect(names(providersOf(modulePath, exportName, 'true'))).toContain(processor);
    });
  });

  // The gate must not take the API down with it. A local backend still has to
  // serve requests, which is the entire point of the change — if these went
  // missing too, "workers off" would mean "app off".
  it.each([
    ['../../foundation/workflow/workflow.module', 'WorkflowModule', 'WorkflowService'],
    ['../../foundation/setup-health/setup-health.module', 'SetupHealthModule', 'SetupHealthService'],
    [
      '../../foundation/setup-health/setup-health.module',
      'SetupHealthModule',
      // Local verification invokes the reconciler in-process rather than
      // enqueueing (CLAUDE.md, ACC-82). That pattern only works while this
      // stays registered with workers off.
      'SetupConditionReconciler',
    ],
    ['../../foundation/notification/notification.module', 'NotificationModule', 'NotificationService'],
  ])('%s still provides %s with workers disabled', (modulePath, exportName, service) => {
    expect(names(providersOf(modulePath, exportName, undefined))).toContain(service);
  });
});
