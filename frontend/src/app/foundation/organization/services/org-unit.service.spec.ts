import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../../../environments/environment';
import { OrgUnitService } from './org-unit.service';

// ACC-120 slice 11 — the read model's three GETs. No screen reads them yet
// (PR C, D and E do); this pins the URLs and the query each one sends.
describe('OrgUnitService — the read model (ACC-120 slice 11)', () => {
  let service: OrgUnitService;
  let http: HttpTestingController;
  const base = `${environment.apiUrl}/organization/units`;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(OrgUnitService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('getStructure asks for structure, with includeInactive only when wanted', () => {
    service.getStructure().subscribe();
    const plain = http.expectOne((r) => r.url === `${base}/structure`);
    expect(plain.request.method).toBe('GET');
    expect(plain.request.params.has('includeInactive')).toBe(false);
    plain.flush({ nodes: [], asOf: '2026-10-20T09:00:00.000Z' });

    service.getStructure({ includeInactive: true }).subscribe();
    const all = http.expectOne((r) => r.url === `${base}/structure`);
    expect(all.request.params.get('includeInactive')).toBe('true');
    all.flush({ nodes: [], asOf: '2026-10-20T09:00:00.000Z' });
  });

  it('getChart sends rootId and depth only when given', () => {
    service.getChart().subscribe();
    const top = http.expectOne((r) => r.url === `${base}/chart`);
    expect(top.request.params.keys()).toEqual([]);
    top.flush({ root: { id: 'u0', path: [] }, depth: 4, nodes: [], asOf: '' });

    service.getChart({ rootId: 'u3', depth: 2 }).subscribe();
    const rerooted = http.expectOne((r) => r.url === `${base}/chart`);
    expect(rerooted.request.params.get('rootId')).toBe('u3');
    expect(rerooted.request.params.get('depth')).toBe('2');
    rerooted.flush({ root: { id: 'u3', path: [] }, depth: 2, nodes: [], asOf: '' });
  });

  it('getSummary asks for the unit’s summary', () => {
    service.getSummary('u3').subscribe();
    const req = http.expectOne(`${base}/u3/summary`);
    expect(req.request.method).toBe('GET');
    req.flush({});
  });
});
