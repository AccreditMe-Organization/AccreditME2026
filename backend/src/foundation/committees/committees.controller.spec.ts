import { Test, TestingModule } from '@nestjs/testing';
import { CommitteesController } from './committees.controller';
import { CommitteesService } from './committees.service';
import { CommitteeListsService } from './committee-lists.service';
import { CommitteeFormChoicesService } from './committee-form-choices.service';
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
  let lists: { members: jest.Mock; subCommittees: jest.Mock };
  let formChoices: { forOrganization: jest.Mock };
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

    lists = {
      members: jest.fn().mockResolvedValue({ items: [], total: 0, matching: 0 }),
      subCommittees: jest.fn().mockResolvedValue({ items: [], total: 0, matching: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CommitteesController],
      providers: [
        { provide: CommitteesService, useValue: service },
        { provide: CommitteeListsService, useValue: lists },
        { provide: CommitteeFormChoicesService, useValue: formChoices },
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

  it('listCommittees delegates to the service', async () => {
    const result = await controller.listCommittees(TENANT_ID);

    expect(service.listCommittees).toHaveBeenCalledWith(TENANT_ID);
    expect(result).toEqual([MOCK_COMMITTEE]);
  });

  // ACC-238 — the record page's read carries the stage key, from getCommitteeDetail().
  it("getCommitteeById delegates to the service's detail read", async () => {
    const result = await controller.getCommitteeById('committee-1', TENANT_ID);

    expect(service.getCommitteeDetail).toHaveBeenCalledWith('committee-1', TENANT_ID);
    expect(result).toEqual(MOCK_COMMITTEE);
  });

  // ACC-265 — the record page's read, which now names the type and the owning
  // unit, needs committees:view and nothing else: a role without lookups:view
  // or org:view reads the names with the committee.
  it('the record read needs committees:view alone', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, CommitteesController.prototype.getCommitteeById)).toEqual(['committees:view']);
  });

  it('createCommittee delegates to the service with tenant and actor', async () => {
    const dto = { nameEn: 'Quality Committee', nameAr: 'لجنة الجودة', typeValueId: 'quality_committee' };
    const result = await controller.createCommittee(dto as never, TENANT_ID, USER_ID);

    expect(service.createCommittee).toHaveBeenCalledWith(dto, TENANT_ID, USER_ID);
    expect(result).toEqual(MOCK_COMMITTEE);
  });

  it('updateCommittee delegates to the service with tenant and actor', async () => {
    const dto = { nameEn: 'Renamed' };
    const result = await controller.updateCommittee('committee-1', dto as never, TENANT_ID, USER_ID);

    expect(service.updateCommittee).toHaveBeenCalledWith('committee-1', dto, TENANT_ID, USER_ID);
    expect(result).toEqual(MOCK_COMMITTEE);
  });

  // ACC-230 — the two lists behind the Members and Sub-committees panels.
  it('membersPage delegates to the lists service with the query and the tenant', async () => {
    const query = { q: 'sara', sort: 'name' as const, take: 5 };
    await controller.membersPage('committee-1', query, TENANT_ID);
    expect(lists.members).toHaveBeenCalledWith('committee-1', query, TENANT_ID);
  });

  it('subCommittees delegates to the lists service with the query and the tenant', async () => {
    const query = { sort: 'status' as const };
    await controller.subCommittees('committee-1', query, TENANT_ID);
    expect(lists.subCommittees).toHaveBeenCalledWith('committee-1', query, TENANT_ID);
  });

  it('listMembers delegates to the service', async () => {
    const result = await controller.listMembers('committee-1', TENANT_ID);

    expect(service.listMembers).toHaveBeenCalledWith('committee-1', TENANT_ID);
    expect(result).toEqual([MOCK_MEMBER]);
  });

  it('listMembershipEvents delegates to the service', async () => {
    const result = await controller.listMembershipEvents('committee-1', TENANT_ID);

    expect(service.listMembershipEvents).toHaveBeenCalledWith('committee-1', TENANT_ID);
    expect(result).toEqual([MOCK_EVENT]);
  });

  it('addMember delegates to the service with tenant and actor', async () => {
    const dto = { userId: 'user-1', roleValueId: 'chairman' };
    const result = await controller.addMember('committee-1', dto as never, TENANT_ID, USER_ID);

    expect(service.addMember).toHaveBeenCalledWith('committee-1', dto, TENANT_ID, USER_ID);
    expect(result).toEqual(MOCK_MEMBER);
  });

  it('changeMemberRole delegates to the service with tenant and actor', async () => {
    const dto = { roleValueId: 'secretary' };
    const result = await controller.changeMemberRole('committee-1', 'member-1', dto as never, TENANT_ID, USER_ID);

    expect(service.changeMemberRole).toHaveBeenCalledWith('committee-1', 'member-1', dto, TENANT_ID, USER_ID);
    expect(result).toEqual(MOCK_MEMBER);
  });

  it('removeMember delegates to the service with tenant and actor', async () => {
    const dto = {};
    await controller.removeMember('committee-1', 'member-1', dto as never, TENANT_ID, USER_ID);

    expect(service.removeMember).toHaveBeenCalledWith('committee-1', 'member-1', dto, TENANT_ID, USER_ID);
  });

  // ACC-255 (plan §10.5)
  it('getFormChoices delegates to the form choices service with the tenant', async () => {
    await expect(controller.getFormChoices('org-a')).resolves.toEqual({ committeeTypes: [], orgUnits: [] });
    expect(formChoices.forOrganization).toHaveBeenCalledWith('org-a');
  });
});
