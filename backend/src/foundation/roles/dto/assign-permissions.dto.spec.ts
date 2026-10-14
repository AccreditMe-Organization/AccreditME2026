import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AssignPermissionsDto } from './assign-permissions.dto';

// ACC-120 slice 5 — the request shape, through the real validators (the
// service specs never run them, so a decorator change is invisible there).
describe('AssignPermissionsDto (ACC-120 slice 5)', () => {
  const errorsFor = async (body: object): Promise<string[]> =>
    (await validate(plainToInstance(AssignPermissionsDto, body))).map((e) => e.property);

  it('accepts an EMPTY list (D6): a role may grant nothing', async () => {
    expect(await errorsFor({ permissionKeys: [], expectedPermissionKeys: [] })).toEqual([]);
  });

  // PR B — required. A save that does not say what it loaded cannot be told
  // apart from a stale one, so it is a 400 before the service is reached.
  it('refuses a save with no expectedPermissionKeys', async () => {
    expect(await errorsFor({ permissionKeys: ['tasks:view'] })).toEqual(['expectedPermissionKeys']);
  });

  it('accepts expectedPermissionKeys as a list of keys, empty included', async () => {
    expect(await errorsFor({ permissionKeys: ['tasks:view'], expectedPermissionKeys: [] })).toEqual([]);
    expect(
      await errorsFor({ permissionKeys: ['tasks:view'], expectedPermissionKeys: ['tasks:view'] }),
    ).toEqual([]);
  });

  it('refuses expectedPermissionKeys that is not a list of strings', async () => {
    expect(await errorsFor({ permissionKeys: [], expectedPermissionKeys: 'tasks:view' })).toEqual([
      'expectedPermissionKeys',
    ]);
    expect(await errorsFor({ permissionKeys: [], expectedPermissionKeys: [1] })).toEqual(['expectedPermissionKeys']);
  });

  it('still requires permissionKeys', async () => {
    expect(await errorsFor({ expectedPermissionKeys: [] })).toEqual(['permissionKeys']);
  });
});
