import { fakeAsync, tick } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import {
  RequestOutcome,
  composePageOutcome,
  createRequestOutcome,
  isRefreshing,
  isSkeleton,
} from './request-outcome';

describe('createRequestOutcome (ACC-111, artboard 8)', () => {
  const reason = 'A committee needs at least 3 members before it can leave Formation.';

  it('reports rows for a completed response that has some', () => {
    const handle = createRequestOutcome(() => of([{ id: 'a' }]), { emptyReason: reason });
    const outcome = handle.outcome();
    expect(outcome.status).toBe('rows');
    expect(outcome.status === 'rows' && outcome.data.length).toBe(1);
    handle.destroy();
  });

  // The rule the whole type exists for.
  it('reports EMPTY only for a completed response with zero rows, and carries the reason', () => {
    const handle = createRequestOutcome(() => of([]), { emptyReason: reason });
    const outcome = handle.outcome();
    expect(outcome.status).toBe('empty');
    expect(outcome.status === 'empty' && outcome.reason).toBe(reason);
    handle.destroy();
  });

  it('is NEVER empty while the request is still in flight — the 312-users bug', fakeAsync(() => {
    const subject = new Subject<{ id: string }[]>();
    const handle = createRequestOutcome(() => subject, { emptyReason: reason });

    tick(500);
    expect(handle.outcome().status).toBe('loading');
    expect(handle.outcome().status).not.toBe('empty');

    subject.next([{ id: 'a' }]);
    expect(handle.outcome().status).toBe('rows');
    handle.destroy();
  }));

  describe('the two timings', () => {
    it('suppresses the skeleton under 200ms, so a fast answer never flashes', fakeAsync(() => {
      const subject = new Subject<{ id: string }[]>();
      const handle = createRequestOutcome(() => subject, { emptyReason: reason });

      tick(199);
      expect(handle.outcome().status).toBe('idle');

      subject.next([{ id: 'a' }]);
      expect(handle.outcome().status).toBe('rows');

      // And the skeleton timer must not fire after the answer landed.
      tick(1000);
      expect(handle.outcome().status).toBe('rows');
      handle.destroy();
    }));

    it('shows the skeleton once past 200ms', fakeAsync(() => {
      const subject = new Subject<{ id: string }[]>();
      const handle = createRequestOutcome(() => subject, { emptyReason: reason });

      tick(200);
      expect(handle.outcome().status).toBe('loading');
      handle.destroy();
    }));

    it('becomes an error at 8 seconds', fakeAsync(() => {
      const subject = new Subject<{ id: string }[]>();
      const handle = createRequestOutcome(() => subject, { emptyReason: reason });

      tick(7999);
      expect(handle.outcome().status).toBe('loading');

      tick(1);
      expect(handle.outcome().status).toBe('error');
      handle.destroy();
    }));

    it('ignores an answer that arrives AFTER the timeout', fakeAsync(() => {
      const subject = new Subject<{ id: string }[]>();
      const handle = createRequestOutcome(() => subject, { emptyReason: reason });

      tick(8000);
      expect(handle.outcome().status).toBe('error');

      // A late response must not overwrite the error the reader is looking at.
      subject.next([{ id: 'a' }]);
      expect(handle.outcome().status).toBe('error');
      handle.destroy();
    }));
  });

  // Artboard 8: "No centred spinner for an initial load; a spinner means 'in
  // place, refreshing'." Sorting, paging, filtering and searching are all
  // refetches WITH rows already on screen.
  describe('the two loadings', () => {
    const firstLoad = (subject: Subject<{ id: string }[]>) =>
      createRequestOutcome(() => subject, { emptyReason: reason });

    it('keeps the rows on screen during a refetch, rather than blanking them', fakeAsync(() => {
      const first = new Subject<{ id: string }[]>();
      let current: Subject<{ id: string }[]> = first;
      const handle = createRequestOutcome(() => current, { emptyReason: reason });
      first.next([{ id: 'a' }]);
      expect(handle.outcome().status).toBe('rows');

      // A sort: refetch with data already shown.
      const second = new Subject<{ id: string }[]>();
      current = second;
      handle.retry();

      const during = handle.outcome();
      expect(during.status).toBe('rows');
      expect(during.status === 'rows' && during.data.length).toBe(1);
      handle.destroy();
    }));

    it('marks the refetch as refreshing past 200ms — a spinner, not a skeleton', fakeAsync(() => {
      const first = new Subject<{ id: string }[]>();
      let current: Subject<{ id: string }[]> = first;
      const handle = createRequestOutcome(() => current, { emptyReason: reason });
      first.next([{ id: 'a' }]);

      current = new Subject<{ id: string }[]>();
      handle.retry();
      tick(200);

      const during = handle.outcome();
      expect(during.status).toBe('rows');
      expect(during.status === 'rows' && during.refreshing).toBe(true);
      expect(isSkeleton(during)).toBe(false);
      expect(isRefreshing(during)).toBe(true);
      handle.destroy();
    }));

    it('shows NOTHING at all for a fast sort — suppression applies to a refresh too', fakeAsync(() => {
      const first = new Subject<{ id: string }[]>();
      let current: Subject<{ id: string }[]> = first;
      const handle = createRequestOutcome(() => current, { emptyReason: reason });
      first.next([{ id: 'a' }]);

      const second = new Subject<{ id: string }[]>();
      current = second;
      handle.retry();
      tick(150);
      expect(isRefreshing(handle.outcome())).toBe(false);

      second.next([{ id: 'b' }]);
      tick(500);
      const after = handle.outcome();
      expect(after.status === 'rows' && after.data[0].id).toBe('b');
      expect(isRefreshing(after)).toBe(false);
      handle.destroy();
    }));

    it('still shows a SKELETON for the first load, which has nothing to keep', fakeAsync(() => {
      const subject = new Subject<{ id: string }[]>();
      const handle = firstLoad(subject);
      tick(200);
      expect(isSkeleton(handle.outcome())).toBe(true);
      handle.destroy();
    }));

    it('keeps an empty answer on screen while it refetches, with its reason', fakeAsync(() => {
      const first = new Subject<{ id: string }[]>();
      let current: Subject<{ id: string }[]> = first;
      const handle = createRequestOutcome(() => current, { emptyReason: reason });
      first.next([]);
      expect(handle.outcome().status).toBe('empty');

      current = new Subject<{ id: string }[]>();
      handle.retry();
      tick(200);
      const during = handle.outcome();
      expect(during.status).toBe('empty');
      expect(during.status === 'empty' && during.reason).toBe(reason);
      expect(isRefreshing(during)).toBe(true);
      handle.destroy();
    }));
  });

  describe('refusals', () => {
    it('reports a 403 as denied, carrying the status a screen needs', () => {
      const handle = createRequestOutcome(() => throwError(() => ({ status: 403 })), {
        emptyReason: reason,
      });
      const outcome = handle.outcome();
      expect(outcome.status).toBe('denied');
      expect(outcome.status === 'denied' && outcome.httpStatus).toBe(403);
      handle.destroy();
    });

    // ACC-101: a 404 must never become a permission wall, so the status
    // travels rather than being flattened to "denied".
    it('reports a 404 as denied WITH its status, never merged into 403', () => {
      const handle = createRequestOutcome(() => throwError(() => ({ status: 404 })), {
        emptyReason: reason,
      });
      const outcome = handle.outcome();
      expect(outcome.status === 'denied' && outcome.httpStatus).toBe(404);
      handle.destroy();
    });

    it('reports a 500 as an error, with the id support can quote', () => {
      const handle = createRequestOutcome(
        () => throwError(() => ({ status: 500, error: { errorId: 'req_8f2' } })),
        { emptyReason: reason },
      );
      const outcome = handle.outcome();
      expect(outcome.status).toBe('error');
      expect(outcome.status === 'error' && outcome.errorId).toBe('req_8f2');
      handle.destroy();
    });
  });

  it('re-runs the source on retry', fakeAsync(() => {
    let attempt = 0;
    const handle = createRequestOutcome(
      () => {
        attempt += 1;
        return attempt === 1 ? throwError(() => ({ status: 500 })) : of([{ id: 'a' }]);
      },
      { emptyReason: reason },
    );

    expect(handle.outcome().status).toBe('error');
    handle.retry();
    expect(handle.outcome().status).toBe('rows');
    expect(attempt).toBe(2);
    handle.destroy();
  }));

  it('stops its timers when destroyed, so a dead panel cannot error later', fakeAsync(() => {
    const subject = new Subject<{ id: string }[]>();
    const handle = createRequestOutcome(() => subject, { emptyReason: reason });
    handle.destroy();
    tick(10000);
    expect(handle.outcome().status).toBe('idle');
  }));
});

