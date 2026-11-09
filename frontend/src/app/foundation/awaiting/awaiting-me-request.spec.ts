import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../../environments/environment';
import { WorkflowService } from '../workflow/services/workflow.service';

// ACC-120 — WorkflowService.getAwaitingMe() takes an optional page for the
// Awaiting my action page. Kept here, beside its only paging caller, so the
// workflow folder carries just the one-line change to its service.
describe('WorkflowService.getAwaitingMe (ACC-120)', () => {
  const URL = `${environment.apiUrl}/workflows/awaiting-me`;
  let http: HttpTestingController;
  let service: WorkflowService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(WorkflowService);
  });
  afterEach(() => http.verify());

  it("with no argument sends exactly Home's request: no query params", () => {
    service.getAwaitingMe().subscribe();
    const req = http.expectOne((r) => r.url === URL);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.keys()).toEqual([]);
    expect(req.request.urlWithParams).toBe(URL);
    req.flush({ total: 0, rows: [], oldestSince: null });
  });

  it('with a page sends skip and take', () => {
    service.getAwaitingMe({ skip: 50, take: 50 }).subscribe();
    const req = http.expectOne((r) => r.url === URL);
    expect(req.request.params.get('skip')).toBe('50');
    expect(req.request.params.get('take')).toBe('50');
    expect(req.request.params.keys().sort()).toEqual(['skip', 'take']);
    req.flush({ total: 0, rows: [], oldestSince: null });
  });
});
