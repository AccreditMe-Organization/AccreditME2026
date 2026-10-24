import { LIST_DIALOG_SHEET_BELOW_PX } from '../../../shared/components/list-dialog/list-dialog.component';
import { ChangeRequestDto } from './change-request.service';

/**
 * Answers the phone query (`injectIsPhone()`) as `phone` says, and every other
 * media query as the browser does. Call before the component is created.
 */
export function fakePhone(phone: boolean): void {
  const query = `(max-width: ${LIST_DIALOG_SHEET_BELOW_PX - 0.02}px)`;
  const real = jasmine.isSpy(window.matchMedia) ? null : window.matchMedia.bind(window);
  const spy = jasmine.isSpy(window.matchMedia) ? (window.matchMedia as jasmine.Spy) : spyOn(window, 'matchMedia');
  const passThrough = real ?? ((q: string) => ({ matches: false, media: q, addEventListener: () => undefined, removeEventListener: () => undefined }) as unknown as MediaQueryList);
  spy.and.callFake((q: string) =>
    q === query
      ? ({ matches: phone, media: q, addEventListener: () => undefined, removeEventListener: () => undefined } as unknown as MediaQueryList)
      : passThrough(q),
  );
}

/** ACC-240 — one change request, under review, for specs; override what a spec is about. */
export const REQUEST = (over: Partial<ChangeRequestDto> = {}): ChangeRequestDto => ({
  id: 'cr-1',
  committeeId: 'c-1',
  committeeNameEn: 'Patient Experience Committee',
  committeeNameAr: null,
  number: 3,
  status: 'under_review',
  requestedBy: { id: 'u-nora', name: 'Nora Al-Otaibi' },
  reason: 'Two new members joined.',
  changes: { quorumCount: 6 },
  fromValues: { quorumCount: 5 },
  submittedAt: '2026-10-18T09:00:00Z',
  returnNote: null,
  rejectionReason: null,
  decidedById: null,
  decidedBy: null,
  decidedAt: null,
  appliedAt: null,
  termsTaskId: null,
  withdrawnById: null,
  withdrawnBy: null,
  withdrawnAt: null,
  createdAt: '2026-10-17T09:00:00Z',
  updatedAt: '2026-10-18T09:00:00Z',
  actions: { edit: false, submit: false, withdraw: false, approve: false, return: false, reject: false },
  labels: {},
  ...over,
});
