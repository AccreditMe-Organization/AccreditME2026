import { Observable, of } from 'rxjs';
import { TransferCommitteeSeatDto, TransferCommitteesDto } from '../../services/transfer-committees.service';
import { TransferUserWizardComponent } from './transfer-user-wizard.component';

// ACC-296 — fixtures shared by the Committees step's behaviour spec and its
// layout spec. Plain data and fakes; no TestBed here.

const unit = (id: string, nameEn: string, nameAr: string, parentId: string | null) => ({
  id,
  organizationId: 'org',
  parentId,
  nameEn,
  nameAr,
  code: id.toUpperCase(),
  type: null,
  typeValueId: null,
  typeValue: null,
  description: null,
  isActive: true,
  isCodeLocked: false,
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});
export const SOURCE_UNIT = unit('u-src', 'Pharmacy', 'الصيدلية', 'u-root');
export const DESTINATION_UNIT = unit('u-dst', 'Intensive Care', 'العناية المركزة', 'u-root');
export const UNITS = [unit('u-root', 'Al-Nakheel Hospital', 'مستشفى النخيل', null), SOURCE_UNIT, DESTINATION_UNIT];
/** The same units with no Arabic names (an organisation that does not work in Arabic). */
export const UNITS_EN_ONLY = UNITS.map((u) => ({ ...u, nameAr: null }));

export const PERSON = { id: 'user-1', name: 'Huda Al-Harbi', primaryOrgUnitId: SOURCE_UNIT.id };

export function seat(i: number, over: Partial<TransferCommitteeSeatDto> = {}): TransferCommitteeSeatDto {
  return {
    memberId: `m-${i}`,
    committeeId: `c-${i}`,
    nameEn: `Committee ${i}`,
    nameAr: `اللجنة ${i}`,
    seat: { id: 'seat-member', labelEn: 'Member', labelAr: 'عضو' },
    joinedAt: '2026-01-10T08:00:00.000Z',
    stage: { nameEn: 'Active', nameAr: 'نشطة' },
    mayRemove: true,
    ...over,
  };
}

export function seats(n: number, total = n): TransferCommitteesDto {
  return { total, rows: Array.from({ length: n }, (_, i) => seat(i + 1)) };
}

/** The UserService the wizard calls, answering every step without a server. */
export function fakeUserService(
  opts: {
    reports?: boolean;
    transfer?: () => Observable<unknown>;
    log?: string[];
    /** The one available position's names; Nurse / ممرضة by default. */
    position?: { nameEn: string; nameAr: string | null };
  } = {},
) {
  return {
    getById: () => of(PERSON),
    getTransferContext: () =>
      of({
        hasActiveDirectReports: opts.reports ?? false,
        availablePositions: [{ id: 'p-1', ...(opts.position ?? { nameEn: 'Nurse', nameAr: 'ممرضة' }), isUnitHeadPosition: false }],
        currentDestinationHead: null,
      }),
    validateTransferReplacement: () => of(undefined),
    validateTransferPosition: () => of(undefined),
    listAllUsers: () => of([{ id: 'm-boss', name: 'Omar Haddad' }, { id: 'r-1', name: 'Reem Saleh' }]),
    transferUser: (..._args: unknown[]) => {
      opts.log?.push('transfer');
      return opts.transfer ? opts.transfer() : of({ promotionCompleted: true });
    },
  };
}

/** Walks the wizard from Destination to the step after Manager, as a person would. */
export function walkToAfterManager(w: TransferUserWizardComponent, opts: { destination?: string; reports?: boolean } = {}): void {
  const activate = (value: number): void => w.currentStep.set(value);
  w.form.controls.destinationOrgUnitId.setValue(opts.destination ?? DESTINATION_UNIT.id);
  w.goFromDestination(activate);
  if (opts.reports) {
    w.form.controls.replacementUserId.setValue('r-1');
    w.goFromReplacement(activate);
  }
  w.form.controls.newPositionId.setValue('p-1');
  w.goFromPosition(activate);
  w.form.controls.newManagerId.setValue('m-boss');
  w.goFromManager(activate);
}
