import { Test, TestingModule } from '@nestjs/testing';
import { PlatformSettingsController } from './platform-settings.controller';
import { PlatformSettingsService } from './platform-settings.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PlatformGuard } from '../../common/guards/platform.guard';

const ACTOR_ID = 'platform-admin-1';

describe('PlatformSettingsController', () => {
  let controller: PlatformSettingsController;
  let service: { getSettings: jest.Mock; updateSettings: jest.Mock };

  beforeEach(async () => {
    service = {
      getSettings: jest.fn().mockResolvedValue({ announcement: null }),
      updateSettings: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlatformSettingsController],
      providers: [{ provide: PlatformSettingsService, useValue: service }],
    })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PlatformGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(PlatformSettingsController);
  });

  afterEach(() => jest.clearAllMocks());

  it('getSettings delegates with no arguments', async () => {
    await controller.getSettings();
    expect(service.getSettings).toHaveBeenCalledWith();
  });

  it('updateSettings delegates with dto and actorId', async () => {
    const dto = { message: 'Hi', severity: 'info' as const };
    await controller.updateSettings(dto, ACTOR_ID);
    expect(service.updateSettings).toHaveBeenCalledWith(dto, ACTOR_ID);
  });
});
