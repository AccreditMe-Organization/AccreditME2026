import { PartialType } from '@nestjs/mapped-types';
import { IsISO8601, IsOptional } from 'class-validator';
import { CreateCommitteeDto } from './create-committee.dto';

export class UpdateCommitteeDto extends PartialType(CreateCommitteeDto) {
  // ACC-238 — the committee's `updatedAt` as the dialog loaded it. When sent,
  // the save is refused (409 COMMITTEE_CHANGED) if the committee has changed
  // since, compared under the committee's row lock. Omitted, the save behaves
  // as before, for any caller that is not the Edit dialog.
  @IsOptional()
  @IsISO8601({ strict: true })
  expectedUpdatedAt?: string;
}
