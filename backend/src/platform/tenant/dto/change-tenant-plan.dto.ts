import { IsString, IsNotEmpty, ValidateIf } from 'class-validator';

// ACC-194 (D18) — PATCH /platform/tenants/:id/plan. A plan id, or null to
// remove the plan. The AI allocation follows the plan (D3).
export class ChangeTenantPlanDto {
  @ValidateIf((dto: ChangeTenantPlanDto) => dto.planId !== null)
  @IsString()
  @IsNotEmpty()
  planId!: string | null;
}
