import { TENANT_NAV_GROUPS, isNavModuleOpen } from '../../core/navigation/nav-items';
import { recordPageLink } from '../../shared/utils/record-link.util';

// ACC-316 PR 6 — Meetings in the rail, and the links to a meeting. The rail
// item carries the meetings module, and the committee and unit pages show
// their Meetings panel by the same rule (isNavModuleOpen, ACC-279), so the
// rail and the panels cannot disagree about whether meetings are open.
describe('Meetings navigation and links (ACC-316 PR 6)', () => {
  const item = TENANT_NAV_GROUPS.flatMap((g) => g.items).find((i) => i.key === 'meetings');

  it('the rail item goes to /meetings and carries the meetings module, with no permission of its own', () => {
    expect(item).toBeDefined();
    expect(item!.route).toBe('/meetings');
    expect(item!.moduleKey).toBe('meetings');
    // Members open their own meetings without meetings:view (plan §4.3); the server decides what each view holds.
    expect(item!.requiredPermission).toBeUndefined();
  });

  it('the panels follow the module: open only when the meetings module is', () => {
    expect(isNavModuleOpen('meetings', { isModuleEnabled: (k) => k === 'meetings' })).toBeTrue();
    expect(isNavModuleOpen('meetings', { isModuleEnabled: () => false })).toBeFalse();
  });

  it("a meeting's record link opens its page", () => {
    expect(recordPageLink('MEETING', 'm-1')).toEqual(['/meetings', 'm-1']);
  });
});
