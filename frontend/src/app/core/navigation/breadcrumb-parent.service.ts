import { Injectable, signal } from '@angular/core';
import { normalizePath } from './nav-location';

/**
 * ACC-228 — a page whose ANCESTRY is a record, not a nav section.
 *
 * The breadcrumb is ancestry and stops at the parent (ACC-79). For most pages
 * the nav model gives that parent. A task page's parent is the record the task
 * is about (Q11: "Committees / Infection Prevention & Control"), which only the
 * page knows, once the task has loaded and only if the viewer may open that
 * record. The page names it here; the breadcrumb resolves the record's own
 * section from the nav model, exactly as it would on the record's page, and
 * adds the record after it.
 *
 * Keyed by the page's path, so a parent set by one page can never leak onto the
 * next: a stale entry simply does not match the current URL.
 */
export interface BreadcrumbParent {
  /** The path of the page that set it (normalised). */
  forPath: string;
  /** The parent record's own page, e.g. /committees/abc. */
  url: string;
  /** Its name, already in the reader's language (tenant data, never translated). */
  text: string;
  /**
   * ACC-120 slice 11, PR D — the records above the parent, top first, when the
   * ancestry is longer than one record (an org unit's parent units). Absent
   * for a single parent.
   */
  above?: ReadonlyArray<{ url: string; text: string }>;
}

@Injectable({ providedIn: 'root' })
export class BreadcrumbParentService {
  private readonly parent = signal<BreadcrumbParent | null>(null);
  readonly current = this.parent.asReadonly();

  set(forPath: string, url: string, text: string): void {
    this.parent.set({ forPath: normalizePath(forPath), url, text });
  }

  /**
   * A trail of records, top first, ending with the page's parent. An empty
   * trail clears this page's entry: the nav model alone gives the parent.
   */
  setTrail(forPath: string, crumbs: ReadonlyArray<{ url: string; text: string }>): void {
    const parent = crumbs[crumbs.length - 1];
    if (!parent) return this.clear(forPath);
    this.parent.set({ forPath: normalizePath(forPath), url: parent.url, text: parent.text, above: crumbs.slice(0, -1) });
  }

  /** Clears only this page's own entry. */
  clear(forPath: string): void {
    if (this.parent()?.forPath === normalizePath(forPath)) this.parent.set(null);
  }
}
