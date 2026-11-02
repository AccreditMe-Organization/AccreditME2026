import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TASKS_ROUTES } from './tasks.routes';
import { permissionGuard } from '../../core/guards/permission.guard';
import { ROUTE_PERMISSIONS } from '../../core/navigation/nav-items';

// ACC-228 — the task page's route. Read from the config itself, because the
// two ways to break it are both silent in the browser: declare ':id' before a
// literal and /tasks/all opens a "task" called "all"; drop its canActivate and
// a child route never runs the guard (CLAUDE.md, ACC-79).
describe('TASKS_ROUTES — the task page (ACC-228)', () => {
  const paths = TASKS_ROUTES.map((r) => r.path);

  it("declares ':id' after every literal path, so 'all' and 'unassigned' are never read as ids", () => {
    expect(paths.indexOf(':id')).toBe(paths.length - 1);
    expect(paths.indexOf('all')).toBeLessThan(paths.indexOf(':id'));
    expect(paths.indexOf('unassigned')).toBeLessThan(paths.indexOf(':id'));
  });

  it('carries its own canActivate', () => {
    const route = TASKS_ROUTES.find((r) => r.path === ':id')!;
    expect(route.canActivate).toEqual([permissionGuard]);
  });

  it('names no permission for it: who may open a task is the server\'s answer (Q4)', () => {
    expect([...ROUTE_PERMISSIONS.keys()].some((path) => /^\/?tasks\/:id/.test(path))).toBe(false);
  });
});

// ACC-120 slice 3 — the old pages are saved views of /tasks. Navigated for real
// through TASKS_ROUTES (the shell and the task page stood in for), so the
// redirects are what a browser follows, query parameters included.
describe('TASKS_ROUTES — the old pages redirect to their views (ACC-120 slice 3)', () => {
  @Component({ standalone: true, template: '' })
  class StubPage {}

  async function land(url: string): Promise<string> {
    TestBed.resetTestingModule();
    const routes = TASKS_ROUTES.map((r) => (r.loadComponent ? { ...r, loadComponent: undefined, canActivate: undefined, component: StubPage } : r));
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: 'tasks', children: routes }])] });
    const router = TestBed.inject(Router);
    await router.navigateByUrl(url);
    return router.url;
  }
  const parsed = (url: string) => {
    const tree = TestBed.inject(Router).parseUrl(url);
    return { path: tree.root.children['primary']?.segments.map((s) => s.path).join('/'), query: tree.queryParams };
  };

  it('sends /tasks/all to /tasks?view=all', async () => {
    expect(parsed(await land('/tasks/all'))).toEqual({ path: 'tasks', query: { view: 'all' } });
  });

  it('sends /tasks/unassigned to /tasks?view=unassigned, keeping ?reassign=', async () => {
    expect(parsed(await land('/tasks/unassigned?reassign=t-9'))).toEqual({ path: 'tasks', query: { reassign: 't-9', view: 'unassigned' } });
  });

  it('keeps every other query parameter on the way', async () => {
    expect(parsed(await land('/tasks/all?recordType=COMMITTEE&x=1'))).toEqual({ path: 'tasks', query: { recordType: 'COMMITTEE', x: '1', view: 'all' } });
  });

  it("leaves My tasks' deep links alone", async () => {
    expect(parsed(await land('/tasks?task=t-1'))).toEqual({ path: 'tasks', query: { task: 't-1' } });
    expect(parsed(await land('/tasks?request=r-1'))).toEqual({ path: 'tasks', query: { request: 'r-1' } });
  });

  it('still opens a task page at /tasks/:id', async () => {
    expect(parsed(await land('/tasks/t-1'))).toEqual({ path: 'tasks/t-1', query: {} });
  });
});
