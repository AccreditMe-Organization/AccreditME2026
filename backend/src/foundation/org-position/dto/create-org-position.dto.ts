import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateOrgPositionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nameEn!: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  nameAr?: string;

  @IsString()
  @IsOptional()
  orgUnitId?: string;

  @IsInt()
  @Min(1)
  @Max(10)
  grade!: number;
}
