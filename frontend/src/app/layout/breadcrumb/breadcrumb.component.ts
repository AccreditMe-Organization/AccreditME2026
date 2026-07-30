import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, NavigationEnd, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { catchError, filter, map, of, startWith, switchMap } from 'rxjs';

interface BreadcrumbItem {
  labelKey: string;
  url: string;
}

@Component({
  selector: 'app-breadcrumb',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  template: `
    <nav class="flex items-center gap-2 px-4 py-2 text-sm text-[var(--am-text-secondary)]">
      @for (item of items(); track item.url; let last = $last) {
        @if (!last) {
          <a [routerLink]="item.url" class="hover:text-[var(--am-blue-primary)]">{{ item.labelKey | translate }}</a>
          <i class="pi pi-angle-right text-xs"></i>
        } @else {
          <span class="text-[var(--am-text-primary)] font-medium">{{ item.labelKey | translate }}</span>
        }
      }
    </nav>
  `,
})
export class BreadcrumbComponent {
  private readonly router = inject(Router);

  readonly items = signal<BreadcrumbItem[]>([]);

  constructor() {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        startWith(null),
        // Each navigation gets its own inner observable so a failure building
        // ONE breadcrumb can't tear down the subscription to router.events
        // itself — a plain `.subscribe(nextFn)` throwing synchronously is
        // treated by RxJS as an unhandled error and unsubscribes for good,
        // which is exactly how the original bug went unnoticed on every
        // navigation after the first crash (see git history on this file).
        // catchError here is scoped to just this one build; it always
        // resolves, so the outer subscription to router.events is never at risk.
        switchMap(() =>
          of(null).pipe(
            map(() => this.buildBreadcrumb(this.router.routerState.snapshot.root)),
            catchError((err: unknown) => {
              console.error('BreadcrumbComponent: failed to build breadcrumb trail', err);
              return of(this.items());
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((breadcrumbs) => this.items.set(breadcrumbs));
  }

  private buildBreadcrumb(
    route: ActivatedRouteSnapshot,
    url = '',
    breadcrumbs: BreadcrumbItem[] = [],
  ): BreadcrumbItem[] {
    // Walks router.routerState.snapshot (an ActivatedRouteSnapshot tree) —
    // fully computed and immutable before ANY component activates, unlike
    // the live ActivatedRoute.children this used to walk, which is wired up
    // incrementally, outlet by outlet, DURING component activation. This
    // component sits inside AppShellComponent's own template rather than
    // being itself a routed leaf, so its constructor (and the startWith(null)
    // below) fires as soon as the shell activates — before Angular has
    // finished activating the shell's own nested (often lazy-loaded) child
    // route. Walking the live tree at that exact moment could hit a node
    // whose .snapshot hadn't been assigned yet; the snapshot tree has no such
    // window, since it's computed in full during route recognition, before
    // any component (including this one) starts constructing.
    const children = route.children;
    if (children.length === 0) return breadcrumbs;

    for (const child of children) {
      const routeUrlSegment = child.url.map((seg) => seg.path).join('/');
      const nextUrl = routeUrlSegment ? `${url}/${routeUrlSegment}` : url;
      // child.routeConfig.data is this route's OWN declared data, exactly as
      // authored — never inherited. child.data (the resolved snapshot data)
      // is NOT the same thing: Angular merges an ancestor's data into a
      // descendant's resolved data when the descendant doesn't declare its
      // own, so every leaf route in this app (none of which declare their
      // own breadcrumb) used to report its PARENT's breadcrumb label as if
      // it were its own — pushing the same label twice, once correctly for
      // the parent and once spuriously for the leaf that only inherited it.
      const label = child.routeConfig?.data?.['breadcrumb'] as string | undefined;
      if (label) {
        breadcrumbs.push({ labelKey: label, url: nextUrl });
      }
      return this.buildBreadcrumb(child, nextUrl, breadcrumbs);
    }
    return breadcrumbs;
  }
}
