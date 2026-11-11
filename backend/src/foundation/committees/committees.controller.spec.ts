import { Test, TestingModule } from '@nestjs/testing';
import { CommitteesController } from './committees.controller';
import { CommitteesService } from './committees.service';
import { CommitteeListsService } from './committee-lists.service';
import { CommitteeFormChoicesService } from './committee-form-choices.service';
import { CommitteeHomeService } from './committee-home.service';
import { CommitteeMembershipsService } from './committee-memberships.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { ICommittee, ICommitteeMember, ICommitteeMembershipEvent } from './interfaces/committee.interface';

const TENANT_ID = 'tenant-test';
const USER_ID = 'user-test';

const MOCK_COMMITTEE: ICommittee = {
  id: 'committee-1',
  organizationId: TENANT_ID,
  nameEn: 'Quality Committee',
  nameAr: 'لجنة الجودة',
  typeValueId: 'quality_committee',
  purpose: null,
  quorumCount: 3,
  meetingFrequency: 'MONTHLY',
  parentCommitteeId: null,
  orgUnitId: 'root-unit-a',
  termsOfReferenceDocumentId: null,
  reportingToCommitteeId: null,
  formedAt: null,
  dissolvedAt: null,
  isActive: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const MOCK_MEMBER: ICommitteeMember = {
  id: 'member-1',
  organizationId: TENANT_ID,
  committeeId: 'committee-1',
  userId: 'user-1',
  roleValueId: 'chairman',
  joinedAt: new Date('2026-01-01'),
  leftAt: null,
  isActive: true,
};

const MOCK_EVENT: ICommitteeMembershipEvent = {
  id: 'event-1',
  organizationId: TENANT_ID,
  committeeId: 'committee-1',
  userId: 'user-1',
  roleValueId: 'chairman',
  action: 'JOINED',
  effectiveDate: new Date('2026-01-01'),
  reason: null,
  approvedBy: null,
  createdAt: new Date('2026-01-01'),
};

// ACC-28 correction (Retrospective Note 2) — updateCommittee/addMember/
// changeMemberRole/removeMember no longer take a userPermissions
// parameter; each is gated purely by its own @Permissions() decorator,
// enforced by PermissionGuard (stubbed here, like every other controller
// spec in this codebase — see committees.permissions.spec.ts for real
// enforcement coverage). This file only proves delegation.
describe('CommitteesController', () => {
  let controller: CommitteesController;
  let lists: { members: jest.Mock; subCommittees: jest.Mock; membershipEvents: jest.Mock };
  let formChoices: { forOrganization: jest.Mock };
  let home: { mine: jest.Mock };
  let memberships: { forUser: jest.Mock };
  let service: {
    listCommittees: jest.Mock;
    getCommitteeDetail: jest.Mock;
    createCommittee: jest.Mock;
    updateCommittee: jest.Mock;
    listMembers: jest.Mock;
    listMembershipEvents: jest.Mock;
    addMember: jest.Mock;
    changeMemberRole: jest.Mock;
    removeMember: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      listCommittees: jest.fn().mockResolvedValue([MOCK_COMMITTEE]),
      getCommitteeDetail: jest.fn().mockResolvedValue(MOCK_COMMITTEE),
      createCommittee: jest.fn().mockResolvedValue(MOCK_COMMITTEE),
      updateCommittee: jest.fn().mockResolvedValue(MOCK_COMMITTEE),
      listMembers: jest.fn().mockResolvedValue([MOCK_MEMBER]),
      listMembershipEvents: jest.fn().mockResolvedValue([MOCK_EVENT]),
      addMember: jest.fn().mockResolvedValue(MOCK_MEMBER),
      changeMemberRole: jest.fn().mockResolvedValue(MOCK_MEMBER),
      removeMember: jest.fn().mockResolvedValue(undefined),
    };

    formChoices = { forOrganization: jest.fn().mockResolvedValue({ committeeTypes: [], orgUnits: [] }) };

    home = { mine: jest.fn().mockResolvedValue({ total: 0, rows: [] }) };
    memberships = { forUser: jest.fn().mockResolvedValue({ total: 0, rows: [] }) };

    lists = {
      members: jest.fn().mockResolvedValue({ items: [], total: 0, matching: 0 }),
      subCommittees: jest.fn().mockResolvedValue({ items: [], total: 0, matching: 0 }),
      membershipEvents: jest.fn().mockResolvedValue([MOCK_EVENT]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CommitteesController],
      providers: [
        { provide: CommitteesService, useValue: service },
        { provide: CommitteeListsService, useValue: lists },
        { provide: CommitteeFormChoicesService, useValue: formChoices },
        { provide: CommitteeHomeService, useValue: home },
        { provide: CommitteeMembershipsService, useValue: memberships },
      ],
    })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(CommitteesController);
  });

  afterEach(() => jest.clearAllMocks());

  // ACC-281 — every read passes the viewer, so the service can admit committees:view
  // OR an active member of the committee; no read carries a route permission.
  const PERMS = ['committees:view'];
  const VIEWER = { id: USER_ID, permissions: PERMS };

  it('listCommittees delegates with the viewer', async () => {
    const result = await controller.listCommittees(TENANT_ID, USER_ID, PERMS);

    expect(service.listCommittees).toHaveBeenCalledWith(TENANT_ID, VIEWER);
    expect(result).toEqual([MOCK_COMMITTEE]);
  });

  // ACC-238 — the record page's read, from getCommitteeDetail().
  it("getCommitteeById delegates to the service's detail read with the viewer", async () => {
    const result = await controller.getCommitteeById('committee-1', TENANT_ID, USER_ID, PERMS);

    expect(service.getCommitteeDetail).toHaveBeenCalledWith('committee-1', TENANT_ID, VIEWER);
    expect(result).toEqual(MOCK_COMMITTEE);
  });

  // ACC-279 — the caller's own committees: self-scoped, so no route permission.
  it('getMine delegates with the tenant and the CALLER, and carries no @Permissions', async () => {
    const result = await controller.getMine(TENANT_ID, 'user-1');

    expect(home.mine).toHaveBeenCalledWith(TENANT_ID, 'user-1');
    expect(result).toEqual({ total: 0, rows: [] });
    expect(Reflect.getMetadata(PERMISSIONS_KEY, CommitteesController.prototype.getMine)).toBeUndefined();
  });

  // ACC-295 — one person's memberships: committees:view at the route (users:view in the
  // service), and the caller's permissions and the query's userId passed on.
  it('getMemberships delegates with the tenant, the caller\'s permissions and the userId, under committees:view', async () => {
    const result = await controller.getMemberships({ userId: 'user-9' }, TENANT_ID, PERMS);
    expect(memberships.forUser).toHaveBeenCalledWith(TENANT_ID, { permissions: PERMS }, 'user-9');
    expect(result).toEqual({ total: 0, rows: [] });
    const handler = Object.getOwnPropertyDescriptor(CommitteesController.prototype, 'getMemberships')!.value as object;
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual(['committees:view']);
  });

  // ACC-281 — no read gates on committees:view at the route: the service decides
  // view-or-member. Pinned handler by handler, so one cannot quietly get it back.
  it.each(['listCommittees', 'getCommitteeById', 'listMembers', 'membersPage', 'subCommittees', 'listMembershipEvents'] as const)(
    '%s carries no route permission (ACC-281)',
    (handler) => {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, CommitteesController.prototype[handler])).toBeUndefined();
    },
  );

  // ACC-281 — every write keeps EXACTLY its own key at the route (Ahmad, 7 Nov).
  it.each([
    ['createCommittee', ['committees:create']],
    ['updateCommittee', ['committees:edit_details']],
    ['addMember', ['committees:add_member']],
    ['changeMemberRole', ['committees:change_member_role']],
    ['removeMember', ['committees:remove_member']],
  ] as const)('%s keeps its own route permission, %j', (handler, keys) => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, CommitteesController.prototype[handler])).toEqual(keys);
  });

  it('createCommittee delegates to the service with tenant and actor', async () => {
    const dto = { nameEn: 'Quality Committee', nameAr: 'لجنة الجودة', typeValueId: 'quality_committee' };
    const result = await controller.createCommittee(dto as never, TENANT_ID, USER_ID);

    expect(service.createCommittee).toHaveBeenCalledWith(dto, TENANT_ID, USER_ID);
    expect(result).toEqual(MOCK_COMMITTEE);
  });

  it("updateCommittee delegates with tenant, actor and the actor's permissions", async () => {
    const dto = { nameEn: 'Renamed' };
    const result = await controller.updateCommittee('committee-1', dto as never, TENANT_ID, USER_ID, PERMS);

    expect(service.updateCommittee).toHaveBeenCalledWith('committee-1', dto, TENANT_ID, USER_ID, PERMS);
    expect(result).toEqual(MOCK_COMMITTEE);
  });

  // ACC-230 — the two lists behind the Members and Sub-committees panels.
  it('membersPage delegates to the lists service with the query, the tenant and the viewer', async () => {
    const query = { q: 'sara', sort: 'name' as const, take: 5 };
    await controller.membersPage('committee-1', query, TENANT_ID, USER_ID, PERMS);
    expect(lists.members).toHaveBeenCalledWith('committee-1', query, TENANT_ID, VIEWER);
  });

  it('subCommittees delegates to the lists service with the query, the tenant and the viewer', async () => {
    const query = { sort: 'status' as const };
    await controller.subCommittees('committee-1', query, TENANT_ID, USER_ID, PERMS);
    expect(lists.subCommittees).toHaveBeenCalledWith('committee-1', query, TENANT_ID, VIEWER);
  });

  it('listMembers delegates to the service with the viewer', async () => {
    const result = await controller.listMembers('committee-1', TENANT_ID, USER_ID, PERMS);

    expect(service.listMembers).toHaveBeenCalledWith('committee-1', TENANT_ID, VIEWER);
    expect(result).toEqual([MOCK_MEMBER]);
  });

  it('listMembershipEvents delegates to the lists service (named rows) with the viewer', async () => {
    const result = await controller.listMembershipEvents('committee-1', TENANT_ID, USER_ID, PERMS);

    expect(lists.membershipEvents).toHaveBeenCalledWith('committee-1', TENANT_ID, VIEWER);
    expect(result).toEqual([MOCK_EVENT]);
  });

  it("addMember delegates with tenant, actor and the actor's permissions", async () => {
    const dto = { userId: 'user-1', roleValueId: 'chairman' };
    const result = await controller.addMember('committee-1', dto as never, TENANT_ID, USER_ID, PERMS);

    expect(service.addMember).toHaveBeenCalledWith('committee-1', dto, TENANT_ID, USER_ID, PERMS);
    expect(result).toEqual(MOCK_MEMBER);
  });

  it("changeMemberRole delegates with tenant, actor and the actor's permissions", async () => {
    const dto = { roleValueId: 'secretary' };
    const result = await controller.changeMemberRole('committee-1', 'member-1', dto as never, TENANT_ID, USER_ID, PERMS);

    expect(service.changeMemberRole).toHaveBeenCalledWith('committee-1', 'member-1', dto, TENANT_ID, USER_ID, PERMS);
    expect(result).toEqual(MOCK_MEMBER);
  });

  it("removeMember delegates with tenant, actor and the actor's permissions", async () => {
    const dto = {};
    await controller.removeMember('committee-1', 'member-1', dto as never, TENANT_ID, USER_ID, PERMS);

    expect(service.removeMember).toHaveBeenCalledWith('committee-1', 'member-1', dto, TENANT_ID, USER_ID, PERMS);
  });

  // ACC-255 (plan §10.5)
  it('getFormChoices delegates to the form choices service with the tenant', async () => {
    await expect(controller.getFormChoices('org-a')).resolves.toEqual({ committeeTypes: [], orgUnits: [] });
    expect(formChoices.forOrganization).toHaveBeenCalledWith('org-a');
  });
});
