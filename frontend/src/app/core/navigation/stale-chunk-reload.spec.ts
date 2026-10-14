import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { appConfig } from '../../app.config';
import {
  APP_ROUTER_FEATURES,
  FullPageLoader,
  STALE_CHUNK_RELOAD_KEY,
  STALE_CHUNK_RELOAD_WINDOW_MS,
  isChunkLoadFailure,
  reloadOnStaleChunk,
} from './stale-chunk-reload';

// ACC-223 — a tab opened before a release asks for lazy chunks that are gone.
// The router is REAL here and wired with APP_ROUTER_FEATURES, the same list
// app.config.ts passes to provideRouter, so these exercise the handler as the
// app runs it. Only the full page load is replaced, with a spy.

@Component({ standalone: true, template: '' })
class Blank {}

// What each engine says when a dynamic import cannot be loaded.
const CHROMIUM = 'Failed to fetch dynamically imported module: http://al-nakheel.localhost/chunk-CLEGIXN6.js';
const FIREFOX = 'error loading dynamically imported module: http://al-nakheel.localhost/chunk-CLEGIXN6.js';
const SAFARI = 'Importing a module script failed.';

describe('reloadOnStaleChunk (ACC-223)', () => {
  let router: Router;
  let load: jasmine.Spy;
  let chunkFailure: Error;

  beforeEach(() => {
    sessionStorage.removeItem(STALE_CHUNK_RELOAD_KEY);
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date('2026-10-13T09:00:00Z'));
    chunkFailure = new TypeError(CHROMIUM);
    load = jasmine.createSpy('load');
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [
            { path: 'home', component: Blank },
            { path: 'roles', loadChildren: () => Promise.reject(chunkFailure) },
            { path: 'broken', loadChildren: () => Promise.reject(new Error('the resolver failed')) },
          ],
          ...APP_ROUTER_FEATURES,
        ),
        { provide: FullPageLoader, useValue: { load } },
      ],
    });
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    jasmine.clock().uninstall();
    sessionStorage.removeItem(STALE_CHUNK_RELOAD_KEY);
  });

  /** Navigates and reports how the navigation ended, without failing the test on a rejection. */
  const go = (url: string): Promise<string> =>
    router.navigateByUrl(url).then(
      (ok) => (ok ? 'resolved' : 'cancelled'),
      (e: unknown) => `rejected: ${(e as Error).message}`,
    );

  it('NON-VACUITY: the lazy route really fails, as a chunk failure, through the real router', async () => {
    expect(await go('/roles')).toBe(`rejected: ${CHROMIUM}`);
    expect(isChunkLoadFailure(chunkFailure)).toBe(true);
  });

  it('a failed lazy chunk makes ONE full page load, of the URL the person was going to', async () => {
    await go('/roles?tab=2');

    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('/roles?tab=2');
    expect(Number(sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY))).toBe(Date.now());
  });

  it('a second failure inside the window does NOT reload again: no loop', async () => {
    await go('/roles');
    jasmine.clock().tick(STALE_CHUNK_RELOAD_WINDOW_MS - 1);

    const second = await go('/roles');

    expect(load).toHaveBeenCalledTimes(1);
    // And it behaves as a navigation error does today: the navigation rejects.
    expect(second).toBe(`rejected: ${CHROMIUM}`);
  });

  it('a failure AFTER the window reloads again (a later release, in the same tab)', async () => {
    await go('/roles');
    jasmine.clock().tick(STALE_CHUNK_RELOAD_WINDOW_MS);

    await go('/roles');

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('a navigation error that is NOT a chunk failure never reloads, and rejects as it does today', async () => {
    const outcome = await go('/broken');

    expect(outcome).toBe('rejected: the resolver failed');
    expect(load).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY)).toBeNull();
  });

  it('a successful navigation never reloads', async () => {
    expect(await go('/home')).toBe('resolved');
    expect(load).not.toHaveBeenCalled();
  });

  it('makes NO reload when the marker cannot be written, since nothing could then stop a loop', async () => {
    spyOn(Storage.prototype, 'setItem').and.throwError('storage is blocked');

    await go('/roles');

    expect(load).not.toHaveBeenCalled();
  });

  it('recognises each engine\'s wording, and webpack\'s, and nothing else', () => {
    for (const message of [CHROMIUM, FIREFOX, SAFARI, 'Loading chunk 482 failed.']) {
      expect(isChunkLoadFailure(new TypeError(message))).withContext(message).toBe(true);
    }
    expect(isChunkLoadFailure({ name: 'ChunkLoadError', message: 'anything' })).toBe(true);
    expect(isChunkLoadFailure(CHROMIUM)).toBe(true);

    for (const other of [new Error('the resolver failed'), new Error('Http failure response: 404'), null, undefined, 42, {}]) {
      expect(isChunkLoadFailure(other)).withContext(String(other)).toBe(false);
    }
  });

  // provideRouter's features are opaque provider lists, so the wiring is found
  // by looking for the handler itself among app.config's providers. Without
  // this, deleting the feature from app.config.ts would leave every test above
  // green — they build their own router.
  it('app.config.ts gives the app\'s own router this handler', () => {
    // A fresh visited-set per search: the two lists share the same feature objects.
    const holdsHandler = (root: unknown): boolean => {
      const seen = new Set<unknown>();
      const walk = (node: unknown): boolean => {
        if (!node || typeof node !== 'object' || seen.has(node)) return false;
        seen.add(node);
        if ((node as { useValue?: unknown }).useValue === reloadOnStaleChunk) return true;
        return Object.values(node as Record<string, unknown>).some(walk);
      };
      return walk(root);
    };

    expect(holdsHandler(APP_ROUTER_FEATURES)).withContext('the search finds the handler where it is known to be').toBe(true);
    expect(holdsHandler(appConfig.providers)).toBe(true);
  });
});
