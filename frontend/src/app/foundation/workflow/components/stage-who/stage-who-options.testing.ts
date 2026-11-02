import { Provider, signal } from '@angular/core';
import { Observable, of } from 'rxjs';
import type { AssignableUnitDto, CommitteeRoleCatalogueDto } from '../../../tasks/services/task.service';
import type { IOrgPositionDto } from '../../../org-position/services/org-position.service';
import type { StageAssigneeKind, StageWhoEntryDto, WhoRulesDto } from '../../services/workflow-template.service';
import { StageWhoOptionsStore } from './stage-who-options.store';

/**
 * The server's whoRulesFor() for a record type that offers every kind, exactly
 * as the template read serves it (backend stage-who.ts) — spec data, so a spec
 * reads what the screen is given, not a copy the screen keeps.
 */
export const WHO_RULES: WhoRulesDto = {
  kinds: {
    SPECIFIC_USER: { uses: ['userId'], requires: ['userId'] },
    POSITION_IN_UNIT: { uses: ['positionId', 'orgUnitId'], requires: ['positionId', 'orgUnitId'] },
    ORG_UNIT_HEAD: { uses: ['orgUnitId'], requires: [] },
    CREATOR: { uses: [], requires: [] },
    COMMITTEE: { uses: ['committeeId', 'committeeRoleValueId'], requires: [] },
  },
  modes: [{ key: 'ANY_ONE' }, { key: 'ALL' }, { key: 'COMMITTEE_VOTE', onlyWithSingle: 'COMMITTEE' }],
  modeChoiceShownWhen: { minEntries: 2, orSingleKind: 'COMMITTEE' },
  defaultMode: 'ANY_ONE',
};

export const ALL_KINDS: StageAssigneeKind[] = ['SPECIFIC_USER', 'POSITION_IN_UNIT', 'ORG_UNIT_HEAD', 'CREATOR', 'COMMITTEE'];

/** A stored entry as the template read returns it; only what the spec names is set. */
export function storedEntry(entry: Partial<StageWhoEntryDto> & { kind: StageAssigneeKind }): StageWhoEntryDto {
  return {
    id: `entry-${entry.kind}-${Math.random().toString(36).slice(2, 8)}`,
    order: 1,
    userId: null,
    user: null,
    positionId: null,
    position: null,
    orgUnitId: null,
    orgUnit: null,
    committeeId: null,
    committee: null,
    committeeRoleValueId: null,
    committeeRole: null,
    isStartingAssignment: false,
    holderCount: null,
    ...entry,
  };
}

/** The units, positions and roles most who specs pick from. */
export const WHO_OPTIONS: FakeStageWhoOptions = {
  units: [
    { id: 'unit-q', parentId: null, nameEn: 'Quality Department', nameAr: 'إدارة الجودة' },
    { id: 'unit-ps', parentId: 'unit-q', nameEn: 'Patient Safety Unit', nameAr: null },
  ],
  positions: [
    { id: 'pos-tl', nameEn: 'Team Leader', nameAr: 'قائد فريق', isActive: true },
    { id: 'pos-qm', nameEn: 'Quality Manager', nameAr: 'مدير الجودة', isActive: true },
  ],
  roles: [
    { id: 'role-chair', labelEn: 'Chairman', labelAr: 'رئيس', memberCount: null },
    { id: 'role-sec', labelEn: 'Secretary', labelAr: null, memberCount: null },
  ],
  holders: { 'unit-q|pos-tl': 3, 'unit-ps|pos-tl': 0, 'unit-q|pos-qm': 1 },
};

/** Spec data for the stage editor's who lists. */
export interface FakeStageWhoOptions {
  units?: Partial<AssignableUnitDto>[];
  positions?: Partial<IOrgPositionDto>[];
  roles?: Partial<CommitteeRoleCatalogueDto>[];
  /** Holder counts for a draft Fixed position row, by `${unitId}|${positionId}`; missing = 0. */
  holders?: Record<string, number>;
}

/** A stand-in for the page-scoped StageWhoOptionsStore: the lists as given, no HTTP. */
export function fakeStageWhoOptions(data: FakeStageWhoOptions = {}): Provider {
  const fake = {
    units: signal(data.units ?? []),
    positions: signal(data.positions ?? []),
    roles: signal(data.roles ?? []),
    loaded: signal(true),
    ensureLoaded: jasmine.createSpy('ensureLoaded'),
    holderCount: (orgUnitId: string, positionId: string): Observable<number | null> => of(data.holders?.[`${orgUnitId}|${positionId}`] ?? 0),
  };
  return { provide: StageWhoOptionsStore, useValue: fake };
}
