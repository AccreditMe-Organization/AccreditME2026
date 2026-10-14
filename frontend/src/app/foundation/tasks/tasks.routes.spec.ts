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
