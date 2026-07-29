import { IsObject } from 'class-validator';

// Merged into Organization.settings.modules — never overwrites unrelated
// settings keys (e.g. taskSla) wholesale. moduleKey values are free text by
// convention, matching PlanModule.moduleKey — not a Prisma enum.
export class UpdateTenantModulesDto {
  @IsObject()
  modules!: Record<string, boolean>;
}
