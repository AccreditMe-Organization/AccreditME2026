import { Test, TestingModule } from '@nestjs/testing';
import { PlanController } from './plan.controller';
import { PlanService } from './plan.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PlatformGuard } from '../../common/guards/platform.guard';

const PLATFORM_ORG_ID = 'platform-org';
const ACTOR_ID = 'actor-1';

describe('PlanController', () => {
  let controller: PlanController;
  let service: {
    listPlans: jest.Mock;
    getPlanById: jest.Mock;
    createPlan: jest.Mock;
    updatePlan: jest.Mock;
    deactivatePlan: jest.Mock;
    listPlanModules: jest.Mock;
    upsertPlanModule: jest.Mock;
    listAiCreditPacks: jest.Mock;
    createAiCreditPack: jest.Mock;
    updateAiCreditPack: jest.Mock;
    listAiFeatureCosts: jest.Mock;
    upsertAiFeatureCost: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      listPlans: jest.fn().mockResolvedValue([]),
      getPlanById: jest.fn().mockResolvedValue({}),
      createPlan: jest.fn().mockResolvedValue({}),
      updatePlan: jest.fn().mockResolvedValue({}),
      deactivatePlan: jest.fn().mockResolvedValue(undefined),
      listPlanModules: jest.fn().mockResolvedValue([]),
      upsertPlanModule: jest.fn().mockResolvedValue({}),
      listAiCreditPacks: jest.fn().mockResolvedValue([]),
      createAiCreditPack: jest.fn().mockResolvedValue({}),
      updateAiCreditPack: jest.fn().mockResolvedValue({}),
      listAiFeatureCosts: jest.fn().mockResolvedValue([]),
      upsertAiFeatureCost: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlanController],
      providers: [{ provide: PlanService, useValue: service }],
    })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PlatformGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(PlanController);
  });

  afterEach(() => jest.clearAllMocks());

  it('listPlans delegates with includeInactive parsed from query string', async () => {
    await controller.listPlans('true');
    expect(service.listPlans).toHaveBeenCalledWith(true);
  });

  it('getPlanById delegates with the id param', async () => {
    await controller.getPlanById('p1');
    expect(service.getPlanById).toHaveBeenCalledWith('p1');
  });

  it('createPlan delegates with dto, actorId, platformOrgId', async () => {
    const dto = { name: 'starter' } as any;
    await controller.createPlan(dto, ACTOR_ID, PLATFORM_ORG_ID);
    expect(service.createPlan).toHaveBeenCalledWith(dto, ACTOR_ID, PLATFORM_ORG_ID);
  });

  it('updatePlan delegates with id, dto, actorId, platformOrgId', async () => {
    const dto = { name: 'renamed' } as any;
    await controller.updatePlan('p1', dto, ACTOR_ID, PLATFORM_ORG_ID);
    expect(service.updatePlan).toHaveBeenCalledWith('p1', dto, ACTOR_ID, PLATFORM_ORG_ID);
  });

  it('deactivatePlan delegates with id, actorId, platformOrgId', async () => {
    await controller.deactivatePlan('p1', ACTOR_ID, PLATFORM_ORG_ID);
    expect(service.deactivatePlan).toHaveBeenCalledWith('p1', ACTOR_ID, PLATFORM_ORG_ID);
  });

  it('listPlanModules delegates with planId', async () => {
    await controller.listPlanModules('p1');
    expect(service.listPlanModules).toHaveBeenCalledWith('p1');
  });

  it('upsertPlanModule delegates with planId, dto, actorId, platformOrgId', async () => {
    const dto = { moduleKey: 'documents', accessLevel: 'FULL' } as any;
    await controller.upsertPlanModule('p1', dto, ACTOR_ID, PLATFORM_ORG_ID);
    expect(service.upsertPlanModule).toHaveBeenCalledWith('p1', dto, ACTOR_ID, PLATFORM_ORG_ID);
  });

  it('listAiCreditPacks delegates with includeInactive parsed from query string', async () => {
    await controller.listAiCreditPacks('true');
    expect(service.listAiCreditPacks).toHaveBeenCalledWith(true);
  });

  it('createAiCreditPack delegates with dto, actorId, platformOrgId', async () => {
    const dto = { name: 'Pack A' } as any;
    await controller.createAiCreditPack(dto, ACTOR_ID, PLATFORM_ORG_ID);
    expect(service.createAiCreditPack).toHaveBeenCalledWith(dto, ACTOR_ID, PLATFORM_ORG_ID);
  });

  it('updateAiCreditPack delegates with id, dto, actorId, platformOrgId', async () => {
    const dto = { credits: 500 } as any;
    await controller.updateAiCreditPack('pack-1', dto, ACTOR_ID, PLATFORM_ORG_ID);
    expect(service.updateAiCreditPack).toHaveBeenCalledWith('pack-1', dto, ACTOR_ID, PLATFORM_ORG_ID);
  });

  it('listAiFeatureCosts delegates with no arguments', async () => {
    await controller.listAiFeatureCosts();
    expect(service.listAiFeatureCosts).toHaveBeenCalledWith();
  });

  it('upsertAiFeatureCost delegates with dto, actorId, platformOrgId', async () => {
    const dto = { featureKey: 'rca_assistance', creditCost: 5 } as any;
    await controller.upsertAiFeatureCost(dto, ACTOR_ID, PLATFORM_ORG_ID);
    expect(service.upsertAiFeatureCost).toHaveBeenCalledWith(dto, ACTOR_ID, PLATFORM_ORG_ID);
  });
});
