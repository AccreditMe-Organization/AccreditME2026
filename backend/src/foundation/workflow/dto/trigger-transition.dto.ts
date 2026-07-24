import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class TriggerTransitionDto {
  @IsString()
  @IsNotEmpty()
  transitionId!: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  comment?: string;
}
