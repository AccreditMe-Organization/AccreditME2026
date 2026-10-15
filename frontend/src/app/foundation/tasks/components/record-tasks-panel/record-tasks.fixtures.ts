import { ITaskActionsDto, ITaskRecordListDto, ITaskRecordRowDto } from '../../services/task.service';

// ACC-229 — rows as GET /tasks/record-panel and /record-list return them, for
// the panel's and the list's specs.

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

export function recordRow(id: string, over: Partial<ITaskRecordRowDto> = {}): ITaskRecordRowDto {
  return {
    id,
    title: `Task ${id}`,
    titleAr: null,
    status: 'PENDING',
    priority: 'MEDIUM',
    dueAt: '2099-10-20T05:00:00.000Z',
    onHoldUntil: null,
    completedAt: null,
    cancelledAt: null,
    cancelledReason: null,
    rejectedReason: null,
    createdAt: '2026-10-01T05:00:00.000Z',
    updatedAt: '2026-10-02T05:00:00.000Z',
    requiresEvidence: false,
    requirement: null,
    sourceType: 'COMMITTEE',
    sourceId: 'c-1',
    record: null,
    assignees: [{ id: 'u-1', name: 'Dr. Sara Al-Qahtani', positionNameEn: 'Quality Officer', positionNameAr: null }],
    pool: null,
    waitingInPool: false,
    pickedByViewer: false,
    openRequest: null,
    evidenceCount: 0,
    createdBy: { id: 'creator', name: 'Hessa Al-Dosari' },
    createdByWorkflow: false,
    actions: { ...NO_ACTIONS },
    ...over,
  };
}

export function rows(n: number, over: (i: number) => Partial<ITaskRecordRowDto> = () => ({})): ITaskRecordRowDto[] {
  return Array.from({ length: n }, (_, i) => recordRow(`t${i + 1}`, over(i)));
}

export function listPage(items: ITaskRecordRowDto[], over: Partial<ITaskRecordListDto> = {}): ITaskRecordListDto {
  return {
    items,
    total: items.length,
    matching: items.length,
    scope: 'all',
    facets: { people: [{ id: 'u-1', name: 'Dr. Sara Al-Qahtani' }], pools: [] },
    aroundIndex: null,
    ...over,
  };
}
