import { Injectable } from '@nestjs/common';
import { LookupService } from '../lookup/lookup.service';
import { OrganizationService } from '../organization/organization.service';
import { ICommitteeFormChoices } from './interfaces/committee.interface';

const COMMITTEE_TYPE_CATEGORY = 'committee_type';

/**
 * ACC-255 (plan §10.5) — what the committee create and edit dialogs choose
 * from: the committee types the organisation offers and its units.
 *
 * The dialogs read GET /lookups/categories/committee_type/values (lookups:view)
 * and GET /organization/units/flat (org:view). A tenant-made role that may
 * create or edit committees without those keys got a 403 there, and the
 * field's Retry could never succeed. This serves the SAME values through the
 * same two services, so the lists cannot differ, behind the committee keys.
 *
 * Both reads are scoped by organisation inside their services. Nothing here
 * names a person.
 */
@Injectable()
export class CommitteeFormChoicesService {
  constructor(
    private readonly lookups: LookupService,
    private readonly organization: OrganizationService,
  ) {}

  async forOrganization(organizationId: string): Promise<ICommitteeFormChoices> {
    const [committeeTypes, orgUnits] = await Promise.all([
      this.lookups.getValues(COMMITTEE_TYPE_CATEGORY, organizationId),
      this.organization.listFlat(organizationId),
    ]);
    return { committeeTypes, orgUnits };
  }
}
