import {
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateLookupCategoryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @IsOptional()
  labelEn?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @IsOptional()
  labelAr?: string;

  @IsObject()
  @IsOptional()
  attributeSchema?: Record<string, unknown>;

  @IsInt()
  @IsOptional()
  @Min(0)
  sortOrder?: number;
}
