import { LookupService } from '../lookup/lookup.service';
import { OrganizationService } from '../organization/organization.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { CommitteeFormChoicesService } from './committee-form-choices.service';

// ACC-255 (plan §10.5) — the committee dialogs' choices are the SAME values the
// two lists they replace serve, read through the same services, for the
// caller's organisation only.

describe('CommitteeFormChoicesService (ACC-255)', () => {
  const TYPES = [{ id: 'type-1', key: 'quality', labelEn: 'Quality', labelAr: null }];
  const UNITS = [{ id: 'unit-1', nameEn: 'Hospital', parentId: null, isActive: true }];

  function make() {
    const lookups = { getValues: jest.fn().mockResolvedValue(TYPES) };
    const organization = { listFlat: jest.fn().mockResolvedValue(UNITS) };
    const service = new CommitteeFormChoicesService(lookups as unknown as LookupService, organization as unknown as OrganizationService);
    return { service, lookups, organization };
  }

  it('returns the committee types and the units exactly as their own services serve them', async () => {
    const { service, lookups } = make();
    await expect(service.forOrganization('org-a')).resolves.toEqual({ committeeTypes: TYPES, orgUnits: UNITS });
    expect(lookups.getValues).toHaveBeenCalledWith('committee_type', 'org-a');
  });

  itEnforcesTenantIsolation("committee form choices — both lists are read for the caller's organisation", async () => {
    const { service, lookups, organization } = make();
    await service.forOrganization('org-b');
    expect(lookups.getValues).toHaveBeenCalledWith('committee_type', 'org-b');
    expect(organization.listFlat).toHaveBeenCalledWith('org-b');
    expect(lookups.getValues).toHaveBeenCalledTimes(1);
    expect(organization.listFlat).toHaveBeenCalledTimes(1);
  });
});
