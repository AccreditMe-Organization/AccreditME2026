import {
  DestroyRef,
  Injectable,
  Injector,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { NavigationEnd, Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { filter } from 'rxjs';
import { NavigationAccessService } from './navigation-access.service';
import { normalizePath, resolveNavLocation } from '../navigation/nav-location';

// ACC-79 — BROWSER TAB TITLES.
//
//   tenant shell     Committees · Al Nakheel Specialist Hospital — AccreditMe
//   platform shell   Tenants — AccreditMe Platform
//
// Before this every tab read "Frontend", the scaffold's index.html default, so
// someone with four AccreditMe tabs open could not tell them apart — and a user
// with access to two tenants could not tell WHICH tenant a tab belonged to,
// which in a multi-tenant product is the half that matters.
//
// Page first, because a browser truncates the END of a tab title. The tenant
// comes next, then the product. The platform shell names no tenant: it is not
// inside one.

export const PRODUCT_TITLE = 'AccreditMe';
export const PLATFORM_PRODUCT_TITLE = 'AccreditMe Platform';

export function formatDocumentTitle(parts: {
  page: string | null;
  tenant: string | null;
  platform: boolean;
}): string {
  if (parts.platform) {
    return parts.page
      ? `${parts.page} — ${PLATFORM_PRODUCT_TITLE}`
      : PLATFORM_PRODUCT_TITLE;
  }
  const lead = [parts.page, parts.tenant].filter((p): p is string => !!p);
  return lead.length > 0
    ? `${lead.join(' · ')} — ${PRODUCT_TITLE}`
    : PRODUCT_TITLE;
}

export interface PageNameEntry {
  readonly text: string;
}

/**
 * The name the current page gives itself, when it knows better than the rail.
 *
 * PageHeaderComponent registers its H1 here, so a tab reads the same words as
 * the page's heading — and a record page, whose H1 is the record's own name
 * ("Quality Management Committee"), gets that name rather than its section's.
 * There is deliberately no second, per-page title string to maintain.
 *
 * Kept free of dependencies so PageHeaderComponent can inject it anywhere,
 * including specs with no router or HTTP.
 */
@Injectable({ providedIn: 'root' })
export class PageNameRegistry {
  private readonly _entry = signal<PageNameEntry | null>(null);
  readonly entry = this._entry.asReadonly();

  register(text: string): PageNameEntry {
    const entry: PageNameEntry = { text };
    this._entry.set(entry);
    return entry;
  }

  // Released by identity, not by text. Navigating from one page to another
  // with the same heading must not let the old page's destroy wipe the new
  // page's entry.
  release(entry: PageNameEntry): void {
    if (this._entry() === entry) this._entry.set(null);
  }
}

@Injectable({ providedIn: 'root' })
export class DocumentTitleService {
  private readonly router = inject(Router);
  private readonly access = inject(NavigationAccessService);
  private readonly translate = inject(TranslateService);
  private readonly title = inject(Title);
  private readonly pageNames = inject(PageNameRegistry);

  private readonly path = signal(normalizePath(this.router.url));

  constructor() {
    // A root service lives for the whole session, so this subscription is
    // never torn down. It only copies a string, so there is nothing in it that
    // can throw and end it.
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(() => this.path.set(normalizePath(this.router.url)));
  }

  // A COMPUTED for the same reason as the breadcrumb's trail: the tenant name
  // and permissions land asynchronously, often after the first navigation.
  readonly documentTitle = computed(() => {
    const path = this.path();
    // CLAUDE.md (ACC-55) requires this explicit dependency, on the grounds that
    // instant() is not a signal read. On the installed ngx-translate (v18) that
    // is no longer true: instant() reads the store's signals, and removing this
    // line during ACC-79 left the language-switch test passing. Kept because it
    // costs nothing and holds if that internal detail changes; the rule itself
    // is out of date.
    this.translate.currentLang();
    const platform = this.access.isPlatformAdmin();
    const tenant = platform ? null : this.access.tenantName() || null;

    return formatDocumentTitle({
      page: this.pageNames.entry()?.text || this.railLabel(path),
      tenant,
      platform,
    });
  });

  /**
   * Keeps the document title in step while the shell is alive, and resets it
   * when the shell goes — so the sign-in page after a logout does not keep the
   * last tenant's name in its tab.
   */
  attach(injector: Injector): void {
    effect(() => this.title.setTitle(this.documentTitle()), { injector });
    injector
      .get(DestroyRef)
      .onDestroy(() => this.title.setTitle(PRODUCT_TITLE));
  }

  // The fallback for a page with no header of its own yet, and for the moment
  // between a record page opening and its record loading.
  private railLabel(path: string): string | null {
    const location = resolveNavLocation(path, this.access);
    if (!location) return null;
    const key = location.item.labelKey;
    const label = this.translate.instant(key) as string;
    // A missing or not-yet-loaded translation comes back as the key itself.
    // "nav.users — AccreditMe" is worse than no page name at all.
    return label && label !== key ? label : null;
  }
}
