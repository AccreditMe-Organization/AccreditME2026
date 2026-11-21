import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  INestApplication,
  Injectable,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'http';
import request from 'supertest';
import { PrismaService } from '../../prisma/prisma.service';
import { RequiresModule } from '../decorators/requires-module.decorator';
import { HttpExceptionFilter } from '../filters/http-exception.filter';
import { itEnforcesTenantIsolation } from '../testing/tenant-isolation';
import { NULL_PLAN_FALLBACK_ACCESS } from '../../foundation/tenant/module-entitlements';

jest.mock('better-auth/api', () => ({ isAPIError: () => false }));

/**
 * ACC-102 — ModuleGuard on a test controller, through a real Nest app.
 *
 * The stand-in TenantGuard sits at CLASS level, as on every real controller,
 * and sets the tenant from a header; @RequiresModule registers ModuleGuard on
 * the route. So each request also proves the guard runs after TenantGuard and
 * is registered by the decorator alone.
 */
@Injectable()
class StandInTenantGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string>; tenantId?: string }>();
    req.tenantId = req.headers['x-test-tenant'];
    return true;
  }
}

@Controller('probe')
@UseGuards(StandInTenantGuard)
class ProbeController {
  @Get('read')
  @RequiresModule('documents', 'read')
  read(): { ok: true } {
    return { ok: true };
  }

  @Post('write')
  @RequiresModule('documents', 'write')
  write(): { ok: true } {
    return { ok: true };
  }

  @Get('open')
  open(): { ok: true } {
    return { ok: true };
  }
}

@Controller('unguarded')
class NoTenantController {
  @Get()
  @RequiresModule('documents', 'read')
  read(): { ok: true } {
    return { ok: true };
  }
}

/** Rows as the guard's one statement returns them. */
type Row = { settings: unknown; planId: string | null; moduleKey: string | null; accessLevel: string | null };

const enabled = { modules: { documents: true } };
const onPlan = (accessLevel: string | null, settings: unknown = enabled): Row[] => [
  { settings, planId: 'plan-1', moduleKey: accessLevel ? 'documents' : null, accessLevel },
];

describe('ModuleGuard (ACC-102)', () => {
  let app: INestApplication;
  let queryRaw: jest.Mock;

  const http = (): ReturnType<typeof request> => request(app.getHttpServer() as Server);

  beforeAll(async () => {
    queryRaw = jest.fn();
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController, NoTenantController],
      providers: [{ provide: PrismaService, useValue: { $queryRaw: queryRaw } }],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => queryRaw.mockReset());

  it('refuses MODULE_NOT_ENABLED, naming the module, when the module is absent', async () => {
    queryRaw.mockResolvedValue(onPlan('FULL', { modules: {} }));
    const res = await http().get('/probe/read').set('x-test-tenant', 'org-a');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'MODULE_NOT_ENABLED', module: 'documents' });
    expect(JSON.stringify(res.body)).not.toMatch(/permission/i);
  });

  it('refuses MODULE_NOT_ENABLED when the plan grants NONE, or says nothing about the module', async () => {
    queryRaw.mockResolvedValue(onPlan('NONE'));
    expect((await http().get('/probe/read').set('x-test-tenant', 'org-a')).body.code).toBe('MODULE_NOT_ENABLED');
    queryRaw.mockResolvedValue(onPlan(null));
    expect((await http().get('/probe/read').set('x-test-tenant', 'org-a')).body.code).toBe('MODULE_NOT_ENABLED');
  });

  it('allows a read on a READ_ONLY module', async () => {
    queryRaw.mockResolvedValue(onPlan('READ_ONLY'));
    const res = await http().get('/probe/read').set('x-test-tenant', 'org-a');
    expect(res.status).toBe(200);
  });

  it('refuses MODULE_READ_ONLY for a write on a READ_ONLY module', async () => {
    queryRaw.mockResolvedValue(onPlan('READ_ONLY'));
    const res = await http().post('/probe/write').set('x-test-tenant', 'org-a');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'MODULE_READ_ONLY', module: 'documents' });
  });

  it('allows a read and a write on a FULL module', async () => {
    queryRaw.mockResolvedValue(onPlan('FULL'));
    expect((await http().get('/probe/read').set('x-test-tenant', 'org-a')).status).toBe(200);
    expect((await http().post('/probe/write').set('x-test-tenant', 'org-a')).status).toBe(201);
  });

  it('lets NULL_PLAN_FALLBACK_ACCESS decide when the organisation has no plan', async () => {
    expect(NULL_PLAN_FALLBACK_ACCESS).toBe('FULL');
    queryRaw.mockResolvedValue([{ settings: enabled, planId: null, moduleKey: null, accessLevel: null }]);
    expect((await http().post('/probe/write').set('x-test-tenant', 'org-a')).status).toBe(201);
    // Still needs the module switched on.
    queryRaw.mockResolvedValue([{ settings: { modules: {} }, planId: null, moduleKey: null, accessLevel: null }]);
    expect((await http().get('/probe/read').set('x-test-tenant', 'org-a')).body.code).toBe('MODULE_NOT_ENABLED');
  });

  it('a plan with no module rows grants nothing (not the no-plan fallback)', async () => {
    queryRaw.mockResolvedValue([{ settings: enabled, planId: 'plan-1', moduleKey: null, accessLevel: null }]);
    expect((await http().get('/probe/read').set('x-test-tenant', 'org-a')).body.code).toBe('MODULE_NOT_ENABLED');
  });

  it('a "true" string in settings does not switch a module on', async () => {
    queryRaw.mockResolvedValue(onPlan('FULL', { modules: { documents: 'true' } }));
    expect((await http().get('/probe/read').set('x-test-tenant', 'org-a')).body.code).toBe('MODULE_NOT_ENABLED');
  });

  it('a route with no @RequiresModule makes no query', async () => {
    const res = await http().get('/probe/open').set('x-test-tenant', 'org-a');
    expect(res.status).toBe(200);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('makes exactly one query per gated request', async () => {
    queryRaw.mockResolvedValue(onPlan('FULL'));
    await http().post('/probe/write').set('x-test-tenant', 'org-a');
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  itEnforcesTenantIsolation("ModuleGuard reads only the caller's own organisation and its own plan", async () => {
    queryRaw.mockResolvedValue(onPlan('FULL'));
    await http().get('/probe/read').set('x-test-tenant', 'org-a');

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    // The only bound value is the caller's organisation id: no plan id or
    // other organisation can enter the statement.
    expect(values).toEqual(['org-a']);
    const sql = strings.join('?');
    // The plan is reached through that organisation's own planId.
    expect(sql).toMatch(/JOIN "PlanModule" pm ON pm\."planId" = o\."planId"/);
    expect(sql).toMatch(/WHERE o\."id" = \?/);
  });

  it('fails loudly (500), never guessing, when a decorated route has no tenant on the request', async () => {
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await http().get('/unguarded');
    expect(res.status).toBe(500);
    expect(queryRaw).not.toHaveBeenCalled();
    quiet.mockRestore();
  });
});
