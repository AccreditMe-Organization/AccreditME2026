import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { PlanModuleAccessLevel } from '../interfaces/plan.interface';

export class UpsertPlanModuleDto {
  @IsString()
  @IsNotEmpty()
  moduleKey!: string;

  @IsEnum(PlanModuleAccessLevel)
  accessLevel!: PlanModuleAccessLevel;
}
