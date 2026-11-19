import { Test, type TestingModule } from '@nestjs/testing';

// Better Auth is ESM-only and breaks Jest (CLAUDE.md, ACC-25/27): every path the
// app imports is stood in for. This spec reads the DI graph and calls nothing.
jest.mock('better-auth', () => {
  // Any method the app binds off auth.api is a no-op: nothing here signs anyone in.
  const anyMethod = new Proxy({}, { get: () => async () => ({}) });
  return { betterAuth: () => ({ api: anyMethod, handler: async () => undefined, options: {} }) };
});
jest.mock('better-auth/adapters/prisma', () => ({ prismaAdapter: () => ({}) }));
jest.mock('better-auth/api', () => ({ isAPIError: () => false }));
jest.mock('better-auth/plugins/two-factor', () => ({ twoFactor: () => ({}) }));
jest.mock('better-auth/plugins/haveibeenpwned', () => ({ haveIBeenPwned: () => ({}) }));
import { restoreWiringEnv } from './meeting-invitees.wiring-env';
import { getQueueToken } from '@nestjs/bullmq';
import { AppModule } from '../../../app.module';
import { CommitteesService } from '../../committees/committees.service';
import { UserService } from '../../user/user.service';
import { AuthService } from '../../auth/auth.service';
import { SlaMonitorProcessor } from '../../workflow/sla-monitor.processor';
import { PrismaService } from '../../../prisma/prisma.service';
import { MeetingInviteeSyncService } from './meeting-invitee-sync.service';
import { NotificationService } from '../../notification/notification.service';
import { WorkingCalendarService } from '../../working-calendar/working-calendar.service';
import { StageRulesService } from '../../workflow/stage-rules.service';

/**
 * PrismaService is a LEAF of the graph (it injects nothing), and the unit suite
 * stubs the generated client, so it is stood in for: any property is a callable
 * that answers with itself. Every module, provider and injection that decides
 * the wiring stays the app's own.
 */
const anything: unknown = new Proxy(function () {}, {
  get: (_target, key) => (key === 'then' ? undefined : anything),
  apply: () => anything,
});

/** Every queue QueueModule registers: stubbed, so no Queue (and no Redis connection) is ever built. */
const QUEUES = [
  'workflow-actions',
  'sla-monitor',
  'setup-health',
  'storage-purge',
  'ai-credits',
  'committee-transfer-notice',
  'password-reset',
  'email-delivery',
];

/**
 * ACC-316 PR 3b — the writers take MeetingInviteeSyncService `@Optional()`, so
 * a spec that builds them by hand needs none. Optional is also how a module
 * that FORGOT to import MeetingInviteesModule would fail: silently, the sync
 * never called, the change shown only after the next sweep. This compiles the
 * REAL application graph (AppModule; only the queues stubbed) and proves each
 * writer holds the one sync instance the app registered, and the sweep too.
 * Mutation-checked: removing MeetingInviteesModule from a writer's module turns
 * its line red.
 */
describe('MeetingInviteeSync is wired into every writer of the real app (ACC-316 PR 3b)', () => {
  let app: TestingModule;

  beforeAll(async () => {
    let builder = Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(anything);
    for (const name of QUEUES) builder = builder.overrideProvider(getQueueToken(name)).useValue({ add: async () => undefined });
    app = await builder.compile();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    restoreWiringEnv();
  });

  const syncOf = (service: object): unknown => (service as { meetingInvitees?: unknown }).meetingInvitees;

  it.each([
    ['CommitteesService (membership add, seat change, removal)', CommitteesService],
    ['UserService (transfer, unit change, deactivate, reactivate)', UserService],
    ['AuthService (an accepted invitation)', AuthService],
  ] as const)('%s holds the sync', (_name, writer) => {
    const sync = syncOf(app.get(writer, { strict: false }));
    expect(sync).toBeInstanceOf(MeetingInviteeSyncService);
  });

  it("the sync uses the app's own single instances, never private copies (lane B's review)", () => {
    const sync = app.get(MeetingInviteeSyncService, { strict: false }) as unknown as Record<string, unknown>;
    // Which modules hold the very instance the sync was given: the service's own module, and no copy.
    const owners = (token: unknown, instance: unknown): string[] => {
      const modules = (app as unknown as { container: { getModules(): Map<string, { metatype: { name: string }; providers: Map<unknown, { instance: unknown }> }> } }).container.getModules();
      return [...modules.values()].filter((m) => m.providers.get(token)?.instance === instance).map((m) => m.metatype.name);
    };
    expect({
      notifications: owners(NotificationService, sync['notifications']),
      calendar: owners(WorkingCalendarService, sync['calendar']),
      stageRules: owners(StageRulesService, sync['stageRules']),
    }).toEqual({ notifications: ['NotificationModule'], calendar: ['WorkingCalendarModule'], stageRules: ['StageRulesModule'] });
  });

  it('the SLA sweep holds it too (sweepMeetingInvitees)', () => {
    const processor = app.get(SlaMonitorProcessor, { strict: false });
    expect(syncOf(processor)).toBeInstanceOf(MeetingInviteeSyncService);
  });
});
