// ACC-46 Section 2.6.b — the transfer wizard's HTTP layer. First
// HttpClient-based *.service.spec.ts in this codebase (no direct
// precedent existed) — follows the same provideHttpClient()/
// provideHttpClientTesting()/HttpTestingController pattern already
// established at the component level (invite-user.component.spec.ts).
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../../../environments/environment';
import { UserService, ITransferContextDto, ITransferResultDto } from './user.service';

describe('UserService — transfer wizard (ACC-46 Section 2.6.b)', () => {
  let service: UserService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(UserService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('getTransferContext() GETs /users/:id/transfer/context with destinationOrgUnitId as a query param', () => {
    const expected: ITransferContextDto = {
      hasActiveDirectReports: false,
      availablePositions: [],
      currentDestinationHead: null,
    };

    let result: ITransferContextDto | undefined;
    service.getTransferContext('user-1', 'unit-dest').subscribe((r) => (result = r));

    const req = httpMock.expectOne(
      (r) => r.url === `${environment.apiUrl}/users/user-1/transfer/context` && r.params.get('destinationOrgUnitId') === 'unit-dest',
    );
    expect(req.request.method).toBe('GET');
    req.flush(expected);

    expect(result).toEqual(expected);
  });

  it('validateTransferReplacement() POSTs to /users/:id/transfer/validate-replacement', () => {
    let completed = false;
    service.validateTransferReplacement('user-1', { replacementUserId: 'r1' }).subscribe(() => (completed = true));

    const req = httpMock.expectOne(`${environment.apiUrl}/users/user-1/transfer/validate-replacement`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ replacementUserId: 'r1' });
    req.flush(null, { status: 204, statusText: 'No Content' });

    expect(completed).toBe(true);
  });

  it('validateTransferPosition() POSTs to /users/:id/transfer/validate-position', () => {
    let completed = false;
    service
      .validateTransferPosition('user-1', { destinationOrgUnitId: 'unit-dest', newPositionId: 'pos-1' })
      .subscribe(() => (completed = true));

    const req = httpMock.expectOne(`${environment.apiUrl}/users/user-1/transfer/validate-position`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ destinationOrgUnitId: 'unit-dest', newPositionId: 'pos-1' });
    req.flush(null, { status: 204, statusText: 'No Content' });

    expect(completed).toBe(true);
  });

  it('transferUser() POSTs to /users/:id/transfer and returns ITransferResultDto', () => {
    const dto = { destinationOrgUnitId: 'unit-dest', newPositionId: 'pos-1', newManagerId: 'm1' };
    const expected: ITransferResultDto = {
      user: { id: 'user-1' } as ITransferResultDto['user'],
      promotionCompleted: true,
    };

    let result: ITransferResultDto | undefined;
    service.transferUser('user-1', dto).subscribe((r) => (result = r));

    const req = httpMock.expectOne(`${environment.apiUrl}/users/user-1/transfer`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(dto);
    req.flush(expected);

    expect(result).toEqual(expected);
  });

  it('transferUser() surfaces promotionCompleted: false with promotionError on a partial promotion failure', () => {
    const dto = { destinationOrgUnitId: 'unit-dest', newPositionId: 'pos-1' };
    const expected: ITransferResultDto = {
      user: { id: 'user-1' } as ITransferResultDto['user'],
      promotionCompleted: false,
      promotionError: 'destination position no longer vacant',
    };

    let result: ITransferResultDto | undefined;
    service.transferUser('user-1', dto).subscribe((r) => (result = r));

    const req = httpMock.expectOne(`${environment.apiUrl}/users/user-1/transfer`);
    // Still a 200 with a body describing the partial failure — not an
    // HTTP error (2.6.e: the core transfer already succeeded).
    req.flush(expected);

    expect(result?.promotionCompleted).toBe(false);
    expect(result?.promotionError).toBe('destination position no longer vacant');
  });
});
