import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Routes, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { BreadcrumbComponent } from './breadcrumb.component';

// Mirrors the real architecture exactly: BreadcrumbComponent lives inside the
// SHELL's own template (a template child, not itself a routed leaf) — its
// constructor runs the instant the shell activates, before Angular finishes
// activating the shell's nested, lazy-loaded child route. This is what
// actually reproduced the original crash (walking the live ActivatedRoute
// tree at that exact moment hits a not-yet-activated node) — a stub that
// isn't nested this way, or that uses static (non-lazy) children, would not
// exercise the same timing window.
@Component({
  selector: 'stub-shell',
  standalone: true,
  imports: [BreadcrumbComponent],
  template: `<app-breadcrumb />`,
})
class StubShellComponent {}

@Component({ template: '', standalone: true })
class StubOrgLeafComponent {}

@Component({ template: '', standalone: true })
class StubTenantsLeafComponent {}

const routes: Routes = [
  {
    path: '',
    component: StubShellComponent,
    children: [
      { path: '', redirectTo: 'organization', pathMatch: 'full' },
      {
        path: 'organization',
        data: { breadcrumb: 'nav.organization' },
        // Genuine async loadChildren, matching organization.routes.ts's own
        // shape: parent declares breadcrumb data, leaf does not.
        loadChildren: () =>
          Promise.resolve([{ path: '', component: StubOrgLeafComponent }] as Routes),
      },
      {
        path: 'platform',
        data: { breadcrumb: 'nav.platform' },
        children: [{ path: 'tenants', component: StubTenantsLeafComponent }],
      },
    ],
  },
];

function getBreadcrumbComponent(harness: RouterTestingHarness): BreadcrumbComponent {
  const debugEl = harness.routeDebugElement!.query(By.directive(BreadcrumbComponent));
  return debugEl.componentInstance as BreadcrumbComponent;
}

describe('BreadcrumbComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter(routes), provideTranslateService({ lang: 'en' })],
    });
  });

  it('does not throw when constructed before a lazy-loaded nested route finishes activating, and does not duplicate the parent label', async () => {
    const harness = await RouterTestingHarness.create();

    await expectAsync(harness.navigateByUrl('/organization')).toBeResolved();
    harness.detectChanges();

    const breadcrumb = getBreadcrumbComponent(harness);
    expect(breadcrumb.items()).toEqual([{ labelKey: 'nav.organization', url: '/organization' }]);
  });

  it('recovers on the next navigation after a build failure instead of dying for the rest of the session', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/organization');
    harness.detectChanges();

    const breadcrumb = getBreadcrumbComponent(harness);
    expect(breadcrumb.items()).toEqual([{ labelKey: 'nav.organization', url: '/organization' }]);

    // Force exactly one build failure, simulating whatever the next
    // unrelated bug might be — the point is the subscription itself must
    // survive it, not that this specific failure mode is realistic.
    const original = (breadcrumb as any).buildBreadcrumb.bind(breadcrumb);
    let calls = 0;
    spyOn(breadcrumb as any, 'buildBreadcrumb').and.callFake((...args: unknown[]) => {
      calls++;
      if (calls === 1) throw new Error('simulated breadcrumb build failure');
      return original(...args);
    });

    await harness.navigateByUrl('/platform/tenants');
    harness.detectChanges();

    // Degrades gracefully: keeps the last good trail rather than crashing.
    expect(breadcrumb.items()).toEqual([{ labelKey: 'nav.organization', url: '/organization' }]);

    // A subsequent, different navigation still updates correctly — proves
    // router.events is still being listened to, not dead after the error.
    await harness.navigateByUrl('/organization');
    harness.detectChanges();

    expect(breadcrumb.items()).toEqual([{ labelKey: 'nav.organization', url: '/organization' }]);
  });
});
