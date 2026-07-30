import { IsDateString } from 'class-validator';

export class ExtendTrialDto {
  @IsDateString()
  trialEndsAt!: string;
}
