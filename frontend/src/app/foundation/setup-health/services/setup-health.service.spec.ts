import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../../../environments/environment';
import { SetupConditionDto, SetupHealthService } from './setup-health.service';

const condition = (id: string, severity: SetupConditionDto['severity']): SetupConditionDto => ({
  id,
  type: 'ORG_UNIT_WITHOUT_HEAD',
  severity,
  objectId: `unit-${id}`,
  subject: { nameEn: id },
  openedAt: '2026-09-01T08:00:00.000Z',
  ageBasis: 'OBJECT',
  lastSeenAt: '2026-09-15T08:00:00.000Z',
  clearedAt: null,
});

describe('SetupHealthService (ACC-82)', () => {
  let service: SetupHealthService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(SetupHealthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reads the summary for the badge and keeps it', () => {
    service.getSummary().subscribe();
    http.expectOne(`${environment.apiUrl}/setup-health/summary`).flush({ open: 25, blocksWork: 2 });

    expect(service.summary()).toEqual({ open: 25, blocksWork: 2 });
  });

  // Opening the page after a fix must correct the badge without waiting for
  // the rail's next poll.
  it('updates the badge counts from the full read', () => {
    service.getHealth().subscribe();
    http.expectOne(`${environment.apiUrl}/setup-health`).flush({
      open: [condition('a', 'BLOCKS_WORK'), condition('b', 'AT_RISK'), condition('c', 'AT_RISK')],
      recentlyCleared: [],
      freshness: [],
    });

    expect(service.summary()).toEqual({ open: 3, blocksWork: 1 });
  });

  it('forgets the counts on clear', () => {
    service.getSummary().subscribe();
    http.expectOne(`${environment.apiUrl}/setup-health/summary`).flush({ open: 1, blocksWork: 0 });

    service.clear();

    expect(service.summary()).toBeNull();
  });
});
