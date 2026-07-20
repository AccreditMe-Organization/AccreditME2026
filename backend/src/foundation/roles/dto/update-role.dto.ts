import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateRoleDto } from './create-role.dto';

// Permission changes go through the dedicated assign-permissions endpoint,
// not through this general update — keeps the checkbox-matrix UI decoupled
// from the name/description form.
export class UpdateRoleDto extends PartialType(
  OmitType(CreateRoleDto, ['permissionKeys'] as const),
) {}
