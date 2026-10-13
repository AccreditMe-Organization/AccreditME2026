import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { NavigationError, RouterFeatures, withNavigationErrorHandler } from '@angular/router';

/**
 * ACC-223 — a link keeps working after a release, without a hard refresh.
 *
 * A tab opened before a release runs the old main bundle, which knows the OLD
 * lazy-chunk file names. After the release those files are gone, so clicking a
 * link to a screen not yet loaded fails its dynamic import — and the click did
 * nothing, because no navigation error was handled anywhere.
 *
 * When a navigation fails for that reason, ONE full page load of the URL the
 * person was going to: the fresh page brings the new bundle and its chunk
 * names, and they arrive where they meant to. (frontend/vercel.json is the
 * other half: a missing chunk is now a 404, not the HTML page cached for a year
 * under the chunk's address.)
 *
 * ## It can never loop
 *
 * A marker in sessionStorage records when the reload was made. A second chunk
 * failure inside the window does NOT reload again — the error then behaves
 * exactly as it does today — so a chunk that is genuinely missing costs one
 * reload, never a spinning tab. If the marker cannot be written (storage
 * blocked), nothing could stop a loop, so no reload is made at all.
 *
 * ## Every other navigation error is untouched
 *
 * The handler returns nothing. The router does with a navigation error exactly
 * what it does with no handler at all — it emits NavigationError and rejects
 * the navigation (verified in @angular/router 21.2's transition code).
 */

/** sessionStorage key: when this tab last reloaded for a stale chunk (ms since epoch). */
export const STALE_CHUNK_RELOAD_KEY = 'am.staleChunkReloadAt';

/** A second chunk failure within this long after a reload is not reloaded again. */
export const STALE_CHUNK_RELOAD_WINDOW_MS = 60_000;

// What a failed dynamic import says, by engine: Chromium; Firefox; Safari; and
// webpack's ChunkLoadError, should the builder ever change.
const CHUNK_FAILURE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk \S+ failed/i;

/** Whether an error is a lazy chunk, or any dynamic import, that could not be loaded. */
export function isChunkLoadFailure(error: unknown): boolean {
  if (typeof error === 'string') return CHUNK_FAILURE.test(error);
  if (!error || typeof error !== 'object') return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  return name === 'ChunkLoadError' || (typeof message === 'string' && CHUNK_FAILURE.test(message));
}

/** A full page load of a URL. Its own injectable so a spec can watch it instead of leaving the page. */
@Injectable({ providedIn: 'root' })
export class FullPageLoader {
  private readonly document = inject(DOCUMENT);

  load(url: string): void {
    this.document.location.assign(url);
  }
}

/** The router's navigation error handler (runs in an injection context). */
export function reloadOnStaleChunk(error: NavigationError): void {
  if (!isChunkLoadFailure(error.error)) return;

  const loader = inject(FullPageLoader);
  const storage = inject(DOCUMENT).defaultView?.sessionStorage;
  const now = Date.now();
  try {
    const last = Number(storage?.getItem(STALE_CHUNK_RELOAD_KEY));
    // Already tried, moments ago: no loop. (A marker from the future is not one.)
    if (last > 0 && now >= last && now - last < STALE_CHUNK_RELOAD_WINDOW_MS) return;
    if (!storage) return;
    storage.setItem(STALE_CHUNK_RELOAD_KEY, String(now));
  } catch {
    return; // the marker could not be read or written, so a loop could not be stopped
  }
  loader.load(error.url);
}

/**
 * The router features the app is configured with. One list, read by
 * app.config.ts AND by this file's spec, so the spec exercises the handler
 * exactly as the app wires it.
 */
export const APP_ROUTER_FEATURES: RouterFeatures[] = [withNavigationErrorHandler(reloadOnStaleChunk)];
