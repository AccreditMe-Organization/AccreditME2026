import { Test, TestingModule } from '@nestjs/testing';
import { CommitteesController } from './committees.controller';
import { CommitteesService } from './committees.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { ICommittee, ICommitteeMember, ICommitteeMembershipEvent } from './interfaces/committee.interface';

const TENANT_ID = 'tenant-test';
const USER_ID = 'user-test';
const USER_PERMISSIONS = ['committees:manage']; // ACC-28

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
  termsOfReferenceDocumentId: null,
  reportingToCommitteeId: null,
  reportingToRoleId: null,
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

describe('CommitteesController', () => {
  let controller: CommitteesController;
  let service: {
    listCommittees: jest.Mock;
    getCommitteeById: jest.Mock;
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
      getCommitteeById: jest.fn().mockResolvedValue(MOCK_COMMITTEE),
      createCommittee: jest.fn().mockResolvedValue(MOCK_COMMITTEE),
      updateCommittee: jest.fn().mockResolvedValue(MOCK_COMMITTEE),
      listMembers: jest.fn().mockResolvedValue([MOCK_MEMBER]),
      listMembershipEvents: jest.fn().mockResolvedValue([MOCK_EVENT]),
      addMember: jest.fn().mockResolvedValue(MOCK_MEMBER),
      changeMemberRole: jest.fn().mockResolvedValue(MOCK_MEMBER),
      removeMember: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CommitteesController],
      providers: [{ provide: CommitteesService, useValue: service }],
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

  it('getCommitteeById delegates to the service', async () => {
    const result = await controller.getCommitteeById('committee-1', TENANT_ID);

    expect(service.getCommitteeById).toHaveBeenCalledWith('committee-1', TENANT_ID);
    expect(result).toEqual(MOCK_COMMITTEE);
  });

  it('createCommittee delegates to the service with tenant and actor', async () => {
    const dto = { nameEn: 'Quality Committee', nameAr: 'لجنة الجودة', typeValueId: 'quality_committee' };
    const result = await controller.createCommittee(dto as never, TENANT_ID, USER_ID);

    expect(service.createCommittee).toHaveBeenCalledWith(dto, TENANT_ID, USER_ID);
    expect(result).toEqual(MOCK_COMMITTEE);
  });

  it('updateCommittee delegates to the service with tenant, actor, and userPermissions (ACC-28)', async () => {
    const dto = { nameEn: 'Renamed' };
    const result = await controller.updateCommittee(
      'committee-1',
      dto as never,
      TENANT_ID,
      USER_ID,
      USER_PERMISSIONS,
    );

    expect(service.updateCommittee).toHaveBeenCalledWith('committee-1', dto, TENANT_ID, USER_ID, USER_PERMISSIONS);
    expect(result).toEqual(MOCK_COMMITTEE);
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

  it('addMember delegates to the service with tenant, actor, and userPermissions (ACC-28)', async () => {
    const dto = { userId: 'user-1', roleValueId: 'chairman' };
    const result = await controller.addMember(
      'committee-1',
      dto as never,
      TENANT_ID,
      USER_ID,
      USER_PERMISSIONS,
    );

    expect(service.addMember).toHaveBeenCalledWith('committee-1', dto, TENANT_ID, USER_ID, USER_PERMISSIONS);
    expect(result).toEqual(MOCK_MEMBER);
  });

  it('changeMemberRole delegates to the service with tenant, actor, and userPermissions (ACC-28)', async () => {
    const dto = { roleValueId: 'secretary' };
    const result = await controller.changeMemberRole(
      'committee-1',
      'member-1',
      dto as never,
      TENANT_ID,
      USER_ID,
      USER_PERMISSIONS,
    );

    expect(service.changeMemberRole).toHaveBeenCalledWith(
      'committee-1',
      'member-1',
      dto,
      TENANT_ID,
      USER_ID,
      USER_PERMISSIONS,
    );
    expect(result).toEqual(MOCK_MEMBER);
  });

  it('removeMember delegates to the service with tenant, actor, and userPermissions (ACC-28)', async () => {
    const dto = {};
    await controller.removeMember('committee-1', 'member-1', dto as never, TENANT_ID, USER_ID, USER_PERMISSIONS);

    expect(service.removeMember).toHaveBeenCalledWith(
      'committee-1',
      'member-1',
      dto,
      TENANT_ID,
      USER_ID,
      USER_PERMISSIONS,
    );
  });
});
