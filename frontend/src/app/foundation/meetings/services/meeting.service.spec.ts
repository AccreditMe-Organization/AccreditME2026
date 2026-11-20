import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../../../environments/environment';
import { MyWorkEvents } from '../../../core/my-work/my-work-events';
import { MeetingService } from './meeting.service';

// ACC-316 PR 7c-2 — a write that changes what waits on someone tells Home and
// the rail (MyWorkEvents, ACC-279), after it succeeds and never when it fails:
// answering the review, suggesting, returning the minutes, and distributing them
// (which gives the present members something to review).
describe('MeetingService — telling Home and the rail (ACC-316 PR 7c-2)', () => {
  let service: MeetingService;
  let http: HttpTestingController;
  let changed: jasmine.Spy;
  const base = `${environment.apiUrl}/meetings`;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(MeetingService);
    http = TestBed.inject(HttpTestingController);
    changed = spyOn(TestBed.inject(MyWorkEvents), 'changed');
  });
  afterEach(() => http.verify());

  const cases: { name: string; send: () => void; url: string; body: unknown }[] = [
    { name: 'No corrections', send: () => service.noCorrections('m-1').subscribe({ error: () => undefined }), url: `${base}/m-1/review/no-corrections`, body: undefined },
    { name: 'a suggestion', send: () => service.suggest('m-1', { agendaItemId: null, text: 'x' }).subscribe({ error: () => undefined }), url: `${base}/m-1/review/suggestions`, body: { id: 's-1' } },
    { name: 'Return for Correction', send: () => service.returnMinutes('m-1', null).subscribe({ error: () => undefined }), url: `${base}/m-1/return`, body: undefined },
    { name: 'Distribute Minutes', send: () => service.distribute('m-1').subscribe({ error: () => undefined }), url: `${base}/m-1/distribute`, body: undefined },
  ];

  for (const c of cases) {
    it(`${c.name}: told after it succeeds`, () => {
      c.send();
      expect(changed).not.toHaveBeenCalled();
      http.expectOne(c.url).flush(c.body ?? null);
      expect(changed).toHaveBeenCalledTimes(1);
    });

    it(`${c.name}: not told when it fails`, () => {
      c.send();
      http.expectOne(c.url).flush({ code: 'STAGE_ACTION_NOT_ALLOWED' }, { status: 409, statusText: 'Conflict' });
      expect(changed).not.toHaveBeenCalled();
    });
  }
});
