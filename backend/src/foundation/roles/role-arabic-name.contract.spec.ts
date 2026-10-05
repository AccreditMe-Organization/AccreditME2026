import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { RoleController } from './role.controller';
import { RoleService } from './role.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';

jest.mock('better-auth/api', () => ({ isAPIError: () => false }));

// ACC-160 — THE ARABIC NAME, END TO END THROUGH THE HTTP BOUNDARY.
//
// THE LATENT 500 THIS PINS. Before ACC-160, UpdateRoleDto already ACCEPTED
// `nameAr: null` — PartialType adds @IsOptional, which skips null — and
// updateRole() writes it through (`dto.nameAr !== undefined`), so the request
// passed validation and then failed at the database's NOT NULL constraint: a
// server error for a client's ordinary request. The migration removed the
// constraint; this spec pins that the request now succeeds and that NULL is
// what reaches the write.
//
// WHY THE REAL SERVICE. ACC-78's contract specs mock the service, because they
// are about the pipe. Here the claim is "PATCH returns 200 AND stores null", so
// the real RoleService runs and only Prisma is mocked: one request covers the
// status, the validation, the transform and the service's write-through. The
// database half — the column accepting NULL — is the migration's, verified
// against the dev database when it was applied.
//
// The pipe options MUST mirror main.ts, for the reason ACC-78 gives: if they
// drift, this goes on passing while production rejects.
describe('Role Arabic name — HTTP contract (ACC-160)', () => {
  let app: INestApplication;
  const ORG = 'org-a-id';
  const ACTOR = 'user-1';
  const ROLE = {
    id: 'role-1',
    organizationId: ORG,
    key: null,
    nameEn: 'Governance Lead',
    nameAr: 'قائد الحوكمة',
    description: null,
    isSystem: false,
    isActive: true,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
  };

  const prisma = {
    role: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
    // The response attaches the role's permissions; none are needed here.
    rolePermission: { findMany: jest.fn() },
  };
  const auditLog = { log: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [RoleController],
      providers: [
        RoleService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: auditLog },
      ],
    })
      // The guards are not under test. This one sets what the real TenantGuard
      // would, so the real service is scoped to a real tenant.
      .overrideGuard(TenantGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest<{ tenantId: string; userId: string }>();
          req.tenantId = ORG;
          req.userId = ACTOR;
          return true;
        },
      })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );
    await app.init();
  });

  afterAll(async () => await app.close());

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.role.findFirst.mockImplementation(({ where }: { where: { id?: string } }) =>
      Promise.resolve(where.id ? ROLE : null),
    );
    // Echo what was written, so the response body shows the stored value.
    prisma.role.update.mockImplementation(({ data }: { data: object }) =>
      Promise.resolve({ ...ROLE, ...data }),
    );
    prisma.role.create.mockImplementation(({ data }: { data: object }) =>
      Promise.resolve({ ...ROLE, ...data }),
    );
    prisma.rolePermission.findMany.mockResolvedValue([]);
    auditLog.log.mockResolvedValue(undefined);
  });

  const writtenData = (): Record<string, unknown> =>
    (prisma.role.update.mock.calls[0][0] as { data: Record<string, unknown> }).data;

  // ── THE NON-VACUITY GUARD, first. ─────────────────────────────────────────
  // Every success below would also pass against a pipe that validated nothing.
  // These pin that the strict pipeline is live and that only the ARABIC half
  // was relaxed: an empty English name is still refused, by name, and an
  // undeclared property is still refused.
  describe('the pipeline under test is the strict one', () => {
    it('still refuses an empty English name, naming it', async () => {
      const res = await request(app.getHttpServer())
        .patch('/roles/role-1')
        .send({ nameEn: '' })
        .expect(400);

      expect(JSON.stringify(res.body.message)).toContain('nameEn');
      expect(prisma.role.update).not.toHaveBeenCalled();
    });

    it('still refuses a property the DTO does not declare', async () => {
      await request(app.getHttpServer()).patch('/roles/role-1').send({ colour: 'red' }).expect(400);
      expect(prisma.role.update).not.toHaveBeenCalled();
    });
  });

  // ── PATCH ─────────────────────────────────────────────────────────────────
  describe('PATCH /roles/:id', () => {
    it('accepts nameAr: null, returns 200 and writes NULL — the request that used to 500', async () => {
      const res = await request(app.getHttpServer())
        .patch('/roles/role-1')
        .send({ nameAr: null })
        .expect(200);

      expect(writtenData()).toEqual({ nameAr: null });
      expect(res.body.nameAr).toBeNull();
      // Scoped to the caller's tenant, by the real service.
      expect(prisma.role.findFirst).toHaveBeenCalledWith({
        where: { id: 'role-1', organizationId: ORG },
      });
    });

    it("turns an emptied field into NULL rather than storing ''", async () => {
      await request(app.getHttpServer()).patch('/roles/role-1').send({ nameAr: '' }).expect(200);
      expect(writtenData()).toEqual({ nameAr: null });
    });

    it('treats whitespace-only as empty', async () => {
      await request(app.getHttpServer()).patch('/roles/role-1').send({ nameAr: '   ' }).expect(200);
      expect(writtenData()).toEqual({ nameAr: null });
    });

    it('keeps a real Arabic name, trimmed', async () => {
      await request(app.getHttpServer())
        .patch('/roles/role-1')
        .send({ nameAr: '  قائد الحوكمة  ' })
        .expect(200);
      expect(writtenData()).toEqual({ nameAr: 'قائد الحوكمة' });
    });

    // An OMITTED field is undefined, not null, and Prisma ignores undefined —
    // so an update about something else cannot clear the Arabic name.
    it('leaves the Arabic name alone when the update does not mention it', async () => {
      await request(app.getHttpServer())
        .patch('/roles/role-1')
        .send({ description: 'Chairs the governance review' })
        .expect(200);
      expect(writtenData()).not.toHaveProperty('nameAr');
    });
  });

  // ── POST ──────────────────────────────────────────────────────────────────
  describe('POST /roles', () => {
    it('creates a role with no Arabic name at all', async () => {
      const res = await request(app.getHttpServer())
        .post('/roles')
        .send({ nameEn: 'Records Officer' })
        .expect(201);

      const data = (prisma.role.create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
      // Omitted means undefined, which Prisma writes as the column's NULL.
      expect(data['nameAr']).toBeUndefined();
      expect(data['nameEn']).toBe('Records Officer');
      expect(res.body.nameEn).toBe('Records Officer');
    });

    it("creates with an empty Arabic name stored as NULL, not ''", async () => {
      await request(app.getHttpServer())
        .post('/roles')
        .send({ nameEn: 'Records Officer', nameAr: '' })
        .expect(201);

      const data = (prisma.role.create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
      expect(data['nameAr']).toBeNull();
    });
  });
});
