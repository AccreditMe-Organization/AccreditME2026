import {
  IsString,
  IsOptional,
  IsArray,
  IsInt,
  ArrayMinSize,
  ArrayMaxSize,
  Min,
  Max,
  Matches,
} from 'class-validator';

export class UpdateWorkingCalendarDto {
  @IsString()
  @IsOptional()
  timezone?: string;

  @IsArray()
  @IsOptional()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  workingDays?: number[];

  @IsString()
  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/, { message: 'workingHoursStart must be in HH:mm format' })
  workingHoursStart?: string;

  @IsString()
  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/, { message: 'workingHoursEnd must be in HH:mm format' })
  workingHoursEnd?: string;
}
