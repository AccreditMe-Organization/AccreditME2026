import { IsObject } from 'class-validator';

// ACC-286 — an organisation's own values for a SYSTEM lookup value's
// attributes (e.g. whether a committee seat is required). Only keys the
// category's attributeSchema declares are accepted, each of its declared type;
// null removes the organisation's own value for that key, so the shared default
// applies again. Checked in LookupService.overrideAttributes().
export class OverrideAttributesDto {
  @IsObject()
  attributes!: Record<string, unknown>;
}
