import { Injectable } from '@nestjs/common';
import { LookupService } from '../lookup/lookup.service';

/** The meeting types the organisation offers, as Schedule meeting chooses from them. */
export interface IMeetingFormChoices {
  types: { id: string; labelEn: string; labelAr: string | null }[];
}

/**
 * ACC-316 PR 6 — what Schedule meeting chooses from: the organisation's
 * meeting_type values, active ones only, through the lookup resolution (a
 * tenant override hides or renames a shared value). Not sensitive, and needed
 * by whoever may schedule, who may hold no lookups:view: the route carries no
 * permission, as the committee form's choices need no lookups:view (ACC-255).
 */
@Injectable()
export class MeetingFormChoicesService {
  constructor(private readonly lookups: LookupService) {}

  async forOrganization(organizationId: string): Promise<IMeetingFormChoices> {
    const values = await this.lookups.getValues('meeting_type', organizationId);
    return { types: values.map((v) => ({ id: v.id, labelEn: v.labelEn, labelAr: v.labelAr ?? null })) };
  }
}
