import { HomeController } from './home.controller';
import { HomeService } from './home.service';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';

// ACC-279 — the admin summary decides its parts in the service, so the route
// carries no permission (the shape of GET /tasks/views).
describe('HomeController (ACC-279)', () => {
  it("adminSummary carries no @Permissions and passes the tenant and the caller's permissions", async () => {
    const home = { adminSummary: jest.fn().mockResolvedValue({ setup: null, users: null, committees: null }) };
    const controller = new HomeController(home as unknown as HomeService);

    await controller.adminSummary('org-a', ['setup:view']);

    expect(home.adminSummary).toHaveBeenCalledWith('org-a', ['setup:view']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, HomeController.prototype.adminSummary)).toBeUndefined();
  });
});
