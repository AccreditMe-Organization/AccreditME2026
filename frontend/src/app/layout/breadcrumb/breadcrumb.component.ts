import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { catchError, filter, map, of, startWith, switchMap } from 'rxjs';
import { NavigationAccessService } from '../../core/services/navigation-access.service';
import { LANDING_ROUTE } from '../../core/navigation/landing-route';
import {
  normalizePath,
  resolveNavLocation,
} from '../../core/navigation/nav-location';

// A crumb is either tenant data (the tenant's own name, rendered as-is) or a
// translation key (a group or page label) — never both.
export interface BreadcrumbItem {
  text?: string;
  labelKey?: string;
  // null for a crumb that is not a page — a rail group has nowhere to go.
  url: string | null;
}

const PLATFORM_LANDING = '/platform/tenants';

// ACC-79 — THE BREADCRUMB IS ANCESTRY, AND STOPS AT THE PARENT.
//
// It never names the current page. The page's H1 (PageHeaderComponent) owns
// that, so the title appears exactly once (UX-04). Before this, the last crumb
// WAS the current page, rendered in bold directly above an H1 saying the same
// word — on 28 pages.
//
// The trail, from frontend/design-reference/AccreditMe App Shell.dc.html:
//
//   landing page       root                                  (Home)
//   a section page     root / group                          (Users)
//   below a section    root / group / section (link)         (a committee)
//
//   root   the tenant's own name, or "Platform" on the platform shell
//   group  the rail group — plain text, since a group is not a page
//
// The reference shows record pages as ".../ Committees / QMC-014", with the
// record's human-readable ID as the last crumb and its name in the H1. No record
// in this product HAS such an ID (CLAUDE.md, Open/Deferred Items), so a record
// page stops at its section. When reference codes exist, the ID crumb goes
// after the section.
//
// ACC-79 also moved this off route `data.breadcrumb`. Those labels were a second
// hand-maintained copy of what the nav model holds; the trail now comes from
// resolveNavLocation(), which the rail and the tab title read too. That removes
// the reason for ACC-13/14's snapshot-walking constraints in this file — there
// is no route tree walked any more — but NOT the per-navigation error isolation
// below, which still matters for the reason recorded there.
@Component({
  selector: 'app-breadcrumb',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  template: `
    @if (items().length > 0) {
      <nav
        class="flex items-center gap-[7px] px-2 min-w-0 text-[12.5px] text-[var(--am-text-secondary)]"
        [attr.aria-label]="'shell.breadcrumb' | translate"
      >
        @for (item of items(); track $index; let last = $last) {
          @if (item.url) {
            <a
              [routerLink]="item.url"
              class="whitespace-nowrap overflow-hidden text-ellipsis hover:text-[var(--am-blue-primary)]"
              >{{ item.text ?? (item.labelKey! | translate) }}</a
            >
          } @else {
            <span class="whitespace-nowrap overflow-hidden text-ellipsis">{{
              item.text ?? (item.labelKey! | translate)
            }}</span>
          }
          @if (!last) {
            <!-- A slash, not an angle icon: it needs no mirroring in RTL, where
                 a right-pointing chevron would point the wrong way. -->
            <span class="text-[var(--am-border)]" aria-hidden="true">/</span>
          }
        }
      </nav>
    }
  `,
})
export class BreadcrumbComponent {
  private readonly router = inject(Router);
  private readonly access = inject(NavigationAccessService);

  private readonly currentUrl = signal('');
  private lastGood: BreadcrumbItem[] = [];

  // A COMPUTED, not a value set once per navigation, because two of its inputs
  // arrive asynchronously AFTER a navigation can complete: the tenant name
  // (entitlements) and the user's permissions. A trail built once at
  // NavigationEnd on a hard reload would miss the root and every group, and
  // never recover until the next navigation.
  readonly items = computed<BreadcrumbItem[]>(() => {
    const url = this.currentUrl();
    // Read the async inputs explicitly so this re-evaluates when they land.
    this.access.tenantName();
    this.access.permissions();
    this.access.modules();
    try {
      this.lastGood = this.buildBreadcrumb(url);
    } catch (err: unknown) {
      // Keeps the last good trail rather than blanking the bar.
      console.error(
        'BreadcrumbComponent: failed to build breadcrumb trail',
        err,
      );
    }
    return this.lastGood;
  });

  constructor() {
    this.router.events
      .pipe(
        filter(
          (event): event is NavigationEnd => event instanceof NavigationEnd,
        ),
        startWith(null),
        // Each navigation gets its own inner observable, so a failure handling
        // ONE navigation cannot tear down the subscription to router.events
        // itself. A plain .subscribe(nextFn) throwing is treated by RxJS as an
        // unhandled error and unsubscribes for good — which is how the original
        // ACC-14 bug went unnoticed on every navigation after the first crash.
        // Still load-bearing after ACC-79, even though reading a URL is simple.
        switchMap(() =>
          of(null).pipe(
            map(() => this.router.url),
            catchError(() => of(this.currentUrl())),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((url) => this.currentUrl.set(url));
  }

  buildBreadcrumb(url: string): BreadcrumbItem[] {
    const path = normalizePath(url);
    const isPlatform = this.access.isPlatformAdmin();
    const landing = isPlatform ? PLATFORM_LANDING : LANDING_ROUTE;
    const onLanding = path === landing;

    const trail: BreadcrumbItem[] = [];

    // The root. It links home — except on home itself, where it would link to
    // the page already open. The tenant name arrives with entitlements; until
    // then there is no root rather than an empty crumb.
    const rootLink = onLanding ? null : landing;
    if (isPlatform) {
      trail.push({ labelKey: 'shell.product.platform', url: rootLink });
    } else if (this.access.tenantName()) {
      trail.push({ text: this.access.tenantName(), url: rootLink });
    }

    if (onLanding) return trail;

    const location = resolveNavLocation(path, this.access);
    if (!location) return trail;

    // The platform shell has one group, labelled "Platform" — the same word as
    // its root. Repeating it would read "Platform / Platform".
    if (location.group.key !== 'platform') {
      trail.push({ labelKey: location.group.labelKey, url: null });
    }

    if (!location.isSectionPage) {
      trail.push({
        labelKey: location.item.labelKey,
        url: location.item.route,
      });
    }

    // Two crumbs must not lead to the same page. On the platform shell the
    // landing page IS the tenants list, so a tenant record would otherwise read
    // "Platform / Tenants" with both linking to /platform/tenants. The more
    // specific crumb keeps the link; the root becomes plain text.
    const root = trail[0];
    if (root?.url && trail.slice(1).some((crumb) => crumb.url === root.url)) {
      trail[0] = { ...root, url: null };
    }

    return trail;
  }
}
