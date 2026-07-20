import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateRoleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nameEn!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nameAr!: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  // Initial permission set, format "module:action". Validated against the
  // Permission table in the service. Never persisted directly from here —
  // createRole() always forces key=null, isSystem=false regardless of input.
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  permissionKeys?: string[];
}
