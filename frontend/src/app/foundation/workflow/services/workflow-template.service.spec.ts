import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { WorkflowTemplateService, WorkflowTemplateDto } from './workflow-template.service';
import { environment } from '../../../../environments/environment';

const TEMPLATE_ID = 'template-1';
const URL = `${environment.apiUrl}/workflow-templates/${TEMPLATE_ID}`;

const TEMPLATE = {
  id: TEMPLATE_ID,
  organizationId: 'org-1',
  nameEn: 'Committee Lifecycle',
  nameAr: 'دورة حياة اللجنة',
  objectType: 'COMMITTEE',
  isDefault: true,
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  stages: [],
} as WorkflowTemplateDto;

// ACC-76 — getTemplate() coalesces concurrent requests. Tested because an
// untested request-dedupe is exactly the kind of thing that silently
// regresses: without these, reverting to a plain http.get() breaks nothing
// visible, it just quietly doubles the calls again.
describe('WorkflowTemplateService.getTemplate (ACC-76)', () => {
  let service: WorkflowTemplateService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [WorkflowTemplateService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(WorkflowTemplateService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('issues ONE request when two consumers ask before it resolves', () => {
    const received: WorkflowTemplateDto[] = [];

    // The real shape on an object-detail page: the page and
    // WorkflowTransitionActionsComponent both ask in the same cycle.
    service.getTemplate(TEMPLATE_ID).subscribe((t) => received.push(t));
    service.getTemplate(TEMPLATE_ID).subscribe((t) => received.push(t));

    httpMock.expectOne(URL).flush(TEMPLATE);

    // expectOne() above already asserts exactly one request was made; this
    // asserts BOTH subscribers were actually served by it.
    expect(received.length).toBe(2);
    expect(received[0]).toEqual(TEMPLATE);
    expect(received[1]).toEqual(TEMPLATE);
  });

  it('does not coalesce different template ids', () => {
    service.getTemplate(TEMPLATE_ID).subscribe();
    service.getTemplate('template-2').subscribe();

    httpMock.expectOne(URL).flush(TEMPLATE);
    httpMock.expectOne(`${environment.apiUrl}/workflow-templates/template-2`).flush(TEMPLATE);
  });

  // The half that makes this a coalescer and not a cache: once settled, the
  // next caller gets fresh data. A retained cache would show a template
  // another user has since edited.
  it('re-fetches on a later call once the first has settled', () => {
    service.getTemplate(TEMPLATE_ID).subscribe();
    httpMock.expectOne(URL).flush(TEMPLATE);

    service.getTemplate(TEMPLATE_ID).subscribe();
    httpMock.expectOne(URL).flush(TEMPLATE);
  });

  // A failed request must not pin a broken observable — otherwise one 403
  // (e.g. a user without workflows:view) would poison every later call for
  // the rest of the session.
  it('re-fetches after a failed request rather than replaying the error', () => {
    service.getTemplate(TEMPLATE_ID).subscribe({ error: () => undefined });
    httpMock.expectOne(URL).flush('denied', { status: 403, statusText: 'Forbidden' });

    let received: WorkflowTemplateDto | undefined;
    service.getTemplate(TEMPLATE_ID).subscribe((t) => (received = t));
    httpMock.expectOne(URL).flush(TEMPLATE);

    expect(received).toEqual(TEMPLATE);
  });
});
