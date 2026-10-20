import { Test, TestingModule } from '@nestjs/testing';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { CreateOrgUnitDto } from './dto/create-org-unit.dto';
import { UpdateOrgUnitDto } from './dto/update-org-unit.dto';
import { IOrgUnit } from './interfaces/org-unit.interface';
import { OrgStructureService } from './org-structure.service';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TENANT_ID = 'org-test';
const USER_ID   = 'user-test';
const UNIT_ID   = 'unit-test';

const MOCK_UNIT: IOrgUnit = {
  id:             UNIT_ID,
  organizationId: TENANT_ID,
  parentId:       null,
  nameEn:         'Intensive Care Unit',
  nameAr:         null,
  code:           'ICU',
  type:           null,
  typeValueId:    null,
  typeValue:      null,
  description:    null,
  isActive:       true,
  isCodeLocked:   false,
  sortOrder:      0,
  createdAt:      new Date('2026-01-01'),
  updatedAt:      new Date('2026-01-01'),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OrganizationController', () => {
  let controller: OrganizationController;
  let service: {
    getTree:    jest.Mock;
    listFlat:   jest.Mock;
    findById:   jest.Mock;
    create:     jest.Mock;
    update:     jest.Mock;
    deactivate: jest.Mock;
  };
  let structure: { structure: jest.Mock; chart: jest.Mock; summary: jest.Mock };

  beforeEach(async () => {
    service = {
      getTree:    jest.fn().mockResolvedValue([MOCK_UNIT]),
      listFlat:   jest.fn().mockResolvedValue([MOCK_UNIT]),
      findById:   jest.fn().mockResolvedValue(MOCK_UNIT),
      create:     jest.fn().mockResolvedValue(MOCK_UNIT),
      update:     jest.fn().mockResolvedValue(MOCK_UNIT),
      deactivate: jest.fn().mockResolvedValue({ ...MOCK_UNIT, isActive: false }),
    };

    structure = {
      structure: jest.fn().mockResolvedValue({ nodes: [], asOf: new Date() }),
      chart: jest.fn().mockResolvedValue({ root: { id: UNIT_ID, path: [] }, depth: 4, nodes: [], asOf: new Date() }),
      summary: jest.fn().mockResolvedValue({ unit: { id: UNIT_ID } }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrganizationController],
      providers: [
        { provide: OrganizationService, useValue: service },
        { provide: OrgStructureService, useValue: structure },
      ],
    })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(OrganizationController);
  });

  afterEach(() => jest.clearAllMocks());

  // ── getTree ───────────────────────────────────────────────────────────────

  describe('getTree', () => {
    it('delegates to organizationService.getTree with tenantId', async () => {
      const result = await controller.getTree(TENANT_ID);
      expect(service.getTree).toHaveBeenCalledWith(TENANT_ID);
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe(UNIT_ID);
    });
  });

  // ── listFlat ──────────────────────────────────────────────────────────────

  describe('listFlat', () => {
    it('delegates to organizationService.listFlat with tenantId', async () => {
      const result = await controller.listFlat(TENANT_ID);
      expect(service.listFlat).toHaveBeenCalledWith(TENANT_ID);
      expect(result).toHaveLength(1);
    });
  });

  // ── the read model (ACC-120 slice 11) ─────────────────────────────────────

  describe('structure, chart and summary', () => {
    const PERMS = ['org:view', 'users:view'];

    it('structure passes the tenant, the caller’s permissions and includeInactive', async () => {
      await controller.structure({ includeInactive: true }, TENANT_ID, PERMS);
      expect(structure.structure).toHaveBeenCalledWith(TENANT_ID, PERMS, { includeInactive: true });
    });

    it('chart passes rootId and depth', async () => {
      await controller.chart({ rootId: UNIT_ID, depth: 3 }, TENANT_ID, PERMS);
      expect(structure.chart).toHaveBeenCalledWith(TENANT_ID, PERMS, { rootId: UNIT_ID, depth: 3 });
    });

    it('summary passes the unit id', async () => {
      await controller.summary(UNIT_ID, TENANT_ID, PERMS);
      expect(structure.summary).toHaveBeenCalledWith(TENANT_ID, PERMS, UNIT_ID);
    });

    it('all three need org:view', () => {
      for (const handler of ['structure', 'chart', 'summary'] as const) {
        expect(Reflect.getMetadata(PERMISSIONS_KEY, OrganizationController.prototype[handler])).toEqual(['org:view']);
      }
    });

    // Express matches routes in declaration order: below ':id', 'structure'
    // and 'chart' would be read as unit ids and answer 404.
    it('are declared above :id', () => {
      const order = Object.getOwnPropertyNames(OrganizationController.prototype);
      for (const handler of ['structure', 'chart', 'summary']) {
        expect(order.indexOf(handler)).toBeGreaterThan(-1);
        expect(order.indexOf(handler)).toBeLessThan(order.indexOf('findById'));
      }
    });
  });

  // ── findById ──────────────────────────────────────────────────────────────

  describe('findById', () => {
    it('delegates to organizationService.findById with id and tenantId', async () => {
      const result = await controller.findById(UNIT_ID, TENANT_ID);
      expect(service.findById).toHaveBeenCalledWith(UNIT_ID, TENANT_ID);
      expect(result.id).toBe(UNIT_ID);
    });
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('delegates to organizationService.create with tenantId, dto, and actorId', async () => {
      const dto = { nameEn: 'Intensive Care Unit', code: 'ICU' } as CreateOrgUnitDto;
      const result = await controller.create(dto, TENANT_ID, USER_ID);
      expect(service.create).toHaveBeenCalledWith(TENANT_ID, dto, USER_ID);
      expect(result.organizationId).toBe(TENANT_ID);
    });
  });

  // ── update ────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('delegates to organizationService.update with id, tenantId, dto, and actorId', async () => {
      const dto = { nameEn: 'Updated ICU' } as UpdateOrgUnitDto;
      const result = await controller.update(UNIT_ID, dto, TENANT_ID, USER_ID);
      expect(service.update).toHaveBeenCalledWith(UNIT_ID, TENANT_ID, dto, USER_ID);
      expect(result.id).toBe(UNIT_ID);
    });
  });

  // ── deactivate ────────────────────────────────────────────────────────────

  describe('deactivate', () => {
    it('delegates to organizationService.deactivate with id, tenantId, and actorId', async () => {
      const result = await controller.deactivate(UNIT_ID, TENANT_ID, USER_ID);
      expect(service.deactivate).toHaveBeenCalledWith(UNIT_ID, TENANT_ID, USER_ID);
      expect(result.isActive).toBe(false);
    });
  });
});
