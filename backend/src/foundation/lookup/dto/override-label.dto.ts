import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class OverrideLabelDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  labelOverrideEn!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  labelOverrideAr!: string;
}
