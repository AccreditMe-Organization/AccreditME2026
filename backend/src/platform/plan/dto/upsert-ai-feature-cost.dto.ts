import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class UpsertAiFeatureCostDto {
  @IsString()
  @IsNotEmpty()
  featureKey!: string;

  @IsInt()
  @Min(0)
  creditCost!: number;

  @IsString()
  @IsOptional()
  description?: string;
}
