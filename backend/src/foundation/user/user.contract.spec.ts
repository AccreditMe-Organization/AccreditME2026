import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';

jest.mock('better-auth/api', () => ({ isAPIError: () => false }));

// ACC-78 — THE HTTP CONTRACT. The test shape that would have caught the 400.
//
// Why the existing suite could not. A controller spec calls
// `controller.listUsers(tenantId, dto)` with arguments already constructed, so
// the ValidationPipe never runs. Every such spec passed while every request
// carrying a filter was rejected in production:
//
//   GET /users?status=ACTIVE
//   → {"message":["property status should not exist"],
//      "error":"Bad Request","statusCode":400}
//
// Cause: a bare `@Query()` binds the WHOLE query object, so the globally
// configured `forbidNonWhitelisted: true` validated every parameter against a
// DTO that declared only page/pageSize/search/sortBy/sortDir. The 78 tenant
// isolation tests on this branch were true and entirely irrelevant to it.
//
// So this spec asserts the one thing those cannot: that a real request, with a
// real query string, through the REAL pipe configuration from main.ts, is
// accepted or rejected as intended. The service is mocked — this is about the
// HTTP boundary, not about what the service does with the values.
//
// The pipe options below MUST mirror main.ts. If they drift, this spec goes on
// passing while production rejects; that is the failure mode it exists for, so
// it is worth checking them together when either changes.
describe('UserController HTTP contract (ACC-78)', () => {
  let app: INestApplication;
  const listUsers = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        {
          provide: UserService,
          useValue: {
            listUsers,
            getStatusCounts: jest.fn().mockResolvedValue({}),
          },
        },
      ],
    })
      // The guards are not what is under test; a real TenantGuard would need a
      // JWT, and the parameter decorators resolve to undefined harmlessly.
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
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
    listUsers.mockReset();
    listUsers.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 25 });
  });

  // Each of these is a query string the UI actually sends. Written as real
  // URLs rather than objects, because the defect lived in how the query string
  // was bound — an object would skip the part that broke.
  const accepted = [
    ['no parameters at all', ''],
    ['pagination only', '?page=2&pageSize=50'],
    ['the status chip', '?status=ACTIVE'],
    ['the org-unit filter', '?orgUnitId=3f5e2917-bd9b-4d09-8379-66d919aff729'],
    ['the position filter', '?positionId=3f5e2917-bd9b-4d09-8379-66d919aff729'],
    ['search plus sort', '?search=ahmad&sortBy=email&sortDir=desc'],
    [
      'every filter at once, as the full bar sends them',
      '?status=INVITED&orgUnitId=3f5e2917-bd9b-4d09-8379-66d919aff729' +
        '&positionId=3f5e2917-bd9b-4d09-8379-66d919aff729' +
        '&search=a&sortBy=name&sortDir=asc&page=1&pageSize=25',
    ],
  ];

  for (const [name, qs] of accepted) {
    it(`accepts ${name}`, async () => {
      await request(app.getHttpServer()).get(`/users${qs}`).expect(200);
      expect(listUsers).toHaveBeenCalled();
    });
  }

  // The other half of the contract. forbidNonWhitelisted is not collateral
  // damage to be worked around — it is what turns a misspelled filter into an
  // error instead of a silently ignored parameter, which on a permissions
  // screen is the difference between "no results" and "results you should not
  // see". These assert it still bites.
  it('rejects an undeclared parameter rather than ignoring it', async () => {
    const res = await request(app.getHttpServer()).get('/users?stattus=ACTIVE').expect(400);
    expect(JSON.stringify(res.body)).toContain('stattus');
    expect(listUsers).not.toHaveBeenCalled();
  });

  it('rejects a status outside the allowed set', async () => {
    await request(app.getHttpServer()).get('/users?status=BANANA').expect(400);
    expect(listUsers).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid orgUnitId', async () => {
    await request(app.getHttpServer()).get('/users?orgUnitId=not-a-uuid').expect(400);
    expect(listUsers).not.toHaveBeenCalled();
  });

  it('rejects a pageSize above the cap', async () => {
    await request(app.getHttpServer()).get('/users?pageSize=5000').expect(400);
    expect(listUsers).not.toHaveBeenCalled();
  });

  // Query strings are strings. Without @Type(() => Number) the DTO receives
  // "2" and @IsInt fails, so this pins the coercion as part of the contract.
  it('coerces numeric query parameters', async () => {
    await request(app.getHttpServer()).get('/users?page=2&pageSize=10').expect(200);
    expect(listUsers).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ page: 2, pageSize: 10 }),
    );
  });
});
