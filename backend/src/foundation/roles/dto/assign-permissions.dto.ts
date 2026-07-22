import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';

export class AssignPermissionsDto {
  // Full replacement set for the role — see Business Rules,
  // "Full-replace semantics" in the Step 4 plan.
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  permissionKeys!: string[];
}
