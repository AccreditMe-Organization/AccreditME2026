import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { filter, startWith } from 'rxjs';

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
  private readonly activatedRoute = inject(ActivatedRoute);

  readonly items = signal<BreadcrumbItem[]>([]);

  constructor() {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        startWith(null),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.items.set(this.buildBreadcrumb(this.activatedRoute.root)));
  }

  private buildBreadcrumb(
    route: ActivatedRoute,
    url = '',
    breadcrumbs: BreadcrumbItem[] = [],
  ): BreadcrumbItem[] {
    const children = route.children;
    if (children.length === 0) return breadcrumbs;

    for (const child of children) {
      const routeUrlSegment = child.snapshot.url.map((seg) => seg.path).join('/');
      const nextUrl = routeUrlSegment ? `${url}/${routeUrlSegment}` : url;
      const label = child.snapshot.data['breadcrumb'] as string | undefined;
      if (label) {
        breadcrumbs.push({ labelKey: label, url: nextUrl });
      }
      return this.buildBreadcrumb(child, nextUrl, breadcrumbs);
    }
    return breadcrumbs;
  }
}