describe('composePageOutcome (ACC-111)', () => {
  const rows: RequestOutcome<unknown> = { status: 'rows', data: [1], refreshing: false };
  const empty: RequestOutcome<unknown> = { status: 'empty', reason: 'none yet', refreshing: false };
  const loading: RequestOutcome<unknown> = { status: 'loading' };
  const error: RequestOutcome<unknown> = { status: 'error' };
  const denied: RequestOutcome<unknown> = { status: 'denied', httpStatus: 403 };

  it('is PARTIAL when one panel failed and its neighbours did not', () => {
    expect(composePageOutcome([rows, error, empty])).toBe('partial');
  });

  it('treats a refusal as a failure for the page, not as a neighbourly success', () => {
    expect(composePageOutcome([rows, denied])).toBe('partial');
  });

  it('is COMPLETE when every panel answered, empty included', () => {
    expect(composePageOutcome([rows, empty])).toBe('complete');
  });

  it('is FAILED only when every panel failed', () => {
    expect(composePageOutcome([error, denied])).toBe('failed');
  });

  it('is LOADING while any panel is still in flight and none has failed', () => {
    expect(composePageOutcome([rows, loading])).toBe('loading');
  });

  it('calls a page with no panels complete rather than loading forever', () => {
    expect(composePageOutcome([])).toBe('complete');
  });
});
