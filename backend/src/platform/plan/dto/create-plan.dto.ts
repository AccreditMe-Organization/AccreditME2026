import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreatePlanDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  nameEn!: string;

  @IsString()
  @IsNotEmpty()
  nameAr!: string;

  @IsNumberString()
  monthlyPrice!: string;

  @IsNumberString()
  annualPrice!: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxFullUsers?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxStaff?: number;

  @IsInt()
  @Min(1)
  maxStorageGb!: number;

  @IsInt()
  @Min(0)
  aiCreditsPerMonth!: number;

  @IsBoolean()
  @IsOptional()
  isPublic?: boolean;

  @IsInt()
  @IsOptional()
  sortOrder?: number;
}
