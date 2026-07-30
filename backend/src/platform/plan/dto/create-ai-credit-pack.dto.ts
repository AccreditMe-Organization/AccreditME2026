import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateAiCreditPackDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  nameAr?: string;

  @IsInt()
  @Min(1)
  credits!: number;

  @IsNumberString()
  price!: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  availableTo?: string[];

  @IsInt()
  @IsOptional()
  sortOrder?: number;
}
