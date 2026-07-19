import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateLookupValueDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[a-z0-9_]+$/, { message: 'key must be lowercase letters, numbers, and underscores only' })
  key!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  labelEn!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  labelAr!: string;

  @IsObject()
  @IsOptional()
  attributes?: Record<string, unknown>;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsInt()
  @IsOptional()
  @Min(0)
  sortOrder?: number;
}
