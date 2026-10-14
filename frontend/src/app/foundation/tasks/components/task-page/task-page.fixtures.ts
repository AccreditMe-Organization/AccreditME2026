import { ITaskActionsDto, ITaskHistoryEventDto, ITaskPageViewDto } from '../../services/task.service';

// ACC-228 — test data for the task page's specs. Not imported by the app.

export const NO_ACTIONS: ITaskActionsDto = {
  start: false,
  complete: false,
  completeNeedsEvidence: false,
  reject: false,
  release: false,
  pickUp: false,
  requestMoreTime: false,
  requestHold: false,
  withdrawRequest: false,
  reviewRequest: false,
  resume: false,
  addEvidence: false,
  reassign: false,
  edit: false,
  cancel: false,
  reopen: false,
  primary: null,
};

const PERSON = {
  positionNameEn: 'Clinical Pharmacist',
  positionNameAr: 'صيدلي إكلينيكي',
  orgUnitNameEn: 'Pharmacy',
  orgUnitNameAr: 'الصيدلية',
};

export function pageView(overrides: {
  task?: Partial<ITaskPageViewDto['task']>;
  actions?: Partial<ITaskActionsDto>;
  view?: Partial<Omit<ITaskPageViewDto, 'task' | 'actions'>>;
} = {}): ITaskPageViewDto {
  return {
    task: {
      id: 'task-1',
      organizationId: 'org-1',
      title: 'Update hand-hygiene audit tool',
      description: "Align the ward audit form with WHO's five moments.",
      sourceType: 'COMMITTEE',
      sourceId: 'committee-1',
      sourceStageId: null,
      workflowInstanceId: null,
      workflowInstanceStageId: null,
      isMandatory: false,
      meetingId: null,
      createdById: 'creator-1',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      dueAt: '2099-10-15T14:00:00.000Z',
      dueDateOverridden: false,
      slaBreachedAt: null,
      completedAt: null,
      completedById: null,
      requiresEvidence: true,
      rejectedReason: null,
      rejectedAt: null,
      rejectedById: null,
      assignedOrgUnitId: null,
      assignedPositionId: null,
      assignedCommitteeId: null,
      assignedCommitteeRoleValueId: null,
      pooledAt: null,
      poolEscalateAt: null,
      poolEscalatedAt: null,
      managerEscalatedAt: null,
      headEscalatedAt: null,
      heldAt: null,
      onHoldUntil: null,
      heldFromStatus: null,
      slaStartAt: null,
      slaLimitAt: null,
      slaExtendedTo: null,
      cancelledReason: null,
      cancelledAt: null,
      cancelledById: null,
      reopenedReason: null,
      reopenedAt: null,
      reopenedById: null,
      createdAt: '2026-10-01T06:12:00.000Z',
      updatedAt: '2026-10-05T11:20:00.000Z',
      evidenceCount: 2,
      pool: null,
      openRequest: null,
      canManage: false,
      ...overrides.task,
    },
    record: { type: 'COMMITTEE', id: 'committee-1', canOpen: true, nameEn: 'Infection Prevention & Control', nameAr: 'لجنة مكافحة العدوى' },
    stage: null,
    assignees: [{ id: 'huda', name: 'Dr. Huda Zahrani', ...PERSON, pickedAt: null, delegation: null }],
    poolMemberCount: null,
    createdBy: { id: 'creator-1', name: 'Nora Al-Otaibi', positionNameEn: 'Quality Manager', positionNameAr: 'مديرة الجودة', orgUnitNameEn: null, orgUnitNameAr: null },
    createdByWorkflow: false,
    completedBy: null,
    rejectedBy: null,
    cancelledBy: null,
    reopenedBy: null,
    ...overrides.view,
    actions: { ...NO_ACTIONS, ...overrides.actions },
  };
}

export const HISTORY: ITaskHistoryEventDto[] = [
  { at: '2026-10-01T06:12:00.000Z', actorName: 'Nora Al-Otaibi', kind: 'created', reason: null, requestType: null, evidenceType: null },
  { at: '2026-10-02T05:40:00.000Z', actorName: 'Dr. Huda Zahrani', kind: 'picked', reason: null, requestType: null, evidenceType: null },
  { at: '2026-10-02T07:05:00.000Z', actorName: 'Dr. Huda Zahrani', kind: 'started', reason: null, requestType: null, evidenceType: null },
  {
    at: '2026-10-05T11:20:00.000Z',
    actorName: 'Dr. Huda Zahrani',
    kind: 'request_made',
    reason: 'The audit form needs Infection Control sign-off.',
    requestType: 'ON_HOLD',
    evidenceType: null,
  },
];
